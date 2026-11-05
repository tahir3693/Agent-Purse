// A fixture-backed stub implementing Channel3SdkLike.
//
// No live network calls (Requirement 7.1): search/retrieve resolve from supplied
// fixtures (or reject with a supplied error), and every call is recorded so tests
// can assert mapping (max_price, limit), call counts (retry-once), and which path
// (search vs retrieve) was taken.

import type { Channel3SdkLike } from "../../client.js";
import type { Channel3Product } from "../../types.js";

type SearchArgs = Parameters<Channel3SdkLike["products"]["search"]>[0];
type RetrieveArgs = Parameters<Channel3SdkLike["products"]["retrieve"]>[0];

export interface StubClient extends Channel3SdkLike {
  /** Recorded arguments of every products.search call, in order. */
  readonly searchCalls: SearchArgs[];
  /** Recorded arguments of every products.retrieve call, in order. */
  readonly retrieveCalls: RetrieveArgs[];
}

export interface StubOptions {
  /** Products returned by search (wrapped as { data }). Ignored if searchError set. */
  searchData?: Channel3Product[];
  /** Product returned by retrieve. Ignored if retrieveError set. */
  retrieveData?: Channel3Product;
  /** When set, search rejects with this error instead of resolving. */
  searchError?: unknown;
  /** When set, retrieve rejects with this error instead of resolving. */
  retrieveError?: unknown;
}

/**
 * Create a deterministic stub SDK client. All calls are synchronous-resolving
 * promises (no timers) so tests stay fast and deterministic.
 */
export function makeStubClient(options: StubOptions = {}): StubClient {
  const searchCalls: SearchArgs[] = [];
  const retrieveCalls: RetrieveArgs[] = [];

  return {
    searchCalls,
    retrieveCalls,
    products: {
      async search(args) {
        searchCalls.push(args);
        if (options.searchError !== undefined) {
          throw options.searchError;
        }
        return { data: options.searchData ?? [] };
      },
      async retrieve(args) {
        retrieveCalls.push(args);
        if (options.retrieveError !== undefined) {
          throw options.retrieveError;
        }
        if (options.retrieveData === undefined) {
          throw new Error("stub retrieve called without retrieveData");
        }
        return options.retrieveData;
      },
    },
  };
}
