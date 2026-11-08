// OpenAI-compatible assistant model: mocked fetch only, fake key.
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  OWNER_ID,
  TEST_OWNER_SECRET,
  createHarness,
} from "../../intents/__tests__/helpers.js";
import { signOwnerToken } from "../../owners/tokens.js";
import { OpenAiAssistantModel, parseChatPayload, toChatMessages } from "../model.js";
import { registerAssistantRoutes } from "../routes.js";
import { FAIL_CLOSED_MESSAGE } from "../schema.js";
import { readOnlyView, SYSTEM_PROMPT } from "../service.js";
import { READ_TOOL_NAMES } from "../tools.js";

const FAKE_KEY = "gsk_FakeTestKey0123456789abcdef";
const CONFIG = {
  apiKey: FAKE_KEY,
  baseUrl: "https://api.example.test/openai/v1",
  model: "test-model",
};

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

function scripted(responses: Array<() => Response>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(init.body as string) });
    const next = responses[calls.length - 1];
    if (!next) throw new Error("unexpected extra call");
    return next();
  };
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const toolCallReply = (name: string, args: string, id = "call_1") =>
  json({
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          content: null,
          tool_calls: [
            { id, type: "function", function: { name, arguments: args } },
          ],
        },
      },
    ],
  });
const textReply = (t: string) =>
  json({ choices: [{ finish_reason: "stop", message: { content: t } }] });

async function setup(fetchImpl: (u: string, i: RequestInit) => Promise<Response>) {
  const h = createHarness({ decision: "escalate" });
  const app = Fastify();
  registerAssistantRoutes(app, {
    reads: readOnlyView({
      agents: h.registry.adminStore,
      policies: h.registry.policyStore,
      intents: h.stores.intents,
      audit: h.stores.audit,
    }),
    model: new OpenAiAssistantModel(CONFIG, fetchImpl),
    jwtSecret: TEST_OWNER_SECRET,
    now: () => new Date(h.clock.ms),
    callTimeoutMs: 2000,
    totalTimeoutMs: 5000,
  });
  const token = signOwnerToken(OWNER_ID, TEST_OWNER_SECRET, new Date(h.clock.ms)).token;
  const ask = (text = "How much did I spend?") =>
    app.inject({
      method: "POST",
      url: "/assistant",
      payload: { messages: [{ role: "user", text }] },
      headers: { authorization: `Bearer ${token}` },
    });
  const events = (body: string) =>
    body
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { ask, events };
}

describe("OpenAiAssistantModel request shape and tool round trip", () => {
  it("maps tool_calls to tool_use, runs the read tool, and emits the same NDJSON events", async () => {
    const s = scripted([() => toolCallReply("get_stats", "{}"), () => textReply("You spent $0.00 today.")]);
    const app = await setup(s.fetchImpl);
    const res = await app.ask();
    expect(res.statusCode).toBe(200);
    const ev = app.events(res.body);
    expect(ev.map((e) => e["type"])).toEqual(["note", "text", "done"]);
    expect(String(ev[0]!["text"])).toContain("spending stats");
    expect(ev[1]).toMatchObject({ delta: "You spent $0.00 today." });

    // First request: URL, bearer header only, body with the four function tools.
    const first = s.calls[0]!;
    expect(first.url).toBe("https://api.example.test/openai/v1/chat/completions");
    const headers = first.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Bearer ${FAKE_KEY}`);
    expect(first.url).not.toContain(FAKE_KEY);
    expect(first.body["model"]).toBe("test-model");
    expect(first.body["stream"]).toBeUndefined();
    const tools = first.body["tools"] as Array<{ type: string; function: { name: string } }>;
    expect(tools.every((t) => t.type === "function")).toBe(true);
    expect(tools.map((t) => t.function.name).sort()).toEqual([...READ_TOOL_NAMES].sort());
    const messages = first.body["messages"] as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: "system", content: SYSTEM_PROMPT });

    // Second request carries the assistant tool_calls and the tool result.
    const second = s.calls[1]!.body["messages"] as Array<Record<string, unknown>>;
    const assistant = second.find((m) => m["role"] === "assistant")!;
    expect(assistant["tool_calls"]).toMatchObject([
      { id: "call_1", type: "function", function: { name: "get_stats", arguments: "{}" } },
    ]);
    const tool = second.find((m) => m["role"] === "tool")!;
    expect(tool["tool_call_id"]).toBe("call_1");
    expect(String(tool["content"])).toContain("untrusted_data");
  });

  it("rejects a mutating tool call as unavailable (read-only) and still answers", async () => {
    const s = scripted([() => toolCallReply("approve_intent", '{"intentId":"x"}'), () => textReply("I cannot approve.")]);
    const app = await setup(s.fetchImpl);
    const ev = app.events((await app.ask()).body);
    expect(String(ev[0]!["text"])).toContain("not available");
    const tool = (s.calls[1]!.body["messages"] as Array<Record<string, unknown>>).find((m) => m["role"] === "tool")!;
    expect(String(tool["content"])).toContain("read-only");
  });

  it("fails closed with the fixed message on an HTTP error, without leaking the key", async () => {
    const s = scripted([() => json({ error: { message: `bad key ${FAKE_KEY}` } }, 401)]);
    const app = await setup(s.fetchImpl);
    const res = await app.ask();
    const ev = app.events(res.body);
    expect(ev[0]).toEqual({ type: "error", message: FAIL_CLOSED_MESSAGE });
    expect(res.body).not.toContain(FAKE_KEY);
  });

  it("fails closed on a network error and on an empty reply", async () => {
    const net = await setup(async () => {
      throw new TypeError("fetch failed");
    });
    expect(net.events((await net.ask()).body)[0]).toEqual({ type: "error", message: FAIL_CLOSED_MESSAGE });
    const empty = await setup(async () => json({ choices: [{ message: { content: "" } }] }));
    expect(empty.events((await empty.ask()).body)[0]).toEqual({ type: "error", message: FAIL_CLOSED_MESSAGE });
  });
});

describe("chat payload mapping helpers", () => {
  it("tolerates invalid tool arguments and skips malformed tool_calls", () => {
    const r = parseChatPayload({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: "checking",
            tool_calls: [
              { id: "a", function: { name: "list_intents", arguments: "{not json" } },
              { function: { name: "no_id", arguments: "{}" } },
            ],
          },
        },
      ],
    });
    expect(r.blocks).toEqual([
      { type: "text", text: "checking" },
      { type: "tool_use", id: "a", name: "list_intents", input: null },
    ]);
    expect(r.stopReason).toBe("tool_calls");
  });

  it("converts the internal conversation to chat messages", () => {
    const msgs = toChatMessages({
      system: "S",
      tools: [],
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "get_stats", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }] },
      ],
    });
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
  });
});
