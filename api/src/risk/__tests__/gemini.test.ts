// Gemini adapter, provider config and AI_PROVIDER=off behaviour.
// Mocked fetch only; keys below are fake.

import { describe, expect, it } from "vitest";

import { DEFAULT_GEMINI_MODEL, loadAiConfig } from "../config.js";
import { GeminiRiskReviewer, geminiUrl } from "../gemini.js";
import { evaluateRisk } from "../guard.js";
import { createRiskReviewer } from "../provider.js";
import type { ReviewRequest } from "../reviewer.js";
import { CONFIG, deps, FakeReviewer, OK_REVIEW, price, riskInput } from "./helpers.js";

const FAKE_KEY = "AIzaFakeTestKey0123456789abcdefgh";
const config = { apiKey: FAKE_KEY, model: "gemini-3.8-flash" };
const req: ReviewRequest = {
  payee: "example.com",
  description: "SECRET-PROMPT-TEXT",
  justification: "needed",
  amountCents: 1_000,
  currency: "USD",
  priceStatus: "ok",
};
const REVIEW = { approved: true, riskScore: 5, reason: "fine", flagPromptInjection: false };

type Fetch = (u: string, i: RequestInit) => Promise<Response>;

function setup(fetchImpl: Fetch) {
  const lines: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  const reviewer = new GeminiRiskReviewer({
    config,
    fetch: fetchImpl,
    logger: { warn: (obj, msg) => lines.push({ obj, msg }) },
  });
  const run = () => reviewer.review(req, { signal: new AbortController().signal }).catch((e: unknown) => e);
  return { lines, reviewer, run };
}

const geminiOk = (text: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] }, ...extra }] }), {
    status: 200,
  });
const errRes = (status: number, st: string, message: string) =>
  new Response(JSON.stringify({ error: { code: status, status: st, message } }), { status });

describe("GeminiRiskReviewer success", () => {
  it("returns parsed JSON; key only in header; strict JSON format requested", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const { reviewer, lines } = setup(async (u, i) => {
      url = u;
      init = i;
      return geminiOk(JSON.stringify(REVIEW));
    });
    await expect(reviewer.review(req, { signal: new AbortController().signal })).resolves.toEqual(REVIEW);
    expect(lines).toHaveLength(0);
    expect(url).toBe(geminiUrl("gemini-3.8-flash"));
    expect(url).not.toContain(FAKE_KEY);
    const h = init!.headers as Record<string, string>;
    expect(h["x-goog-api-key"]).toBe(FAKE_KEY);
    const body = JSON.parse(init!.body as string) as {
      generationConfig: { responseFormat: { text: { mimeType: string; schema: { required: string[] } } } };
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ parts: Array<{ text: string }> }>;
    };
    expect(body.generationConfig.responseFormat.text.mimeType).toBe("APPLICATION_JSON");
    expect(body.generationConfig.responseFormat.text.schema.required).toContain("riskScore");
    expect(body.systemInstruction.parts[0]!.text).toContain("untrusted");
    expect(body.contents[0]!.parts[0]!.text).toContain("UNTRUSTED_INTENT_DATA");
  });

  it("skips thought parts when picking the text", async () => {
    const { reviewer } = setup(async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "thinking...", thought: true }, { text: JSON.stringify(REVIEW) }] } }],
        }),
        { status: 200 },
      ),
    );
    await expect(reviewer.review(req, { signal: new AbortController().signal })).resolves.toEqual(REVIEW);
  });
});

describe("GeminiRiskReviewer error mapping", () => {
  const cases: Array<[string, Fetch, string, number | undefined]> = [
    ["bad key (400)", async () => errRes(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key."), "auth", 400],
    ["403", async () => errRes(403, "PERMISSION_DENIED", "denied"), "auth", 403],
    ["404 model", async () => errRes(404, "NOT_FOUND", "models/x is not found"), "model_not_found", 404],
    ["400 bad request", async () => errRes(400, "INVALID_ARGUMENT", "Invalid JSON payload"), "bad_request", 400],
    ["429", async () => errRes(429, "RESOURCE_EXHAUSTED", "quota"), "rate_limited", 429],
    ["503", async () => errRes(503, "UNAVAILABLE", "overloaded"), "rate_limited", 503],
    ["504", async () => new Response("x", { status: 504 }), "timeout", 504],
    ["500", async () => new Response("x", { status: 500 }), "unknown", 500],
    [
      "timeout",
      async () => {
        throw Object.assign(new Error("t"), { name: "TimeoutError" });
      },
      "timeout",
      undefined,
    ],
    [
      "network",
      async () => {
        throw new TypeError("fetch failed");
      },
      "network",
      undefined,
    ],
    ["not JSON envelope", async () => new Response("<html>", { status: 200 }), "parse", undefined],
    ["no candidates", async () => new Response("{}", { status: 200 }), "parse", undefined],
    ["blocked prompt", async () => new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), { status: 200 }), "parse", undefined],
    ["bad text JSON", async () => geminiOk("nope"), "parse", undefined],
    ["truncated", async () => geminiOk("{", { finishReason: "MAX_TOKENS" }), "parse", undefined],
  ];

  it.each(cases)("%s", async (_n, fetchImpl, kind, status) => {
    const { lines, run } = setup(fetchImpl);
    expect(await run()).toBeInstanceOf(Error);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.obj).toMatchObject({ event: "ai_review_failed", provider: "gemini", kind, model: "gemini-3.8-flash" });
    expect(lines[0]!.obj["httpStatus"]).toBe(status);
  });

  it("redacts the key (exact and AIza shape) and never logs the prompt", async () => {
    const { lines, run } = setup(async () =>
      errRes(400, "INVALID_ARGUMENT", `bad ${FAKE_KEY} AIzaSyAnotherKey0123456789abc ${"z".repeat(400)}`),
    );
    await run();
    const text = JSON.stringify(lines);
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain("AIzaSyAnotherKey");
    expect(text).not.toContain("SECRET-PROMPT-TEXT");
    expect(text).not.toContain("x-goog-api-key");
    expect((lines[0]!.obj["message"] as string).length).toBeLessThanOrEqual(200);
  });
});

