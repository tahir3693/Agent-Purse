# Design Document

spec-06 Vault Linking

## Overview

`linkMethod` and `listMethods` services depend on a `VaultStore`, an `AuditStore` and the injected `PaymentProvider`. Routes are thin and authenticate an owner bearer JWT (HS256, `JWT_SECRET`, claim `sub` = ownerId). Prisma and in-memory stores satisfy the same interface.

## Architecture

```
api/prisma/schema.prisma   + VaultMethod
api/src/db/                + VaultStore (stores.ts, prisma.ts, memory.ts)
api/src/payments/          linkPaymentMethod result + optional cardType, last4 (types.ts, braintree/gateway.ts, provider.ts)
api/src/vault/
  schema.ts                zod bodies
  auth.ts                  verifyOwnerToken (node:crypto HS256), authenticateOwner
  service.ts               linkMethod, listMethods, toRedacted
  routes.ts                POST /vault/link, GET /vault/methods
  index.ts
  __tests__/
```

## Components and Interfaces

```ts
interface VaultMethodRecord { id; ownerId; customerId; token; cardType: string|null; last4: string|null; createdAt }
interface VaultStore {
  create(m): Promise<VaultMethodRecord>;            // unique (ownerId, token)
  findByOwnerAndToken(ownerId, token): Promise<VaultMethodRecord|null>;
  listByOwner(ownerId): Promise<VaultMethodRecord[]>;
}
interface RedactedMethod { id; cardType; last4; tokenRef; createdAt }
```

### linkMethod flow

1. Auth owner; body ownerId must equal it (else 403, no provider call).
2. `provider.linkPaymentMethod({ ownerId, nonce })`. Throw maps to 422 (`invalid_request`, `rejected`, `declined`) or 502, nothing stored.
3. If `(ownerId, token)` exists, return it. Else `create`; create failure audits `vault_persist_failed` and returns 502.
4. Audit `vault_linked` (ids only). Return `toRedacted`.

`tokenRef` is `"****" + last 4 chars of token`. The raw token never leaves the server.

## Data Models

VaultMethod: id uuid, ownerId, customerId, token, cardType?, last4?, createdAt; unique (ownerId, token). No FK to Agent (owners are not modelled yet).

## Error Handling

`ProviderError` codes map to HTTP status; messages are generic. Zod errors return field names only. Logger redacts `authorization` and `nonce`.

## Correctness Properties

### Property 1: Responses never contain secrets

For any stored method, serialized `toRedacted` output contains neither the raw token nor the customerId and has exactly the five redacted keys.

**Validates: Requirements 3.2, 3.3**

### Property 2: Failure leaves no records

For any provider failure, the store holds zero records afterwards.

**Validates: Requirements 2.1**

## Testing Strategy

Vitest and fast-check, no live calls. Fake provider and Braintree gateway fixtures (`fake-valid-nonce` succeeds, others fail). Fastify inject for routes. Log capture stream asserts no nonce, token or key.

## TODO(verify)

- Owner login/JWT issuance is a later slice; here the token is verified only.
- Provider success followed by DB failure leaves an unreferenced provider payment method (no delete in PaymentProvider).
- Braintree `cardType` and `last4` fields on the created payment method and customer paymentMethods.
- Intents still take the raw token as `paymentMethodRef`; resolving a vault `id` and checking ownership is a follow-up.
