import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { centsToDecimal, decimalToCents } from "../money.js";
import { requestId } from "../idempotency.js";

// Feature: spec-03-paypal-core, Property 1: money conversion round-trips
//
// For any integer cents in [0, 10_000_000] with the default 2-decimal currency,
// decimalToCents(centsToDecimal(cents)) === cents, and centsToDecimal always
// emits a canonical "<major>.<2 digits>" string. The PayPal decimal boundary
// never distorts a cent value.
//
// Validates: Requirements 4.2, 4.3
describe("Property 1: money conversion round-trips", () => {
  it("decimalToCents(centsToDecimal(cents)) === cents and the string is 2dp", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (cents) => {
        const decimal = centsToDecimal(cents);
        expect(decimal).toMatch(/^\d+\.\d{2}$/);
        expect(decimalToCents(decimal)).toBe(cents);
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: spec-03-paypal-core, Property 2: idempotency key deterministic
//
// For any intentId and any operation, requestId(intentId, op) is stable across
// repeated calls, non-empty, and <= 10000 chars. For a fixed intentId, two
// DIFFERENT operations yield DIFFERENT keys. Guarantees retries reuse one key
// (no double-charge) while distinct writes stay distinct.
//
// Validates: Requirements 5.1, 5.2
describe("Property 2: idempotency key is deterministic and stable", () => {
  // Bounded intent-id generator keeps the suite fast; includes the empty string.
  const intentIdArb = fc.string({ maxLength: 64 });
  const OPS = ["create", "authorize", "capture", "void"] as const;
  const opArb = fc.constantFrom(...OPS);

  it("is stable per (intentId, op), non-empty, and <= 10000 chars", () => {
    fc.assert(
      fc.property(intentIdArb, opArb, (intentId, op) => {
        const first = requestId(intentId, op);
        const second = requestId(intentId, op);
        expect(first).toBe(second);
        expect(first.length).toBeGreaterThan(0);
        expect(first.length).toBeLessThanOrEqual(10000);
      }),
      { numRuns: 200 },
    );
  });

  it("different ops for the same intent produce different keys", () => {
    // Two distinct ops from the fixed set guarantee a real pair to compare.
    const twoDistinctOps = fc
      .tuple(opArb, opArb)
      .filter(([a, b]) => a !== b);

    fc.assert(
      fc.property(intentIdArb, twoDistinctOps, (intentId, [opA, opB]) => {
        expect(requestId(intentId, opA)).not.toBe(requestId(intentId, opB));
      }),
      { numRuns: 200 },
    );
  });
});
