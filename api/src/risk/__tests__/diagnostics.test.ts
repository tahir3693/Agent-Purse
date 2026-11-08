// Failure diagnostics: kind mapping, redaction, and fail-closed behaviour.
// Mocked fetch only; keys below are fake.

import { describe, expect, it } from "vitest";

import { AnthropicRiskReviewer } from "../anthropic.js";
import { redactSecrets, sanitizeText } from "../diagnostics.js";
import { evaluateRisk } from "../guard.js";
import { CONFIG, deps, price, riskInput } from "./helpers.js";
import type { ReviewRequest } from "../reviewer.js";

const FAKE_KEY = "test-key-not-real-0123456789";
const config = { apiKey: FAKE_KEY, model: "claude-sonnet-5-5" };
const req: ReviewRequest = {
  payee: "example.com",
  description: "SECRET-PROMPT-TEXT",
  justification: "needed",
  amountCents: 1_000,
  currency: "USD",
  priceStatus: "ok",
};

type Fetch = (u: string, i: RequestInit) => Promise<Response>;

function setup(fetchImpl: Fetch) {
  const lines: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  const reviewer = new AnthropicRiskReviewer({
    config,
    fetch: fetchImpl,
    logger: { warn: (obj, msg) => lines.push({ obj, msg }) },
  });
  const run = () => reviewer.review(req, { signal: new AbortController().signal }).catch((e: unknown) => e);
  return { lines, reviewer, run };
}

const errRes = (status: number, type: string, message: string) =>
  new Response(JSON.stringify({ type: "error", error: { type, message } }), { status });

describe("failure kind mapping", () => {
  const cases: Array<[string, Fetch, string, number | undefined]> = [
    ["auth 401", async () => errRes(401, "authentication_error", "invalid x-api-key"), "auth", 401],
    ["auth 403", async () => errRes(403, "permission_error", "nope"), "auth", 403],
    ["model 404", async () => errRes(404, "not_found_error", "model: nope"), "model_not_found", 404],
    ["bad request 400", async () => errRes(400, "invalid_request_error", "`temperature` is deprecated"), "bad_request", 400],
    ["rate limit 429", async () => errRes(429, "rate_limit_error", "slow down"), "rate_limited", 429],
    ["overloaded 529", async () => errRes(529, "overloaded_error", "busy"), "rate_limited", 529],
    ["gateway timeout 504", async () => new Response("x", { status: 504 }), "timeout", 504],
    ["server 500", async () => new Response("x", { status: 500 }), "unknown", 500],
    [
      "abort/timeout",
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
    ["bad envelope", async () => new Response("<html>", { status: 200 }), "parse", undefined],
    [
      "no text block",
      async () => new Response(JSON.stringify({ content: [{ type: "thinking" }] }), { status: 200 }),
      "parse",
      undefined,
    ],
    [
      "bad text JSON",
      async () => new Response(JSON.stringify({ content: [{ type: "text", text: "nope" }] }), { status: 200 }),
      "parse",
      undefined,
    ],
    [
      "other error",
      async () => {
        throw new Error("boom");
      },
      "unknown",
      undefined,
    ],
  ];

  it.each(cases)("%s", async (_name, fetchImpl, kind, status) => {
    const { lines, run } = setup(fetchImpl);
    expect(await run()).toBeInstanceOf(Error);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.obj).toMatchObject({ event: "ai_review_failed", kind, model: "claude-sonnet-5-5" });
    expect(lines[0]!.obj["httpStatus"]).toBe(status);
  });

  it("skips a leading non-text block when parsing", async () => {
    const ok = { approved: true, riskScore: 1, reason: "r", flagPromptInjection: false };
    const { reviewer, lines } = setup(async () =>
      new Response(
        JSON.stringify({ content: [{ type: "thinking" }, { type: "text", text: JSON.stringify(ok) }] }),
        { status: 200 },
      ),
    );
    await expect(reviewer.review(req, { signal: new AbortController().signal })).resolves.toEqual(ok);
    expect(lines).toHaveLength(0);
  });
});

describe("request body", () => {
  it("sends no sampling params, no prefill, correct headers", async () => {
    let init: RequestInit | undefined;
    const { reviewer } = setup(async (_u, i) => {
      init = i;
      return new Response("{}", { status: 500 });
    });
    await reviewer.review(req, { signal: new AbortController().signal }).catch(() => undefined);
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    for (const k of ["temperature", "top_p", "top_k", "thinking"]) expect(body).not.toHaveProperty(k);
    expect(body["max_tokens"]).toBeGreaterThanOrEqual(300);
    const msgs = body["messages"] as Array<{ role: string }>;
    expect(msgs.at(-1)!.role).toBe("user");
    const h = init!.headers as Record<string, string>;
    expect(h["anthropic-version"]).toBe("2023-06-01");
    expect(h["x-api-key"]).toBe(FAKE_KEY);
  });
});

describe("redaction", () => {
  it("redacts sk-ant tokens and the configured key, and truncates to 200", () => {
    const text = `a sk-ant-api03-AbC_d-123 b ${FAKE_KEY} ${"x".repeat(500)}`;
    const out = sanitizeText(text, [FAKE_KEY]);
    expect(out).not.toContain("sk-ant");
    expect(out).not.toContain(FAKE_KEY);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(redactSecrets("sk-ant-xyz")).toBe("[redacted]");
  });

  it("log line never contains key, prompt, or headers", async () => {
    const { lines, run } = setup(async () =>
      errRes(401, "authentication_error", `invalid ${FAKE_KEY} sk-ant-api03-LEAK ${"y".repeat(400)}`),
    );
    await run();
    const text = JSON.stringify(lines);
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain("sk-ant-api03-LEAK");
    expect(text).not.toContain("SECRET-PROMPT-TEXT");
    expect(text).not.toContain("x-api-key");
    expect((lines[0]!.obj["message"] as string).length).toBeLessThanOrEqual(200);
  });
});

describe("fail closed", () => {
  it("a 400 from the provider still escalates, never approves", async () => {
    const { reviewer } = setup(async () => errRes(400, "invalid_request_error", "bad"));
    const decision = await evaluateRisk(deps(reviewer, price("ok"), { ...CONFIG, aiTimeoutMs: 2_000 }), riskInput());
    expect(decision.decision).toBe("escalate");
    expect(decision.audit.aiOutcome).toBe("ai_error");
  });
});