describe("fail closed with Gemini", () => {
  it("a provider error escalates, never approves", async () => {
    const { reviewer } = setup(async () => errRes(429, "RESOURCE_EXHAUSTED", "quota"));
    const d = await evaluateRisk(deps(reviewer, price("ok"), { ...CONFIG, aiTimeoutMs: 2_000 }), riskInput());
    expect(d.decision).toBe("escalate");
    expect(d.riskScore).toBe(100);
    expect(d.audit.aiOutcome).toBe("ai_error");
  });

  it("a schema-violating verdict escalates (ai_parse)", async () => {
    const { reviewer } = setup(async () => geminiOk(JSON.stringify({ ...REVIEW, extra: 1 })));
    const d = await evaluateRisk(deps(reviewer, price("ok"), { ...CONFIG, aiTimeoutMs: 2_000 }), riskInput());
    expect(d.decision).toBe("escalate");
    expect(d.audit.aiOutcome).toBe("ai_parse");
  });
});

describe("loadAiConfig", () => {
  const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

  it("defaults to anthropic", () => {
    expect(loadAiConfig(env({ ANTHROPIC_API_KEY: "k" }))).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" });
  });
  it("gemini uses GEMINI_API_KEY and the documented default model", () => {
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(loadAiConfig(env({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "k" }))).toEqual({
      provider: "gemini",
      apiKey: "k",
      model: "gemini-3.8-flash",
    });
    expect(loadAiConfig(env({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "k", AI_MODEL: "m" }))).toMatchObject({ model: "m" });
  });
  it("gemini without a key names GEMINI_API_KEY only", () => {
    expect(() => loadAiConfig(env({ AI_PROVIDER: "gemini", ANTHROPIC_API_KEY: "secretvalue" }))).toThrow(
      "Missing required environment variable: GEMINI_API_KEY",
    );
  });
  it("rejects a Claude model id under gemini, naming AI_MODEL", () => {
    expect(() =>
      loadAiConfig(env({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "k", AI_MODEL: "claude-sonnet-5-5" })),
    ).toThrow(/AI_MODEL/);
  });
  it("off needs no keys", () => {
    expect(loadAiConfig(env({ AI_PROVIDER: "off" }))).toEqual({ provider: "off" });
    expect(createRiskReviewer({ provider: "off" })).toBeNull();
  });
  it("rejects unknown providers without echoing values", () => {
    expect(() => loadAiConfig(env({ AI_PROVIDER: "bogus-value" }))).toThrow("Invalid environment variable: AI_PROVIDER");
    try {
      loadAiConfig(env({ AI_PROVIDER: "bogus-value" }));
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("bogus-value");
    }
  });
  it("anthropic without a key names ANTHROPIC_API_KEY", () => {
    expect(() => loadAiConfig(env({ GEMINI_API_KEY: "k" }))).toThrow("ANTHROPIC_API_KEY");
  });
});

describe("AI_PROVIDER=off (reviewer null)", () => {
  const off = (priceStatus: Parameters<typeof price>[0], amountCents = 1_000, overrides = {}) =>
    evaluateRisk(deps(null, price(priceStatus)), riskInput({ amountCents, ...overrides }));

  it("small purchase with a normal price auto-approves, and says AI review disabled", async () => {
    const d = await off("ok");
    expect(d.decision).toBe("approve");
    expect(d.reason).toMatch(/^AI review disabled/);
    expect(d.audit.aiOutcome).toBe("disabled");
    expect(d.riskScore).toBeGreaterThan(0);
  });

  it.each([["low"], ["unknown"], ["high"]] as const)("price %s escalates", async (p) => {
    const d = await off(p);
    expect(d.decision).toBe("escalate");
    expect(d.reason).toMatch(/^AI review disabled/);
    expect(d.audit.aiOutcome).toBe("disabled");
  });

  it("amount above the auto-approve limit escalates", async () => {
    const d = await off("ok", CONFIG.autoApproveBelowCents + 1);
    expect(d.decision).toBe("escalate");
    expect(d.reason).toMatch(/^AI review disabled/);
  });

  it("a policy rule failure still denies before anything else", async () => {
    const d = await off("ok", 10_000_000);
    expect(d.decision).toBe("deny");
    expect(d.audit.aiOutcome).toBe("skipped");
  });

  it("makes no reviewer call (a real reviewer is never consulted)", async () => {
    const reviewer = new FakeReviewer({ kind: "value", value: OK_REVIEW });
    await evaluateRisk(deps(reviewer, price("ok")), riskInput());
    expect(reviewer.requests).toHaveLength(1); // sanity: the fake is called when present
    const none = await off("ok");
    expect(none.audit.aiOutcome).toBe("disabled");
  });
});
