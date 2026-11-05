// Channel3 single-product retrieval.
//
// retrieve is the fresh, free source for price/stock/url at display time
// (freshness discipline: cache IDs only). The client is injected so tests can
// stub it with fixtures.

import type { Channel3SdkLike } from "./client.js";
import type { Channel3Product } from "./types.js";

/**
 * Fetch a single canonical product by its Channel3 id.
 *
 * A not-found error from the SDK (e.g. a 404 for an id not yet in the catalog)
 * propagates to the caller rather than being swallowed, so callers can react
 * (Requirement 3.3).
 */
export async function getProduct(
  client: Channel3SdkLike,
  productId: string,
): Promise<Channel3Product> {
  return client.products.retrieve({ product_id: productId });
}
