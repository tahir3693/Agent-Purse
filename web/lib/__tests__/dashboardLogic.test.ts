import { describe, expect, it } from "vitest";

import { applyDecision, type QueueItem } from "../approvals";
import { errorMessage, request, setUnauthorizedHandler } from "../client/api";
import { decisionInfo, type Intent } from "../types";

const intent = (id: string): Intent => ({
  id,
  agentId: "a1",
  amountCents: 12_000,
  currency: "USD",
  payee: "shop.test",
  category: "electronics",
  description: "<b>keyboard</b>",
  justification: "needed",
  paymentMethodId: "vm1",
  state: "escalated",
  decision: "escalate",
  riskScore: 70,
  createdAt: "2030-01-01T00:00:00.000Z",
});

function queueState(initial: QueueItem[]) {
  let q = initial;
  return {
    get: () => q,
    set: (fn: (x: QueueItem[]) => QueueItem[]) => (q = fn(q)),
  };
}

describe("approvals optimistic update", () => {
  const items = [
    { intent: intent("i1") },
    { intent: intent("i2") },
    { intent: intent("i3") },
  ];

  it("removes the item before the API answers and keeps it removed on success", async () => {
    const s = queueState(items);
    let seenDuringCall: string[] = [];
    const r = await applyDecision(
      s.get(),
      "i2",
      "approve",
      s.set,
      async (path) => {
        seenDuringCall = s.get().map((x) => x.intent.id);
        expect(path).toBe("intents/i2/approve");
        return { ok: true, status: 200, data: {} };
      }
    );
    expect(r).toEqual({ ok: true });
    expect(seenDuringCall).toEqual(["i1", "i3"]);
    expect(s.get().map((x) => x.intent.id)).toEqual(["i1", "i3"]);
  });

  it("restores the item in place with a clear message on 409", async () => {
    const s = queueState(items);
    const r = await applyDecision(s.get(), "i2", "deny", s.set, async () => ({
      ok: false,
      status: 409,
      error: "conflict",
      message: "Intent is not awaiting approval",
    }));
    expect(r).toEqual({
      ok: false,
      message: "This intent is no longer awaiting approval.",
    });
    expect(s.get().map((x) => x.intent.id)).toEqual(["i1", "i2", "i3"]);
  });

  it("restores on any other error with the API message", async () => {
    const s = queueState(items);
    const r = await applyDecision(
      s.get(),
      "i1",
      "approve",
      s.set,
      async () => ({
        ok: false,
        status: 502,
        error: "bad_gateway",
        message: "Upstream error",
      })
    );
    expect(r).toEqual({ ok: false, message: "Upstream error" });
    expect(s.get()[0]?.intent.id).toBe("i1");
  });
});

describe("decision info", () => {
  it("reads reason and price fields from the latest decision event, as plain strings", () => {
    const d = decisionInfo([
      { event: "intent_created", meta: {}, createdAt: "x" },
      {
        event: "intent_escalated",
        meta: {
          reason: "<img src=x onerror=alert(1)>",
          priceStatus: "high",
          priceMedianCents: 999,
          priceSampleSize: 3,
        },
        createdAt: "x",
      },
    ]);
    expect(d).toEqual({
      reason: "<img src=x onerror=alert(1)>",
      priceStatus: "high",
      priceMedianCents: 999,
      priceSampleSize: 3,
    });
  });

  it("defaults when the record predates spec-09a", () => {
    expect(
      decisionInfo([
        { event: "intent_escalated", meta: { riskScore: 80 }, createdAt: "x" },
      ])
    ).toEqual({
      reason: null,
      priceStatus: "unknown",
      priceMedianCents: null,
      priceSampleSize: 0,
    });
  });
});

describe("client request wrapper", () => {
  it("maps errors to status and message and sends owners to /login on a proxied 401", async () => {
    let redirected = 0;
    setUnauthorizedHandler(() => redirected++);
    const f = (async () =>
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
      })) as typeof fetch;
    const r = await request("/api/owner/agents", {}, f);
    expect(r).toMatchObject({
      ok: false,
      status: 401,
      error: "unauthorized",
      message: "unauthorized",
    });
    expect(redirected).toBe(1);
    await request("/api/auth/login", { method: "POST", body: {} }, f);
    expect(redirected).toBe(1);
    const down = await request("/api/owner/agents", {}, (async () => {
      throw new TypeError("x");
    }) as typeof fetch);
    expect(down).toMatchObject({ ok: false, status: 0 });
    expect(errorMessage(500, { message: "m".repeat(300) })).toHaveLength(200);
  });
});

describe("no HTML rendering", () => {
  it("web source never uses dangerouslySetInnerHTML", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = new URL("../../", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1"
    );
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        if (n === "node_modules" || n === ".next") return [];
        const p = join(d, n);
        return statSync(p).isDirectory()
          ? walk(p)
          : /\.tsx?$/.test(n) && !p.includes("__tests__")
            ? [p]
            : [];
      });
    for (const f of walk(root))
      expect(readFileSync(f, "utf8"), f).not.toContain(
        "dangerouslySetInnerHTML"
      );
  });
});
