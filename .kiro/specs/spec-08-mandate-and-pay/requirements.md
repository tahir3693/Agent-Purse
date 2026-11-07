# Requirements Document

## Introduction

spec-08 Mandate and Pay: the intent-to-execution pipeline at `/api/src/intents/` and `/api/src/mandates/`, persisted in PostgreSQL via Prisma. `POST /intents` runs Risk Guard (spec-07) and, on approve, authorizes a hold and issues a single-use mandate token. `POST /intents/:id/execute` verifies the token, captures, and voids on any failure. Webhook dedupe moves to the database. Owner approval of escalated intents is spec-09/10.

## Glossary

- **Intent**: a stored purchase request with a state and the Risk Guard decision.
- **Authorization**: a payment hold from the active PaymentProvider (no settlement).
- **Mandate**: a signed single-use token bound to one authorization, amount, currency and payee.
- **Agent**: caller authenticated by a bearer API key.

## Requirements

### Requirement 1: Create and evaluate an intent

**User Story:** As an agent, I want to submit a purchase intent and get a decision.

#### Acceptance Criteria

1. WHEN `POST /intents` receives a valid body (amountCents integer > 0, 3-letter currency, payee, category, description, justification, paymentMethodRef), THE API SHALL persist the intent and run `evaluateRisk`.
2. WHEN the decision is `deny` or `escalate`, THE API SHALL store the state and decision and return them, and SHALL NOT call the PaymentProvider.
3. WHEN the decision is `approve`, THE API SHALL call `authorize` (hold, no settlement) with orderId = intentId.
4. IF the request is unauthenticated or the body is invalid, THEN THE API SHALL respond 401 or 400 and persist nothing.
5. THE API SHALL write an audit log row for each state change, containing no intent text, tokens or keys.

### Requirement 2: Mandate issuance

**User Story:** As an owner, I want each approved purchase bound to one cryptographic token.

#### Acceptance Criteria

1. AFTER a successful authorization, THE API SHALL issue an HS256 JWT signed with MANDATE_SIGNING_KEY with claims jti (nonce), intentId, authorizationId, amountCents, currency, payee and exp no more than 5 minutes ahead.
2. THE API SHALL store the mandate by jti with consumedAt null and return the token once.
3. IF authorization fails, THEN THE API SHALL mark the intent `failed`, issue no token and return a generic error.

### Requirement 3: Execution

**User Story:** As an agent, I want to present the token to complete the purchase safely.

#### Acceptance Criteria

1. WHEN `POST /intents/:id/execute` is called by the owning agent with a token, THE API SHALL verify signature (constant-time), algorithm, expiry, and that intentId, authorizationId, amountCents, currency and payee equal the stored authorization.
2. THE API SHALL consume the jti with an atomic update guarded by `consumedAt IS NULL` BEFORE capture; zero rows updated SHALL reject with 409 and SHALL NOT capture or void.
3. WHEN consume succeeds, THE API SHALL call `capture`; on success the intent becomes `captured`.
4. IF the token is expired, tampered or mismatched, THEN THE API SHALL reject (401) and void the authorization if it is still held.
5. IF capture fails after consume, THEN THE API SHALL void the authorization and mark the intent `voided` with a failure audit row.
6. THE API SHALL never return or log the token, signing key or provider secrets in errors.

### Requirement 4: Persistence and webhook dedupe

**User Story:** As an operator, I want state and webhook dedupe to survive restarts.

#### Acceptance Criteria

1. THE database SHALL contain Agent, Policy, Intent, Authorization, Mandate, AuditLog and WebhookEvent tables; WebhookEvent.eventId is unique.
2. THE webhook route SHALL claim an event by inserting eventId; a unique violation SHALL return 200 `duplicate` without reprocessing.
3. WHERE a webhook carries a transaction id matching an Authorization, THE API SHALL update its status.
4. THE in-memory store SHALL be replaced in production wiring.

### Requirement 5: Config and tests

**User Story:** As a maintainer, I want safe startup and offline tests.

#### Acceptance Criteria

1. IF DATABASE_URL or MANDATE_SIGNING_KEY is missing at startup, THEN THE API SHALL name the variable and exit 1; tests SHALL NOT require either.
2. Tests SHALL use in-memory store fakes and fake providers, with no live calls, covering: happy path, replay rejection, expired-token void, tamper rejection, capture-failure void, deny/escalate without a hold, authorize failure, and DB webhook dedupe.

