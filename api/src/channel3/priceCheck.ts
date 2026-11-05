// Risk Guard-facing price-sanity verdict for an intent amount.
//
// priceCheck gathers in-stock, same-currency offers from Channel3, converts them
// to integer cents, and classifies the intent amount against the market median.
// It is TOTAL: any error, timeout, or empty sample degrades to `unknown` and it
// never throws (Requirements 4.3, 5.1).

import type { Channel3SdkLike } from "./client.js";
import { majorToCents } from "./money.js";
import { getProduct as defaultGetProduct } from "./product.js";
import { searchProducts as defaultSearchProducts, type SearchProductsInput } from "./search.js";
import type { Channel3Product, PriceCheckResult } from "./types.js";
import { withResilience } from "./withResilience.js";

/**
 * Verdict thresholds as a ratio of intent amount to market median. Deliberate,
 * documented defaults (not from Channel3); kept in one named constant so Risk
 * Guard tuning in spec-07 is a one-line change.
 */
export const PRICE_BANDS = { high: 1.3, low: 0.7 } as const;

/** 8-second ceiling with one retry, per Requirement 5.1. */
const RESILIENCE = { timeoutMs: 8000, retries: 1 } as const;

/** Result count to sample when falling back to a title search. */
const SEARCH_LIMIT = 10;

export interface PriceCheckInput {
  /** Free-text product title, used for the fallback catalog search. */
  title: string;
  /** Intent amount under evaluation, in integer cents. */
  amountCents: number;
  /** ISO 4217 currency code the intent is denominated in. */
  currency: string;
  /** Optional exact Channel3 product id; when present, we compare that product only. */
  productId?: string;
}

/** Injected collaborators, overridable in tests; default to the real functions. */
export interface PriceCheckDeps {
  client: Channel3SdkLike;
  searchProducts?: (
    client: Channel3SdkLike,
    input: SearchProductsInput,
  ) => Promise<Channel3Product[]>;
  getProduct?: (client: Channel3SdkLike, productId: string) => Promise<Channel3Product>;
}

const UNKNOWN: PriceCheckResult = { status: "unknown", medianCents: null, sampleSize: 0 };

/**
 * Compute a price-sanity verdict for an intent.
 *
 * - When `productId` is provided, compares against that exact product's offers
 *   (free retrieve); otherwise falls back to a title search (Refinements, Req 4.1).
 * - Only in-stock offers whose currency matches `input.currency` are sampled,
 *   converted to integer cents via money.ts (Requirement 4.4).
 * - Empty sample or any error/timeout => `unknown` with `sampleSize: 0`; never
 *   throws (Requirements 4.3, 5.1).
 */
export async function priceCheck(
  deps: PriceCheckDeps,
  input: PriceCheckInput,
): Promise<PriceCheckResult> {
  const searchProducts = deps.searchProducts ?? defaultSearchProducts;
  const getProduct = deps.getProduct ?? defaultGetProduct;

  try {
    const products = await withResilience<Channel3Product[]>(async () => {
      if (input.productId != null) {
        const product = await getProduct(deps.client, input.productId);
        return [product];
      }
      return searchProducts(deps.client, { query: input.title, limit: SEARCH_LIMIT });
    }, RESILIENCE);

    const offers = products
      .flatMap((p) => p.offers ?? [])
      .filter((o) => o.availability === "InStock" && o.price.currency === input.currency)
      .map((o) => ({
        domain: o.domain,
        priceCents: majorToCents(o.price.price),
        currency: o.price.currency,
      }));

    if (offers.length === 0) {
      return { ...UNKNOWN };
    }

    const medianCents = median(offers.map((o) => o.priceCents));
    const bestOffer = offers.reduce((a, b) => (b.priceCents < a.priceCents ? b : a));
    const status = classify(input.amountCents, medianCents);

    return { status, medianCents, sampleSize: offers.length, bestOffer };
  } catch {
    return { ...UNKNOWN };
  }
}

/** Classify an amount against the market median by ratio band. */
function classify(amountCents: number, medianCents: number): PriceCheckResult["status"] {
  if (medianCents <= 0) {
    return "unknown";
  }
  const r = amountCents / medianCents;
  if (r > PRICE_BANDS.high) {
    return "high";
  }
  if (r < PRICE_BANDS.low) {
    return "low";
  }
  return "ok";
}

/** Median of a non-empty list of integers; averages the two middle values when even. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
