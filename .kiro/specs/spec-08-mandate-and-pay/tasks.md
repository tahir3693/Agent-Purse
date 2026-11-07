# Implementation Plan

spec-08 intent-to-execution pipeline. Stores behind interfaces, no live calls in tests, secrets never printed.

## Overview

Schema and stores first, then mandate tokens and DB webhook dedupe in parallel, then the intent and execute services, then routes and wiring, then tests, then verification.

## Tasks

- [x] 1. Prisma schema, client and stores
  - Add pinned prisma and @prisma/client to api; api/prisma/schema.prisma per design; api/src/db/ with store interfaces, Prisma implementations and in-memory fakes; `prisma generate` script; DATABASE_URL in .env.example (do not overwrite the file, append only if missing)
  - _Requirements: 4.1, 5.1_

- [x] 2. Mandate token and service
  - mandates/token.ts (HS256 sign/verify, alg pinning, constant-time compare, 5 minute exp cap), mandates/service.ts (issue, atomic consume)
  - _Requirements: 2.1, 2.2, 3.1, 3.2_

- [x] 3. Database webhook dedupe
  - Replace SeenKeyStore with async WebhookEventStore.claim; update payments/routes.ts, server.ts and the existing webhook tests; update Authorization status from verified events
  - _Requirements: 4.2, 4.3, 4.4_

- [x] 4. Intent and execute services
  - intents/schema.ts, intents/service.ts (createIntent, executeIntent) per design flows, audit rows, void on failure paths
  - _Requirements: 1.1-1.3, 1.5, 2.3, 3.3-3.6_

- [x] 5. Routes, auth and server wiring
  - intents/auth.ts, intents/routes.ts, buildServer options, index.ts building Prisma stores, provider and Risk Guard from env; missing DATABASE_URL or MANDATE_SIGNING_KEY names the variable and exits 1
  - _Requirements: 1.4, 3.6, 4.4, 5.1_

- [x] 6. Tests
  - Unit and route tests per design Testing Strategy; property tests (Properties 1-3) tagged `// Feature: spec-08-mandate-and-pay, Property N: ...`
  - _Requirements: 5.2_

- [x] 7. Verify gates
  - pnpm -r run typecheck, pnpm lint, pnpm build, pnpm test
  - _Requirements: 5.2_

## Notes

- Money stays in integer cents. Provider types stay in adapters.
- TODO(verify): live Postgres migration, expired hold void, agent key provisioning.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2", "3"] },
    { "id": 2, "tasks": ["4"] },
    { "id": 3, "tasks": ["5"] },
    { "id": 4, "tasks": ["6"] },
    { "id": 5, "tasks": ["7"] }
  ]
}
```
