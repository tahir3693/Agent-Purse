// Unit tests for createTokenProvider's in-memory cache (Requirements 2.1-2.3).
//
// A fake fetch counts OAuth calls and an injectable now() drives the clock, so
// we can assert: the first getToken fetches; a second call before the expiry
// margin reuses the cache (one fetch); advancing the clock past
// (expiresAt - EXPIRY_MARGIN_MS) triggers a refresh (two fetches). No live call
// and no real secret - the token fixture value is an obvious placeholder.

import { describe, expect, it } from "vitest";

import { createTokenProvider, EXPIRY_MARGIN_MS } from "../token.js";
import { makeFakeFetch } from "./fixtures/fakeFetch.js";
import { FAKE_CONFIG } from "./fixtures/fakes.js";
import { oauthTokenResponse } from "./fixtures/responses.js";

describe("createTokenProvider cache", () => {
  it("fetches once, reuses before the expiry margin, refreshes after it", async () => {
    const fetch = makeFakeFetch([
      { method: "POST", urlEndsWith: "/v1/oauth2/token", body: oauthTokenResponse },
    ]);

    let clock = 1_000_000;
    const provider = createTokenProvider({
      config: FAKE_CONFIG,
      fetch,
      now: () => clock,
    });

    // First call -> one fetch.
    const first = await provider.getToken();
    expect(first).toBe(oauthTokenResponse.access_token);
    expect(fetch.calls.length).toBe(1);

    // expires_in is 32400s; expiresAt = clock + 32400_000. Still well before the
    // refresh threshold, so a second call reuses the cache (no new fetch).
    clock += 1_000;
    const second = await provider.getToken();
    expect(second).toBe(oauthTokenResponse.access_token);
    expect(fetch.calls.length).toBe(1);

    // Advance to just past (expiresAt - EXPIRY_MARGIN_MS): a refresh must fire.
    const expiresAtMs = 1_000_000 + oauthTokenResponse.expires_in * 1000;
    clock = expiresAtMs - EXPIRY_MARGIN_MS + 1;
    const third = await provider.getToken();
    expect(third).toBe(oauthTokenResponse.access_token);
    expect(fetch.calls.length).toBe(2);
  });

  it("sends a client-credentials grant to the OAuth endpoint", async () => {
    const fetch = makeFakeFetch([
      { method: "POST", urlEndsWith: "/v1/oauth2/token", body: oauthTokenResponse },
    ]);
    const provider = createTokenProvider({ config: FAKE_CONFIG, fetch, now: () => 0 });

    await provider.getToken();

    expect(fetch.calls[0].body).toContain("grant_type=client_credentials");
    expect(fetch.calls[0].headers["authorization"]).toMatch(/^Basic /);
  });
});
