// Anthropic Messages API adapter for RiskReviewer. Anthropic request/response
// types stay in this file. Errors never include keys or response bodies.

import type { AnthropicConfig } from "./config.js";
import {
  AiCallError,
  diagnose,
  errorFromResponse,
  logAiFailure,
  type DiagLogger,
} from "./diagnostics.js";
import { buildSystemPrompt, buildUserMessage } from "./prompt.js";
import type { ReviewRequest, RiskReviewer } from "./reviewer.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Small output: the reply is one short JSON object.
const MAX_TOKENS = 300;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface AnthropicMessageResponse {
  content?: Array<{ type?: string; text?: string }>;
}

export interface AnthropicReviewerOptions {
  config: AnthropicConfig;
  /** Injected for tests; defaults to global fetch. */
  fetch?: FetchLike;
  /** Hard timeout in ms, combined with the caller's signal. */
  timeoutMs?: number;
  /** Receives one sanitized line per failure; defaults to console. */
  logger?: DiagLogger;
}

const consoleLogger: DiagLogger = {
  warn: (obj, msg) => console.warn(JSON.stringify({ msg, ...obj })),
};

export class AnthropicRiskReviewer implements RiskReviewer {
  private readonly config: AnthropicConfig;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly logger: DiagLogger;

  constructor(opts: AnthropicReviewerOptions) {
    this.config = opts.config;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.logger = opts.logger ?? consoleLogger;
  }

  async review(req: ReviewRequest, opts: { signal: AbortSignal }): Promise<unknown> {
    try {
      return await this.call(req, opts);
    } catch (err) {
      // Diagnose, then rethrow unchanged so the guard still fails closed.
      try {
        logAiFailure(this.logger, diagnose(err, this.config.model, [this.config.apiKey]));
      } catch {
        // Logging must never change the outcome.
      }
      throw err;
    }
  }

  private async call(req: ReviewRequest, opts: { signal: AbortSignal }): Promise<unknown> {
    const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(this.timeoutMs)]);

    // No temperature/top_p/top_k: current Claude models (e.g. claude-sonnet-5-5)
    // reject sampling parameters with HTTP 400 "temperature is deprecated".
    const body = {
      model: this.config.model,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: buildUserMessage(req) }],
    };

    const res = await this.fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      throw await errorFromResponse(res);
    }

    let payload: AnthropicMessageResponse;
    try {
      payload = (await res.json()) as AnthropicMessageResponse;
    } catch {
      throw new AiCallError("Anthropic response was not valid JSON", "parse");
    }

    // Find the first text block; it need not be first (e.g. thinking blocks).
    const text = payload.content?.find((b) => b.type === "text" && typeof b.text === "string")?.text;
    if (!text) {
      throw new AiCallError("Anthropic response had no text content", "parse");
    }

    try {
      // TODO(verify): JSON-only compliance without tool use; strip code fences if the model adds them.
      return JSON.parse(text) as unknown;
    } catch {
      throw new AiCallError("Anthropic text content was not valid JSON", "parse");
    }
  }
}
