// Channel3 product search.
//
// Wraps client.products.search, mapping AgentPurse's integer-cents price cap to
// Channel3's major-currency-unit filter and returning only the product array.
// The client is injected (Channel3SdkLike) so tests can stub it with fixtures.

import type { Channel3SdkLike } from "./client.js";
import { centsToMajor } from "./money.js";
import type { Channel3Product } from "./types.js";

export interface SearchProductsInput {
  query: string;
  /** Optional upper price bound in integer cents (our Money convention). */
  maxPriceCents?: number;
  /** Desired result count; clamped to [1, 30]. Defaults to 5. */
  limit?: number;
}

const DEFAULT_LIMIT = 5;
const MIN_LIMIT = 1;
const MAX_LIMIT = 30;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Search the Channel3 catalog.
 *
 * - `limit` is clamped to [1, 30] (SDK max is 30), defaulting to 5 (Requirement 2.2).
 * - `maxPriceCents` maps to `filters.price.max_price` in MAJOR units via money.ts,
 *   the only place cents meet Channel3 decimals (Requirement 2.1).
 * - An empty/successful page yields `[]` (Requirement 2.3).
 */
export async function searchProducts(
  client: Channel3SdkLike,
  input: SearchProductsInput,
): Promise<Channel3Product[]> {
  const limit = clamp(input.limit ?? DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT);
  const filters =
    input.maxPriceCents != null
      ? { price: { max_price: centsToMajor(input.maxPriceCents) } }
      : undefined;

  const page = await client.products.search({ query: input.query, filters, limit });
  return page.data ?? [];
}
