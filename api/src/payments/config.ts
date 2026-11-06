// Payments config loader. Selects the provider from PAYMENT_PROVIDER and loads
// only that provider's variables. Errors name the variable only, never a value.

import { loadPayPalConfig, type PayPalConfig } from "../paypal/config.js";

export interface BraintreeConfig {
  environment: "sandbox";
  merchantId: string;
  publicKey: string;
  privateKey: string;
}

export type PaymentsConfig =
  | { provider: "braintree"; braintree: BraintreeConfig }
  | { provider: "paypal"; paypal: PayPalConfig & { webhookId: string } };

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadPaymentsConfig(env: NodeJS.ProcessEnv): PaymentsConfig {
  const provider = (env.PAYMENT_PROVIDER?.trim().toLowerCase() || "braintree");

  if (provider === "braintree") {
    const braintreeEnv = env.BRAINTREE_ENV?.trim().toLowerCase() || "sandbox";
    if (braintreeEnv !== "sandbox") {
      throw new Error("Invalid value for environment variable: BRAINTREE_ENV");
    }
    const merchantId = required(env, "BRAINTREE_MERCHANT_ID");
    const publicKey = required(env, "BRAINTREE_PUBLIC_KEY");
    const privateKey = required(env, "BRAINTREE_PRIVATE_KEY");
    return {
      provider: "braintree",
      braintree: { environment: "sandbox", merchantId, publicKey, privateKey },
    };
  }

  if (provider === "paypal") {
    const paypal = loadPayPalConfig(env);
    const webhookId = required(env, "PAYPAL_WEBHOOK_ID");
    return { provider: "paypal", paypal: { ...paypal, webhookId } };
  }

  throw new Error("Invalid value for environment variable: PAYMENT_PROVIDER");
}
