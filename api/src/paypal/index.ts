// Public surface of the PayPal module (spec-03).
//
// The rest of the API imports PayPal capability only from here. Internal
// details (HTTP wiring, response shapes) stay behind this barrel. Later tasks
// add the webhook route and smoke script; they re-export from their own files.

export { createHttpPayPalClient } from "./client.js";
export type {
  PayPalClient,
  PayPalClientDeps,
  CreateOrderInput,
  CreatedOrder,
  Authorization,
  Capture,
  Money,
} from "./client.js";

export { createTokenProvider } from "./token.js";
export type { TokenProvider, TokenProviderDeps } from "./token.js";

export { loadPayPalConfig } from "./config.js";
export type { PayPalConfig } from "./config.js";

export { PayPalError } from "./errors.js";
export type { PayPalErrorInit } from "./errors.js";

export { requestId } from "./idempotency.js";

export { centsToDecimal, decimalToCents } from "./money.js";

export { verifyWebhook } from "./webhook.js";
export type { WebhookVerifyDeps, WebhookLogger } from "./webhook.js";

export { createSeenEventStore } from "./dedupe.js";
export type { SeenEventStore } from "./dedupe.js";

export { registerPayPalWebhookRoute } from "./routes.js";
export type { PayPalWebhookRouteDeps } from "./routes.js";
