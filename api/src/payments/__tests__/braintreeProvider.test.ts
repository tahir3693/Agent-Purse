import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderError } from "../errors.js";
import { createBraintreeProvider } from "../braintree/provider.js";
import { createFakeGateway, notFoundError } from "./fakes.js";

const base = {
  amountCents: 1234,
  currency: "USD",
  intentId: "intent_1",
  paymentMethodRef: "pm_secret_token_abc",
};

afterEach(() => vi.restoreAllMocks());

describe("BraintreeProvider.authorize", () => {
  it("sales with submitForSettlement false, orderId=intentId, decimal amount", async () => {
    const { gateway, calls } = createFakeGateway();
    const res = await createBraintreeProvider({ gateway }).authorize(base);
    expect(res).toEqual({ authorizationId: "tx_new", status: "authorized" });
    expect(calls.search).toEqual(["intent_1"]);
    expect(calls.sale).toEqual([
      {
        amount: "12.34",
        paymentMethodToken: "pm_secret_token_abc",
        orderId: "intent_1",
        options: { submitForSettlement: false },
      },
    ]);
  });

  it("is idempotent: existing live transaction is returned without a sale", async () => {
    const { gateway, calls } = createFakeGateway({
      existing: [
        { id: "tx_old_failed", status: "processor_declined" },
        { id: "tx_existing", status: "authorized" },
      ],
    });
    const res = await createBraintreeProvider({ gateway }).authorize(base);
    expect(res).toEqual({ authorizationId: "tx_existing", status: "authorized" });
    expect(calls.sale).toHaveLength(0);
  });

  it("sells again when only declined/failed transactions exist", async () => {
    const { gateway, calls } = createFakeGateway({
      existing: [{ id: "tx_d", status: "gateway_rejected" }],
    });
    await createBraintreeProvider({ gateway }).authorize(base);
    expect(calls.sale).toHaveLength(1);
  });

  it("maps a declined sale to ProviderError(declined) with processor code", async () => {
    const { gateway } = createFakeGateway({
      saleResult: {
        success: false,
        transaction: { id: "tx_d", status: "processor_declined", processorResponseCode: "2000" },
      },
    });
    const err = await createBraintreeProvider({ gateway })
      .authorize(base)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ code: "declined", processorCode: "2000", transactionId: "tx_d" });
    expect(String((err as Error).message)).not.toContain("pm_secret_token_abc");
  });

  it("maps gateway_rejected to code rejected", async () => {
    const { gateway } = createFakeGateway({
      saleResult: { success: false, transaction: { id: "t", status: "gateway_rejected" } },
    });
    await expect(createBraintreeProvider({ gateway }).authorize(base)).rejects.toMatchObject({
      code: "rejected",
    });
  });

  it("rejects non-USD currency and invalid cents", async () => {
    const { gateway, calls } = createFakeGateway();
    const p = createBraintreeProvider({ gateway });
    await expect(p.authorize({ ...base, currency: "EUR" })).rejects.toBeInstanceOf(ProviderError);
    await expect(p.authorize({ ...base, amountCents: 1.5 })).rejects.toThrow(RangeError);
    expect(calls.sale).toHaveLength(0);
  });

  it("wraps unexpected SDK errors into a safe ProviderError (name only)", async () => {
    const boom = new Error("secret detail pm_secret_token_abc");
    boom.name = "NetworkError";
    const { gateway } = createFakeGateway({ throwAll: boom });
    const err = await createBraintreeProvider({ gateway })
      .authorize(base)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe("provider_error");
    expect((err as Error).message).toContain("NetworkError");
    expect((err as Error).message).not.toContain("secret");
  });
});

