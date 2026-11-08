// OpenAI-compatible chat completions adapter for RiskReviewer (Groq, OpenRouter
// and similar). Provider request/response types stay in this file. The key
// travels only in the Authorization header. Errors never include keys,
// prompts or response bodies.
//
// Request shape follows Groq's docs: POST {base}/chat/completions with
// response_format {"type": "json_object"} and an explicit JSON instruction in
// the prompt (https://console.groq.com/docs/structured-outputs).
import { createHash } from "node:crypto";
import type { OpenAiConfig } from "./config.js";
import { AiCallError, diagnose, errorFromResponse, logAiFailure, type DiagLogger } from "./diagnostics.js";
import { buildCompactSystemPrompt, buildUserMessage } from "./prompt.js";
import type { ReviewRequest, RiskReviewer } from "./reviewer.js";

// Free tiers allow very few tokens per minute, so the verdict budget is small.
// It covers the JSON verdict plus the few reasoning tokens left at effort "low".
const MAX_OUTPUT_TOKENS = 400;

/** Identical requests within this window reuse the previous verdict. */
export const REVIEW_CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 100;

/**
 * Groq's reasoning docs (https://console.groq.com/docs/reasoning) define
 * `reasoning_effort` for GPT-OSS models with low | medium | high. "low" is the
 * lowest. It is sent only to Groq-hosted gpt-oss models, since other
 * OpenAI-compatible hosts may not accept the parameter.
 */
export function reasoningParams(config: { baseUrl: string; model: string }): { reasoning_effort?: "low" } {
  let host = "";
  try {
    host = new URL(config.baseUrl).hostname;
  } catch {
    // normalizeBaseUrl already validated it; treat anything else as "not Groq".
  }
  return host === "api.groq.com" && /gpt-oss/i.test(config.model) ? { reasoning_effort: "low" } : {};
}
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface ChatResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: unknown };
  }>;
}

/** `${baseUrl}/chat/completions`, tolerant of trailing slashes on the base. */
export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/**
 * Parse model text as JSON. Tolerates a ```json fence and prose around a single
 * object. Returns undefined when nothing parses. Never throws.
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text);
  const candidates = [text.trim(), fenced?.[1]?.trim() ?? ""];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c) as unknown;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

export interface OpenAiReviewerOptions {
  config: OpenAiConfig;
  /** Injected for tests; defaults to global fetch. */
  fetch?: FetchLike;
  /** Hard timeout in ms, combined with the caller's signal. */
  timeoutMs?: number;
  /** Receives one sanitized line per failure; defaults to console. */
  logger?: DiagLogger;
  /** Clock for the verdict cache; defaults to Date.now. */
  now?: () => number;
  /** Verdict cache window in ms; 0 disables it. Defaults to 60 seconds. */
  cacheTtlMs?: number;
}

const consoleLogger: DiagLogger = {
  warn: (obj, msg) => console.warn(JSON.stringify({ msg, ...obj })),
};

export class OpenAiRiskReviewer implements RiskReviewer {
  private readonly config: OpenAiConfig;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly logger: DiagLogger;
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(opts: OpenAiReviewerOptions) {
    this.config = opts.config;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 12_000;
    this.logger = opts.logger ?? consoleLogger;
    this.now = opts.now ?? Date.now;
    this.cacheTtlMs = opts.cacheTtlMs ?? REVIEW_CACHE_TTL_MS;
  }

  /** Stable key over the model and every reviewed field; the raw text is hashed, never stored. */
  private cacheKey(req: ReviewRequest): string {
    return createHash("sha256")
      .update(JSON.stringify([this.config.model, buildUserMessage(req)]))
      .digest("hex");
  }

  async review(req: ReviewRequest, opts: { signal: AbortSignal }): Promise<unknown> {
    const key = this.cacheTtlMs > 0 ? this.cacheKey(req) : null;
    if (key) {
      const hit = this.cache.get(key);
      if (hit && this.now() - hit.at < this.cacheTtlMs) return hit.value;
      // Same request already on its way: share its result instead of spending tokens twice.
      const pending = this.inFlight.get(key);
      if (pending) return pending;
    }
    const run = this.reviewUncached(req, opts);
    if (!key) return run;
    this.inFlight.set(key, run);
    try {
      const value = await run;
      // Only successful verdicts are cached; failures are never reused.
      this.cache.set(key, { at: this.now(), value });
      if (this.cache.size > MAX_CACHE_ENTRIES) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      return value;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async reviewUncached(req: ReviewRequest, opts: { signal: AbortSignal }): Promise<unknown> {
    try {
      return await this.call(req, opts);
    } catch (err) {
      // Diagnose, then rethrow unchanged so the guard still fails closed.
      try {
        logAiFailure(this.logger, diagnose(err, this.config.model, [this.config.apiKey], "openai"));
      } catch {
        // Logging must never change the outcome.
      }
      throw err;
    }
  }

  private async call(req: ReviewRequest, opts: { signal: AbortSignal }): Promise<unknown> {
    const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(this.timeoutMs)]);
    const body = {
      model: this.config.model,
      temperature: 0,
      max_tokens: MAX_OUTPUT_TOKENS,
      ...reasoningParams(this.config),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildCompactSystemPrompt() },
        { role: "user", content: buildUserMessage(req) },
      ],
    };
    const res = await this.fetchImpl(chatCompletionsUrl(this.config.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await errorFromResponse(res, "openai");

    const parseError = (msg: string) => new AiCallError(msg, "parse", undefined, undefined, undefined, "openai");
    let payload: ChatResponse;
    try {
      payload = (await res.json()) as ChatResponse;
    } catch {
      throw parseError("openai response was not valid JSON");
    }
    const choice = payload.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw parseError("openai response had no text content");
    if (choice?.finish_reason === "length") throw parseError("openai output was truncated");
    const parsed = extractJson(content);
    if (parsed === undefined) throw parseError("openai text content was not valid JSON");
    return parsed;
  }
}
