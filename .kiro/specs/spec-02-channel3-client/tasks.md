# Implementation Plan

spec-02 Channel3 Client. Module at /api/src/channel3/ wrapping @channel3/sdk, server-side only. Tests use fixtures (no live calls).

## Overview

Seven tasks build the Channel3 module bottom-up: SDK + types, client/search/retrieve, resilience + priceCheck, smoke script, fixture unit tests, property tests, then verification.

## Tasks

- [x] 1. Install SDK and add module scaffolding
  - Add `@channel3/sdk` dependency to `api/package.json`; run install
  - Create `api/src/channel3/types.ts` (Channel3Price/Offer/Product, PriceCheckResult) and `api/src/channel3/money.ts` (majorToCents, centsToMajor)
  - _Requirements: 1.1, 4.4_

- [x] 2. Implement client builder and core calls
  - `client.ts`: `buildChannel3Client(env)` throws a named error for missing/blank `CHANNEL3_API_KEY` (never prints value)
  - `search.ts`: `searchProducts({ query, maxPriceCents?, limit? })` maps maxPriceCents to filters.price.max_price (major units), default limit 5, empty page -> []
  - `product.ts`: `getProduct(productId)` via retrieve; surfaces not-found
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 8.1_

- [x] 3. Implement resilience + priceCheck
  - `withResilience.ts`: 8s timeout + one retry
  - `priceCheck.ts`: optional `productId` -> compare that product's offers via getProduct; else title search. Same-currency in-stock offers only, convert to cents, median, bestOffer = lowest. `PRICE_BANDS = { high: 1.30, low: 0.70 }` named constant. Error/empty/timeout -> unknown (sampleSize 0), never throws
  - `index.ts`: `createChannel3Module({ client })` factory + re-exports
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3_

- [x] 4. Smoke script + pnpm script
  - `smoke.ts`: reads argv[2] query, builds client, prints top 5 (title | domain | price currency), never prints key; missing key -> print variable name only, exit 1
  - Add `channel3:smoke` to `api/package.json` loading root .env via `node --env-file=../.env` (dotenv fallback); mirror at root so `pnpm channel3:smoke "..."` works
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 5. Unit tests (fixtures, no live calls)
  - Fixtures under `__tests__/fixtures`; stub Channel3SdkLike
  - Cover: search mapping (max_price = cents/100, default limit), empty -> []; priceCheck bands ok/high/low at boundaries; currency filter excludes mismatches; productId path uses getProduct; error/timeout -> unknown with retry-once; smoke logger never emits the key
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.1_

- [x] 6. Property tests (fast-check, >=100 iters)
  - Property 1: priceCheck total/well-typed (status in set; sampleSize = same-currency in-stock count). Tag: `// Feature: spec-02-channel3-client, Property 1: priceCheck total and well-typed`
  - Property 2: money round-trip `majorToCents(centsToMajor(c)) === c`. Tag: `// Feature: spec-02-channel3-client, Property 2: money conversion round-trips`
  - _Requirements: 4.1, 4.3, 4.4, 5.1_

- [x] 7. Verify gates
  - Run typecheck, build, lint, `vitest run`; fix failures
  - _Requirements: 7.4_

## Notes

- Tests use fixtures / a stubbed SDK; no live network calls. Real CHANNEL3_API_KEY stays in local .env and is never read, printed, or copied.
- Verdict thresholds live in one constant PRICE_BANDS = { high: 1.30, low: 0.70 }.
- priceCheck prefers an exact productId (free retrieve) and falls back to title search only when absent.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3"] },
    { "id": 3, "tasks": ["4", "5", "6"] },
    { "id": 4, "tasks": ["7"] }
  ]
}
```