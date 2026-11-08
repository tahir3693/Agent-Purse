# Implementation Plan

spec-09a owner dashboard. Offline tests, no secrets printed, existing tests stay green.

## Overview

Make the API changes, add the BFF routes and client libraries in parallel, build auth and layout, then the pages, then verify and commit.

## Tasks

- [x] 1. API changes: decision audit and CORS
  - Decision audit meta written when Risk Guard decides: `reason` capped at 280 characters, `priceStatus`, `medianCents`, `sampleSize`; `priceStatus` is `unknown` when no price check ran; `GET /owner/intents/:id` returns the meta in events
  - CORS: allow only origins listed in WEB_ORIGIN, without credentials, on `GET /events` only; no allow-origin header for unlisted origins; no CORS headers on any other route; no origin hard-coded
  - Tests: reason cap, price fields present and `unknown` default, meta returned by owner intent detail, CORS allowed/unlisted/other-route cases; fast-check Property 3, tagged `Feature: spec-09a-dashboard, Property 3`
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 11.1, 11.2_

- [x] 2. BFF additions
  - Route handlers in `web/` for register (`POST /auth/register`, 409 `email_taken` and 400 field errors mapped distinctly) and link-test-card (`POST /vault/link` with nonce `fake-valid-nonce`); update the proxy allowlist for the new paths; Proxy_Route clears the session cookie on API 401
  - Tests (vitest): missing session returns 401, agent apiKey absent from list responses, API errors mapped to status and message, register and link routes, allowlist
  - _Requirements: 1.1, 1.5, 3.2, 9.2, 11.3_

- [x] 3. Client libraries and LiveProvider
  - `web/lib/client/api.ts`: typed fetch helpers for BFF routes with error mapping
  - `web/lib/policyForm.ts`: dollars to integer cents (reject negative or more than 2 decimals), non-negative integer velocity checks, field errors; fast-check Property 2, tagged `Feature: spec-09a-dashboard, Property 2`
  - `web/lib/live/connection.ts`: stream token fetch, EventSource open on NEXT_PUBLIC_API_BASE_URL, backoff 1s doubling capped at 30s, new token per attempt, polling every 2s after 3 failed attempts, single status of connecting/live/reconnecting/offline; fake-timer tests for backoff growth, cap, new token per attempt and polling; fast-check Property 1, tagged `Feature: spec-09a-dashboard, Property 1`
  - `LiveProvider` React context exposing status, events and refresh signals
  - _Requirements: 3.2, 4.2, 4.3, 4.4, 8.1, 8.2, 8.3, 8.5, 10.4, 10.5, 11.4_

- [x] 4. Auth pages, dashboard layout and route protection
  - `/login` and `/register` pages with labelled fields, distinct messages for 401, 429, 409 and 400, redirect to `/dashboard` on success
  - Dashboard layout with nav, sign out, sandbox statement, LiveProvider; route protection redirecting `/dashboard` paths to `/login` without a session cookie
  - Dark theme styles shared with the landing page, visible focus, no horizontal scroll at 360px, no emojis or logos; missing-env message naming only the variable
  - Tests: login/register error mapping, redirect when no cookie
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 10.1, 10.2, 10.3, 10.4_

- [x] 5. Overview, agents and vault pages
  - Overview: `GET /owner/stats` cards per currency, decision counts defaulting to 0, sandbox statement, error state keeping the statement
  - Agents: list, create dialog showing `apiKey` once with copy button and not retained, kill/restore, policy editor using `policyForm` with inline linked errors and no API call when invalid
  - Vault: list methods, "Link sandbox test card", API error keeps list, Braintree sandbox statement
  - Tests: component tests for zero counts, key shown once, invalid policy makes no call, link failure keeps list
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.4, 4.5, 9.1, 9.2, 9.3, 9.4_

- [x] 6. Intents grid, approvals queue and live page
  - Intents grid with `ag-grid-react` and `ag-grid-community` pinned at exact `36.3.0`, loaded by `next/dynamic` with `ssr: false`, license from NEXT_PUBLIC_AG_GRID_LICENSE_KEY (message naming the variable when missing, grid still renders), dark theme, sorting, state filter, Money_Display amounts, detail panel with audit events
  - Approvals queue for escalated intents: payee, amount, justification, reason, risk score, price check as plain text; optimistic remove, restore with error on failure including 409
  - Live page: status with aria-live region, event list, refresh of stats and grid within 1 second of an event
  - Tests: Money_Display, approvals optimistic restore on 409, text rendered without HTML
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 8.3, 8.4_

- [x] 7. Verify gates and commit
  - `pnpm -r run typecheck`, `pnpm lint`, `pnpm --filter @agentpurse/web run build` (`next build`), `pnpm test`, `pnpm check:env-example`, `pnpm check:web-bundle`, secret scan
  - Commit "feat(web): owner dashboard (spec-09a)": stage by explicit path, check staged file names for secrets (names only, never values), confirm `.env` is not staged, no push
  - _Requirements: 10.5, 11.5_

## Notes

- Never print keys or tokens. No live calls in tests.
- Tests with `*` are not used here; tests live inside their tasks.
- design.md was not found when this file was written; Property 1, 2 and 3 are mapped from the task brief. Confirm the numbering against the design.
- TODO(verify): AG Grid 36.3.0 API and license behavior, live SSE against Render.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2", "3"] },
    { "id": 1, "tasks": ["4"] },
    { "id": 2, "tasks": ["5", "6"] },
    { "id": 3, "tasks": ["7"] }
  ]
}
```
