// Local typed views over the Channel3 SDK response shapes.
//
// These mirror ONLY the fields AgentPurse uses, kept deliberately narrow so SDK
// churn has a small blast radius. Field names/shapes are taken from the installed
// Channel3 skill (.agents/skills/channel3-api/references/api-reference.md), not guessed.

/** A single offer's price. Channel3 prices are in MAJOR currency units (e.g. dollars). */
export interface Channel3Price {
  /** Post-discount price in major currency units (not cents). */
  price: number;
  /** ISO 4217 currency code, e.g. "USD". */
  currency: string;
  /** Pre-discount price in major units, when present. */
  compare_at_price?: number | null;
}

/** A single merchant listing for a product. */
export interface Channel3Offer {
  /** Affiliate-tracked buy URL; short-lived, never cached and re-served. */
  url: string;
  /** Retailer domain, e.g. "nordstrom.com". */
  domain: string;
  price: Channel3Price;
  availability: "InStock" | "OutOfStock";
}

/** A catalog product, trimmed to the fields AgentPurse consumes. */
export interface Channel3Product {
  id: string;
  title: string;
  offers?: Channel3Offer[];
}

/** Risk Guard-facing price-sanity verdict for an intent amount. */
export interface PriceCheckResult {
  status: "ok" | "high" | "low" | "unknown";
  /** Median in-stock offer price in integer cents, or null when the sample is empty. */
  medianCents: number | null;
  /** Number of same-currency in-stock offers compared. */
  sampleSize: number;
  /** Lowest-priced in-stock matching offer, in our Money convention (integer cents). */
  bestOffer?: { domain: string; priceCents: number; currency: string };
}
