# Design Document

spec-04 Web to Next.js

## Overview

Replace the `/web` placeholder with a Next.js App Router app (TypeScript, strict). Pages are static placeholders. A thin BFF (login, logout, health, allowlisted proxy) keeps the owner JWT in an httpOnly cookie on the Vercel domain. Handlers are pure functions taking `(req, deps {fetch, env})`; `route.ts` files are thin wrappers, so vitest runs them without a Next server. Vercel settings: Root Directory `web`, Framework Preset Next.js, build command `pnpm --filter @agentpurse/shared run build && pnpm run build`.

## Architecture

```
web/package.json        next (exact pin), react, react-dom, @agentpurse/shared "workspace:*"; build = next build
web/next.config.mjs     transpilePackages ["@agentpurse/shared"], poweredByHeader false
web/tsconfig.json       Next defaults, strict, moduleResolution bundler (replaces dist build setup)
web/next-env.d.ts
web/app/layout.tsx, page.tsx, login/page.tsx ("use client" form), dashboard/page.tsx (placeholder)
web/app/api/health/route.ts            runtime nodejs, maxDuration 60, force-dynamic
web/app/api/auth/login/route.ts, logout/route.ts
web/app/api/owner/[...path]/route.ts   GET, POST, PUT -> proxy
web/lib/env.ts          getServerEnv, publicEnv
web/lib/api.ts          fetchWithTimeout (AbortSignal.timeout)
web/lib/session.ts      cookie "ap_session"
web/lib/handlers/       health.ts, login.ts, logout.ts, proxy.ts (+ __tests__)
web/components/EnvNotice.tsx
```

Removed: `web/src/index.ts` and the tsc-to-dist config. No `server.js`, `index.js`, `app.js`, or root-level `api/` directory in `web/` (Vercel would treat them as backend entrypoints); route handlers under `app/api` are fine. No fastify, express or prisma dependency.

## Components and Interfaces

```ts
type ServerEnv = { ok: true; apiBaseUrl: string } | { ok: false; missing: "API_BASE_URL" }
Deps = { fetch: typeof fetch; env: () => ServerEnv }
handleHealth(req, deps): Response
handleLogin(req, deps): Promise<Response>
handleLogout(req): Response
handleProxy(req, path: string[], deps): Promise<Response>
```

`publicEnv` reads `process.env.NEXT_PUBLIC_API_BASE_URL` and `process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY` as literal references so Next inlines them; `EnvNotice` renders the variable name when one is empty. `@agentpurse/shared` is imported (MoneySchema) only in code that avoids Node-only exports.

### Flows

- **Health:** `GET /healthz` at API_BASE_URL with a 55s timeout. 2xx gives 200 `{ok:true, upstreamStatus, body}` with body cut to 200 chars. Failure gives 502 `{ok:false, reason:"unreachable"|"timeout"|"upstream_error", upstreamStatus?}`. Missing env gives 500 `{ok:false, error:"Missing required environment variable: API_BASE_URL"}` with no upstream call.
- **Login:** minimal body check (`email`, `password` strings), `POST /auth/login`. On 2xx set cookie `ap_session` (httpOnly, secure, sameSite lax, path `/`, expires = `expiresAt`) and return `{ok:true, ownerId, expiresAt}`, never the token. On 400/401/429 return the same status with a generic message; network error returns 502.
- **Logout:** `POST` expires the cookie (`maxAge 0`).
- **Proxy:** no cookie gives 401, no upstream call. Path not allowlisted gives 404, no upstream call. Otherwise forward with `Authorization: Bearer <cookie JWT>`, return upstream status and JSON body, drop upstream `set-cookie`, add `Cache-Control: no-store`.

### Proxy allowlist

Path segments must match `[A-Za-z0-9_-]+`; `..` and empty segments are rejected. The query string is forwarded only for `owner/intents`.

| Method | Paths |
| --- | --- |
| GET | `agents`, `agents/:id/policy`, `owner/intents`, `owner/intents/:id`, `owner/stats`, `vault/methods` |
| POST | `agents`, `agents/:id/kill`, `agents/:id/restore`, `intents/:id/approve`, `intents/:id/deny`, `events/token`, `vault/link` |
| PUT | `agents/:id/policy` |

Mutating methods require `content-type: application/json`; if an `Origin` header is present it must match the request host (CSRF defense on top of sameSite lax).

### Later slices (spec-09)

- AG Studio is loaded with `next/dynamic({ ssr: false })` inside a `"use client"` wrapper. The license key comes from `NEXT_PUBLIC_AG_GRID_LICENSE_KEY`. The assistant goes through Next route handlers to API `POST /assistant`; the browser never calls a model.
- Live updates: the browser gets a stream token via proxy `POST events/token`, then opens SSE directly to `NEXT_PUBLIC_API_BASE_URL/events`. Fallback is polling every 2s.

## Data Models

No persistence. Session state is the cookie only (JWT value, expiry from `expiresAt`). Server secrets are never referenced in `web/`, and the build output is searched for their names.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system, essentially a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Proxy gate

For any HTTP method, path and cookie presence, the upstream fetch is called only when the request is allowlisted and the cookie is present, and then it carries the cookie JWT as a Bearer token. Otherwise the response is 404 (not allowlisted) or 401 (no cookie) and fetch is never called.

**Validates: Requirements 6.5, 6.6, 6.7**

### Property 2: JWT never leaves in a body

For any JWT string and any upstream response body, the login and proxy response bodies and all response headers other than the httpOnly Set-Cookie do not contain the JWT.

**Validates: Requirements 6.1, 6.2**

### Property 3: Health mapping

For any upstream status and body, health returns 200 with a body of at most 200 characters when the status is 2xx, and 502 with the upstream status otherwise.

**Validates: Requirements 5.3, 5.4**

## Error Handling

Missing env: server handlers name only the variable (never values) and keep serving. Pages render `EnvNotice` instead of crashing. Login failures are generic and never reveal which credential was wrong. Upstream network errors map to 502. Errors never include the token or request bodies.

## Testing Strategy

Vitest (root config includes `web/**/__tests__`, environment node) with mocked `fetch`, no live calls. fast-check covers Properties 1 to 3 (100+ runs each, tagged `Feature: spec-04-web-to-nextjs, Property N`). Example tests cover cookie flags on login, failed login sets no cookie, logout expiry, missing env (name only, no values), and health success and failure. Smoke checks: `next build` exit 0, the client bundle contains no server secret names, `web/` has no backend entrypoint files. Root typecheck, lint and the full suite must still pass.

## TODO(verify)

- Exact Next.js version to pin, and Vercel pnpm monorepo install from Root Directory `web` (needs "Include files outside root directory" enabled).
- Render cold starts may take up to 60s; Vercel `maxDuration` 60 may depend on plan.
- API CORS for the SSE origin (WEB_ORIGIN) is needed in spec-09.
- Secure cookie on `http://localhost` in dev (browsers treat localhost as secure).
- Origin/content-type CSRF check is a minimal defense.
