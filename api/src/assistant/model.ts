// LLM boundary for the assistant. Anthropic types stay in this file; errors
// carry an HTTP status at most, never the key, request or response body.
import type { AnthropicConfig, OpenAiConfig } from "../risk/config.js";
import { chatCompletionsUrl, reasoningParams } from "../risk/openai.js";

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

// --- OpenAI-compatible chat completions (Groq, OpenRouter, ...) -------------
// Each turn is one non-streaming POST {AI_BASE_URL}/chat/completions with the
// four read-only tools sent as function tools. The model's tool_calls map to
// the same internal tool_use blocks, and the loop in service.ts still emits the
// same NDJSON events, so the web adapter is unchanged. The key is sent only in
// the Authorization header; errors carry an HTTP status at most.

// Free tiers allow few tokens per minute; keep replies short. Reasoning effort is low.
const OPENAI_MAX_TOKENS = 1024;

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

/** Maps the internal Anthropic-shaped conversation to chat/completions messages. */
export function toChatMessages(req: ModelRequest): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: req.system }];
  for (const m of req.messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const text = m.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");
      const calls = m.content
        .filter(
          (b): b is Extract<ModelBlock, { type: "tool_use" }> =>
            b.type === "tool_use"
        )
        .map((b) => ({
          id: b.id,
          type: "function" as const,
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      });
      continue;
    }
    for (const b of m.content) {
      if (b.type === "tool_result")
        out.push({
          role: "tool",
          tool_call_id: b.tool_use_id,
          content: b.content,
        });
      else if (b.type === "text") out.push({ role: "user", content: b.text });
    }
  }
  return out;
}

export class OpenAiAssistantModel implements AssistantModel {
  private readonly fetchImpl: FetchLike;
  constructor(
    private readonly config: OpenAiConfig,
    fetchImpl?: FetchLike
  ) {
    this.fetchImpl = fetchImpl ?? ((i, init) => fetch(i, init));
  }

  async complete(
    req: ModelRequest,
    signal: AbortSignal
  ): Promise<ModelResponse> {
    const res = await this.fetchImpl(chatCompletionsUrl(this.config.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: OPENAI_MAX_TOKENS,
        ...reasoningParams(this.config),
        messages: toChatMessages(req),
        tools: req.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          },
        })),
      }),
      signal,
    });
    if (!res.ok)
      throw new Error(
        `OpenAI-compatible request failed with status ${res.status}`
      );
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new Error("OpenAI-compatible response was not valid JSON");
    }
    return parseChatPayload(payload);
  }
}

/** Keeps only well-formed text and function tool_calls from choices[0]. */
export function parseChatPayload(payload: unknown): ModelResponse {
  const choice = (
    payload as {
      choices?: Array<{
        finish_reason?: unknown;
        message?: { content?: unknown; tool_calls?: unknown };
      }>;
    }
  )?.choices?.[0];
  const message = choice?.message;
  if (!message) throw new Error("OpenAI-compatible response had no message");
  const blocks: ModelBlock[] = [];
  if (typeof message.content === "string" && message.content.trim())
    blocks.push({ type: "text", text: message.content });
  if (Array.isArray(message.tool_calls)) {
    for (const c of message.tool_calls as Array<Record<string, unknown>>) {
      const fn = c?.["function"] as Record<string, unknown> | undefined;
      if (typeof c?.["id"] !== "string" || typeof fn?.["name"] !== "string")
        continue;
      let input: unknown = {};
      if (typeof fn["arguments"] === "string" && fn["arguments"].trim()) {
        try {
          input = JSON.parse(fn["arguments"]);
        } catch {
          input = null; // invalid arguments: the tool layer rejects them
        }
      }
      blocks.push({
        type: "tool_use",
        id: c["id"],
        name: fn["name"],
        input,
      });
    }
  }
  return {
    blocks,
    stopReason:
      typeof choice?.finish_reason === "string"
        ? choice.finish_reason
        : "stop",
  };
}
