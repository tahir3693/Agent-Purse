# Implementation Plan

spec-06 vault linking. No live calls in tests; secrets never printed.

## Overview

Provider seam, schema and stores first, then service, auth and routes with wiring, then tests, then verification.

## Tasks

- [x] 1. Provider seam, schema and stores
  - Add optional cardType and last4 to the linkPaymentMethod result (types.ts, braintree gateway types and provider only; PayPal unchanged); VaultMethod in schema.prisma plus prisma generate; VaultStore in db/stores.ts, prisma.ts, memory.ts
  - _Requirements: 4.1, 1.5_

- [x] 2. Service, owner auth, routes and wiring
  - vault/schema.ts, auth.ts, service.ts, routes.ts, index.ts; buildServer `vault` option; index.ts wiring (JWT_SECRET required, length >= 32, name only)
  - _Requirements: 1.1-1.5, 2.1-2.3, 3.1-3.3_

- [x] 3. Tests
  - Per design Testing Strategy; property tests (Properties 1-2) tagged `// Feature: spec-06-vault-linking, Property N: ...`
  - _Requirements: 4.2_

- [x] 4. Verify gates
  - pnpm -r run typecheck, pnpm lint, pnpm build, pnpm test
  - _Requirements: 4.2_

## Notes

- Raw tokens, nonces and customer ids never appear in responses or logs.
- TODO(verify): owner login, orphaned provider method on DB failure, Braintree card fields, vault id resolution in intents.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3"] },
    { "id": 3, "tasks": ["4"] }
  ]
}
```
