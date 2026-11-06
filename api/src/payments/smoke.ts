// Payments live smoke script (pnpm payments:smoke).
//
// Exercises the Braintree sandbox through the provider-neutral PaymentProvider:
//   1. linkPaymentMethod with the sandbox nonce fake-valid-nonce
//   2. authorize $10.00 USD, then capture
//   3. authorize $5.00 USD, then void
//
// Not part of the test suite. Prints ids and statuses only; never secrets.
// A missing env var prints its NAME and exits non-zero.

import { loadPaymentsConfig } from "./config.js";
import { ProviderError } from "./errors.js";
import { buildBraintreeGateway, createBraintreeProvider } from "./braintree/index.js";

async function main(): Promise<number> {
  let config;
  try {
    config = loadPaymentsConfig(process.env);
  } catch (err) {
    console.log(err instanceof Error ? err.message : String(err));
    return 1;
  }
  if (config.provider !== "braintree") {
    console.log("payments:smoke supports PAYMENT_PROVIDER=braintree only");
    return 1;
  }

  const provider = createBraintreeProvider({
    gateway: buildBraintreeGateway(config.braintree),
  });
  const stamp = `smoke-${Date.now()}`;

  const linked = await provider.linkPaymentMethod({
    ownerId: stamp,
    nonce: "fake-valid-nonce",
  });
  console.log(`customer id: ${linked.customerId}`);
  console.log(`payment method token: ${linked.paymentMethodToken}`);

  const auth1 = await provider.authorize({
    amountCents: 1000,
    currency: "USD",
    intentId: `${stamp}-capture`,
    paymentMethodRef: linked.paymentMethodToken,
  });
  console.log(`authorization id: ${auth1.authorizationId}`);
  console.log(`authorization status: ${auth1.status}`);

  const capture = await provider.capture(auth1.authorizationId, 1000);
  console.log(`capture id: ${capture.captureId}`);
  console.log(`capture status: ${capture.status}`);

  const auth2 = await provider.authorize({
    amountCents: 500,
    currency: "USD",
    intentId: `${stamp}-void`,
    paymentMethodRef: linked.paymentMethodToken,
  });
  console.log(`authorization id: ${auth2.authorizationId}`);
  console.log(`authorization status: ${auth2.status}`);

  const voided = await provider.void(auth2.authorizationId);
  console.log(`void id: ${voided.voidId}`);
  console.log(`void status: ${voided.status}`);

  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    if (err instanceof ProviderError) {
      const parts = [`Payment provider error code=${err.code}`];
      if (err.transactionId) parts.push(`transaction=${err.transactionId}`);
      console.log(parts.join(" "));
    } else {
      console.log(err instanceof Error ? err.message : String(err));
    }
    process.exitCode = 1;
  });
