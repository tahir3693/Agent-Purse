# Implementation Plan

spec-03 PayPal Core. Module at /api/src/paypal/ behind a PayPalClient interface. Tests use fixtures (no live calls). Endpoints verified from PayPal docs.

## Overview

Bottom-up: config + token + money + errors + idempotency, then the fetch-based PayPalClient, then the webhook route, then the smoke script, then fixture unit tests and property tests, then verify gates.

## Tasks

- [x] 1. Foundations: config, money, errors, idempotency
  - config.ts: loadPayPalConfig(env) reads PAYPAL_CLIENT_ID/SECRET/BASE_URL; throws naming any missing var, never prints a value
  - money.ts: centsToDecimal(cents,currency)/decimalToCents(str,currency), 2dp
  - errors.ts: PayPalError(status,name,debug_id,details) + fromResponse()
  - idempotency.ts: requestId(intentId, op) deterministic, <=10000 chars
  - _Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 5.1, 5.2, 6.1_

- [x] 2. OAuth token cache
  - token.ts: getToken() via client-credentials (Basic auth) against {base}/v1/oauth2/token; in-memory cache; refresh within expiry margin
  - Inject fetch for testability; never log token/secret
  - _Requirements: 2.1, 2.2, 2.3, 1.3_

- [x] 3. PayPalClient (fetch implementation)
  - client.ts: PayPalClient interface + createHttpPayPalClient({ config, token, fetch })
  - createOrder (intent AUTHORIZE, amount via money.ts, PayPal-Request-Id, return approvalUrl from links payer-action/approve), authorizeOrder, captureAuthorization, voidAuthorization, getOrder
  - Map non-2xx -> PayPalError; set PayPal-Request-Id on all writes
  - index.ts: public surface
  - _Requirements: 3.1-3.7, 4.1, 5.1, 5.2, 6.1, 6.2_

- [x] 4. Webhook verify + route
  - webhook.ts: verifyWebhook(headers, rawBody) -> verify-webhook-signature with PAYPAL_WEBHOOK_ID; accept only SUCCESS; pass raw event; fail closed if id missing (log name only)
  - dedupe.ts: in-memory seen event-id set
  - routes.ts: POST /webhooks/paypal reading RAW body; verify, dedupe by event id, 200 fast; 400 unverified
  - _Requirements: 7.1-7.5_

- [x] 5. Smoke script + pnpm wiring
  - smoke.ts: token -> create $1.00 USD AUTHORIZE order -> print approval URL; PAUSE for Enter then authorize+capture, print ids/statuses only; --no-approve stops after create; missing CLIENT_ID/SECRET -> name var, exit
  - package.json (api + root passthrough): paypal:smoke loading root .env (node --env-file-if-exists=../.env)
  - README note: manual approval goes away after Vault (spec-06)
  - _Requirements: 8.1-8.5_

- [x] 6. Unit tests (fixtures, no live calls)
  - Fixtures: order-create, authorize, capture, verify SUCCESS/FAILURE, error body w/ debug_id
  - Fake fetch by url/method; cover create mapping + PayPal-Request-Id, authorize/capture parse, error->PayPalError, webhook verify + dedupe, token cache reuse/refresh, log spy asserts no secret/token emitted
  - _Requirements: 9.1, 9.2, 9.3_

- [x] 7. Property tests (fast-check, >=100 iters)
  - Property 1: money round-trip decimalToCents(centsToDecimal(c))===c. Tag: `// Feature: spec-03-paypal-core, Property 1: money conversion round-trips`
  - Property 2: requestId deterministic/stable, non-empty, <=10000, differs per op. Tag: `// Feature: spec-03-paypal-core, Property 2: idempotency key deterministic`
  - _Requirements: 4.3, 5.1, 5.2_

- [x] 8. Verify gates
  - typecheck, build, lint, vitest run; fix failures
  - _Requirements: 9.1_

## Notes

- Real PayPal keys live only in local .env; never read, printed, or copied. Tests use fixtures.
- Webhook event MUST be verified from the RAW body; re-serialized JSON breaks the signature.
- TODO(verify) carried: approval link rel (payer-action vs approve); Fastify raw-body for the webhook route only; non-2dp currencies out of scope.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3"] },
    { "id": 3, "tasks": ["4", "5"] },
    { "id": 4, "tasks": ["6", "7"] },
    { "id": 5, "tasks": ["8"] }
  ]
}
```