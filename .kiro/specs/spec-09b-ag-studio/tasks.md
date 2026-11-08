# Implementation Plan

spec-09b AG Studio dashboard and read-only assistant. Offline tests, no secrets printed, existing tests stay green.

## Overview

Build the API assistant and the web adapter in parallel, then the BFF route and Studio page, then docs, then verify and commit.

## Tasks

- [x] 1. API assistant endpoint
  - `OwnerReadDeps` narrowing so tools only get read access scoped to the JWT owner
  - Tools registry with exactly four Read_Tools: list intents, get stats, list agents and policies, explain escalated or denied intent; unknown tool returns a tool error; cross-owner id returns not-found; no write tools
  - Model interface plus Anthropic model (ANTHROPIC_API_KEY, AI_MODEL; missing key names the variable and returns 503); service loop accepting only user and assistant text messages, ignoring client tools and system messages, treating tool results and intent text as data; fixed failure message on LLM error or timeout
  - `POST /assistant` NDJSON streaming route with owner JWT auth (401), per-owner rate limit (429), wiring in the server and config
  - Tests with a stub model: 401, 429, ignored client tools and system messages, fail-closed on error and timeout, tool set is read-only, cross-owner not-found, prompt-injection cases (approve, deny, kill) change no state; fast-check Property 1, tagged `Feature: spec-09b-ag-studio, Property 1`
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 8.2, 8.3, 8.4_

- [x] 2. Web BFF assistant route
  - `web/app/api/assistant/route.ts` handler: 401 without `ap_session`, forwards the body to API `POST /assistant` with the JWT as Bearer, streams the response back, no LLM call or key in web code
  - Tests (vitest): missing session returns 401, Bearer forwarded, stream passed through, API error status mapped
  - _Requirements: 4.3, 4.5_

- [x] 3. Web assistant adapter
  - `AgLlmAdapter` with `executeTurn`: converts AG Studio input to user and assistant text messages, posts to `/api/assistant`, parses NDJSON into `AgAiEvent` values, cancels the request when `signal` aborts, maps HTTP and stream errors to an error event
  - Tests with a stubbed BFF response: streamed events, abort, error mapping; fast-check Property 2, tagged `Feature: spec-09b-ag-studio, Property 2`
  - _Requirements: 4.2, 4.4, 8.1_

- [x] 4. Studio page, widgets, theme and layout
  - Pin `ag-studio` and `ag-studio-react` at exact `3.1.0`
  - Data store fetching `GET /owner/stats` and escalated intents through the BFF; aggregates for spend per day and decision counts with 0 for missing decisions, Money_Display from integer cents; fast-check Property 3, tagged `Feature: spec-09b-ag-studio, Property 3`
  - Layout load/save to localStorage, Default_Layout with the three widgets, Reset layout, unparseable state falls back to default
  - Custom widgets via `createWidgets`: spend per day, decisions breakdown, escalation queue (Approve and Deny through the existing proxy, optimistic remove, restore with error on failure); error message on fetch failure; intent text as plain text
  - Dark theme with `studioTheme.withParams`; `StudioDashboard` with AgStudioProvider, AgStudioAiModule and `createAiHarness` with `directLlmRunner` using the adapter; `StudioView` loaded with `next/dynamic` and `ssr: false`; message naming NEXT_PUBLIC_AG_GRID_LICENSE_KEY when missing
  - `/dashboard/studio` page (redirect to `/login` without session) and a nav link; spec-09a pages unchanged
  - Tests: aggregates, missing-variable message, layout fallback and reset, escalation restore on failure, text rendered without HTML
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1_

- [x] 5. README trial licence section
  - State the AG Studio key is a trial licence expiring 20 December 2026 (watermark or banner expected after), evaluation only, no key value
  - Record that AG Grid offers no production hosted model endpoint and that AI licence inclusion is confirmed by the browser console
  - _Requirements: 7.1, 7.2, 7.3_

- [x] 6. Verify gates and commit
  - `pnpm -r run typecheck`, `pnpm lint`, `pnpm --filter @agentpurse/web run build` (`next build`), `pnpm test`, `pnpm check:env-example`, `pnpm check:web-bundle`, secret scan
  - Commit "feat(web): AG Studio dashboard and assistant (spec-09b)": stage by explicit path, check staged file names for secrets (names only, never values), confirm `.env` is not staged, no push
  - _Requirements: 1.5, 8.5_

## Notes

- Never print keys or tokens. No live calls in tests.
- Tests with `*` are not used here; tests live inside their tasks.
- design.md was not found when this file was written; Property 1, 2 and 3 are mapped from the task brief. Confirm the numbering against the design.
- TODO(verify): AG Studio 3.1.0 API names, whether the licence key includes AI, live assistant against Render.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "3"] },
    { "id": 1, "tasks": ["2", "4"] },
    { "id": 2, "tasks": ["5"] },
    { "id": 3, "tasks": ["6"] }
  ]
}
```
