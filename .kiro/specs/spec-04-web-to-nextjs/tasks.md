# Implementation Plan

spec-04 web to Next.js. Offline tests, no secrets printed, existing tests stay green.

## Overview

Scaffold the Next.js app, then env and lib helpers, then pages, then BFF handlers with tests, then docs and deployment safety checks, then verify and commit.

## Tasks

- [x] 1. Scaffold the Next.js app
  - `web/package.json` with exact-pinned next, react, react-dom, `@agentpurse/shared` as `workspace:*`, `build` = `next build`; `next.config.mjs` (transpilePackages, poweredByHeader false); `tsconfig.json` (strict, bundler resolution); `next-env.d.ts`
  - Remove `web/src/index.ts` and the old tsc/dist setup; update root eslint and vitest configs so `web/**/__tests__` run in node and Next files lint cleanly
  - _Requirements: 1.1, 1.2, 1.3, 2.1_

- [x] 2. Env and lib helpers
  - `lib/env.ts` (getServerEnv, publicEnv with literal NEXT_PUBLIC_ references), `lib/api.ts` (fetchWithTimeout), `lib/session.ts` (cookie `ap_session`), `components/EnvNotice.tsx` naming the missing variable only
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 3. Pages
  - `app/layout.tsx`, landing page with tagline and Braintree sandbox (a PayPal service) and Channel3 honesty text, `login/page.tsx` client form posting to the BFF, `dashboard/page.tsx` placeholder; import MoneySchema from shared in non-Node-only code; no logos
  - _Requirements: 2.2, 2.3, 3.3, 4.1, 4.2, 4.3, 4.4_

- [x] 4. BFF handlers, route wrappers and tests
  - `lib/handlers/` health, login, logout, proxy (allowlist, segment validation, CSRF checks) taking `(req, deps)`; thin `route.ts` wrappers for health (maxDuration 60), auth/login, auth/logout, owner/[...path]
  - Vitest with mocked fetch: health success and failure, missing env names variable with no values, login cookie flags, failed login sets no cookie, logout expiry, proxy allowlist and 401
  - fast-check: Property 1 proxy gate, Property 2 JWT never in a body, Property 3 health mapping, tagged `Feature: spec-04-web-to-nextjs, Property N`
  - _Requirements: 3.2, 5.1-5.5, 6.1-6.7, 8.1, 8.2_

- [x] 5. README and deployment safety checks
  - `web/README.md` with Vercel settings (Root Directory `web`, Framework Preset Next.js), variable names only, 60s cold start note
  - Test that `web/` has no backend entrypoint files or API-only dependencies; script/test that scans `.next` client output for server secret names
  - _Requirements: 3.4, 7.1, 7.2, 7.3_

- [ ] 6. Verify gates and commit
  - `pnpm -r run typecheck`, `pnpm lint`, `pnpm --filter @agentpurse/shared run build && pnpm --filter @agentpurse/web run build` (next build), `pnpm test`, `pnpm check:env-example`
  - Commit per git rules: stage by explicit path, check staged file names for secrets (names only, never values), clear message, no push
  - _Requirements: 1.3, 8.3_

## Notes

- Never print passwords, keys or tokens. Do not run live calls or smoke scripts.
- Tests with `*` are not used here; tests live inside their tasks.
- TODO(verify): exact Next.js version, Vercel monorepo install from Root Directory `web`.

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
