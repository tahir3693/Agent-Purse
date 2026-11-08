// spec-11a: optional productId on POST /intents feeds the price check only.
import { describe, expect, it } from "vitest";

import { createHarness, validBody } from "./helpers.js";

describe("POST /intents productId", () => {
  it("passes productId to the Risk Guard and never persists it", async () => {
    const h = createHarness();
    const res = await h.create({
      ...validBody,
      productId: "  prod_test_123  ",
    });
    expect(res.statusCode).toBe(201);
    expect(h.riskCalls[0]?.productId).toBe("prod_test_123");
    const id = (res.json() as { intentId: string }).intentId;
    const stored = await h.stores.intents.get(id);
    expect(stored).not.toBeNull();
    expect(Object.keys(stored!)).not.toContain("productId");
    expect(JSON.stringify(stored)).not.toContain("prod_test_123");
  });

  it("absent productId behaves as before", async () => {
    const h = createHarness();
    expect((await h.create(validBody)).statusCode).toBe(201);
    expect(h.riskCalls[0]).not.toHaveProperty("productId");
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["over 200 characters", "p".repeat(201)],
    ["not a string", 42],
  ])("%s productId => 400 and no intent", async (_n, productId) => {
    const h = createHarness();
    const res = await h.create({ ...validBody, productId });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "invalid_body",
      fields: ["productId"],
    });
    expect(
      await h.stores.intents.listByAgents(["agent-1"], { limit: 10 })
    ).toEqual([]);
    expect(h.riskCalls).toHaveLength(0);
  });

  it("accepts exactly 200 characters", async () => {
    const h = createHarness();
    expect(
      (await h.create({ ...validBody, productId: "p".repeat(200) })).statusCode
    ).toBe(201);
  });
});
