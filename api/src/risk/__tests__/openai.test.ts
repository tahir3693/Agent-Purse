// OpenAI-compatible adapter, config and demo:check line. Mocked fetch only; keys are fake.
import { describe, expect, it } from "vitest";
import { formatAiCheck, runAiCheck } from "../aiCheck.js";
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  loadAiConfig,
  loadAiTimeoutMs,
  normalizeBaseUrl,
} from "../config.js";
import { redactSecrets } from "../diagnostics.js";
import { evaluateRisk } from "../guard.js";
import { chatCompletionsUrl, extractJson, OpenAiRiskReviewer, reasoningParams } from "../openai.js";
import { createRiskReviewer } from "../provider.js";
import type { ReviewRequest } from "../reviewer.js";
import { CONFIG, deps, price, riskInput } from "./helpers.js";

const FAKE_KEY = "gsk_FakeTestKey0123456789abcdef";
const config = { apiKey: FAKE_KEY, baseUrl: "https://api.example.test/openai/v1", model: "test-model" };
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

function setup(fetchImpl: Fetch, timeoutMs?: number) {
  const lines: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  const reviewer = new OpenAiRiskReviewer({
    config,
    fetch: fetchImpl,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    logger: { warn: (obj, msg) => lines.push({ obj, msg }) },
  });
  const run = () => reviewer.review(req, { signal: new AbortController().signal }).catch((e: unknown) => e);
  return { lines, reviewer, run };
}

const ok = (content: unknown, finish = "stop") =>
  new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content } }] }), { status: 200 });
const errRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("OpenAiRiskReviewer success and request shape", () => {
  it("POSTs to {base}/chat/completions with a bearer header and a JSON-object request", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const { reviewer, lines } = setup(async (u, i) => {
      url = u;
      init = i;
      return ok(JSON.stringify(REVIEW));
    });
    await expect(reviewer.review(req, { signal: new AbortController().signal })).resolves.toEqual(REVIEW);
    expect(lines).toHaveLength(0);
    expect(url).toBe("https://api.example.test/openai/v1/chat/completions");
    expect(url).not.toContain(FAKE_KEY);
    expect(init!.method).toBe("POST");
    const h = init!.headers as Record<string, string>;
    expect(h["authorization"]).toBe(`Bearer ${FAKE_KEY}`);
    expect(Object.keys(h)).not.toContain("x-api-key");
    const body = JSON.parse(init!.body as string) as {
      model: string;
      response_format: { type: string };
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("test-model");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]!.role).toBe("system");
    expect(body.messages[0]!.content).toContain("untrusted");
    expect(body.messages[1]!.content).toContain("UNTRUSTED_INTENT_DATA");
    expect(init!.body as string).not.toContain(FAKE_KEY);
  });

  it("tolerates fenced code blocks and prose around the JSON", async () => {
    const fenced = setup(async () => ok("```json\n" + JSON.stringify(REVIEW) + "\n```"));
    await expect(fenced.reviewer.review(req, { signal: new AbortController().signal })).resolves.toEqual(REVIEW);
    const prose = setup(async () => ok(`Here you go: ${JSON.stringify(REVIEW)} Done.`));
    await expect(prose.reviewer.review(req, { signal: new AbortController().signal })).resolves.toEqual(REVIEW);
  });

  it("extractJson returns undefined for non-JSON and never throws", () => {
    expect(extractJson("no json here")).toBeUndefined();
    expect(extractJson("{broken")).toBeUndefined();
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
});

describe("OpenAiRiskReviewer error kinds", () => {
  const cases: Array<[string, Fetch, string, number | undefined]> = [
    ["401", async () => errRes(401, { error: { message: "bad key", type: "invalid_request_error", code: "invalid_api_key" } }), "auth", 401],
    ["403", async () => errRes(403, { error: { message: "denied" } }), "auth", 403],
    ["404 model", async () => errRes(404, { error: { message: "no model", code: "model_not_found" } }), "model_not_found", 404],
    ["400 model_not_found code", async () => errRes(400, { error: { message: "x", code: "model_not_found" } }), "model_not_found", 400],
    ["400 bad request", async () => errRes(400, { error: { message: "bad", type: "invalid_request_error" } }), "bad_request", 400],
    ["429", async () => errRes(429, { error: { message: "slow down", code: "rate_limit_exceeded" } }), "rate_limited", 429],
    ["402 credits", async () => errRes(402, { error: { message: "credits", code: 402 } }), "rate_limited", 402],
    ["503", async () => new Response("x", { status: 503 }), "rate_limited", 503],
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
    ["envelope not JSON", async () => new Response("<html>", { status: 200 }), "parse", undefined],
    ["no choices", async () => new Response("{}", { status: 200 }), "parse", undefined],
    ["empty content", async () => ok(""), "parse", undefined],
    ["text not JSON", async () => ok("nope"), "parse", undefined],
    ["truncated", async () => ok("{", "length"), "parse", undefined],
  ];

  it.each(cases)("%s", async (_n, fetchImpl, kind, status) => {
    const { lines, run } = setup(fetchImpl);
    expect(await run()).toBeInstanceOf(Error);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.obj).toMatchObject({ event: "ai_review_failed", provider: "openai", kind, model: "test-model" });
    expect(lines[0]!.obj["httpStatus"]).toBe(status);
  });
});

