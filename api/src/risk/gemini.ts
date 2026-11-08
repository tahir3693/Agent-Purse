// Gemini generateContent adapter for RiskReviewer. Gemini request/response
// types stay in this file. The key travels only in the x-goog-api-key header,
// never in the URL. Errors never include keys, prompts or response bodies.
//
// Endpoint, header and responseFormat shape follow the official Gemini API docs
// (aistudio.google.com/docs, structured output + text generation, REST tabs).

import type { GeminiConfig } from "./config.js";
import { AiCallError, diagnose, errorFromResponse, logAiFailure, type DiagLogger } from "./diagnostics.js";
import { buildSystemPrompt, buildUserMessage } from "./prompt.js";
import type { ReviewRequest, RiskReviewer } from "./reviewer.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Generous: Gemini 3 thinking tokens count against the output budget.
const MAX_OUTPUT_TOKENS = 2048;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
  promptFeedback?: { blockReason?: string };
}

/** JSON schema of the verdict; mirrors AiReviewSchema. */
export const GEMINI_VERDICT_SCHEMA = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
    riskScore: { type: "integer", minimum: 0, maximum: 100 },
    reason: { type: "string" },
    flagPromptInjection: { type: "boolean" },
  },
  required: ["approved", "riskScore", "reason", "flagPromptInjection"],
} as const;

export function geminiUrl(model: string): string {
  return `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`;
}

export interface GeminiReviewerOptions {
  config: GeminiConfig;
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

export class GeminiRiskReviewer implements RiskReviewer {
  private readonly config: GeminiConfig;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly logger: DiagLogger;

  constructor(opts: GeminiReviewerOptions) {
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
        logAiFailure(this.logger, diagnose(err, this.config.model, [this.config.apiKey], "gemini"));
      } catch {
        // Logging must never change the outcome.
      }
      throw err;
    }
  }

  private async call(req: ReviewRequest, opts: { signal: AbortSignal }): Promise<unknown> {
    const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(this.timeoutMs)]);

    const body = {
      systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
      contents: [{ role: "user", parts: [{ text: buildUserMessage(req) }] }],
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseFormat: {
          text: { mimeType: "APPLICATION_JSON", schema: GEMINI_VERDICT_SCHEMA },
        },
      },
    };

    const res = await this.fetchImpl(geminiUrl(this.config.model), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.config.apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) throw await errorFromResponse(res, "gemini");

    let payload: GeminiResponse;
    try {
      payload = (await res.json()) as GeminiResponse;
    } catch {
      throw new AiCallError("gemini response was not valid JSON", "parse", undefined, undefined, undefined, "gemini");
    }

    const parseError = (msg: string) =>
      new AiCallError(msg, "parse", undefined, undefined, undefined, "gemini");

    if (payload.promptFeedback?.blockReason) throw parseError("gemini blocked the prompt");
    const candidate = payload.candidates?.[0];
    // Skip thought parts; take the first real text part.
    const text = candidate?.content?.parts?.find((p) => p.thought !== true && typeof p.text === "string")?.text;
    if (!text) throw parseError("gemini response had no text content");
    if (candidate?.finishReason === "MAX_TOKENS") throw parseError("gemini output was truncated");

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw parseError("gemini text content was not valid JSON");
    }
  }
}
