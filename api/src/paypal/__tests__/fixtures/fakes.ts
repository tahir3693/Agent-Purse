// Shared non-secret test doubles for the PayPal unit tests.
//
// FAKE_CONFIG uses obvious placeholder credentials (never a real secret) and a
// sandbox base URL. makeFakeToken returns a TokenProvider that yields a dummy
// token string and counts getToken calls, so a client/webhook test needs no
// OAuth round-trip.

import type { PayPalConfig } from "../../config.js";
import type { TokenProvider } from "../../token.js";

/** Obvious placeholder config; none of these are real credentials. */
export const FAKE_CONFIG: PayPalConfig = {
  clientId: "test-client-id-not-real",
  clientSecret: "test-client-secret-not-real",
  baseUrl: "https://api-m.sandbox.paypal.com",
};

/** A clearly-fake bearer token value (never a real secret). */
export const FAKE_TOKEN = "fake-token-xyz";

export interface FakeTokenProvider extends TokenProvider {
  /** Number of times getToken() has been invoked. */
  readonly callCount: number;
}

/**
 * Create a TokenProvider that resolves a dummy token and counts calls, so no
 * OAuth request is made when exercising the client or webhook verifier.
 */
export function makeFakeToken(token: string = FAKE_TOKEN): FakeTokenProvider {
  let callCount = 0;
  const provider = {
    async getToken(): Promise<string> {
      callCount += 1;
      return token;
    },
  } as FakeTokenProvider;
  Object.defineProperty(provider, "callCount", { get: () => callCount });
  return provider;
}
