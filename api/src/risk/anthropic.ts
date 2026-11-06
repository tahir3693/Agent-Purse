// Anthropic Messages API adapter for RiskReviewer. Anthropic request/response
// types stay in this file. Errors never include keys or response bodies.

import type { AnthropicConfig } from "./config.js";
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
}

export class AnthropicRiskReviewer implements RiskReviewer {
  private readonly config: AnthropicConfig;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: AnthropicReviewerOptions) {
    this.config = opts.config;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async review(req: ReviewRequest, opts: { signal: AbortSignal }): Promise<unknown> {
    const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(this.timeoutMs)]);

    const body = {
      model: this.config.model, // TODO(verify): model id claude-sonnet-5-5 accepted by the API
      max_tokens: MAX_TOKENS,
      temperature: 0,
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
      // Status only: the body may echo request content.
      throw new Error(`Anthropic request failed with status ${res.status}`);
    }

    let payload: AnthropicMessageResponse;
    try {
      payload = (await res.json()) as AnthropicMessageResponse;
    } catch {
      throw new Error("Anthropic response was not valid JSON");
    }

    const text = payload.content?.find((b) => b.type === "text" && typeof b.text === "string")?.text;
    if (!text) {
      throw new Error("Anthropic response had no text content");
    }

    try {
      // TODO(verify): JSON-only compliance without tool use; strip code fences if the model adds them.
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Anthropic text content was not valid JSON");
    }
  }
}