describe("BraintreeProvider capture / void / getStatus", () => {
  it("capture submits for settlement with decimal amount; captureId = tx id", async () => {
    const { gateway, calls } = createFakeGateway();
    const res = await createBraintreeProvider({ gateway }).capture("tx_1", 500);
    expect(calls.submit).toEqual([["tx_1", "5.00"]]);
    expect(res).toEqual({ captureId: "tx_1", status: "capture_pending" });
  });

  it("capture failure maps to ProviderError", async () => {
    const { gateway } = createFakeGateway({ submitResult: { success: false } });
    await expect(createBraintreeProvider({ gateway }).capture("tx_1", 500)).rejects.toMatchObject({
      name: "ProviderError",
      code: "invalid_request",
    });
  });

  it("void voids the transaction; voidId = tx id", async () => {
    const { gateway, calls } = createFakeGateway();
    const res = await createBraintreeProvider({ gateway }).void("tx_1");
    expect(calls.void).toEqual(["tx_1"]);
    expect(res).toEqual({ voidId: "tx_1", status: "voided" });
  });

  it("void failure maps to ProviderError", async () => {
    const { gateway } = createFakeGateway({ voidResult: { success: false } });
    await expect(createBraintreeProvider({ gateway }).void("tx_1")).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it("getStatus maps status; not found -> not_found", async () => {
    const ok = createFakeGateway({ findResult: { id: "tx_1", status: "settled" } });
    await expect(createBraintreeProvider({ gateway: ok.gateway }).getStatus("tx_1")).resolves.toEqual({
      status: "captured",
    });
    const nf = createFakeGateway({ findError: notFoundError() });
    await expect(createBraintreeProvider({ gateway: nf.gateway }).getStatus("x")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("BraintreeProvider.linkPaymentMethod", () => {
  it("creates a customer when none exists and returns the new token", async () => {
    const { gateway, calls } = createFakeGateway({ customerFindError: notFoundError() });
    const res = await createBraintreeProvider({ gateway }).linkPaymentMethod({
      ownerId: "owner_1",
      nonce: "fake-valid-nonce",
    });
    expect(res).toEqual({ customerId: "owner_1", paymentMethodToken: "pm_token_new" });
    expect(calls.customerCreate).toEqual([{ id: "owner_1", paymentMethodNonce: "fake-valid-nonce" }]);
    expect(calls.paymentMethodCreate).toHaveLength(0);
  });

  it("adds a payment method to an existing customer", async () => {
    const { gateway, calls } = createFakeGateway();
    const res = await createBraintreeProvider({ gateway }).linkPaymentMethod({
      ownerId: "owner_1",
      nonce: "fake-valid-nonce",
    });
    expect(res).toEqual({ customerId: "owner_1", paymentMethodToken: "pm_token_existing" });
    expect(calls.paymentMethodCreate).toEqual([
      { customerId: "owner_1", paymentMethodNonce: "fake-valid-nonce" },
    ]);
    expect(calls.customerCreate).toHaveLength(0);
  });

  it("failure result maps to ProviderError without leaking the nonce", async () => {
    const { gateway } = createFakeGateway({
      customerFindError: notFoundError(),
      customerCreateResult: { success: false },
    });
    const err = await createBraintreeProvider({ gateway })
      .linkPaymentMethod({ ownerId: "o", nonce: "nonce-should-not-leak" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as Error).message).not.toContain("nonce-should-not-leak");
  });

  it("unexpected find errors are wrapped", async () => {
    const { gateway } = createFakeGateway({ customerFindError: new Error("down") });
    await expect(
      createBraintreeProvider({ gateway }).linkPaymentMethod({ ownerId: "o", nonce: "n" }),
    ).rejects.toMatchObject({ code: "provider_error" });
  });
});

describe("log secret-safety", () => {
  it("emits no console output containing nonces, tokens or keys across operations", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const { gateway } = createFakeGateway({
      saleResult: { success: false, transaction: { id: "t", status: "processor_declined" } },
    });
    const p = createBraintreeProvider({ gateway });
    await p.authorize(base).catch(() => undefined);
    await p.linkPaymentMethod({ ownerId: "o", nonce: "nonce-secret-xyz" }).catch(() => undefined);
    await p.parseWebhook({ bt_signature: "sig-secret", bt_payload: "payload-secret" }).catch(() => undefined);
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    for (const s of ["pm_secret_token_abc", "nonce-secret-xyz", "sig-secret", "payload-secret"]) {
      expect(logged).not.toContain(s);
    }
  });
});
