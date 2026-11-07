import braintree from "braintree";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { buildBraintreeGateway } from "../braintree/gateway.js";
import { createBraintreeProvider } from "../braintree/provider.js";
import { createMemoryWebhookEventStore } from "../../db/memory.js";
import { registerPaymentsWebhookRoute } from "../routes.js";
import type { PaymentProvider } from "../types.js";

// Obviously fake keys: used only to sign and verify offline sample payloads.
const fakeConfig = {
  environment: "sandbox" as const,
  merchantId: "fake_merchant_id",
  publicKey: "fake_public_key",
  privateKey: "fake_private_key_not_real",
};

// The same fake keys build a sibling raw SDK gateway just for sampleNotification.
const rawGateway = new braintree.BraintreeGateway({
  environment: braintree.Environment.Sandbox,
  merchantId: fakeConfig.merchantId,
  publicKey: fakeConfig.publicKey,
  privateKey: fakeConfig.privateKey,
});

async function sample(id = "tx_hook_1") {
  const out = await rawGateway.webhookTesting.sampleNotification(
    "transaction_settled" as never, // typings (@types/braintree) lag the SDK
    id,
  );
  return out as unknown as { bt_signature: string; bt_payload: string };
}

function realProvider(): PaymentProvider {
  return createBraintreeProvider({ gateway: buildBraintreeGateway(fakeConfig) });
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

/** Deterministically change the last character (always differs from the original). */
function flipLast(s: string): string {
  const last = s.slice(-1);
  return s.slice(0, -1) + (last === "0" ? "1" : "0");
}

describe("BraintreeProvider.parseWebhook (real SDK, offline)", () => {
  it("parses a valid signed sample notification", async () => {
    const { bt_signature, bt_payload } = await sample("tx_hook_1");
    const ev = await realProvider().parseWebhook({ bt_signature, bt_payload });
    expect(ev.kind).toBe("transaction_settled");
    expect(ev.transactionId).toBe("tx_hook_1");
    expect(ev.status).toBe("captured");
    expect(ev.key).toContain("transaction_settled:tx_hook_1:");
  });

  it("rejects a tampered signature and a tampered payload", async () => {
    const { bt_signature, bt_payload } = await sample();
    const p = realProvider();
    await expect(
      p.parseWebhook({ bt_signature: flipLast(bt_signature), bt_payload }),
    ).rejects.toMatchObject({ code: "invalid_signature" });
    await expect(
      p.parseWebhook({ bt_signature, bt_payload: flipLast(bt_payload) }),
    ).rejects.toMatchObject({ code: "invalid_signature" });
  });

  it("rejects missing fields", async () => {
    await expect(realProvider().parseWebhook({})).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
});

describe("POST /webhooks/payments", () => {
  async function build(provider: PaymentProvider = realProvider()) {
    const app = Fastify();
    registerPaymentsWebhookRoute(app, { provider, store: createMemoryWebhookEventStore() });
    await app.ready();
    return app;
  }
  const headers = { "content-type": "application/x-www-form-urlencoded" };

  it("returns 400 for invalid signature and for missing fields", async () => {
    const app = await build();
    const bad = await app.inject({
      method: "POST",
      url: "/webhooks/payments",
      headers,
      payload: form({ bt_signature: "bad", bt_payload: "bad" }),
    });
    expect(bad.statusCode).toBe(400);
    const empty = await app.inject({
      method: "POST",
      url: "/webhooks/payments",
      headers,
      payload: "",
    });
    expect(empty.statusCode).toBe(400);
    await app.close();
  });

  it("returns 200 for valid and 200 duplicate without reprocessing", async () => {
    const parseSpy = vi.fn();
    const real = realProvider();
    const provider: PaymentProvider = {
      ...real,
      parseWebhook: async (f) => {
        parseSpy(f);
        return real.parseWebhook(f);
      },
    };
    const app = await build(provider);
    const fields = await sample("tx_dup");
    const send = () =>
      app.inject({
        method: "POST",
        url: "/webhooks/payments",
        headers,
        payload: form(fields),
      });
    const first = await send();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ status: "ok" });
    const second = await send();
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ status: "duplicate" });
    await app.close();
  });

  it("does not claim a key when parsing fails", async () => {
    const store = createMemoryWebhookEventStore();
    const claimSpy = vi.spyOn(store, "claim");
    const app = Fastify();
    registerPaymentsWebhookRoute(app, { provider: realProvider(), store });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/webhooks/payments",
      headers,
      payload: form({ bt_signature: "x", bt_payload: "y" }),
    });
    expect(claimSpy).not.toHaveBeenCalled();
    await app.close();
  });
});
