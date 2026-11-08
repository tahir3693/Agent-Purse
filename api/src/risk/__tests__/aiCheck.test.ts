import { describe, expect, it } from "vitest";

import { formatAiCheck, runAiCheck } from "../aiCheck.js";

const CONFIG = {
  provider: "anthropic" as const,
  apiKey: "test-only-anthropic-key-0123456789",
  model: "claude-sonnet-5-5",
};

const errBody = (type: string, message: string) => JSON.stringify({ type: "error", error: { type, message } });

describe("runAiCheck (stubbed fetch, no live call)", () => {
  it("OK prints the model only", async () => {
    const okFetch = (async () => new Response('{"content":[]}', { status: 200 })) as typeof fetch;
    expect(formatAiCheck(await runAiCheck(CONFIG, okFetch))).toBe("AI check: OK (provider anthropic, model claude-sonnet-5-5)");
  });

  it("FAILED prints kind, status and sanitized message, never the key", async () => {
    const denied = (async () =>
      new Response(errBody("authentication_error", `bad key ${CONFIG.apiKey} sk-ant-api03-ABCDEF`), {
        status: 401,
      })) as typeof fetch;
    const line = formatAiCheck(await runAiCheck(CONFIG, denied));
    expect(line).toContain("provider=anthropic");
    expect(line).toContain("kind=auth");
    expect(line).toContain("status=401");
    expect(line).toContain("type=authentication_error");
    expect(line).toContain("model=claude-sonnet-5-5");
    expect(line).not.toContain(CONFIG.apiKey);
    expect(line).not.toContain("sk-ant-api03");
  });

  it("reports the temperature rejection as bad_request", async () => {
    const f = (async () =>
      new Response(errBody("invalid_request_error", "`temperature` is deprecated for this model."), {
        status: 400,
      })) as typeof fetch;
    const line = formatAiCheck(await runAiCheck(CONFIG, f));
    expect(line).toContain("kind=bad_request");
    expect(line).toContain("temperature");
  });

  it("reports network failures", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(formatAiCheck(await runAiCheck(CONFIG, f))).toContain("kind=network");
  });

  it("sends the configured model with a tiny max_tokens and no sampling params", async () => {
    let body: Record<string, unknown> = {};
    const spy = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await runAiCheck(CONFIG, spy);
    expect(body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 5 });
    expect(body).not.toHaveProperty("temperature");
  });
});

describe("runAiCheck for other providers", () => {
  const GEMINI = { provider: "gemini" as const, apiKey: "AIzaTestOnlyKey0123456789abcdef", model: "gemini-3.8-flash" };

  it("gemini: key goes in x-goog-api-key, never in the URL; OK line names provider and model", async () => {
    let url = "";
    let headers: Record<string, string> = {};
    const f = (async (u: RequestInfo | URL, init?: RequestInit) => {
      url = String(u);
      headers = init?.headers as Record<string, string>;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const line = formatAiCheck(await runAiCheck(GEMINI, f));
    expect(line).toBe("AI check: OK (provider gemini, model gemini-3.8-flash)");
    expect(url).toContain("/models/gemini-3.8-flash:generateContent");
    expect(url).not.toContain(GEMINI.apiKey);
    expect(url).not.toContain("key=");
    expect(headers["x-goog-api-key"]).toBe(GEMINI.apiKey);
  });

  it("gemini: failures print a sanitized diagnostic without the key", async () => {
    const f = (async () =>
      new Response(
        JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: `API key not valid ${GEMINI.apiKey}` } }),
        { status: 400 }
      )) as typeof fetch;
    const line = formatAiCheck(await runAiCheck(GEMINI, f));
    expect(line).toContain("provider=gemini");
    expect(line).toContain("kind=auth");
    expect(line).toContain("status=400");
    expect(line).not.toContain(GEMINI.apiKey);
  });

  it("off: makes no call and says AI review is disabled", async () => {
    let called = false;
    const f = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    const line = formatAiCheck(await runAiCheck({ provider: "off" }, f));
    expect(called).toBe(false);
    expect(line).toContain("AI review disabled");
  });
});
