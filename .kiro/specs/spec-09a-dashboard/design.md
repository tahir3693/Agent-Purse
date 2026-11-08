# Design Document

spec-09a Dashboard

## Overview

Owner dashboard in `/web` on top of the spec-04 BFF: register and login, protected `/dashboard/*` pages, agents and policy editor, AG Grid intents table, approvals, live monitor (SSE with polling fallback) and vault. Two small API changes: persist Risk Guard reason and price data in the decision audit, and tighten SSE CORS. The AG Studio assistant is out of scope (spec-09b). BFF handlers stay pure functions `(req, deps)`; live logic is a pure class with injected deps so vitest runs offline.

## Architecture

```
web/app/dashboard/layout.tsx          server component: cookies() has ap_session else redirect("/login"); nav + LiveProvider
web/app/dashboard/{page,agents,intents,approvals,live,vault}/page.tsx   client pages
web/app/register/page.tsx             client form; on 201 calls login
web/app/api/auth/register/route.ts    thin wrapper
web/app/api/vault/link-test-card/route.ts
web/lib/handlers/register.ts, linkTestCard.ts (+ __tests__); proxy.ts allowlist edit
web/lib/client/api.ts                 fetch wrapper for /api/owner/<path>; 401 -> navigate /login
web/lib/live/connection.ts            LiveConnection
web/lib/money.ts (existing), web/lib/policyForm.ts
web/components/grid/IntentsGrid.tsx   "use client", loaded via next/dynamic ssr:false
web/components/live/LiveProvider.tsx  React context
web/app/globals.css                   extended (dark, responsive)
api/src/risk/types.ts, combine.ts, intents/service.ts, index.ts, events/sse.ts   API changes
```

No middleware (Next 16 renamed it); protection is the server layout. Only API_BASE_URL, NEXT_PUBLIC_API_BASE_URL and NEXT_PUBLIC_AG_GRID_LICENSE_KEY are read. All text renders as React text nodes, never `dangerouslySetInnerHTML`.

## Components and Interfaces

### BFF additions

- `handleRegister(req, deps)`: `POST /api/auth/register` forwards to API `POST /auth/register`. 201 gives `{ok:true}`. 409 `email_taken` gives "An account with this email already exists". 400 returns the failing field names. 429 gives a rate-limit message. Network error gives 502. Never sets a cookie; the UI then calls login.
- `handleLinkTestCard(req, deps)`: `POST /api/vault/link-test-card`. No cookie gives 401. Decodes `sub` from the JWT payload without verifying (the API verifies) and posts `{ownerId: sub, nonce: "fake-valid-nonce"}` to API `POST /vault/link` with the Bearer token. The nonce is fixed server-side. Upstream errors keep their status and message.
- `vault/link` is removed from the generic proxy allowlist.

### Pages

- Overview: cards from `owner/stats` (Money_Display per currency, counts by decision with 0 default), sandbox honesty note always visible, error replaces cards only.
- Agents: list with policy summary (`agents/:id/policy`), create dialog showing `apiKey` once with a copy button (key lives only in dialog state, dropped on close), kill/restore using the returned status, policy editor with dollar inputs and inline errors linked by `aria-describedby`.
- Intents: `IntentsGrid` with sortable columns, state select sent as `?state=`, amount `valueFormatter` from cents, row click loads `owner/intents/:id` into a detail panel with audit events.
- Approvals: `owner/intents?state=escalated`, then detail per item for reason and price. Approve/Deny removes optimistically and restores on any error, including 409.
- Live: event list. Vault: methods list, "Link sandbox test card" button, Braintree sandbox note.
- Nav in the layout shows a live status pill (`aria-live="polite"`).

### Policy form (`lib/policyForm.ts`)

```ts
parseDollarsToCents(s: string): number | null   // /^\d{1,9}(\.\d{1,2})?$/, string parsing, no floats
centsToDollarString(c: number): string
validatePolicyForm(v): { policy } | { errors: Record<string, string> }
```

Lists are comma-separated strings, trimmed, empties removed. Velocity fields must be non-negative integers.

### AG Grid

