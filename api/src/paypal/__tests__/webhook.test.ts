// Unit tests for verifyWebhook and the dedupe store (Requirements 7.1-7.5, 9.x).
//
// verifyWebhook fails CLOSED: true only on a SUCCESS verification response with
// a configured webhookId and all five signature headers present; false (never a
// throw) otherwise. A fake fetch returns the recorded verify responses and a
// fake TokenProvider supplies a dummy bearer so no OAuth call is made. A logger
// spy asserts the missing-id path logs the variable NAME only - no token/secret.

import { describe, expect, it, vi } from "vitest";

import { createSeenEventStore } from "../dedupe.js";
import { verifyWebhook } from "../webhook.js";
import type { WebhookLogger } from "../webhook.js";
import { makeFakeFetch } from "./fixtures/fakeFetch.js";
import { FAKE_CONFIG, FAKE_TOKEN, makeFakeToken } from "./fixtures/fakes.js";
import { verifyFailureResponse, verifySuccessResponse } from "./fixtures/responses.js";

const WEBHOOK_ID = "WH-TEST-1";
const RAW_BODY = JSON.stringify({ id: "EVT-1", event_type: "CHECKOUT.ORDER.APPROVED" });

/** All five PayPal signature headers, lowercased as Fastify would deliver them. */
function fullHeaders(): Record<string, string> {
  return {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem",
    "paypal-transmission-id": "txn-1",
    "paypal-transmission-sig": "sig-1",
    "paypal-transmission-time": "2024-01-01T00:00:00Z",
  };
}

function verifyRoute(body: unknown) {
  return makeFakeFetch([
    {
      method: "POST",
      urlEndsWith: "/v1/notifications/verify-webhook-signature",
      body,
    },
  ]);
}

describe("verifyWebhook", () => {
  it("returns true for a SUCCESS verification response", async () => {
    const result = await verifyWebhook(
      {
        config: FAKE_CONFIG,
        token: makeFakeToken(),
        fetch: verifyRoute(verifySuccessResponse),
        webhookId: WEBHOOK_ID,
      },
      fullHeaders(),
      RAW_BODY,
    );
    expect(result).toBe(true);
  });

  it("returns false for a FAILURE verification response", async () => {
    const result = await verifyWebhook(
      {
        config: FAKE_CONFIG,
        token: makeFakeToken(),
        fetch: verifyRoute(verifyFailureResponse),
        webhookId: WEBHOOK_ID,
      },
      fullHeaders(),
      RAW_BODY,
    );
    expect(result).toBe(false);
  });

  it("returns false (no throw) when webhookId is missing", async () => {
    const fetch = verifyRoute(verifySuccessResponse);
    const result = await verifyWebhook(
      {
        config: FAKE_CONFIG,
        token: makeFakeToken(),
        fetch,
        webhookId: undefined,
        logger: { warn: () => undefined },
      },
      fullHeaders(),
      RAW_BODY,
    );
    expect(result).toBe(false);
    // Fails closed before any network call.
    expect(fetch.calls.length).toBe(0);
  });

  it("returns false when a paypal-* signature header is missing", async () => {
    const headers = fullHeaders();
    delete headers["paypal-transmission-sig"];
    const fetch = verifyRoute(verifySuccessResponse);

    const result = await verifyWebhook(
      { config: FAKE_CONFIG, token: makeFakeToken(), fetch, webhookId: WEBHOOK_ID },
      headers,
      RAW_BODY,
    );

    expect(result).toBe(false);
    // Missing header short-circuits before the verify call.
    expect(fetch.calls.length).toBe(0);
  });
});

describe("verifyWebhook secret safety", () => {
  it("logs only the variable NAME on the missing-id path (no token/secret)", async () => {
    const warn = vi.fn();
    const logger: WebhookLogger = { warn };

    await verifyWebhook(
      {
        config: FAKE_CONFIG,
        token: makeFakeToken(FAKE_TOKEN),
        fetch: verifyRoute(verifySuccessResponse),
        webhookId: undefined,
        logger,
      },
      fullHeaders(),
      RAW_BODY,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain("PAYPAL_WEBHOOK_ID");
    expect(message).not.toContain(FAKE_TOKEN);
    expect(message).not.toContain(FAKE_CONFIG.clientSecret);
  });
});

describe("createSeenEventStore", () => {
  it("reports unseen ids as not seen until markSeen", () => {
    const store = createSeenEventStore();
    expect(store.seen("EVT-1")).toBe(false);
    store.markSeen("EVT-1");
    expect(store.seen("EVT-1")).toBe(true);
  });

  it("tracks ids independently", () => {
    const store = createSeenEventStore();
    store.markSeen("EVT-1");
    expect(store.seen("EVT-1")).toBe(true);
    expect(store.seen("EVT-2")).toBe(false);
  });
});
