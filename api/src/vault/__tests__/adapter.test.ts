import { describe, expect, it } from "vitest";

import { createMemoryAuditStore, createMemoryVaultStore } from "../../db/memory.js";
import type { BtCustomerResult, BtPaymentMethodResult } from "../../payments/braintree/gateway.js";
import { createBraintreeProvider } from "../../payments/braintree/provider.js";
import { ProviderError } from "../../payments/errors.js";
import { createFakeGateway, notFoundError } from "../../payments/__tests__/fakes.js";
import { NONCE, createVaultHarness, ownerToken } from "./helpers.js";

/** Gateway where only the public sandbox nonce succeeds. */
function nonceAwareGateway(opts: {
  existingCustomer: boolean;
  cardType?: string;
  last4?: string;
}) {
  const base = createFakeGateway(
    opts.existingCustomer ? {} : { customerFindError: notFoundError() },
  );
  const card = {
    token: "bt_tok_ABCD",
    ...(opts.cardType !== undefined ? { cardType: opts.cardType } : {}),
    ...(opts.last4 !== undefined ? { last4: opts.last4 } : {}),
  };
  base.gateway.customer.create = async (req) => {
    base.calls.customerCreate.push(req);
    return req.paymentMethodNonce === NONCE
      ? ({ success: true, customer: { id: req.id, paymentMethods: [card] } } as BtCustomerResult)
      : { success: false, message: "Unknown or expired payment method nonce." };
  };
  base.gateway.paymentMethod.create = async (req) => {
    base.calls.paymentMethodCreate.push(req);
    return req.paymentMethodNonce === NONCE
      ? ({ success: true, paymentMethod: card } as BtPaymentMethodResult)
      : { success: false, message: "Unknown or expired payment method nonce." };
  };
  return base;
}

describe("BraintreeProvider.linkPaymentMethod", () => {
  it("new customer path returns token, cardType and last4", async () => {
    const { gateway, calls } = nonceAwareGateway({
      existingCustomer: false,
      cardType: "Visa",
      last4: "1111",
    });
    const res = await createBraintreeProvider({ gateway }).linkPaymentMethod({
      ownerId: "owner_1",
      nonce: NONCE,
    });
    expect(res).toEqual({
      customerId: "owner_1",
      paymentMethodToken: "bt_tok_ABCD",
      cardType: "Visa",
      last4: "1111",
    });
    expect(calls.customerCreate).toEqual([{ id: "owner_1", paymentMethodNonce: NONCE }]);
    expect(calls.paymentMethodCreate).toHaveLength(0);
  });

  it("existing customer path uses paymentMethod.create", async () => {
    const { gateway, calls } = nonceAwareGateway({
      existingCustomer: true,
      cardType: "MasterCard",
      last4: "4444",
    });
    const res = await createBraintreeProvider({ gateway }).linkPaymentMethod({
      ownerId: "owner_1",
      nonce: NONCE,
    });
    expect(res).toMatchObject({ cardType: "MasterCard", last4: "4444" });
    expect(calls.paymentMethodCreate).toEqual([
      { customerId: "owner_1", paymentMethodNonce: NONCE },
    ]);
    expect(calls.customerCreate).toHaveLength(0);
  });

  it.each([true, false])(
    "other nonce => ProviderError invalid_request (existingCustomer=%s)",
    async (existingCustomer) => {
      const { gateway } = nonceAwareGateway({ existingCustomer });
      const err = await createBraintreeProvider({ gateway })
        .linkPaymentMethod({ ownerId: "o", nonce: "some-other-nonce" })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err).toMatchObject({ code: "invalid_request" });
      expect((err as Error).message).not.toContain("some-other-nonce");
    },
  );

  it.each([true, false])("missing cardType/last4 are omitted (existing=%s)", async (existing) => {
    const { gateway } = nonceAwareGateway({ existingCustomer: existing });
    const res = await createBraintreeProvider({ gateway }).linkPaymentMethod({
      ownerId: "o",
      nonce: NONCE,
    });
    expect(res).toEqual({ customerId: "o", paymentMethodToken: "bt_tok_ABCD" });
    expect("cardType" in res).toBe(false);
    expect("last4" in res).toBe(false);
  });

  it("unexpected SDK error becomes a safe provider_error", async () => {
    const { gateway } = createFakeGateway({ throwAll: new Error("network tok_leak") });
    const err = await createBraintreeProvider({ gateway })
      .linkPaymentMethod({ ownerId: "o", nonce: NONCE })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "provider_error" });
    expect((err as Error).message).not.toContain("tok_leak");
  });
});

describe("vault routes wired to the Braintree adapter (offline)", () => {
  it("links with fake-valid-nonce => 201 with Visa/1111 and masked token", async () => {
    const { gateway } = nonceAwareGateway({
      existingCustomer: false,
      cardType: "Visa",
      last4: "1111",
    });
    const h = await createVaultHarness({ provider: createBraintreeProvider({ gateway }) });
    const res = await h.link({ ownerId: "owner_1", nonce: NONCE }, ownerToken("owner_1"));
    expect(res.statusCode).toBe(201);
    expect((res.json() as { method: Record<string, unknown> }).method).toMatchObject({
      cardType: "Visa",
      last4: "1111",
      tokenRef: "****ABCD",
    });
    const stored = await h.vault.listByOwner("owner_1");
    expect(stored[0]).toMatchObject({ customerId: "owner_1", token: "bt_tok_ABCD" });
    expect(res.body).not.toContain("bt_tok_ABCD");
  });

  it("other nonce => 422 payment_method_rejected and nothing stored", async () => {
    const { gateway } = nonceAwareGateway({ existingCustomer: false });
    const vault = createMemoryVaultStore();
    const h = await createVaultHarness({
      provider: createBraintreeProvider({ gateway }),
      vault,
      audit: createMemoryAuditStore(),
    });
    const res = await h.link({ ownerId: "o", nonce: "nope-nonce" }, ownerToken("o"));
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toBe("payment_method_rejected");
    expect(await vault.listByOwner("o")).toHaveLength(0);
    expect(h.logs()).not.toContain("nope-nonce");
  });

  it("SDK outage => 502 and nothing stored", async () => {
    const { gateway } = createFakeGateway({ throwAll: new Error("down") });
    const h = await createVaultHarness({ provider: createBraintreeProvider({ gateway }) });
    const res = await h.link({ ownerId: "o", nonce: NONCE }, ownerToken("o"));
    expect(res.statusCode).toBe(502);
    expect(await h.vault.listByOwner("o")).toHaveLength(0);
  });
});
