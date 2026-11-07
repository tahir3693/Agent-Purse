# Requirements Document

## Introduction

spec-06b Owner and Agents: owner accounts, agent management, owner-scoped reads, approval of escalated intents and a live SSE feed, so the dashboard and demo agent have a working backend. Builds on spec-06 (owner JWT) and spec-08 (intents).

## Glossary

- **Owner**: human account (email, password) that owns agents and vault methods.
- **Agent**: software with an API key hash, an ownerId, a kill switch and a policy.
- **Vault_Method_Id**: id of a stored vault method; never the provider token.

## Requirements

### Requirement 1: Owner accounts

**User Story:** As an owner, I want to register and log in so I can manage agents.

#### Acceptance Criteria

1. THE API SHALL provide `POST /auth/register` and `POST /auth/login`; passwords SHALL be hashed with scrypt (random salt; owner decision: scrypt chosen over argon2/bcrypt to avoid native builds on Render) and never logged or returned.
2. WHEN login succeeds, THE API SHALL return an HS256 JWT signed with JWT_SECRET (`sub` = ownerId, expiry at most 1 hour) that spec-06 verifies.
3. THE API SHALL return the same generic 401 for unknown email and wrong password and SHALL rate-limit login per IP and email (429).

### Requirement 2: Agent management (owner scoped)

**User Story:** As an owner, I want to create, list and revoke my agents and set their policy.

#### Acceptance Criteria

1. `POST /agents` SHALL create an agent with ownerId = the caller and return the API key once; only its sha256 hash is stored.
2. `GET /agents` SHALL list only the caller's agents without key material.
3. `POST /agents/:id/kill` and `/restore` SHALL toggle the kill switch for the caller's agent only.
4. `GET` and `PUT /agents/:id/policy` SHALL read and write the caller's agent policy; PUT SHALL validate with PolicySchema (400 on failure).
5. Another owner's agent id SHALL return 404.

### Requirement 3: Intent payment method safety

**User Story:** As an owner, I want agents unable to spend raw provider tokens.

#### Acceptance Criteria

1. `paymentMethodRef` SHALL be a Vault_Method_Id; THE API SHALL resolve it server-side to the token and only if the method belongs to the agent's owner.
2. IF it is unknown, belongs to another owner, or is a raw token, THEN THE API SHALL return 422 `invalid_payment_method` and persist nothing.
3. Agents without an owner SHALL be rejected with the same error.

### Requirement 4: Owner reads

**User Story:** As an owner, I want to see intents and totals.

#### Acceptance Criteria

1. `GET /owner/intents?state=` SHALL list intents of the caller's agents only.
2. `GET /owner/intents/:id` SHALL return the intent and its audit events; other owners' ids SHALL return 404.
3. `GET /owner/stats` SHALL return spent today (captured, UTC day, per currency) and counts by decision.

### Requirement 5: Approval of escalated intents

**User Story:** As an owner, I want to approve or deny escalated purchases.

#### Acceptance Criteria

1. `POST /intents/:id/approve` and `/deny` SHALL require the owner JWT, an intent of the caller's agent and state `escalated` (else 409).
2. Approve SHALL authorize the hold (state `authorized`); deny SHALL set state `denied`. Both SHALL write audit events.
3. THE agent SHALL obtain the mandate with `POST /intents/:id/mandate` (agent key; state `authorized`) and the status with `GET /intents/:id`.

### Requirement 6: Live feed

**User Story:** As an owner, I want live updates in the dashboard.

#### Acceptance Criteria

1. `POST /events/token` SHALL mint a stream token (60 seconds, scope `sse`); `GET /events?stream_token=` SHALL stream only that owner's events as SSE.
2. A stream token SHALL NOT work as a bearer token and a bearer token SHALL NOT open the stream.
3. Events: intent.created, intent.decided, intent.authorized, intent.captured, intent.denied; payloads hold ids and states only. Request logs SHALL NOT include the query string of `/events`.

### Requirement 7: Seed, migration, tests

**User Story:** As a maintainer, I want reproducible demo data and safe tests.

#### Acceptance Criteria

1. `pnpm seed:demo` SHALL create a demo owner, an agent with a policy and a vaulted `fake-valid-nonce` card, printing the demo login and the agent key once and never the provider token.
2. A real Prisma migration SHALL add the new models and fields; the apply command SHALL be documented.
3. Offline tests SHALL cover ownership isolation, key shown once, raw-token rejection, approve and deny, SSE auth, and all existing tests SHALL stay green.

### Requirement 8: Root status route

**User Story:** As an operator, I want GET / to answer so Render's HEAD / health check stops logging 404s.

#### Acceptance Criteria

1. THE API SHALL respond to `GET /` (and therefore `HEAD /`) with 200 and body `{"name":"agentpurse-api","status":"ok"}` without authentication.
2. THE response SHALL contain no configuration or environment values.
