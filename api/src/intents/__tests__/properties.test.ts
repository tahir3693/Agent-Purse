// Property tests for spec-08 (fast-check, >= 100 runs each).

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createHarness } from "./helpers.js";

const RUNS = { numRuns: 100 };

describe("spec-08 properties", () => {
  // Feature: spec-08-mandate-and-pay, Property 1: A mandate token is accepted at most once
  // **Validates: Requirements 3.2**
  it("Property 1: N sequential executes with the same token capture at most once", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 6 }), async (n) => {
        const h = createHarness();
        const created = await h.create();
        const { intentId, mandateToken } = created.json() as {
          intentId: string;
          mandateToken: string;
        };
        const codes: number[] = [];
        for (let i = 0; i < n; i++) {
          codes.push((await h.execute(intentId, mandateToken)).statusCode);
        }
        expect(h.provider.captureCalls.length).toBeLessThanOrEqual(1);
        expect(codes.filter((c) => c === 200)).toHaveLength(1);
        expect(h.provider.voidCalls).toHaveLength(0);
        await h.app.close();
      }),
      RUNS,
    );
  });

  // Feature: spec-08-mandate-and-pay, Property 3: Only approve places a hold
  // **Validates: Requirements 1.2**
  it("Property 3: deny or escalate never calls authorize", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("deny", "escalate" as const),
        fc.integer({ min: 1, max: 1_000_000 }),
        async (decision, amountCents) => {
          const h = createHarness({ decision: decision as "deny" | "escalate" });
          const res = await h.create({
            amountCents,
            currency: "USD",
            payee: "shop.example.com",
            category: "office",
            description: "item",
            justification: "because",
            paymentMethodRef: "pm_fake_token",
          });
          expect(res.statusCode).toBe(200);
          expect(h.provider.authorizeCalls).toHaveLength(0);
          await h.app.close();
        },
      ),
      RUNS,
    );
  });
});
