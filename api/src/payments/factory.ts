// Selects the PaymentProvider from PAYMENT_PROVIDER (default braintree).
// Only the selected provider's variables are read, so missing PAYPAL_* keys
// never affect a braintree startup. Errors name the variable only.

import { createHttpPayPalClient, type PayPalClient } from "../paypal/client.js";
import { createTokenProvider } from "../paypal/token.js";
import { createBraintreeProvider } from "./braintree/provider.js";
import { buildBraintreeGateway, type BraintreeGatewayLike } from "./braintree/gateway.js";
import { loadPaymentsConfig } from "./config.js";
import { createPayPalRestProvider } from "./paypal/provider.js";
import type { PaymentProvider } from "./types.js";

export interface PaymentProviderDeps {
  /** Test seam: inject a fake Braintree gateway. */
  braintreeGateway?: BraintreeGatewayLike;
  /** Test seam: inject a fake PayPal client. */
  paypalClient?: PayPalClient;
  fetch?: typeof fetch;
}

export function createPaymentProvider(
  env: NodeJS.ProcessEnv,
  deps: PaymentProviderDeps = {},
): PaymentProvider {
  const config = loadPaymentsConfig(env);

  if (config.provider === "braintree") {
    const gateway = deps.braintreeGateway ?? buildBraintreeGateway(config.braintree);
    return createBraintreeProvider({ gateway });
  }

  const client =
    deps.paypalClient ??
    createHttpPayPalClient({
      config: config.paypal,
      token: createTokenProvider({
        config: config.paypal,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      }),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
  return createPayPalRestProvider({ client });
}
