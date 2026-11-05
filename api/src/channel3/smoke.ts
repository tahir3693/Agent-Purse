// Channel3 smoke script (pnpm channel3:smoke "<query>").
//
// A tiny CLI that runs a live search against Channel3 and prints the top results
// so a human can eyeball that auth + the SDK work end to end. It is NOT part of
// the test suite (tests use fixtures; this touches the live API).
//
// Secret discipline (money-rules.md): this script never reads, prints, copies,
// or logs CHANNEL3_API_KEY. On a missing key it prints only the error message,
// which names the variable - never its value.
//
// The pnpm script loads the root .env via `node --env-file=../.env`, so running
// from a configured repo does not falsely report a missing variable.

import { buildChannel3Client } from "./client.js";
import { createChannel3Module } from "./index.js";
import type { Channel3Offer, Channel3Product } from "./types.js";

const USAGE = 'usage: pnpm channel3:smoke "<query>"';

/** Pick the lowest-priced offer for a product as its representative listing. */
function bestOffer(product: Channel3Product): Channel3Offer | undefined {
  const offers = product.offers ?? [];
  if (offers.length === 0) return undefined;
  return offers.reduce((best, o) => (o.price.price < best.price.price ? o : best));
}

/** Format a single product line as `title | domain | price currency`. */
function formatLine(product: Channel3Product): string {
  const offer = bestOffer(product);
  if (!offer) return `${product.title} | (no offers)`;
  return `${product.title} | ${offer.domain} | ${offer.price.price} ${offer.price.currency}`;
}

async function main(): Promise<number> {
  const query = process.argv[2];
  if (!query) {
    console.log(USAGE);
    return 1;
  }

  // Build the client. A missing/blank CHANNEL3_API_KEY throws a named error
  // (the message identifies the variable, never its value). Print only that.
  let module;
  try {
    const client = buildChannel3Client(process.env);
    module = createChannel3Module({ client });
  } catch (err) {
    console.log(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const products = await module.searchProducts({ query, limit: 5 });
  if (products.length === 0) {
    console.log("(no results)");
    return 0;
  }

  for (const product of products.slice(0, 5)) {
    console.log(formatLine(product));
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    // Unexpected transport/runtime error. Print the message only (no secrets
    // ever appear in our error messages) and exit non-zero.
    console.log(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
