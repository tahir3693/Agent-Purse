// Product lookup through the existing Channel3 module (api/src/channel3).
// Shared by relative import so there is exactly one Channel3 client.
import {
  buildChannel3Client,
  createChannel3Module,
  type Channel3Product,
} from "../../api/src/channel3/index.js";
import { majorToCents } from "../../api/src/channel3/money.js";

export type Product = Channel3Product;

export interface Catalog {
  search(query: string, maxPriceCents: number): Promise<Product[]>;
}

export interface Offer {
  productId: string;
  title: string;
  domain: string;
  priceCents: number;
  currency: string;
}

/**
 * Cheapest in-stock USD offer at or below the budget; ties keep the first
 * offer in result order. null when nothing fits.
 */
export function pickOffer(
  products: Product[],
  budgetCents: number
): Offer | null {
  let best: Offer | null = null;
  for (const p of products) {
    for (const o of p.offers ?? []) {
      if (o.availability !== "InStock" || o.price.currency !== "USD") continue;
      if (typeof o.price.price !== "number" || !Number.isFinite(o.price.price))
        continue;
      const priceCents = majorToCents(o.price.price);
      if (priceCents <= 0 || priceCents > budgetCents) continue;
      if (!best || priceCents < best.priceCents) {
        best = {
          productId: p.id,
          title: p.title,
          domain: o.domain,
          priceCents,
          currency: "USD",
        };
      }
    }
  }
  return best;
}

export function createChannel3Catalog(env: NodeJS.ProcessEnv): Catalog {
  const module = createChannel3Module({ client: buildChannel3Client(env) });
  return {
    search: (query, maxPriceCents) =>
      module.searchProducts({ query, maxPriceCents, limit: 10 }),
  };
}
