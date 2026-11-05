// Fixture Channel3 response objects for fixture-backed unit tests.
//
// These mirror the narrow typed views in types.ts (the only fields AgentPurse
// consumes). No secrets, no live data - deterministic recorded shapes used to
// drive the stub SDK client (Requirement 7.1).

import type { Channel3Offer, Channel3Product } from "../../types.js";

/** Build an in-stock offer in major currency units (e.g. dollars). */
export function offer(
  priceMajor: number,
  currency = "USD",
  domain = "example.com",
  availability: Channel3Offer["availability"] = "InStock",
): Channel3Offer {
  return {
    url: `https://${domain}/buy`,
    domain,
    price: { price: priceMajor, currency },
    availability,
  };
}

/** Build a product with the given offers. */
export function product(
  id: string,
  title: string,
  offers: Channel3Offer[],
): Channel3Product {
  return { id, title, offers };
}

/**
 * A product whose in-stock USD offers have prices 90, 100, 110 (major units),
 * i.e. 9000, 10000, 11000 cents -> median 10000 cents. Handy for band tests.
 */
export const medianProduct10000: Channel3Product = product("p-median", "27 inch monitor", [
  offer(90),
  offer(100),
  offer(110),
]);

/** A product whose single in-stock USD offer is 100.00 -> median 10000 cents. */
export const singleOffer10000: Channel3Product = product("p-single", "mechanical keyboard", [
  offer(100),
]);

/** A product with a mix of currencies and availability for the currency-filter test. */
export const mixedCurrencyProduct: Channel3Product = product("p-mixed", "wireless mouse", [
  offer(100, "USD"), // counts
  offer(120, "USD"), // counts
  offer(80, "EUR"), // excluded: wrong currency
  offer(50, "USD", "closed.com", "OutOfStock"), // excluded: out of stock
]);
