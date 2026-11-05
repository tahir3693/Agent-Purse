import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { Channel3SdkLike } from "../client.js";
import { centsToMajor, majorToCents } from "../money.js";
import { priceCheck, type PriceCheckDeps } from "../priceCheck.js";
import type { Channel3Offer, Channel3Product } from "../types.js";

// A small, fixed currency set so the generated `input.currency` collides with
// offer currencies often enough to exercise both the match and mismatch paths.
const CURRENCIES = ["USD", "EUR", "GBP", "JPY"] as const;
const currencyArb = fc.constantFrom(...CURRENCIES);

// A single arbitrary offer: bounded price (incl. zero), in/out of stock, any
// currency from the small set. Kept small so the suite stays fast.
const offerArb: fc.Arbitrary<Channel3Offer> = fc.record({
  url: fc.webUrl(),
  domain: fc.domain(),
  price: fc.record({
    price: fc.integer({ min: 0, max: 100_000 }), // major units, incl. zero
    currency: currencyArb,
    compare_at_price: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: undefined }),
  }),
  availability: fc.constantFrom<"InStock" | "OutOfStock">("InStock", "OutOfStock"),
});

// Offer sets include the empty set, mixed currency, mixed availability, and
// zero/positive prices by construction.
const offersArb: fc.Arbitrary<Channel3Offer[]> = fc.array(offerArb, { maxLength: 12 });

// A client that must never be touched: injected searchProducts/getProduct
// below fully replace any real SDK call, so no live client is used.
const unusedClient = {} as Channel3SdkLike;

/** Count of offers that are BOTH InStock AND match the given currency. */
function matchingCount(offers: Channel3Offer[], currency: string): number {
  return offers.filter((o) => o.availability === "InStock" && o.price.currency === currency)
    .length;
}

// Feature: spec-02-channel3-client, Property 1: priceCheck total and well-typed
//
// For any amountCents >= 0, any currency, and any stubbed offer set (empty,
// mixed-currency, in/out-of-stock, zero/positive prices), priceCheck resolves
// without throwing to a result whose status is one of the four literals and
// whose sampleSize equals the number of same-currency in-stock offers.
//
// Validates: Requirements 4.1, 4.3, 4.4, 5.1
describe("Property 1: priceCheck is total and well-typed", () => {
  const VALID_STATUSES = ["ok", "high", "low", "unknown"] as const;

  it("resolves to a valid status with sampleSize = same-currency in-stock count", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 10_000_000 }),
        currencyArb,
        offersArb,
        async (amountCents, currency, offers) => {
          // Fake searchProducts: returns a single product built from the
          // generated offers. No real client, fully deterministic.
          const searchProducts = async (): Promise<Channel3Product[]> => [
            { id: "prod-fake", title: "fake", offers },
          ];
          const deps: PriceCheckDeps = { client: unusedClient, searchProducts };

          const result = await priceCheck(deps, {
            title: "anything",
            amountCents,
            currency,
          });

          expect(VALID_STATUSES).toContain(result.status);
          expect(result.sampleSize).toBe(matchingCount(offers, currency));
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: spec-02-channel3-client, Property 2: money conversion round-trips
//
// For any integer cents in [0, 10_000_000], majorToCents(centsToMajor(cents))
// returns exactly cents. The Channel3 major-units boundary loses no cent value.
//
// Validates: Requirements 4.4
describe("Property 2: money conversion round-trips", () => {
  it("majorToCents(centsToMajor(cents)) === cents", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (cents) => {
        expect(majorToCents(centsToMajor(cents))).toBe(cents);
      }),
      { numRuns: 200 },
    );
  });
});
