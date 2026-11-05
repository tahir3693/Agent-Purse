# Requirements Document

spec-03 PayPal Core

## Introduction

Build the PayPal sandbox integration at `/api/src/paypal/`, behind a `PayPalClient` interface so tests use recorded fixtures (no live calls). Covers OAuth2 client-credentials, Orders v2 (create AUTHORIZE, authorize, get), Payments v2 (capture, void), and webhook signature verification. Cents convert to PayPal decimal strings only inside this module. All write calls carry a deterministic `PayPal-Request-Id` idempotency header. A smoke script exercises the live create/approve/authorize/capture flow. Verified against PayPal official docs (Orders v2, Payments v2, verify-webhook-signature); any residual uncertainty is marked TODO(verify).

## Glossary

- PayPalClient: the interface hiding all PayPal HTTP calls so the rest of the API (and tests) never touch fetch directly.
- Order: a PayPal Orders v2 resource created with intent AUTHORIZE; the buyer approves it via an approval URL.
- Authorization: the hold placed on buyer funds after authorizing an approved order (Payments v2 resource).
- Capture: settling (taking) funds from an existing authorization.
- Void: cancelling an authorization before capture, releasing the hold.
- Idempotency key: the PayPal-Request-Id header value, derived deterministically from the intent id, so retries do not double-charge.
- verify-webhook-signature: PayPal endpoint that confirms a webhook POST genuinely came from PayPal.
- debug_id: PayPal's per-request correlation id, safe to log; secrets are never logged.

## Requirements

### Requirement 1: Config and secrets

**User Story:** As an operator, I want PayPal config loaded from env with clear errors, so misconfiguration is obvious and no secret leaks.

#### Acceptance Criteria
1. WHEN the module loads config THEN it SHALL read PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_BASE_URL from the environment.
2. IF any of those is missing or blank THEN config loading SHALL throw an error naming the missing variable and SHALL NOT print any value.
3. No secret value SHALL appear in any log, error message, or script output.

### Requirement 2: OAuth2 token with cache

**User Story:** As the client, I want cached client-credentials tokens, so I do not fetch a new token per call.

#### Acceptance Criteria
1. WHEN a token is needed THEN the module SHALL obtain one via client-credentials (HTTP Basic client id/secret) from PayPal's OAuth endpoint.
2. The module SHALL cache the token in memory and reuse it until near expiry, applying a safety margin before `expires_in`.
3. WHEN the cached token is within the expiry margin THEN the next call SHALL refresh it.

### Requirement 3: PayPalClient interface (Orders + Payments)

**User Story:** As an API developer, I want one typed interface for the PayPal operations AgentPurse needs, so call sites stay simple and testable.

#### Acceptance Criteria
1. The module SHALL export a `PayPalClient` interface with: createOrder, authorizeOrder, captureAuthorization, voidAuthorization, getOrder, verifyWebhook.
2. WHEN createOrder is called with (amountCents, currency, referenceId, returnUrl, cancelUrl) THEN it SHALL create an Orders v2 order with intent AUTHORIZE and return the order id, status, and approval URL.
3. WHEN authorizeOrder(orderId) is called THEN it SHALL authorize the approved order and return the authorization id and status.
4. WHEN captureAuthorization(authorizationId, intentId) is called THEN it SHALL capture that authorization and return the capture id and status.
5. WHEN voidAuthorization(authorizationId) is called THEN it SHALL void that authorization.
6. WHEN getOrder(orderId) is called THEN it SHALL return the current order status.
7. All HTTP calls SHALL go through the interface so tests can substitute a fixture-backed implementation with no live network calls.

### Requirement 4: Money conversion boundary

**User Story:** As the owner, I want cents converted to PayPal decimals only here, so the money rule holds system-wide.

#### Acceptance Criteria
1. Conversion between integer cents and PayPal's decimal amount string SHALL occur only inside this module.
2. The conversion SHALL be exact for standard 2-decimal currencies (e.g. 1234 cents -> "12.34").
3. A property test SHALL assert centsToDecimal/decimalToCents round-trips for arbitrary non-negative cent amounts.

### Requirement 5: Idempotency

**User Story:** As the platform, I want every write idempotent, so retries never double-charge.

#### Acceptance Criteria
1. Every PayPal write call (createOrder, authorizeOrder, captureAuthorization, voidAuthorization) SHALL send a PayPal-Request-Id header.
2. The header value SHALL be derived deterministically from the intent id (same intent id -> same key for a given operation).

### Requirement 6: Typed errors

**User Story:** As a developer, I want PayPal failures mapped to a typed error, so handling and logging are consistent.

#### Acceptance Criteria
1. WHEN a PayPal call returns a non-success status THEN the module SHALL throw a `PayPalError` carrying status, name, debug_id, and details.
2. The module SHALL log the debug_id for correlation and SHALL NOT log secrets or tokens.

### Requirement 7: Webhook route with signature verification

**User Story:** As the system, I want an authentic-only webhook endpoint, so forged events cannot change state.

#### Acceptance Criteria
1. The API SHALL expose POST /webhooks/paypal that reads the RAW request body (unparsed) for verification.
2. WHEN an event arrives THEN the route SHALL verify it via PayPal's verify-webhook-signature endpoint using PAYPAL_WEBHOOK_ID and the PayPal transmission headers, accepting only verification_status SUCCESS.
3. The route SHALL dedupe by event id (in-memory for now) so a repeated event id is processed at most once.
4. The route SHALL respond 200 quickly for accepted (or already-seen) events and reject unverified events.
5. IF PAYPAL_WEBHOOK_ID is missing THEN the route SHALL fail verification (never treat an event as verified) and the missing variable SHALL be named in logs without printing a value.

### Requirement 8: Smoke script

**User Story:** As a developer, I want a guided live smoke test, so I can confirm the end-to-end sandbox flow.

#### Acceptance Criteria
1. WHEN `pnpm paypal:smoke` runs THEN it SHALL get a token, create a $1.00 USD AUTHORIZE order, and print the approval URL.
2. The script SHALL then PAUSE for the operator to approve in the browser, continuing on Enter to authorize then capture, printing ids and statuses only (no secrets).
3. WHEN run with `--no-approve` THEN it SHALL stop after creating the order (print order id + approval URL) and exit.
4. IF PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is missing THEN the script SHALL name the missing variable and exit without printing a value.
5. The script SHALL auto-load the root .env (as the channel3 smoke does).

### Requirement 9: Fixture-based tests

**User Story:** As a maintainer, I want deterministic tests, so CI is free and reliable.

#### Acceptance Criteria
1. Tests SHALL cover create, authorize, capture, and webhook verify using fixtures, with no live calls.
2. Tests SHALL cover error mapping (non-success -> PayPalError with debug_id), the idempotency header derivation, and the cents<->decimal round-trip property.
3. Tests SHALL assert no secret or token value is written to logs.