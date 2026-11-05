// PayPal guided live smoke script (pnpm paypal:smoke [--no-approve]).
//
// A tiny CLI that exercises the live PayPal sandbox end to end so a human can
// confirm auth, order creation, approval, authorize, and capture all work. It
// is NOT part of the test suite (tests use fixtures; this touches the live
// sandbox API).
//
// Flow (Requirement 8):
//   1. Load config; a missing var throws a named error -> print message, exit 1.
//   2. Build token provider + client.
//   3. Create a $1.00 USD AUTHORIZE order; print order id + approval URL.
//   4. --no-approve: stop after create, exit 0.
//   5. Otherwise PAUSE for the operator to approve in the browser, then on Enter
//      authorize, then capture, printing ids and statuses only.
//
// Secret discipline (money-rules.md, Requirements 1.3, 6.2): this script never
// reads, prints, copies, or logs any secret or token. On a missing variable it
// prints only the error message, which names the variable - never its value.
// A PayPalError prints status + debug_id only.
//
// NOTE: the manual browser-approval pause here goes away once Vault linking
// (spec-06) lets AgentPurse charge a vaulted payment source without a
// per-order human approval step.

import { createInterface } from "node:readline/promises";

import { createHttpPayPalClient } from "./client.js";
import { loadPayPalConfig } from "./config.js";
import { PayPalError } from "./errors.js";
import { createTokenProvider } from "./token.js";

/** Run a PayPal call, mapping a PayPalError to a secret-free message + exit 1. */
async function runPayPal<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (err) {
    if (err instanceof PayPalError) {
      const parts = [`PayPal request failed with status ${err.status}`];
      if (err.debugId) parts.push(`debug_id=${err.debugId}`);
      console.log(parts.join(" "));
      process.exit(1);
    }
    throw err;
  }
}

async function main(): Promise<number> {
  const noApprove = process.argv.includes("--no-approve");

  // Load config. A missing/blank PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET /
  // PAYPAL_BASE_URL throws a named error (message identifies the variable, never
  // its value). Print only that message and exit.
  let config;
  try {
    config = loadPayPalConfig(process.env);
  } catch (err) {
    console.log(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const client = createHttpPayPalClient({
    config,
    token: createTokenProvider({ config }),
  });

  // A shared id ties the order's reference and the idempotency keys together.
  const stamp = `smoke-${Date.now()}`;

  const order = await runPayPal(() =>
    client.createOrder({
      amountCents: 100,
      currency: "USD",
      referenceId: stamp,
      intentId: stamp,
      returnUrl: "https://example.com/paypal/return",
      cancelUrl: "https://example.com/paypal/cancel",
    }),
  );

  console.log(`order id: ${order.id}`);
  console.log(`order status: ${order.status}`);
  console.log(`approval URL: ${order.approvalUrl ?? "(none in response)"}`);

  if (noApprove) {
    console.log("--no-approve: stopped after creating the order.");
    return 0;
  }

  // PAUSE: the operator opens the approval URL, approves with their sandbox
  // buyer, then presses Enter to continue.
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await rl.question(
      "\nOpen the approval URL above, approve with your sandbox buyer, then press Enter to authorize + capture... ",
    );
  } finally {
    rl.close();
  }

  const authorization = await runPayPal(() =>
    client.authorizeOrder(order.id, stamp),
  );
  console.log(`authorization id: ${authorization.id}`);
  console.log(`authorization status: ${authorization.status}`);

  const capture = await runPayPal(() =>
    client.captureAuthorization(authorization.id, stamp),
  );
  console.log(`capture id: ${capture.id}`);
  console.log(`capture status: ${capture.status}`);

  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    // Unexpected transport/runtime error. Our error messages never carry
    // secrets; print the message only and exit non-zero.
    console.log(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
