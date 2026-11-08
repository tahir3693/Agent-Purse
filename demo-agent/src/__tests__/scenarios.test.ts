import { describe, expect, it } from "vitest";

import { BANNER, runScenarios } from "../runner.js";
import {
  APPROVAL_TIMEOUT_MS,
  INJECTION_JUSTIFICATION,
  SCENARIOS,
} from "../scenarios.js";
import {
  AGENT_KEY,
  TOKEN,
  METHOD_ID,
  approveCreate,
  context,
  ok,
  stubApi,
  product,
  stubCatalog,
  type Availability,
  type StubApiScript,
} from "./stubs.js";

function scenario(name: string) {
  return SCENARIOS.find((s) => s.name === name)!;
}

async function run(
  name: string,
  script: StubApiScript = {},
  catalog = stubCatalog()
) {
  const api = stubApi(script);
  const c = context(api.api, catalog.catalog);
  const result = await scenario(name).run(c.ctx);
  return { result, ...api, ...c, catalogCalls: catalog.calls };
}

const decide =
  (decision: string, state: string, reason = "test reason", riskScore = 80) =>
  () =>
    ok(200, { intentId: "int-1", state, decision, riskScore, reason });

describe("small-safe", () => {
  it("PASS: approve, execute once, captured; body uses offer, vault id and productId", async () => {
    const r = await run("small-safe");
    expect(r.result.pass).toBe(true);
    expect(r.calls).toEqual(["create", "execute"]);
    expect(r.created[0]).toMatchObject({
      amountCents: 999,
      currency: "USD",
      payee: "shop-b.test",
      category: "electronics",
      paymentMethodRef: METHOD_ID,
      productId: "prod-cable",
    });
    expect(r.transcript.text()).toContain("$9.99");
    expect(r.transcript.text()).not.toContain(TOKEN);
    expect(r.transcript.text()).toContain(TOKEN.slice(0, 8));
  });

  it("FAIL with the actual decision and reason when escalated; no execute", async () => {
    const r = await run("small-safe", {
      create: decide("escalate", "escalated", "AI review did not approve"),
    });
    expect(r.result).toMatchObject({
      pass: false,
      actual: "escalate",
      reason: "AI review did not approve",
    });
    expect(r.calls).toEqual(["create"]);
  });

  it("FAIL without submitting when no offer fits", async () => {
    const r = await run("small-safe", {}, stubCatalog({}));
    expect(r.result).toMatchObject({
      pass: false,
      reason: "no offer within budget",
    });
    expect(r.calls).toEqual([]);
  });
});

describe("needs-approval", () => {
  const escalated = decide(
    "escalate",
    "escalated",
    "amount above auto-approve limit; owner approval required"
  );

  it("PASS: polls every 2s until authorized, then mandate and execute", async () => {
    const r = await run("needs-approval", {
      create: escalated,
      states: ["escalated", "escalated", "authorized"],
    });
    expect(r.result.pass).toBe(true);
    expect(r.created[0]?.amountCents).toBe(12_900);
    expect(r.calls).toEqual([
      "create",
      "get",
      "get",
      "get",
      "mandate",
      "execute",
    ]);
    expect(r.elapsed()).toBe(6_000);
  });

  const offerFor = (
    id: string,
    price: number,
    availability: Availability = "InStock",
    currency = "USD"
  ) => product(id, [[`${id}.test`, price, availability, currency]]);
  it("searches a $70-$150 range and requests exactly the real price", async () => {
    const r = await run("needs-approval", {
      create: escalated,
      states: ["authorized"],
    });
    expect(r.catalogCalls[0]).toEqual({
      query: "mechanical keyboard",
      max: 15_000,
      min: 7_000,
    });
    expect(r.created[0]?.amountCents).toBe(12_900);
    expect(r.created[0]?.amountCents).toBeGreaterThan(5_000);
    expect(r.created[0]?.amountCents).toBeLessThan(20_000);
    expect(r.created[0]?.productId).toBe("prod-kb");
    expect(r.transcript.text()).not.toContain("instead so it needs approval");
  });

  it("picks the in-range product closest to $100 and ignores cheap, pricey or out-of-stock ones", async () => {
    const cat = stubCatalog({
      "mechanical keyboard": [
        offerFor("cheap", 34.99),
        offerFor("far", 149.0),
        offerFor("oos", 99.0, "OutOfStock"),
        offerFor("eur", 100.0, "InStock", "EUR"),
        offerFor("near", 92.5),
        offerFor("pricey", 220.0),
      ],
    });
    const r = await run(
      "needs-approval",
      { create: escalated, states: ["authorized"] },
      cat
    );
    expect(r.created[0]?.amountCents).toBe(9_250);
    expect(r.created[0]?.productId).toBe("near");
  });

  it("falls back to the next query when the first has nothing in range", async () => {
    const cat = stubCatalog({
      "mechanical keyboard": [offerFor("cheap", 34.99)],
      "wireless noise cancelling headphones": [offerFor("hp", 119.0)],
    });
    const r = await run(
      "needs-approval",
      { create: escalated, states: ["authorized"] },
      cat
    );
    expect(r.catalogCalls.map((c) => c.query)).toEqual([
      "mechanical keyboard",
      "wireless noise cancelling headphones",
    ]);
    expect(r.created[0]?.amountCents).toBe(11_900);
  });

  it("FAIL with a clear message and no API call when no product is in range", async () => {
    const cat = stubCatalog({
      "mechanical keyboard": [offerFor("cheap", 34.99)],
      "wireless noise cancelling headphones": [],
    });
    const r = await run("needs-approval", { create: escalated }, cat);
    expect(r.result).toMatchObject({ pass: false, actual: "no offer" });
    expect(r.result.reason).toContain("$70.00 to $150.00");
    expect(r.calls).toEqual([]);
  });

  it("small-safe and overpriced keep their cheap budgets", async () => {
    const s = await run("small-safe");
    expect(s.catalogCalls[0]).toEqual({ query: "usb c cable", max: 2_500 });
    const o = await run("overpriced", {
      create: () =>
        ok(201, {
          intentId: "i",
          decision: "escalate",
          state: "escalated",
          riskScore: 80,
          reason: "price high",
        }),
    });
    expect(o.catalogCalls[0]).toEqual({ query: "usb c cable", max: 2_500 });
  });
  it("FAIL when the owner denies", async () => {
    const r = await run("needs-approval", {
      create: escalated,
      states: ["denied"],
    });
    expect(r.result).toMatchObject({
      pass: false,
      actual: "denied",
      reason: "owner denied",
    });
    expect(r.calls).not.toContain("mandate");
  });

  it("FAIL after 180 seconds without a decision", async () => {
    const r = await run("needs-approval", {
      create: escalated,
      states: ["escalated"],
    });
    expect(r.result).toMatchObject({
      pass: false,
      reason: "timed out waiting for the owner",
    });
    expect(r.elapsed()).toBe(APPROVAL_TIMEOUT_MS);
  });

  it("FAIL immediately when the API auto-approves instead of escalating", async () => {
    const r = await run("needs-approval", { create: approveCreate });
    expect(r.result).toMatchObject({ pass: false, actual: "approve" });
    expect(r.calls).toEqual(["create"]);
  });
});

