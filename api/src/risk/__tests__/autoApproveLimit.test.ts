// spec-11a: a high price or an amount above the auto-approve limit never
// approves, whatever the AI says. Offline: fake reviewer and price check.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { evaluateRisk } from "../guard.js";
import {
  CONFIG,
  FakeReviewer,
  OK_REVIEW,
  deps,
  price,
  riskInput,
} from "./helpers.js";

const statuses = fc.constantFrom<"ok" | "low" | "high" | "unknown">(
  "ok",
  "low",
  "high",
  "unknown"
);
const reviews = fc.record({
  approved: fc.boolean(),
  riskScore: fc.integer({ min: 0, max: 100 }),
  reason: fc.string({ maxLength: 40 }),
  flagPromptInjection: fc.boolean(),
});

describe("auto-approve limit is deterministic", () => {
  it("amount above the limit with a fair price and an approving AI escalates", async () => {
    const res = await evaluateRisk(
      deps(new FakeReviewer({ kind: "value", value: OK_REVIEW }), price("ok")),
      riskInput({ amountCents: CONFIG.autoApproveBelowCents + 1 })
    );
    expect(res.decision).toBe("escalate");
    expect(res.reason).toBe(
      "amount above auto-approve limit; owner approval required"
    );
  });

  it("the limit wins over an AI failure, so the reason does not depend on the AI", async () => {
    const res = await evaluateRisk(
      deps(new FakeReviewer({ kind: "throw" }), price("ok")),
      riskInput({ amountCents: 12_000 })
    );
    expect(res.decision).toBe("escalate");
    expect(res.reason).toBe(
      "amount above auto-approve limit; owner approval required"
    );
  });

  it("a high price is reported before the limit", async () => {
    const res = await evaluateRisk(
      deps(
        new FakeReviewer({ kind: "value", value: OK_REVIEW }),
        price("high")
      ),
      riskInput({ amountCents: 12_000 })
    );
    expect(res.decision).toBe("escalate");
    expect(res.reason).toBe("amount is well above the market price");
  });

  it("at the limit, a fair price and an approving AI may still approve", async () => {
    const res = await evaluateRisk(
      deps(new FakeReviewer({ kind: "value", value: OK_REVIEW }), price("ok")),
      riskInput({ amountCents: CONFIG.autoApproveBelowCents })
    );
    expect(res.decision).toBe("approve");
  });

  // Feature: spec-11a-demo-agent, Property 3: Risk Guard never over-approves
  it("Property 3: amount above the limit or price high never approves, for any AI output", async () => {
    await fc.assert(
      fc.asyncProperty(
        reviews,
        statuses,
        fc.integer({ min: 1, max: 49_999 }),
        async (review, status, amount) => {
          const res = await evaluateRisk(
            deps(
              new FakeReviewer({ kind: "value", value: review }),
              price(status)
            ),
            riskInput({ amountCents: amount })
          );
          if (status === "high" || amount > CONFIG.autoApproveBelowCents) {
            expect(res.decision).not.toBe("approve");
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
