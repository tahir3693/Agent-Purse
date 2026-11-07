# Implementation Plan

spec-06b owner accounts, agents, approvals, SSE. Offline tests, no secrets printed, existing tests stay green.

## Overview

Schema and stores first, then owner accounts and agents, then intent changes and owner reads, then SSE, then seed and wiring, then verification.

## Tasks

- [x] 1. Schema, migration and stores
  - Owner model, Agent.ownerId and name, generated migration (migrate diff from the committed schema), store interfaces, Prisma and in-memory implementations, `db:migrate` script
  - _Requirements: 7.2_

- [x] 2. Owner accounts and agent management
  - owners/password, tokens, rateLimit, accounts, agents, routes; scope support in vault/auth; tests
  - _Requirements: 1.1-1.3, 2.1-2.5_

- [x] 3. Intent safety, approvals and owner reads
  - Vault id resolution, approve/deny, agent GET and mandate routes, owner reads and stats; update existing intent tests; tests
  - _Requirements: 3.1-3.3, 4.1-4.3, 5.1-5.3_

- [x] 4. Live feed
  - events/bus, SSE route, stream token, publisher hooks in the intent flows, query-string log redaction; tests
  - _Requirements: 6.1-6.3_

- [x] 5. Seed script and wiring
  - seed/demo.ts and `seed:demo` script, index.ts wiring (owners, events), render and docs note for the migration command, GET / status route; tests for seedDemo and GET /
  - _Requirements: 7.1, 7.2, 8.1-8.2_

- [x] 6. Verify gates
  - Isolation and property tests, then pnpm -r run typecheck, pnpm lint, pnpm build, pnpm test
  - _Requirements: 7.3_

## Notes

- Never print passwords, keys or tokens. Do not run the seed or smoke scripts.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3"] },
    { "id": 3, "tasks": ["4"] },
    { "id": 4, "tasks": ["5"] },
    { "id": 5, "tasks": ["6"] }
  ]
}
```