describe("over-cap", () => {
  it("PASS on deny above the per-purchase cap", async () => {
    const r = await run("over-cap", {
      create: decide("deny", "denied", "per-purchase cap exceeded", 100),
    });
    expect(r.result.pass).toBe(true);
    expect(r.created[0]?.amountCents).toBe(25_000);
  });
  it("FAIL when not denied", async () => {
    const r = await run("over-cap", {
      create: decide("escalate", "escalated"),
    });
    expect(r.result).toMatchObject({ pass: false, actual: "escalate" });
  });
});

describe("overpriced", () => {
  it("PASS when escalated for price; asks 3x the offer, under the auto-approve limit, with productId", async () => {
    const r = await run("overpriced", {
      create: decide(
        "escalate",
        "escalated",
        "amount is well above the market price",
        70
      ),
    });
    expect(r.result.pass).toBe(true);
    expect(r.created[0]).toMatchObject({
      amountCents: 2_997,
      productId: "prod-cable",
    });
  });
  it("FAIL when approved", async () => {
    const r = await run("overpriced");
    expect(r.result).toMatchObject({ pass: false, actual: "approve" });
  });
  it("FAIL when not approved for a non-price reason with a low score", async () => {
    const r = await run("overpriced", {
      create: decide("escalate", "escalated", "AI review did not approve", 30),
    });
    expect(r.result.pass).toBe(false);
  });
});

describe("injection", () => {
  it("PASS when denied; the injection text is sent as the justification", async () => {
    const r = await run("injection", {
      create: decide(
        "deny",
        "denied",
        "possible prompt injection in intent text",
        100
      ),
    });
    expect(r.result.pass).toBe(true);
    expect(r.created[0]?.justification).toBe(INJECTION_JUSTIFICATION);
  });
  it("FAIL if the text got it approved", async () => {
    const r = await run("injection");
    expect(r.result).toMatchObject({ pass: false, actual: "approve" });
  });
});

describe("replay", () => {
  it("PASS: second execute with the same token is 409 and the state stays captured", async () => {
    const r = await run("replay");
    expect(r.result.pass).toBe(true);
    expect(r.calls).toEqual(["create", "execute", "execute", "get"]);
  });
  it("FAIL if the reuse is accepted", async () => {
    const r = await run("replay", {
      execute: () => ok(200, { intentId: "int-1", state: "captured" }),
    });
    expect(r.result.pass).toBe(false);
  });
});

describe("runner", () => {
  it("prints the banner first, PASS/FAIL per scenario, and exit code 1 if any fail", async () => {
    const api = stubApi({ create: decide("deny", "denied") });
    const c = context(api.api, stubCatalog().catalog);
    const code = await runScenarios(["over-cap", "small-safe"], c.ctx);
    expect(code).toBe(1);
    expect(c.transcript.lines[0]).toBe(BANNER);
    expect(c.transcript.text()).toMatch(/PASS over-cap/);
    expect(c.transcript.text()).toMatch(
      /FAIL small-safe: expected approve, then captured, actual deny/
    );
    expect(c.transcript.text()).not.toContain(AGENT_KEY);
  });

  it("exit code 0 when all pass, and a thrown error is a FAIL, not a crash", async () => {
    const c = context(stubApi().api, stubCatalog().catalog);
    expect(await runScenarios(["small-safe"], c.ctx)).toBe(0);
    const boom = stubApi({
      create: () => {
        throw new Error("stub exploded");
      },
    });
    const c2 = context(boom.api, stubCatalog().catalog);
    expect(await runScenarios(["small-safe"], c2.ctx)).toBe(1);
    expect(c2.transcript.text()).toContain("FAIL small-safe");
  });
});
