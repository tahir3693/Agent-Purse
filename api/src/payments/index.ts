// Public surface of the payments module. Callers depend on PaymentProvider
// only; vendor types stay inside the adapters.

export type {
  PaymentProvider,
  PaymentStatus,
  AuthorizeInput,
  AuthorizeResult,
  CaptureResult,
  VoidResult,
  WebhookEvent,
} from "./types.js";
export { ProviderError } from "./errors.js";
export type { ProviderName, ProviderErrorInit } from "./errors.js";
export { loadPaymentsConfig } from "./config.js";
export type { PaymentsConfig, BraintreeConfig } from "./config.js";
export { createPaymentProvider } from "./factory.js";
export type { PaymentProviderDeps } from "./factory.js";
export { createSeenKeyStore } from "./dedupe.js";
export type { SeenKeyStore } from "./dedupe.js";
