# Implementation Plan

spec-03b Braintree primary provider behind a provider-neutral interface. No live calls in tests; secrets never printed.

## Overview

Types and config first, then the Braintree adapter, then the PayPal REST adapter and factory, then webhook route and server wiring, then the smoke script and docs, then tests, then verification.

## Tasks

- [x] 1. Types, errors, config, env files
  - payments/types.ts, errors.ts (ProviderError), config.ts (loadPaymentsConfig: PAYMENT_PROVIDER default braintree, BRAINTREE_ENV default sandbox else reject, BRAINTREE_* required for braintree, PAYPAL_* only for paypal; names missing var only), dedupe.ts
  - Update .env.example to the official variable list (placeholders only; PAYPAL_* marked optional; keep WEB_ORIGIN, API_BASE_URL, NEXT_PUBLIC_API_BASE_URL) and render.yaml API envVars (add PAYMENT_PROVIDER, BRAINTREE_*; remove AG_GRID_LICENSE_KEY; PAYPAL_* optional)
  - Append a short decision addendum to MASTER_PROMPT.md
  - _Requirements: 1.1-1.5, 3.2, 3.3, 3.4, 6.4_

- [x] 2. BraintreeProvider
  - braintree/money.ts, status.ts, gateway.ts (BraintreeGatewayLike + builder from config), provider.ts (authorize with idempotency lookup, capture, void, getStatus, linkPaymentMethod, parseWebhook)
  - _Requirements: 2.1-2.7, 4.1, 4.3_

- [x] 3. PayPalRestProvider and factory
  - paypal/provider.ts wrapping the spec-03 client (add getAuthorization to the client, GET /v2/payments/authorizations/{id}); factory.ts; payments/index.ts
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 4. Webhook route and server wiring
  - routes.ts POST /webhooks/payments (form parser, fail closed, dedupe, fast 200); buildServer(opts?) registers it when a provider is passed; index.ts builds provider from env, logs missing var name and exits 1; /webhooks/paypal untouched
  - _Requirements: 4.1-4.4_

- [x] 5. Smoke script and docs
  - payments/smoke.ts and `payments:smoke` scripts (api + root) loading root .env via --env-file-if-exists; README Smoke tests section plus honest-disclosure paragraph
  - _Requirements: 5.1-5.3, 6.3_

- [x] 6. Tests
  - Fixture unit tests per design Testing Strategy plus property tests (Property 1 and 2), tagged `// Feature: spec-03b-payment-provider-braintree, Property N: ...`
  - Quality-gate coverage (all in api/src/payments/__tests__): idempotency (braintreeProvider.test.ts, existing orderId transaction returned without a new sale); webhook signature (webhookRoute.test.ts, valid sample parses, tampered signature/payload and missing fields rejected, route returns 400); missing PayPal keys (factory.test.ts, braintree startup does not need PAYPAL_*, paypal selection names the missing key)
  - _Requirements: 6.1, 6.2_

- [x] 7. Verify gates
  - pnpm -r run typecheck, pnpm lint, pnpm build, pnpm test
  - _Requirements: 6.2_

## Notes

- Braintree and PayPal types never leave their adapters. Cents become decimal strings only inside adapters.
- TODO(verify): types version gap, search index lag, webhook dedupe key, PayPal getAuthorization endpoint and partial capture.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3", "4", "5"] },
    { "id": 3, "tasks": ["6"] },
    { "id": 4, "tasks": ["7"] }
  ]
}
```