# Design Document

spec-03 PayPal Core

## Overview

PayPal sandbox integration at `/api/src/paypal/`, hidden behind a `PayPalClient` interface so production uses a `fetch`-based implementation and tests use a fixture-backed stub (no live calls). Covers OAuth2 client-credentials with a cached token, Orders v2 (create AUTHORIZE / authorize / get), Payments v2 (capture / void), and webhook signature verification. Integer cents convert to PayPal decimal strings only here. Every write carries a deterministic `PayPal-Request-Id`.

Endpoints are taken from PayPal official docs (verified, not guessed):
- OAuth: `POST {base}/v1/oauth2/token`, HTTP Basic (client:secret), body `grant_type=client_credentials`; response has `access_token`, `expires_in`.
- Orders v2: `POST /v2/checkout/orders` (intent AUTHORIZE); `POST /v2/checkout/orders/{id}/authorize`; `GET /v2/checkout/orders/{id}`.
- Payments v2: `POST /v2/payments/authorizations/{id}/capture`; `POST /v2/payments/authorizations/{id}/void`.
- Webhook: `POST /v1/notifications/verify-webhook-signature`; accept only `verification_status === "SUCCESS"`; the webhook event MUST be the RAW body (never re-serialized).

## Architecture

```
api/src/paypal/
  config.ts        loadPayPalConfig(env) -> { clientId, clientSecret, baseUrl }; names missing var, no values
  token.ts         TokenCache: getToken() client-credentials + in-memory cache w/ expiry margin
  money.ts         centsToDecimal(cents,currency) / decimalToCents(str,currency) (2dp default)
  errors.ts        PayPalError(status, name, debug_id, details); fromResponse()
  idempotency.ts   requestId(intentId, op) -> deterministic PayPal-Request-Id
  client.ts        PayPalClient interface + createHttpPayPalClient(deps) (fetch impl)
  webhook.ts       verifyWebhook(headers, rawBody) via verify-webhook-signature
  dedupe.ts        in-memory seen-event-id set (TODO(verify): swap for DB table in spec-08)
  routes.ts        registerPayPalWebhookRoute(fastify) -> POST /webhooks/paypal (raw body)
  smoke.ts         pnpm paypal:smoke [--no-approve]
  index.ts         public surface
  __tests__/       fixtures + unit/property tests
```

The whole surface is behind `PayPalClient`, created by `createHttpPayPalClient({ config, token, fetch })`. Tests pass a stub implementing `PayPalClient` or inject a fake `fetch` returning fixtures.

## Components and Interfaces

```ts
export interface Money { amountCents: number; currency: string; }

export interface CreateOrderInput {
  amountCents: number; currency: string; referenceId: string;
  returnUrl: string; cancelUrl: string; intentId: string; // intentId drives idempotency
}
export interface CreatedOrder { id: string; status: string; approvalUrl: string | null; }
export interface Authorization { id: string; status: string; }
export interface Capture { id: string; status: string; }

export interface PayPalClient {
  createOrder(input: CreateOrderInput): Promise<CreatedOrder>;
  authorizeOrder(orderId: string, intentId: string): Promise<Authorization>;
  captureAuthorization(authorizationId: string, intentId: string): Promise<Capture>;
  voidAuthorization(authorizationId: string, intentId: string): Promise<void>;
  getOrder(orderId: string): Promise<{ id: string; status: string }>;
  verifyWebhook(headers: Record<string,string|undefined>, rawBody: string): Promise<boolean>;
}
```

- createOrder body: `{ intent: "AUTHORIZE", purchase_units: [{ reference_id, amount: { currency_code, value: centsToDecimal(...) } }], payment_source: { paypal: { experience_context: { return_url, cancel_url } } } }`. approvalUrl = the `links[] rel==="payer-action"` (fallback `rel==="approve"`). TODO(verify): exact rel name in current sandbox response; capture whichever of payer-action/approve is present.
- Write calls set headers `Authorization: Bearer <token>`, `Content-Type: application/json`, `PayPal-Request-Id: requestId(intentId, op)`.
- captureAuthorization POSTs to the authorization capture path with an empty JSON body (full capture).

## Data Models

The typed shapes above (Money, CreateOrderInput, CreatedOrder, Authorization, Capture) are the module's data models. Persistence of orders/authorizations/mandates belongs to spec-08; this slice holds no DB state except the in-memory token cache and webhook dedupe set.

## Money and Idempotency

- `centsToDecimal(1234,"USD") === "12.34"`; `decimalToCents("12.34","USD") === 1234`. 2-decimal assumption documented; zero-decimal currencies are out of scope here (TODO(verify) if a non-2dp currency is ever needed).
- `requestId(intentId, op)` = stable string like `${intentId}:${op}` (<=10000 chars per PayPal limit). Deterministic so retries reuse the key.
- `PayPalError` built from a non-2xx response JSON (`name`, `debug_id`, `details`), plus HTTP `status`. Only `debug_id` + status are logged.

## Error Handling

All non-2xx PayPal responses map to a single PayPalError { status, name, debug_id, details }. Call sites catch it; only status and debug_id are logged (never tokens or secrets). Network/timeout failures surface as the same error type with a synthetic name. The webhook route fails closed: any verification error or missing PAYPAL_WEBHOOK_ID is treated as unverified.

## Webhook flow

`POST /webhooks/paypal`: Fastify route configured to receive the RAW body (add a content-type parser that keeps the raw string for this route). Read the five `paypal-transmission-*` / `paypal-cert-url` / `paypal-auth-algo` headers, call verify-webhook-signature with `{ auth_algo, cert_url, transmission_id, transmission_sig, transmission_time, webhook_id: PAYPAL_WEBHOOK_ID, webhook_event: <parsed raw body> }`. Accept only SUCCESS. Dedupe by `webhook_event.id` (in-memory). Respond 200 fast for accepted/duplicate; 400 for unverified. Missing PAYPAL_WEBHOOK_ID -> verification fails closed and logs the variable name only.

## Correctness Properties

### Property 1: money conversion round-trips

For any integer cents in [0, 10_000_000] with a 2-decimal currency, `decimalToCents(centsToDecimal(cents)) === cents`. Guarantees the PayPal decimal boundary never distorts a cent value.

**Validates: Requirements 4.2, 4.3**

### Property 2: idempotency key is deterministic and stable

For any intentId and operation, `requestId(intentId, op)` is non-empty, <=10000 chars, and equal across repeated calls; different operations for the same intent differ.

**Validates: Requirements 5.1, 5.2**

## Testing Strategy

Fixtures (recorded PayPal JSON for order-create, authorize, capture, verify success/failure, and an error body with debug_id). A fake `fetch` returns these by URL/method so `createHttpPayPalClient` is tested without network. Cases: create maps amount + sets PayPal-Request-Id; authorize/capture parse ids+status; error response -> PayPalError(status,name,debug_id,details); webhook verify SUCCESS/FAILURE and dedupe; a log spy asserts no token/secret string is emitted. Plus the two property tests above (fast-check, >=100 runs).

## TODO(verify)

- Exact approval link `rel` in the current sandbox create-order response (`payer-action` vs `approve`); code reads whichever is present.
- Fastify raw-body handling for the webhook route only, without disturbing JSON parsing elsewhere.
- Non-2-decimal currencies (JPY etc.) are out of scope; revisit if needed.