// spec-09a: the decision record carries the Risk Guard reason and price check
// data, and never the agent's justification or description.
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { evaluateRisk } from "../../risk/guard.js";
import { CONFIG, FakeReviewer } from "../../risk/__tests__/helpers.js";
import { REASON_MAX } from "../service.js";
import { createHarness, validBody, type Harness } from "./helpers.js";

const DECISION_EVENTS = ["intent_escalated", "intent_denied", "risk_approved"];

async function decisionMeta(h: Harness, intentId: string) {
  const res = await h.app.inject({
    method: "GET",
    url: `/owner/intents/${intentId}`,
    headers: h.asOwner(),
  });
  expect(res.statusCode).toBe(200);
  const { events } = res.json() as {
    events: { event: string; meta: Record<string, unknown> }[];
  };
  return events.filter((e) => DECISION_EVENTS.includes(e.event));
}

describe("decision audit meta", () => {
  it("escalation stores reason, price status, median and sample size", async () => {
    const h = createHarness({ decision: "escalate" });
    h.deps.evaluateRisk = async () => ({
      decision: "escalate",
      riskScore: 70,
      reason: "amount is well above the market price",
      audit: {
        stageReached: "ai",
        aiOutcome: "ok",
        flagPromptInjection: false,
        riskScore: 70,
        priceStatus: "high",
        priceMedianCents: 999,
        priceSampleSize: 4,
      },
    });
    const id = ((await h.create()).json() as { intentId: string }).intentId;
    const [meta] = (await decisionMeta(h, id)).map((e) => e.meta);
    expect(meta).toMatchObject({
      reason: "amount is well above the market price",
      priceStatus: "high",
      priceMedianCents: 999,
      priceSampleSize: 4,
    });
  });

  it("no price check => priceStatus unknown; reason capped at 280 characters", async () => {
    const h = createHarness();
    h.deps.evaluateRisk = async () => ({
      decision: "deny",
      riskScore: 100,
      reason: "r".repeat(400),
      audit: {
        stageReached: "rules",
        aiOutcome: "skipped",
        flagPromptInjection: false,
        riskScore: 100,
      },
    });
    const id = ((await h.create()).json() as { intentId: string }).intentId;
    const [meta] = (await decisionMeta(h, id)).map((e) => e.meta);
    expect(meta).toMatchObject({
      priceStatus: "unknown",
      priceMedianCents: null,
      priceSampleSize: 0,
    });
    expect(String(meta!["reason"])).toHaveLength(REASON_MAX);
  });

  it("missing policy denial also records reason and priceStatus unknown", async () => {
    const h = createHarness();
    h.deps.policies.getPolicy = async () => null;
    const id = ((await h.create()).json() as { intentId: string }).intentId;
    const [meta] = (await decisionMeta(h, id)).map((e) => e.meta);
    expect(meta).toMatchObject({
      code: "policy_missing",
      reason: "No valid policy",
      priceStatus: "unknown",
    });
  });

  // Feature: spec-09a-dashboard, Property 3: decision audit excludes intent text
  it("Property 3: with the real Risk Guard, no audit meta contains the justification or description", async () => {
    const textArb = fc
      .stringMatching(/^[A-Za-z]{6,12}$/)
      .map((s) => `MARK${s}`);
    await fc.assert(
      fc.asyncProperty(
        textArb,
        textArb,
        fc.constantFrom("ok", "high", "unknown"),
        fc.integer({ min: 1, max: 9000 }),
        async (just, desc, status, amount) => {
          const h = createHarness();
          // The AI echoes the untrusted text back in its reason; it must still not be stored.
          const reviewer = new FakeReviewer({
            kind: "value",
            value: {
              approved: true,
              riskScore: 10,
              reason: `${just} ${desc}`,
              flagPromptInjection: false,
            },
          });
          h.deps.evaluateRisk = (input) =>
            evaluateRisk(
              {
                priceCheck: async () => ({
                  status: status as "ok",
                  medianCents: status === "unknown" ? null : 1000,
                  sampleSize: 3,
                }),
                reviewer,
                config: CONFIG,
              },
              input
            );
          const res = await h.create({
            ...validBody,
            amountCents: amount,
            justification: `need ${just}`,
            description: `item ${desc}`,
          });
          const id = (res.json() as { intentId: string }).intentId;
          const all = await h.stores.audit.listByIntent(id);
          const blob = JSON.stringify(all.map((e) => e.meta));
          expect(blob).not.toContain(just);
          expect(blob).not.toContain(desc);
          expect((await decisionMeta(h, id)).length).toBe(1);
        }
      ),
      { numRuns: 60 }
    );
  });
});

describe("SSE CORS configuration", () => {
  it("index.ts hard-codes no browser origin", () => {
    const src = readFileSync(
      new URL("../../index.ts", import.meta.url),
      "utf8"
    );
    expect(src).not.toMatch(/localhost:3000/);
    expect(src).toMatch(/WEB_ORIGIN/);
  });

  it("only GET /events can send CORS headers, and never credentials", async () => {
    const h = createHarness();
    const origin = { origin: "http://localhost:3000" };
    for (const [method, url, extra] of [
      ["GET", "/", {}],
      ["GET", "/healthz", {}],
      ["GET", "/agents", h.asOwner()],
      ["POST", "/events/token", h.asOwner()],
      ["OPTIONS", "/events", {}],
    ] as const) {
      const res = await h.app.inject({
        method,
        url,
        headers: { ...origin, ...extra },
      });
      expect(
        res.headers["access-control-allow-origin"],
        `${method} ${url}`
      ).toBeUndefined();
      expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    }
    void validBody;
  });
});
