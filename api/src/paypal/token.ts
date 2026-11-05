// OAuth2 client-credentials token with an in-memory cache.
//
// PayPal access tokens are obtained via the client-credentials grant and reused
// until they are near expiry, so we do not mint a fresh token per API call
// (Requirement 2.1, 2.2, 2.3). The client id/secret are server-side secrets:
// they live only in the PayPalConfig held in memory for the request and are
// NEVER logged, printed, or copied, and neither is the resulting access token
// or the Authorization header. This module emits no console output at all
// (money-rules.md, Requirements 1.3, 6.2).
//
// Verified against PayPal docs:
//   POST {baseUrl}/v1/oauth2/token
//   Authorization: Basic base64("<clientId>:<clientSecret>")
//   Content-Type: application/x-www-form-urlencoded
//   body: grant_type=client_credentials
//   -> { access_token: string, expires_in: number /* seconds */ }

import type { PayPalConfig } from "./config.js";
import { PayPalError } from "./errors.js";

/**
 * Safety margin applied before a token's reported expiry. We refresh at least
 * this long before `expires_in` elapses so an in-flight request never carries a
 * token that expires mid-call (clock skew + network latency headroom).
 */
export const EXPIRY_MARGIN_MS = 60_000;

/** Provides a valid PayPal access token, refreshing transparently as needed. */
export interface TokenProvider {
  getToken(): Promise<string>;
}

export interface TokenProviderDeps {
  config: PayPalConfig;
  /** Injectable fetch for testability; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Injectable clock (ms since epoch) for testability; defaults to Date.now. */
  now?: () => number;
}

interface CachedToken {
  accessToken: string;
  /** Absolute expiry instant in ms since epoch. */
  expiresAtMs: number;
}

/** Shape of the fields we read from the OAuth token response. */
interface TokenResponseBody {
  access_token: string;
  expires_in: number;
}

/**
 * Create a {@link TokenProvider} backed by an in-memory cache.
 *
 * `getToken()` returns the cached token while `now() < expiresAtMs -
 * EXPIRY_MARGIN_MS`; otherwise it requests a new one from PayPal's OAuth
 * endpoint, caches it with `expiresAtMs = now() + expires_in * 1000`, and
 * returns it. A non-2xx response throws a {@link PayPalError} via
 * `PayPalError.fromResponse`.
 */
export function createTokenProvider(deps: TokenProviderDeps): TokenProvider {
  const { config } = deps;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;

  let cached: CachedToken | null = null;

  async function getToken(): Promise<string> {
    if (cached !== null && now() < cached.expiresAtMs - EXPIRY_MARGIN_MS) {
      return cached.accessToken;
    }

    const token = await fetchToken();
    cached = token;
    return token.accessToken;
  }

  async function fetchToken(): Promise<CachedToken> {
    const basic = Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
    ).toString("base64");

    const url = `${config.baseUrl.replace(/\/+$/, "")}/v1/oauth2/token`;

    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!res.ok) {
      // fromResponse extracts only the secret-free status/name/debug_id.
      throw await PayPalError.fromResponse(res);
    }

    const body = (await res.json()) as TokenResponseBody;

    return {
      accessToken: body.access_token,
      expiresAtMs: now() + body.expires_in * 1000,
    };
  }

  return { getToken };
}
