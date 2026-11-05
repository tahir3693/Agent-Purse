// Channel3 SDK client builder.
//
// This is the only place that constructs the real @channel3/sdk client and the
// only place that reads CHANNEL3_API_KEY. The key is a server-side secret and is
// NEVER logged, printed, copied, or included in an error message (money-rules.md).

import { Channel3 } from "@channel3/sdk";

import type { Channel3Product } from "./types.js";

/**
 * Minimal structural view of the Channel3 SDK that AgentPurse depends on.
 *
 * Functions take a `Channel3SdkLike` (dependency injection) so the index.ts
 * factory can wire the real SDK while tests inject a fixture-backed stub - no
 * live network calls in tests (Requirement 7). The real SDK's response types are
 * wider than this; we narrow at the client boundary via `buildChannel3Client`.
 */
export interface Channel3SdkLike {
  products: {
    search(args: {
      query: string;
      filters?: { price?: { max_price?: number; min_price?: number } };
      limit?: number;
    }): Promise<{ data: Channel3Product[] }>;
    retrieve(args: { product_id: string }): Promise<Channel3Product>;
  };
}

/**
 * Construct a Channel3 SDK client from the environment.
 *
 * Reads and trims `CHANNEL3_API_KEY`. If it is missing or blank, throws a named
 * error that identifies the variable by NAME only - never its value
 * (Requirements 1.2, 8.1).
 */
export function buildChannel3Client(env: NodeJS.ProcessEnv): Channel3 {
  const apiKey = env.CHANNEL3_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing required environment variable: CHANNEL3_API_KEY");
  }
  return new Channel3({ apiKey });
}
