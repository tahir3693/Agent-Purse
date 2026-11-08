// AG Studio AgLlmAdapter for the AgentPurse assistant (spec-09b).
// executeTurn posts the conversation text to this app's BFF (/api/assistant);
// the API runs the model with server-owned, read-only tools. The adapter:
//  - sends only user and assistant TEXT (never request.tools, request.instructions,
//    system-role items, tool calls, tool results or reasoning),
//  - never emits TOOL_CALL_* events, so Studio executes nothing,
//  - never sees an LLM key.
import type {
  AgAiConversationItem,
  AgAiEvent,
  AgLlmAdapter,
  AgLlmExecuteTurnOptions,
  AgLlmRequest,
  AgLlmResponse,
  AgLlmResponseHandler,
} from "ag-studio";

export const MAX_MESSAGES = 20;
export const MAX_TEXT = 4000;
export const FAIL_MESSAGE =
  "The assistant is unavailable right now. No action was taken.";

export interface AssistantMessage {
  role: "user" | "assistant";
  text: string;
}

/** Studio conversation -> plain user/assistant text, newest MAX_MESSAGES. */
export function toAssistantMessages(
  input: AgAiConversationItem[]
): AssistantMessage[] {
  const out: AssistantMessage[] = [];
  for (const item of input) {
    if (item.type !== "message") continue;
    if (item.kind === "input" && item.role === "user") {
      const text = item.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("")
        .trim();
      if (text) out.push({ role: "user", text: text.slice(0, MAX_TEXT) });
    } else if (item.kind === "output" && item.role === "assistant") {
      const text = item.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("")
        .trim();
      if (text) out.push({ role: "assistant", text: text.slice(0, MAX_TEXT) });
    }
    // system-role input, tool calls, tool results and reasoning are never sent.
  }
  const recent = out.slice(-MAX_MESSAGES);
  while (recent.length > 0 && recent[0]!.role !== "user") recent.shift();
  return recent;
}

/** Minimal async queue so events can be pushed while Studio iterates. */
class EventChannel<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private closed = false;
  push(item: T) {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }
  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0))
      w({ value: undefined as never, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined)
          return Promise.resolve({ value: item, done: false });
        if (this.closed)
          return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

const HTTP_MESSAGES: Record<number, string> = {
  401: "Your session has expired. Sign in again to use the assistant.",
  429: "Too many assistant requests. Try again in a minute.",
};

let seq = 0;
const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export interface AssistantAdapterOptions {
  endpoint?: string;
  fetch?: typeof fetch;
}

export function createAssistantAdapter(
  opts: AssistantAdapterOptions = {}
): AgLlmAdapter {
  const endpoint = opts.endpoint ?? "/api/assistant";
  const fetchImpl = opts.fetch ?? ((i, init) => fetch(i, init));

  return {
    executeTurn(
      request: AgLlmRequest,
      options?: AgLlmExecuteTurnOptions
    ): AgLlmResponseHandler {
      const channel = new EventChannel<AgAiEvent>();
      const responseId = newId("resp");
      const textId = newId("msg");
      let text = "";
      let textOpen = false;

      const emitText = (delta: string) => {
        if (!textOpen) {
          channel.push({
            type: "TEXT_MESSAGE_START",
            messageId: textId,
            role: "assistant",
          });
          textOpen = true;
        }
        text += delta;
        channel.push({
          type: "TEXT_MESSAGE_CONTENT",
          messageId: textId,
          delta,
        });
      };
      const emitNote = (note: string) => {
        const id = newId("note");
        channel.push({
          type: "REASONING_MESSAGE_START",
          messageId: id,
          role: "reasoning",
        });
        channel.push({
          type: "REASONING_MESSAGE_CONTENT",
          messageId: id,
          delta: note,
        });
        channel.push({ type: "REASONING_MESSAGE_END", messageId: id });
      };

      const finish = (
        status: AgLlmResponse["status"],
        error?: string
      ): AgLlmResponse => {
        if (textOpen)
          channel.push({ type: "TEXT_MESSAGE_END", messageId: textId });
        channel.close();
        return {
          id: responseId,
          createdAt: Date.now(),
          status,
          ...(error
            ? { error: { code: "assistant_unavailable", message: error } }
            : {}),
          output: text
            ? [
                {
                  id: textId,
                  kind: "output",
                  type: "message",
                  role: "assistant",
                  status: status === "completed" ? "completed" : "incomplete",
                  content: [{ type: "text", text, annotations: [] }],
                },
              ]
            : [],
        };
      };
      const failWith = (message: string) => {
        emitText(message);
        return finish("failed", message);
      };

      const complete = (async (): Promise<AgLlmResponse> => {
        const messages = toAssistantMessages(request.input);
        if (messages.length === 0) return failWith(FAIL_MESSAGE);
        let res: Response;
        try {
          res = await fetchImpl(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/x-ndjson",
            },
            // Only the conversation text. Never request.tools / instructions / system items.
            body: JSON.stringify({ messages }),
            signal: options?.signal,
          });
        } catch {
          if (options?.signal?.aborted) return finish("cancelled");
          return failWith(FAIL_MESSAGE);
        }
        if (!res.ok || !res.body)
          return failWith(HTTP_MESSAGES[res.status] ?? FAIL_MESSAGE);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let failed: string | null = null;
        const handleLine = (line: string) => {
          if (!line.trim()) return;
          let ev: {
            type?: unknown;
            delta?: unknown;
            text?: unknown;
            message?: unknown;
          };
          try {
            ev = JSON.parse(line) as typeof ev;
          } catch {
            return;
          }
          if (ev.type === "text" && typeof ev.delta === "string")
            emitText(ev.delta);
          else if (ev.type === "note" && typeof ev.text === "string")
            emitNote(ev.text.slice(0, 200));
          else if (ev.type === "error")
            failed =
              typeof ev.message === "string"
                ? ev.message.slice(0, 200)
                : FAIL_MESSAGE;
          // Any other type (including anything tool-like) is ignored.
        };
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buffer.indexOf("\n")) !== -1) {
              handleLine(buffer.slice(0, nl));
              buffer = buffer.slice(nl + 1);
            }
          }
          handleLine(buffer);
        } catch {
          if (options?.signal?.aborted) return finish("cancelled");
          return failWith(FAIL_MESSAGE);
        }
        if (failed) return failWith(failed);
        if (!text) return failWith(FAIL_MESSAGE);
        return finish("completed");
      })();

      return { stream: channel, complete };
    },
  };
}
