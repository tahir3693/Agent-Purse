import { describe, expect, it } from "vitest";

import {
  classifyAnthropicError,
  formatAiCheck,
  runAiCheck,
} from "../aiCheck.js";

const CONFIG = {
  apiKey: "test-only-anthropic-key-0123456789",
  model: "claude-sonnet-5-5",
};

describe("classifyAnthropicError", () => {
  it.each([
    [401, "auth"],
    [403, "auth"],
    [402, "quota"],
    [429, "quota"],
    [529, "quota"],
    [400, "model"],
    [404, "model"],
    [500, "unknown"],
  ] as const)("status %i => %s", (status, category) => {
    expect(classifyAnthropicError({ status })).toBe(category);
  });

  it("maps fetch failures and timeouts to network", () => {
    expect(
      classifyAnthropicError({ error: new TypeError("fetch failed") })
    ).toBe("network");
    expect(
      classifyAnthropicError({
        error: Object.assign(new Error("t"), { name: "TimeoutError" }),
      })
    ).toBe("network");
    expect(classifyAnthropicError({ error: "weird" })).toBe("unknown");
  });
});

describe("runAiCheck (stubbed fetch, no live call)", () => {
  it("OK prints the model only; FAILED prints the category only, never the key or body", async () => {
    const okFetch = (async () =>
      new Response('{"content":[]}', { status: 200 })) as typeof fetch;
    const okLine = formatAiCheck(await runAiCheck(CONFIG, okFetch));
    expect(okLine).toBe("AI check: OK (model claude-sonnet-5-5)");

    const denied = (async () =>
      new Response(`{"error":"bad key ${CONFIG.apiKey}"}`, {
        status: 401,
      })) as typeof fetch;
    const failLine = formatAiCheck(await runAiCheck(CONFIG, denied));
    expect(failLine).toBe("AI check: FAILED (auth)");
    expect(failLine).not.toContain(CONFIG.apiKey);
  });

  it("sends the configured model with a tiny max_tokens", async () => {
    let body: Record<string, unknown> = {};
    const spy = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await runAiCheck(CONFIG, spy);
    expect(body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 5 });
  });
});
