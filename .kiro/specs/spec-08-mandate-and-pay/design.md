# Design Document

spec-08 Mandate and Pay

## Overview

Services depend on store interfaces (`IntentStore`, `AuthorizationStore`, `MandateStore`, `AuditStore`, `WebhookEventStore`, `AgentPolicyStore`). Each has a Prisma implementation and an in-memory fake used by tests. Routes are thin; `createIntent` and `executeIntent` hold the logic. The payment provider and `evaluateRisk` are injected.

## Architecture

```
api/prisma/schema.prisma        Agent, Policy, Intent, Authorization, Mandate, AuditLog, WebhookEvent
api/src/db/                     prisma client factory, Prisma store impls, in-memory fakes
api/src/mandates/
  token.ts                      signMandate / verifyMandate (HS256 JWT, node:crypto)
  service.ts                    issueMandate, consumeMandate (atomic)
api/src/intents/
  schema.ts                     zod body schemas
  service.ts                    createIntent, executeIntent
  routes.ts                     POST /intents, POST /intents/:id/execute
  auth.ts                       bearer agent auth (sha256 key hash lookup)
api/src/payments/dedupe.ts      WebhookEventStore (async claim) replaces SeenKeyStore
```

## Components and Interfaces

```ts
type IntentState = "pending" | "denied" | "escalated" | "authorized" | "captured" | "voided" | "failed";
interface WebhookEventStore { claim(eventId: string): Promise<boolean>; } // false = duplicate
interface MandateStore {
  create(m: { jti: string; intentId: string; expiresAt: Date }): Promise<void>;
  consume(jti: string, now: Date): Promise<boolean>; // UPDATE ... WHERE consumedAt IS NULL, count === 1
}
```

Token claims: `jti, intentId, authorizationId, amountCents, currency, payee, iat, exp` (jti is the nonce). Header alg must be exactly HS256; anything else is rejected. Signature compared with `timingSafeEqual`.

### createIntent flow

1. Validate body; load Agent policy and recent history (Intent rows captured or authorized).
2. Persist intent `pending`; call `evaluateRisk`.
3. deny -> `denied`; escalate -> `escalated`; store decision and risk audit meta; return.
4. approve -> `provider.authorize({ intentId, ... })`; store Authorization; state `authorized`; issue mandate; return `{ intentId, decision, mandateToken, expiresAt }`.
5. authorize throws -> `failed`, no token.

### executeIntent flow

1. Load intent owned by the agent and its authorization (404 otherwise).
2. verify token. Expired, bad signature or claim mismatch: void if still `authorized`, state `voided`, 401.
3. `consume(jti)`; false -> 409 (replay), no capture, no void.
4. `provider.capture`; success -> `captured`. Failure -> `provider.void`, `voided`, 502 generic.
5. Every step writes an AuditLog row.

### Webhook dedupe

`claim` inserts WebhookEvent(eventId unique); unique violation (Prisma P2002) returns false. The route parses first (fail closed on bad signature), then claims, then updates Authorization status by providerTxnId.

## Data Models

Money is integer cents plus currency everywhere. Intent: id, agentId, amountCents, currency, payee, category, description, justification, paymentMethodRef, state, decision, riskScore, createdAt. Authorization: id, intentId (unique), providerTxnId, status. Mandate: jti (PK), intentId, expiresAt, consumedAt. AuditLog: id, intentId, event, meta Json, createdAt. Agent: id, apiKeyHash (unique), killed. Policy: agentId, policy Json (spec-05 Policy), riskConfig Json.

## Error Handling

Zod failures return 400 with field names only. Provider errors map to generic 502; details go to logs without secrets. Missing DATABASE_URL or MANDATE_SIGNING_KEY names the variable and exits 1.

## Correctness Properties

### Property 1: A mandate token is accepted at most once

For any issued token, any number of sequential execute attempts results in at most one capture.

**Validates: Requirements 3.2**

### Property 2: Tampered tokens never verify

For any token and any single-character mutation, verification fails.

**Validates: Requirements 3.1, 3.4**

### Property 3: Only approve places a hold

For any risk decision of deny or escalate, the provider authorize call count is zero.

**Validates: Requirements 1.2**

## Testing Strategy

Vitest and fast-check, no live calls. In-memory stores and a scripted fake PaymentProvider (records authorize, capture, void). Fake `evaluateRisk`. Route tests use Fastify inject. Cases: happy path, replay 409, expired token voids, tamper, claim mismatch, capture failure voids, authorize failure, deny and escalate with zero provider calls, webhook duplicate, log spy for token and key.

## TODO(verify)

- Prisma install, `prisma generate` and migration are not run against a live Postgres in this slice.
- Void of an expired mandate when the provider hold already expired.
- Agent API key provisioning and kill switch enforcement (seed script spec-11, kill switch spec-10).
- Owner approval of escalated intents (spec-09/10).
