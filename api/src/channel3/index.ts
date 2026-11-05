// Public surface of the Channel3 module.
//
// `createChannel3Module` is the factory the rest of the API (and tests) use: it
// binds a Channel3SdkLike client to the three operations AgentPurse needs, so
// callers never touch the SDK directly. Tests pass a fixture-backed stub; prod
// wiring passes `buildChannel3Client(process.env)`.

import { buildChannel3Client, type Channel3SdkLike } from "./client.js";
import { getProduct } from "./product.js";
import {
  priceCheck,
  type PriceCheckDeps,
  type PriceCheckInput,
  PRICE_BANDS,
} from "./priceCheck.js";
import { searchProducts, type SearchProductsInput } from "./search.js";
import type { Channel3Product, PriceCheckResult } from "./types.js";

/** The three Channel3 operations, pre-bound to a single client instance. */
export interface Channel3Module {
  searchProducts(input: SearchProductsInput): Promise<Channel3Product[]>;
  getProduct(productId: string): Promise<Channel3Product>;
  priceCheck(input: PriceCheckInput): Promise<PriceCheckResult>;
}

/**
 * Build the Channel3 module bound to a single SDK client.
 *
 * priceCheck reuses the same injected client for its internal search/retrieve so
 * the whole module shares one auth/config source.
 */
export function createChannel3Module(deps: { client: Channel3SdkLike }): Channel3Module {
  const { client } = deps;
  const priceCheckDeps: PriceCheckDeps = { client };
  return {
    searchProducts: (input) => searchProducts(client, input),
    getProduct: (productId) => getProduct(client, productId),
    priceCheck: (input) => priceCheck(priceCheckDeps, input),
  };
}

// Public re-exports.
export { buildChannel3Client, PRICE_BANDS };
export type {
  Channel3SdkLike,
  Channel3Product,
  PriceCheckResult,
  PriceCheckInput,
  SearchProductsInput,
};
