import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { Policy, RuleIntent, TransactionRecord } from "@agentpurse/shared";
import { evaluateRules } from "../rules.js";

// Deterministic property tests for the gateway rules engine (spec-05).
//
// The engine clock is injected as an explicit `nowMs`, so we pin it to a fixed
// epoch and generate all transaction times around it. No I/O, no live calls:
// evaluateRules is pure and synchronous.

// A fixed "now" so every run is deterministic. Transaction times are generated
// relative to this anchor.
const NOW_MS = 1_700_000_000_000;

// Small currency set so the intent currency collides with history currencies
// often enough to exercise same-currency spend accounting.
const CURRENCIES = ["USD", "EUR", "GBP", "JPY"] as const;
const currencyArb = fc.constantFrom(...CURRENCIES);

// Bounded non-negative integer cents, kept small so the suite stays fast.
const centsArb = fc.integer({ min: 0, max: 1_000_000 });

// Bounded non-negative velocity counts.
const velocityArb = fc.integer({ min: 0, max: 50 });

// A transaction record with a time clustered around NOW_MS: some inside the
// rolling 24h window, some outside (up to ~48h back and a little ahead).
const txRecordArb: fc.Arbitrary<TransactionRecord> = fc.record({
  amountCents: centsArb,
  currency: currencyArb,
  payee: fc.string({ minLength: 1, maxLength: 12 }),
  createdAtMs: fc.integer({
    min: NOW_MS - 48 * 60 * 60 * 1000,
    max: NOW_MS + 60 * 60 * 1000,
  }),
});

const historyArb: fc.Arbitrary<TransactionRecord[]> = fc.array(txRecordArb, {
  maxLength: 15,
});

// An arbitrary valid Policy: non-negative integer caps/budgets/velocities,
// arbitrary (possibly empty) allow/block lists.
const policyArb: fc.Arbitrary<Policy> = fc.record({
  dailyBudgetCents: centsArb,
  perPurchaseCapCents: centsArb,
  allowedCategories: fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 4 }),
  blockedPayees: fc.array(fc.string({ minLength: 1, maxLength: 12 }), { maxLength: 4 }),
  allowedPayees: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 12 }), { maxLength: 4 }), {
    nil: undefined,
  }),
  velocityPerHour: velocityArb,
  velocityPerDay: velocityArb,
});

// An arbitrary valid RuleIntent: non-negative integer amount, 3-letter currency.
const intentArb: fc.Arbitrary<RuleIntent> = fc.record({
  agentId: fc.string({ minLength: 1, maxLength: 12 }),
  payee: fc.string({ minLength: 1, maxLength: 12 }),
  amountCents: centsArb,
  currency: currencyArb,
  category: fc.option(fc.string({ minLength: 1, maxLength: 8 }), { nil: undefined }),
  description: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
});

// Feature: spec-05-gateway-rules, Property 1: remaining budget non-negative
// Validates: Requirements 3.2
//
// For any valid Policy, RuleIntent, and TransactionRecord[], the result's
// remainingBudgetCents is a non-negative integer, whether the intent passes or
// fails. The clock is pinned so the run is deterministic.
describe("Property 1: remaining budget non-negative", () => {
  it("remainingBudgetCents is a non-negative integer for arbitrary inputs", () => {
    fc.assert(
      fc.property(intentArb, policyArb, historyArb, (intent, policy, history) => {
        const result = evaluateRules(intent, policy, history, NOW_MS);
        expect(result.remainingBudgetCents).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(result.remainingBudgetCents)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: spec-05-gateway-rules, Property 2: in-limits intent passes
// Validates: Requirements 2.10, 3.2
//
// We CONSTRUCT inputs that satisfy every rule rather than filtering:
//   - empty history (so spentToday == 0 and both velocity counts == 0),
//   - empty blockedPayees, undefined allowedPayees, empty allowedCategories
//     (so the allow/block checks never fire),
//   - perPurchaseCap and dailyBudget both >= the intent amount,
//   - velocityPerHour and velocityPerDay both >= 1 (0 in-window txns < 1).
// Under these conditions the intent must pass with no matchedRule.
describe("Property 2: in-limits intent passes", () => {
  it("an intent within every limit passes with no matchedRule", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }), // agentId
        fc.string({ minLength: 1, maxLength: 12 }), // payee
        currencyArb,
        centsArb, // amountCents
        fc.integer({ min: 0, max: 1_000_000 }), // extra cap headroom
        fc.integer({ min: 0, max: 1_000_000 }), // extra budget headroom
        fc.integer({ min: 1, max: 50 }), // velocityPerHour (>= 1)
        fc.integer({ min: 1, max: 50 }), // velocityPerDay (>= 1)
        (agentId, payee, currency, amountCents, capHeadroom, budgetHeadroom, vHour, vDay) => {
          const intent: RuleIntent = { agentId, payee, amountCents, currency };
          const policy: Policy = {
            perPurchaseCapCents: amountCents + capHeadroom, // >= amount
            dailyBudgetCents: amountCents + budgetHeadroom, // >= spent(0) + amount
            allowedCategories: [], // unrestricted
            blockedPayees: [], // nothing blocked
            allowedPayees: undefined, // no allowlist
            velocityPerHour: vHour, // 0 in-window < vHour
            velocityPerDay: vDay, // 0 in-window < vDay
          };
          const history: TransactionRecord[] = []; // empty => spent 0, counts 0

          const result = evaluateRules(intent, policy, history, NOW_MS);
          expect(result.passed).toBe(true);
          expect(result.matchedRule).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });
});
