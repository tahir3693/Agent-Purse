# Requirements Document

## Introduction

spec-06 Vault Linking: an owner links a Braintree sandbox payment method through `/api/src/vault/`. The nonce is tokenized by the PaymentProvider, the result is stored for the owner, and only redacted data is ever returned. Owner login is a later slice; this slice authenticates an owner bearer token and binds every call to that owner.

## Glossary

- **Owner**: the human who links payment methods.
- **Nonce**: a single-use client token from the provider (sandbox: `fake-valid-nonce`).
- **Vault_Method**: stored link of owner, customerId, payment method token, card type and last 4.

## Requirements

### Requirement 1: Link a payment method

**User Story:** As an owner, I want to link a card once so my agents can spend from it.

#### Acceptance Criteria

1. WHEN `POST /vault/link` receives `{ ownerId, nonce }` from the authenticated owner with a matching ownerId, THE API SHALL call `PaymentProvider.linkPaymentMethod` and persist customerId, token, card type and last 4.
2. THE API SHALL return 201 with the redacted method only.
3. IF the ownerId differs from the authenticated owner, THEN THE API SHALL return 403 and SHALL NOT call the provider.
4. IF the request is unauthenticated or the body is invalid, THEN THE API SHALL return 401 or 400 and persist nothing.
5. WHEN the same token is linked again by the same owner, THE API SHALL return the existing method without creating a duplicate.

### Requirement 2: Fail closed

**User Story:** As an owner, I want no half-linked records.

#### Acceptance Criteria

1. IF the provider rejects the nonce or throws, THEN THE API SHALL persist nothing and return a typed error (422 for `invalid_request` or `rejected`, 502 otherwise) with a code and generic message.
2. IF persistence fails after tokenization, THEN THE API SHALL return 502 and audit `vault_persist_failed` with ids only.
3. THE error body, audit and logs SHALL NOT contain the nonce, token, or keys.

### Requirement 3: List methods

**User Story:** As an owner, I want to see my linked methods safely.

#### Acceptance Criteria

1. WHEN `GET /vault/methods` is called by an authenticated owner, THE API SHALL return only that owner's methods, newest first, supporting multiple per owner.
2. EACH item SHALL contain only `id`, `cardType`, `last4`, `tokenRef` (masked, last 4 characters of the token) and `createdAt`.
3. THE API SHALL NOT return full card numbers, raw tokens, customer secrets or provider keys.

### Requirement 4: Provider seam and tests

**User Story:** As a maintainer, I want the provider details isolated and tests offline.

#### Acceptance Criteria

1. THE `linkPaymentMethod` result SHALL gain optional `cardType` and `last4`, mapped inside the Braintree adapter only.
2. Tests SHALL use offline gateway fixtures and in-memory stores, covering: success with `fake-valid-nonce`, invalid nonce, multiple cards, redaction, owner mismatch, unauthenticated, persist failure, duplicate link and secret-free logs.
