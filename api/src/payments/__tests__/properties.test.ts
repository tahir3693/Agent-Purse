import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { centsToDecimal, decimalToCents } from "../braintree/money.js";
import { mapStatus } from "../braintree/status.js";

const SEVEN = [
  "authorized",
  "capture_pending",
  "captured",
  "voided",
  "expired",
  "declined",
  "failed",
];

describe("payments properties", () => {
  // Feature: spec-03b-payment-provider-braintree, Property 1: money conversion round-trips
  // **Validates: Requirements 2.4, 6.2**
  it("Property 1: cents -> decimal -> cents round-trips and matches ^\\d+\\.\\d{2}$", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (cents) => {
        const s = centsToDecimal(cents);
        expect(s).toMatch(/^\d+\.\d{2}$/);
        expect(decimalToCents(s)).toBe(cents);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: spec-03b-payment-provider-braintree, Property 2: status mapping is total
  // **Validates: Requirements 1.5**
  it("Property 2: mapStatus returns one of the seven statuses and never throws", () => {
    const known = [
      "authorized",
      "authorizing",
      "submitted_for_settlement",
      "settlement_pending",
      "settling",
      "settled",
      "voided",
      "authorization_expired",
      "processor_declined",
      "settlement_declined",
      "gateway_rejected",
      "failed",
    ];
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constantFrom(...known)), (status) => {
        const out = mapStatus(status);
        expect(SEVEN).toContain(out);
      }),
      { numRuns: 200 },
    );
  });
});
