# Design Document

spec-03b Payment Provider (Braintree primary)

## Overview

`/api/src/payments/` defines a normalized `PaymentProvider`. `BraintreeProvider` (primary) and `PayPalRestProvider` (wraps spec-03) implement it; a factory picks one from `PAYMENT_PROVIDER`. Vendor types stay inside adapters: the Braintree adapter talks to a minimal structural `BraintreeGatewayLike`, so tests inject fakes and the typings version gap (TODO(verify): @types/braintree 3.4.5 vs package 3.41) cannot leak.

Verified Braintree facts: `gateway.transaction.sale({ amount, paymentMethodToken, orderId, options: { submitForSettlement } })`; `submitForSettlement(transactionId, amount)`; `void(transactionId)`; `find(id)`; `search(fn)` returns a stream and supports an orderId term; `webhookNotification.parse(bt_signature, bt_payload)` yields kind, timestamp and subject, and `sampleNotification(kind, id)` produces signed test payloads offline; sandbox test nonce `fake-valid-nonce`.

## Architecture

```
api/src/payments/
  types.ts        PaymentProvider, PaymentStatus, AuthorizeInput/Result, WebhookEvent
  errors.ts       ProviderError { provider, code, safeMessage, transactionId?, processorCode? }
  config.ts       loadPaymentsConfig(env): provider + braintree/paypal config; names missing var
  factory.ts      createPaymentProvider(env, deps?) -> PaymentProvider
  dedupe.ts       in-memory seen-key store
  routes.ts       registerPaymentsWebhookRoute(app, { provider, store })
  smoke.ts        pnpm payments:smoke
  braintree/      money.ts, gateway.ts (BraintreeGatewayLike + real gateway builder), provider.ts, status.ts
  paypal/         provider.ts (PayPalRestProvider over api/src/paypal client)
  index.ts
```

## Components and Interfaces

```ts
type PaymentStatus = "authorized"|"capture_pending"|"captured"|"voided"|"expired"|"declined"|"failed";
interface PaymentProvider {
  authorize(i:{amountCents:number;currency:string;intentId:string;paymentMethodRef:string}):Promise<{authorizationId:string;status:PaymentStatus}>;
  capture(authorizationId:string, amountCents:number):Promise<{captureId:string;status:PaymentStatus}>;
  void(authorizationId:string):Promise<{voidId:string;status:PaymentStatus}>;
  getStatus(authorizationId:string):Promise<{status:PaymentStatus}>;
  parseWebhook(rawFields:Record<string,string|undefined>):Promise<WebhookEvent>;
  linkPaymentMethod(i:{ownerId:string;nonce:string}):Promise<{customerId:string;paymentMethodToken:string}>;
}
```

Braintree mapping: authorizationId = captureId = voidId = transaction id (capture and void act on the same transaction). Status map: authorized -> authorized; submitted_for_settlement/settlement_pending/settling -> capture_pending; settled -> captured; voided -> voided; authorization_expired -> expired; processor_declined/settlement_declined -> declined; gateway_rejected/failed -> failed.

Idempotency (authorize): search by orderId = intentId; if a transaction exists whose status is not declined/failed, return it; otherwise sale. TODO(verify): search index lag may briefly miss a just-created transaction.

linkPaymentMethod: find customer by ownerId; if found, paymentMethod.create({ customerId, paymentMethodNonce }); else customer.create({ id: ownerId, paymentMethodNonce }); return the token of the new payment method.

PayPalRestProvider: paymentMethodRef is an already-approved PayPal order id; authorize = authorizeOrder; capture = captureAuthorization (full capture; TODO(verify) partial amounts); void = voidAuthorization; getStatus needs `getAuthorization` (GET /v2/payments/authorizations/{id}, TODO(verify)) added to the spec-03 client; linkPaymentMethod and parseWebhook throw an "unsupported" ProviderError (Vault is later; PayPal webhooks use /webhooks/paypal).

Webhook route: encapsulated plugin with an `application/x-www-form-urlencoded` parser (URLSearchParams, no new dependency); handler calls provider.parseWebhook({ bt_signature, bt_payload }); error -> 400; dedupe key -> 200 duplicate; else mark seen -> 200. `buildServer(opts?)` registers it only when a provider is passed; `index.ts` builds the provider from env and, on a missing variable, logs its name and exits 1.

## Data Models

Normalized `WebhookEvent { key, kind, timestampMs, transactionId?, status? }`. No persistence in this slice (spec-08 adds a WebhookEvent table).

## Error Handling

All provider failures throw `ProviderError` with safe fields. Declined or rejected authorizations throw (code `declined` or `rejected`). Config errors name only the variable. Webhook errors fail closed with 400. Logs never include nonces, tokens, keys or raw payloads.

## Correctness Properties

### Property 1: money conversion round-trips

For any integer cents in [0, 10_000_000], the Braintree adapter's decimal-to-cents conversion of its cents-to-decimal output equals the original cents, and the string matches ^\d+\.\d{2}$.

**Validates: Requirements 2.4, 6.2**

### Property 2: status mapping is total

For any Braintree status string, the mapper returns one of the seven normalized statuses and never throws.

**Validates: Requirements 1.5**

## Testing Strategy

Vitest, no live calls. Fake `BraintreeGatewayLike` records sale/submit/void/find/search arguments (asserts submitForSettlement false, orderId = intentId, decimal amount). Idempotency tests feed a search stream with existing transactions. Webhook tests use a real `BraintreeGateway` built with obviously fake keys and `sampleNotification` to produce valid and tampered payloads. Route tests use Fastify inject. Factory tests cover the default, paypal selection, invalid value, and missing PayPal keys under braintree. Log spies assert no secrets. Property tests via fast-check (>=100 runs).