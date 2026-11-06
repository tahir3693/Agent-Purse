import { describe, expect, it } from "vitest";

import { loadPaymentsConfig } from "../config.js";
import { createPaymentProvider } from "../factory.js";
import { ProviderError } from "../errors.js";
import { createFakeGateway } from "./fakes.js";

const bt = {
  BRAINTREE_MERCHANT_ID: "fake_merchant_id",
  BRAINTREE_PUBLIC_KEY: "fake_public_key",
  BRAINTREE_PRIVATE_KEY: "fake_private_key_not_real",
};

describe("loadPaymentsConfig", () => {
  it("defaults to braintree + sandbox", () => {
    const cfg = loadPaymentsConfig({ ...bt });
    expect(cfg.provider).toBe("braintree");
  });

  it("braintree startup does not need PAYPAL_* keys", () => {
    expect(() => loadPaymentsConfig({ ...bt, PAYMENT_PROVIDER: "braintree" })).not.toThrow();
  });

  it("rejects an invalid PAYMENT_PROVIDER value naming only the variable", () => {
    expect(() => loadPaymentsConfig({ ...bt, PAYMENT_PROVIDER: "stripe" })).toThrow(
      "PAYMENT_PROVIDER",
    );
    try {
      loadPaymentsConfig({ ...bt, PAYMENT_PROVIDER: "stripe" });
    } catch (e) {
      expect((e as Error).message).not.toContain("stripe");
    }
  });

  it("rejects non-sandbox BRAINTREE_ENV naming only the variable", () => {
    try {
      loadPaymentsConfig({ ...bt, BRAINTREE_ENV: "production" });
      throw new Error("expected throw");
    } catch (e) {
      expect((e as Error).message).toContain("BRAINTREE_ENV");
      expect((e as Error).message).not.toContain("production");
    }
  });

  it("names a missing variable and never prints other values", () => {
    const env = { ...bt, BRAINTREE_PRIVATE_KEY: "" };
    try {
      loadPaymentsConfig(env);
      throw new Error("expected throw");
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toContain("BRAINTREE_PRIVATE_KEY");
      expect(m).not.toContain("fake_public_key");
      expect(m).not.toContain("fake_merchant_id");
    }
    expect(() => loadPaymentsConfig({})).toThrow("BRAINTREE_MERCHANT_ID");
  });

  it("paypal selection requires PAYPAL_* and names the missing one", () => {
    expect(() => loadPaymentsConfig({ PAYMENT_PROVIDER: "paypal" })).toThrow(/PAYPAL_/);
  });

  it("paypal selection loads when all PAYPAL_* are set", () => {
    const cfg = loadPaymentsConfig({
      PAYMENT_PROVIDER: "paypal",
      PAYPAL_CLIENT_ID: "fake_id",
      PAYPAL_CLIENT_SECRET: "fake_secret",
      PAYPAL_WEBHOOK_ID: "fake_hook",
      PAYPAL_BASE_URL: "https://api-m.sandbox.paypal.com",
    });
    expect(cfg.provider).toBe("paypal");
  });
});

describe("createPaymentProvider", () => {
  it("builds the braintree provider by default with an injected gateway", async () => {
    const { gateway, calls } = createFakeGateway();
    const p = createPaymentProvider({ ...bt }, { braintreeGateway: gateway });
    await p.void("tx_1");
    expect(calls.void).toEqual(["tx_1"]);
  });

  it("builds the paypal provider when selected (unsupported ops throw ProviderError)", async () => {
    const p = createPaymentProvider(
      {
        PAYMENT_PROVIDER: "paypal",
        PAYPAL_CLIENT_ID: "fake_id",
        PAYPAL_CLIENT_SECRET: "fake_secret",
        PAYPAL_WEBHOOK_ID: "fake_hook",
        PAYPAL_BASE_URL: "https://api-m.sandbox.paypal.com",
      },
      { fetch: (() => {
        throw new Error("no live calls");
      }) as unknown as typeof fetch },
    );
    await expect(p.linkPaymentMethod({ ownerId: "o", nonce: "n" })).rejects.toBeInstanceOf(
      ProviderError,
    );
    await expect(p.parseWebhook({})).rejects.toMatchObject({ code: "unsupported" });
  });

  it("builds a real braintree gateway offline from fake keys (no network at build)", () => {
    expect(() => createPaymentProvider({ ...bt })).not.toThrow();
  });
});