describe("token budget", () => {
  it("uses a small max_tokens and a compact system prompt", async () => {
    let body: { max_tokens: number; messages: Array<{ role: string; content: string }> } | undefined;
    const { reviewer } = setup(async (_u, i) => {
      body = JSON.parse(i.body as string);
      return ok(JSON.stringify(REVIEW));
    });
    await reviewer.review(req, { signal: new AbortController().signal });
    expect(body!.max_tokens).toBeLessThanOrEqual(500);
    expect(body!.messages[0]!.content.length).toBeLessThan(700);
    expect(body!.messages[0]!.content).toContain("untrusted data");
    expect(body!.messages[0]!.content).toContain("flagPromptInjection");
  });

  it("sends reasoning_effort low only to Groq-hosted gpt-oss models", () => {
    const groq = "https://api.groq.com/openai/v1";
    expect(reasoningParams({ baseUrl: groq, model: "openai/gpt-oss-20b" })).toEqual({ reasoning_effort: "low" });
    expect(reasoningParams({ baseUrl: groq, model: "openai/gpt-oss-120b" })).toEqual({ reasoning_effort: "low" });
    expect(reasoningParams({ baseUrl: groq, model: "llama-3.3-70b-versatile" })).toEqual({});
    expect(reasoningParams({ baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-oss-20b" })).toEqual({});
  });

  it("includes reasoning_effort in the request for the default Groq model", async () => {
    let raw = "";
    const reviewer = new OpenAiRiskReviewer({
      config: { apiKey: FAKE_KEY, baseUrl: DEFAULT_OPENAI_BASE_URL, model: DEFAULT_OPENAI_MODEL },
      fetch: async (_u, i) => {
        raw = i.body as string;
        return ok(JSON.stringify(REVIEW));
      },
      logger: { warn: () => undefined },
    });
    await reviewer.review(req, { signal: new AbortController().signal });
    expect(JSON.parse(raw)).toMatchObject({ reasoning_effort: "low" });
  });
});

describe("429 handling", () => {
  const limited = () =>
    new Response(JSON.stringify({ error: { message: "rate limit", code: "rate_limit_exceeded" } }), {
      status: 429,
      headers: { "retry-after": "7" },
    });

  it("logs kind=rate_limited with the retry-after value", async () => {
    const { lines, run } = setup(async () => limited());
    expect(await run()).toBeInstanceOf(Error);
    expect(lines[0]!.obj).toMatchObject({ kind: "rate_limited", httpStatus: 429, retryAfter: "7", provider: "openai" });
  });

  it("drops a retry-after that is not a plain seconds value", async () => {
    const { lines, run } = setup(
      async () => new Response("x", { status: 429, headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" } }),
    );
    await run();
    expect(lines[0]!.obj["retryAfter"]).toBeUndefined();
  });

  it("still fails closed to escalate with risk 100", async () => {
    const { reviewer } = setup(async () => limited());
    const d = await evaluateRisk(deps(reviewer, price("ok"), { ...CONFIG, aiTimeoutMs: 2_000 }), riskInput());
    expect(d.decision).toBe("escalate");
    expect(d.riskScore).toBe(100);
    expect(d.audit.aiOutcome).toBe("ai_error");
  });

  it("demo:check shows retryAfter", async () => {
    const f = (async () => limited()) as unknown as typeof fetch;
    const line = formatAiCheck(await runAiCheck({ provider: "openai", ...config }, f));
    expect(line).toContain("kind=rate_limited");
    expect(line).toContain("retryAfter=7");
  });
});

describe("review cache", () => {
  function cached(fetchImpl: Fetch) {
    let t = 1_000_000;
    const reviewer = new OpenAiRiskReviewer({
      config,
      fetch: fetchImpl,
      now: () => t,
      logger: { warn: () => undefined },
    });
    const review = (r: ReviewRequest = req) => reviewer.review(r, { signal: new AbortController().signal });
    return { review, advance: (ms: number) => (t += ms) };
  }

  it("does not call the provider twice for the same request within a minute", async () => {
    let calls = 0;
    const c = cached(async () => {
      calls++;
      return ok(JSON.stringify(REVIEW));
    });
    await c.review();
    c.advance(59_000);
    await expect(c.review()).resolves.toEqual(REVIEW);
    expect(calls).toBe(1);
  });

  it("calls again after the window, and for a different request", async () => {
    let calls = 0;
    const c = cached(async () => {
      calls++;
      return ok(JSON.stringify(REVIEW));
    });
    await c.review();
    await c.review({ ...req, amountCents: 2_000 });
    expect(calls).toBe(2);
    c.advance(60_001);
    await c.review();
    expect(calls).toBe(3);
  });

  it("never caches failures", async () => {
    let calls = 0;
    const c = cached(async () => {
      calls++;
      return calls === 1 ? errRes(429, { error: { message: "slow" } }) : ok(JSON.stringify(REVIEW));
    });
    await expect(c.review()).rejects.toBeInstanceOf(Error);
    await expect(c.review()).resolves.toEqual(REVIEW);
    expect(calls).toBe(2);
  });

  it("shares one in-flight call between concurrent identical requests", async () => {
    let calls = 0;
    const c = cached(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return ok(JSON.stringify(REVIEW));
    });
    const [a, b] = await Promise.all([c.review(), c.review()]);
    expect(a).toEqual(b);
    expect(calls).toBe(1);
  });
});

describe("redaction", () => {
  it("redacts the exact key, gsk_ and sk- shapes, and never logs the prompt", async () => {
    const { lines, run } = setup(async () =>
      errRes(401, {
        error: { message: `bad ${FAKE_KEY} gsk_AnotherKey0123456789 sk-or-v1-abcdef0123456789 ${"z".repeat(400)}` },
      }),
    );
    await run();
    const text = JSON.stringify(lines);
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain("gsk_AnotherKey");
    expect(text).not.toContain("sk-or-v1");
    expect(text).not.toContain("SECRET-PROMPT-TEXT");
    expect(text.toLowerCase()).not.toContain("authorization");
    expect((lines[0]!.obj["message"] as string).length).toBeLessThanOrEqual(200);
  });

  it("does not mangle ordinary words that contain 'sk-'", () => {
    expect(redactSecrets("task-management failed")).toBe("task-management failed");
  });
});

describe("fail closed with the openai provider", () => {
  it("a provider error escalates with risk 100, never approves", async () => {
    const { reviewer } = setup(async () => errRes(429, { error: { message: "quota" } }));
    const d = await evaluateRisk(deps(reviewer, price("ok"), { ...CONFIG, aiTimeoutMs: 2_000 }), riskInput());
    expect(d.decision).toBe("escalate");
    expect(d.riskScore).toBe(100);
    expect(d.audit.aiOutcome).toBe("ai_error");
  });

  it("a schema-violating verdict escalates (ai_parse)", async () => {
    const { reviewer } = setup(async () => ok(JSON.stringify({ ...REVIEW, extra: 1 })));
    const d = await evaluateRisk(deps(reviewer, price("ok"), { ...CONFIG, aiTimeoutMs: 2_000 }), riskInput());
    expect(d.decision).toBe("escalate");
    expect(d.audit.aiOutcome).toBe("ai_parse");
  });

  it("a hung call times out and escalates with risk 100 (ai_timeout)", async () => {
    const { reviewer } = setup(
      (_u, i) =>
        new Promise<Response>((_res, rej) => {
          i.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
      20,
    );
    const d = await evaluateRisk(deps(reviewer, price("ok"), { ...CONFIG, aiTimeoutMs: 500 }), riskInput());
    expect(d.decision).toBe("escalate");
    expect(d.riskScore).toBe(100);
    expect(d.audit.aiOutcome).toBe("ai_timeout");
  });

  it("a prompt-injection verdict can only tighten, never approve a rules failure", async () => {
    const { reviewer } = setup(async () => ok(JSON.stringify(REVIEW)));
    const d = await evaluateRisk(deps(reviewer, price("ok")), riskInput({ amountCents: 10_000_000 }));
    expect(d.decision).toBe("deny");
  });
});

describe("loadAiConfig for openai", () => {
  const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

  it("uses Groq defaults and requires only AI_API_KEY (ANTHROPIC_API_KEY stays optional)", () => {
    expect(loadAiConfig(env({ AI_PROVIDER: "openai", AI_API_KEY: "k" }))).toEqual({
      provider: "openai",
      apiKey: "k",
      baseUrl: DEFAULT_OPENAI_BASE_URL,
      model: DEFAULT_OPENAI_MODEL,
    });
    expect(DEFAULT_OPENAI_BASE_URL).toBe("https://api.groq.com/openai/v1");
    expect(DEFAULT_OPENAI_MODEL).toBe("openai/gpt-oss-20b");
  });
  it("names AI_API_KEY only when missing", () => {
    expect(() => loadAiConfig(env({ AI_PROVIDER: "openai", ANTHROPIC_API_KEY: "secretvalue" }))).toThrow(
      "Missing required environment variable: AI_API_KEY",
    );
  });
  it("honours AI_BASE_URL and AI_MODEL; rejects Claude ids", () => {
    expect(
      loadAiConfig(
        env({ AI_PROVIDER: "openai", AI_API_KEY: "k", AI_BASE_URL: "https://openrouter.ai/api/v1/", AI_MODEL: "m/x" }),
      ),
    ).toMatchObject({ baseUrl: "https://openrouter.ai/api/v1", model: "m/x" });
    expect(() =>
      loadAiConfig(env({ AI_PROVIDER: "openai", AI_API_KEY: "k", AI_MODEL: "claude-sonnet-5-5" })),
    ).toThrow(/AI_MODEL/);
  });
  it("normalizes the base URL and rejects non-https or unsafe values without echoing them", () => {
    expect(normalizeBaseUrl("https://x.test/v1///")).toBe("https://x.test/v1");
    expect(normalizeBaseUrl("  https://x.test  ")).toBe("https://x.test");
    expect(chatCompletionsUrl("https://x.test/v1/")).toBe("https://x.test/v1/chat/completions");
    for (const bad of ["http://x.test/v1", "ftp://x.test", "not a url", "https://u:p@x.test", "https://x.test/v1?k=1"]) {
      expect(() => normalizeBaseUrl(bad)).toThrow("Invalid environment variable: AI_BASE_URL");
      try {
        normalizeBaseUrl(bad);
      } catch (e) {
        expect((e as Error).message).not.toContain("p@x.test");
      }
    }
  });
  it("timeout defaults to 12000 and honours AI_TIMEOUT_MS", () => {
    expect(loadAiTimeoutMs(env({}), "openai")).toBe(12_000);
    expect(loadAiTimeoutMs(env({ AI_TIMEOUT_MS: "8000" }), "openai")).toBe(8_000);
  });
  it("createRiskReviewer builds the openai reviewer", () => {
    expect(createRiskReviewer({ provider: "openai", ...config })).toBeInstanceOf(OpenAiRiskReviewer);
  });
});

describe("existing providers are unchanged", () => {
  const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  it("anthropic stays the default and still requires its own key", () => {
    expect(loadAiConfig(env({ ANTHROPIC_API_KEY: "k" }))).toMatchObject({ provider: "anthropic" });
    expect(() => loadAiConfig(env({ AI_API_KEY: "k" }))).toThrow("ANTHROPIC_API_KEY");
    expect(loadAiTimeoutMs(env({}), "anthropic")).toBe(15_000);
    expect(loadAiTimeoutMs(env({}), "gemini")).toBe(12_000);
  });
  it("gemini and off behave as before", () => {
    expect(loadAiConfig(env({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "k" }))).toMatchObject({ provider: "gemini" });
    expect(loadAiConfig(env({ AI_PROVIDER: "off" }))).toEqual({ provider: "off" });
    expect(createRiskReviewer({ provider: "off" })).toBeNull();
  });
});

describe("demo:check for openai", () => {
  const cfg = { provider: "openai" as const, ...config };

  it("prints provider, kind, status, message and elapsed on success", async () => {
    let seen: { url: string; auth: string } | undefined;
    const f = (async (u: string, i: RequestInit) => {
      seen = { url: u, auth: (i.headers as Record<string, string>)["authorization"]! };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const line = formatAiCheck(await runAiCheck(cfg, f));
    expect(seen).toEqual({ url: "https://api.example.test/openai/v1/chat/completions", auth: `Bearer ${FAKE_KEY}` });
    expect(line).toMatch(/^AI check: OK \(provider=openai kind=ok status=200 message=ok model=test-model\) elapsed=\d+ms$/);
  });

  it("prints a sanitized failure with kind, status, message and elapsed, without the key", async () => {
    const f = (async () =>
      errRes(401, { error: { message: `invalid ${FAKE_KEY}`, code: "invalid_api_key" } })) as unknown as typeof fetch;
    const line = formatAiCheck(await runAiCheck(cfg, f));
    expect(line).toContain("provider=openai");
    expect(line).toContain("kind=auth");
    expect(line).toContain("status=401");
    expect(line).toContain("message=");
    expect(line).toMatch(/elapsed=\d+ms$/);
    expect(line).not.toContain(FAKE_KEY);
  });
});
