# Design Document

spec-06b Owner and Agents

## Overview

New `owners/` module (accounts, agents, policy, reads), `events/` (bus and SSE), and changes to `intents/`. Stores gain methods; Prisma and in-memory fakes stay in sync. Owner routes reuse the spec-06 bearer JWT (`vault/auth.ts`), extended with an optional scope claim.

## Architecture

```
api/prisma/schema.prisma   + Owner; Agent.ownerId?, name
api/prisma/migrations/     + <ts>_owner_and_agents (generated with migrate diff)
api/src/db/                OwnerStore, AgentAdminStore, IntentStore.listByAgents, VaultStore.findByIdForOwner
api/src/owners/
  password.ts              scrypt hash/verify (node:crypto), constant-time
  tokens.ts                signOwnerToken, signStreamToken (scp:"sse")
  rateLimit.ts             in-memory sliding window
  accounts.ts              register, login
  agents.ts                create/list/kill/restore, get/set policy
  reads.ts                 listIntents, getIntent, stats
  routes.ts
api/src/events/            bus.ts (publish/subscribe per owner), sse.ts (routes)
api/src/intents/           resolve vault id, approve/deny, GET /intents/:id, POST /intents/:id/mandate
api/src/seed/demo.ts       seedDemo(deps) + CLI
```

## Components and Interfaces

```ts
OwnerStore { create({email,passwordHash}); findByEmail(email); findById(id) }
AgentAdminStore { create({ownerId,name,apiKeyHash}); listByOwner(ownerId); getForOwner(id,ownerId);
                  setKilled(id,ownerId,killed); setPolicy(agentId,policy,riskConfig) }
IntentStore += listByAgents(agentIds,{state?,since?,limit})
VaultStore  += findByIdForOwner(id, ownerId)
AgentRecord += ownerId?: string|null, name?: string
EventPublisher { publish(ownerId, {type, intentId, state?}) }
```

Auth: `verifyOwnerToken(token, secret, now, {scope?})`; access tokens carry no `scp`, stream tokens carry `scp:"sse"`, each rejected by the other path.

### Flows

- **Intent create:** auth agent (needs ownerId) -> resolve `paymentMethodRef` via `findByIdForOwner(ref, agent.ownerId)`; none => 422 before any persistence. Intent stores the vault id; authorize receives the resolved token.
- **Approve:** owner owns agent of intent, state `escalated` -> resolve method, authorize, store Authorization, state `authorized`, audit `owner_approved`. Failure => `failed`, 502. **Deny:** state `denied`, audit `owner_denied`.
- **Mandate for agent:** `POST /intents/:id/mandate` (state `authorized`) issues a 5-minute mandate; `GET /intents/:id` returns state and decision.
- **SSE:** `POST /events/token` -> 60s token; `GET /events?stream_token=` verifies scope, subscribes to the owner's channel, heartbeats every 25s, cleans up on close. Logger serializer drops the query string.
- **Root status:** `GET /` (and `HEAD /`) registered in `api/src/index.ts` server setup, unauthenticated, returns `{"name":"agentpurse-api","status":"ok"}` with no config values.
- **Login:** limiter key `ip|email`, 5 attempts per 15 minutes; unknown email still runs a dummy scrypt verify.

## Data Models

Owner: id, email (unique, lowercased), passwordHash, createdAt. Agent: + ownerId (nullable FK, so existing rows migrate), name. Queries always filter by ownerId, so null never matches an owner.

## Error Handling

Generic messages; zod errors return field names only; typed error classes carry status codes. No passwords, hashes, keys, tokens or stream tokens in logs, audit or responses.

## Correctness Properties

### Property 1: Ownership isolation

For any two owners, every read and write by owner A on an id belonging to owner B returns 404 and changes nothing.

**Validates: Requirements 2.5, 4.2**

### Property 2: Raw tokens are never accepted as payment method

For any string that is not an id of the owner's vault method, intent creation returns 422 and persists nothing.

**Validates: Requirements 3.1, 3.2**

## Testing Strategy

Vitest and fast-check, in-memory stores, fake provider and fake risk, fake clock. Fastify inject for routes; SSE tested over a real `listen` on port 0 with fetch streaming. Scrypt cost is lowered via injected params in tests. Log capture asserts no secrets.

## TODO(verify)

- scrypt (owner-approved) instead of argon2/bcrypt; N=2^15, r=8, p=1.
- In-memory rate limiter and event bus are single-instance only.
- Open registration on a public deployment.
- Approve places the hold immediately; holds can expire before the agent asks for a mandate.
- Prisma stats use in-process aggregation over a bounded window.
