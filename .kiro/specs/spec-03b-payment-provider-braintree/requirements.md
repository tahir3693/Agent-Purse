# Requirements Document

spec-03b Payment Provider (Braintree primary)

## Introduction

Braintree Sandbox (a PayPal service) becomes the primary payment provider behind a provider-neutral `PaymentProvider` interface in `/api/src/payments/`. The spec-03 PayPal REST code is kept as an optional second provider. Money flow: authorize (hold) -> single-use mandate token -> capture -> void on expiry/failure. Verified against Braintree Node docs and the installed `braintree` package; uncertainties are marked TODO(verify).

## Glossary

- PaymentProvider: normalized interface; no Braintree or PayPal types cross it.
- Authorization: a hold on funds (Braintree transaction with submitForSettlement false).
- Capture: submit an authorization for settlement.
- paymentMethodToken: Braintree vaulted payment method reference.
- ProviderError: typed, secret-free provider failure.

## Requirements

### Requirement 1: Provider-neutral interface

**User Story:** As an API developer, I want one payment interface, so providers are swappable and no vendor types leak.

#### Acceptance Criteria
1. The system SHALL export `PaymentProvider` with authorize, capture, void, getStatus, parseWebhook, linkPaymentMethod using normalized types only.
2. authorize SHALL take { amountCents, currency, intentId, paymentMethodRef } and return { authorizationId, status }.
3. capture SHALL take (authorizationId, amountCents) and return { captureId, status }; void SHALL take (authorizationId) and return { voidId, status }; getStatus SHALL return { status }.
4. linkPaymentMethod SHALL take { ownerId, nonce } and return { customerId, paymentMethodToken }.
5. Normalized status SHALL be one of authorized, capture_pending, captured, voided, expired, declined, failed.

### Requirement 2: Braintree adapter

**User Story:** As the platform, I want Braintree sandbox authorize/capture/void, so approved intents can be paid without a browser.

#### Acceptance Criteria
1. The adapter SHALL use the `braintree` package with the sandbox environment and BRAINTREE_MERCHANT_ID, BRAINTREE_PUBLIC_KEY, BRAINTREE_PRIVATE_KEY.
2. authorize SHALL call transaction.sale with paymentMethodToken, a decimal-string amount, options.submitForSettlement false, and orderId = intentId.
3. capture SHALL call submitForSettlement; void SHALL call transaction.void; getStatus SHALL call transaction.find.
4. Cents SHALL convert to a decimal string only inside the Braintree adapter, exactly for 2-decimal currencies.
5. BEFORE authorizing, the adapter SHALL search transactions by orderId = intentId and return an existing non-failed authorization instead of authorizing again.
6. linkPaymentMethod SHALL create the customer (id = ownerId) from the nonce, or add a payment method if the customer exists, returning the payment-method token.
7. Unsuccessful results SHALL throw ProviderError with safe fields only (provider, code, message, transactionId, processor response code); tokens, nonces and keys SHALL never be logged or included.

### Requirement 3: PayPal REST adapter and factory

**User Story:** As an operator, I want to select the provider by env, so PayPal REST stays available but optional.

#### Acceptance Criteria
1. PayPalRestProvider SHALL wrap the existing spec-03 client and implement PaymentProvider; the spec-03 code SHALL NOT be deleted.
2. The factory SHALL select by PAYMENT_PROVIDER (braintree | paypal), default braintree; any other value SHALL fail naming PAYMENT_PROVIDER.
3. PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_WEBHOOK_ID SHALL be required only when PAYMENT_PROVIDER=paypal; missing PayPal keys SHALL NOT break startup or tests.
4. WHEN a required variable is missing THEN the error SHALL name the variable only, never a value. BRAINTREE_ENV SHALL default to sandbox and any other value SHALL be rejected.

### Requirement 4: Webhooks

**User Story:** As the system, I want authentic-only payment webhooks, so forged events cannot change state.

#### Acceptance Criteria
1. The API SHALL expose POST /webhooks/payments accepting form fields bt_signature and bt_payload, parsed via webhookNotification.parse through provider.parseWebhook.
2. Parse failure or invalid signature SHALL respond 400 (fail closed); valid new events SHALL respond 200 quickly; a repeated event key SHALL respond 200 without reprocessing.
3. The dedupe key SHALL be derived from kind, subject id and timestamp (TODO(verify): Braintree notifications carry no unique id).
4. POST /webhooks/paypal SHALL remain unchanged.

### Requirement 5: Smoke script

**User Story:** As a developer, I want one command that proves the money flow with no browser.

#### Acceptance Criteria
1. `pnpm payments:smoke` SHALL auto-load the root .env, create a customer with nonce fake-valid-nonce to get a token, authorize $10.00 USD, capture it, then authorize $5.00 USD and void it.
2. It SHALL print ids and statuses only, never keys, tokens or nonces.
3. A missing variable SHALL be named and the script SHALL exit non-zero.

### Requirement 6: Tests and docs

**User Story:** As a maintainer, I want deterministic tests and honest docs.

#### Acceptance Criteria
1. Fixture tests (no live calls) SHALL cover authorize, capture, void, link, error mapping, idempotency lookup, webhook parsing, log secret-safety, factory selection and optional PayPal keys.
2. A property test SHALL assert the cents <-> decimal round trip; all existing suites SHALL stay green.
3. README SHALL state that payments are Braintree sandbox transactions (a PayPal service), Channel3 supplies real catalog and price data, and no real money or goods are exchanged, and SHALL document payments:smoke as needing no browser approval.
4. .env.example (placeholders only), render.yaml API env declarations and steering SHALL reflect the official variable list.