Pin `ag-grid-react`, `ag-grid-community`, `ag-grid-enterprise` at 36.3.0 (the line `ag-studio-react@3.1.0` depends on). `IntentsGrid.tsx` registers modules, sets `LicenseManager` from `NEXT_PUBLIC_AG_GRID_LICENSE_KEY` when present, and uses `themeQuartz` with dark params matching `globals.css`. A missing key shows `EnvNotice` naming the variable; the grid still renders (watermark expected).

### Live monitor

```ts
interface LiveDeps {
  getToken(): Promise<string | null>
  createSource(url: string): EventSourceLike
  baseUrl: string | null
  timers: { setTimeout; clearTimeout; setInterval; clearInterval }
  onStatus(s: "connecting" | "live" | "reconnecting" | "offline"): void
  onEvent(e: LiveEvent): void
  onPoll(): void
}
class LiveConnection { start(): void; stop(): void }
```

- Status starts `connecting`, becomes `live` on open. On error the source is closed, status is `reconnecting`, and a retry runs after `min(1000 * 2^(n-1), 30000)` ms with a freshly fetched token per attempt.
- After 3 consecutive failures, polling starts every 2s and status is `offline`, until a successful open (polling stops, status `live`). A null `baseUrl` means `offline` plus polling.
- Listens to `intent.created|decided|authorized|captured|denied`. `stop()` closes the source and clears all timers.
- `LiveProvider` exposes `status`, the last 100 events, and a `version` counter bumped on each event and each poll tick. Pages refetch on `version` change, within 1s.

### API changes

- Decision audit: `RiskAuditMeta` gains optional `priceMedianCents` and `priceSampleSize`; `combine` passes `price.medianCents` and `sampleSize`. `riskMeta` in `intents/service.ts` adds `reason` (capped at 280; fixed templates from combine/rules, still untrusted on render), `priceStatus` (default `unknown`), `priceMedianCents`, `priceSampleSize`. It never includes justification or description. Returned through the existing `GET /owner/intents/:id` events meta.
- CORS: `index.ts` stops appending `http://localhost:3000`. `GET /events` sends `Access-Control-Allow-Origin` only when the Origin is in the `WEB_ORIGIN` list, never `Allow-Credentials`. No other route sends CORS headers.

## Data Models

No new tables. Audit event meta (JSON) gains `reason`, `priceStatus`, `priceMedianCents`, `priceSampleSize`. Client state is in-memory only; the agent API key is never persisted. Money is integer cents plus ISO currency everywhere; dollar strings exist only in form fields.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system, essentially a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Backoff and fresh token

For any sequence of consecutive connection failures, the reconnect delay for attempt n is `min(1000 * 2^(n-1), 30000)` ms, and every connect attempt uses a token freshly returned by `getToken`.

**Validates: Requirements 8.2**

### Property 2: Dollars and cents round trip

For any integer cents `c` in 0..10^11, `parseDollarsToCents(centsToDollarString(c)) === c`.

**Validates: Requirements 4.2**

### Property 3: Decision audit excludes intent text

For any intent and any decision, the decision audit meta does not contain the intent justification or description text.

**Validates: Requirements 7.1, 7.2, 7.3**

## Error Handling

BFF handlers map upstream status and message and return 502 on network errors; messages never include tokens or request bodies. Client wrapper sends the user to `/login` on 401. Failed mutations keep prior state and show an error beside the control. Missing env shows `EnvNotice` naming only the variable. A failed stream token or open counts as a connection failure.

## Testing Strategy

Vitest (node, offline, mocked fetch) with fast-check at 100+ runs for Properties 1 to 3, tagged `Feature: spec-09a-dashboard, Property N`. Example tests:

- `handleRegister`: 201, 409, 400 fields, 429, network 502, no cookie set.
- `handleLinkTestCard`: 401 without cookie, fixed nonce, ownerId from `sub`, upstream error mapping.
- Proxy allowlist no longer includes `vault/link`; agent key absent from list passthrough.
- `LiveConnection` with fake timers: backoff 1,2,4,8,16,30,30s; polling every 2s after 3 failures; polling stops on open; `stop()` clears everything.
- API: audit meta includes reason and price fields; CORS allowed, denied, no credentials, no other route sends headers.

Smoke: typecheck, lint, `next build` and the full suite pass with no network.

## TODO(verify)

- AG Grid v36 theming and license API names (check against installed types).
- License key validity and AI features (spec-09b).
- Vercel and Render CORS with real origins.
- SSE through Render proxy buffering.
