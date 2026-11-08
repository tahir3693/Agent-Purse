// LLM boundary for the assistant. Anthropic types stay in this file; errors
// carry an HTTP status at most, never the key, request or response body.
import type { AnthropicConfig } from "../risk/config.js";

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ModelBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export type ModelContent =
  | string
  | Array<
      | ModelBlock
      | {
          type: "tool_result";
          tool_use_id: string;
          content: string;
          is_error?: boolean;
        }
    >;

export interface ModelMessage {
  role: "user" | "assistant";
  content: ModelContent;
}

export interface ModelRequest {
  system: string;
  messages: ModelMessage[];
  tools: ToolSpec[];
}

export interface ModelResponse {
  blocks: ModelBlock[];
  stopReason: string;
}

export interface AssistantModel {
  complete(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 1024;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class AnthropicAssistantModel implements AssistantModel {
  private readonly fetchImpl: FetchLike;
  constructor(
    private readonly config: AnthropicConfig,
    fetchImpl?: FetchLike
  ) {
    this.fetchImpl = fetchImpl ?? ((i, init) => fetch(i, init));
  }

  async complete(
    req: ModelRequest,
    signal: AbortSignal
  ): Promise<ModelResponse> {
    const res = await this.fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      // TODO(verify): tool use with the configured AI_MODEL id.
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: MAX_TOKENS,
        system: req.system,
        messages: req.messages,
        tools: req.tools,
      }),
      signal,
    });
    if (!res.ok)
      throw new Error(`Anthropic request failed with status ${res.status}`);
    let payload: { content?: unknown; stop_reason?: unknown };
    try {
      payload = (await res.json()) as typeof payload;
    } catch {
      throw new Error("Anthropic response was not valid JSON");
    }
    return parseModelPayload(payload);
  }
}

/** Keeps only well-formed text and tool_use blocks. */
export function parseModelPayload(payload: {
  content?: unknown;
  stop_reason?: unknown;
}): ModelResponse {
  if (!Array.isArray(payload.content))
    throw new Error("Anthropic response had no content");
  const blocks: ModelBlock[] = [];
  for (const b of payload.content as Array<Record<string, unknown>>) {
    if (b?.["type"] === "text" && typeof b["text"] === "string")
      blocks.push({ type: "text", text: b["text"] });
    else if (
      b?.["type"] === "tool_use" &&
      typeof b["id"] === "string" &&
      typeof b["name"] === "string"
    ) {
      blocks.push({
        type: "tool_use",
        id: b["id"],
        name: b["name"],
        input: b["input"] ?? {},
      });
    }
  }
  return {
    blocks,
    stopReason:
      typeof payload.stop_reason === "string"
        ? payload.stop_reason
        : "end_turn",
  };
}
