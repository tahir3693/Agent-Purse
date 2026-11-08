# @agentpurse/web

Next.js App Router app (TypeScript) for AgentPurse, deployed on Vercel. The API is a separate Fastify service on Render. Vercel never builds or deploys it.

## Vercel project settings

| Setting                              | Value                                                             |
| ------------------------------------ | ----------------------------------------------------------------- |
| Root Directory                       | `web`                                                             |
| Framework Preset                     | Next.js                                                           |
| Build Command                        | `pnpm --filter @agentpurse/shared run build && pnpm run build`    |
| Install Command                      | default (Vercel detects pnpm from `pnpm-lock.yaml`)               |
| Output Directory                     | default (leave empty; Next.js manages `.next`)                    |
| Include files outside root directory | enabled (needed for `packages/shared` and the workspace lockfile) |
| Node.js version                      | 20.x or newer (Next.js 16 requires >= 20.9)                       |

The "No Output Directory named public" and "No entrypoint found which imports fastify" errors come from the Framework Preset being "Other". Set it to Next.js.

## Environment variables (names only)

| Name                              | Where                        | Purpose                                             |
| --------------------------------- | ---------------------------- | --------------------------------------------------- |
| `API_BASE_URL`                    | server only (route handlers) | Render API base URL used by the BFF                 |
| `NEXT_PUBLIC_API_BASE_URL`        | browser                      | Render API base URL for the direct SSE stream       |
| `NEXT_PUBLIC_AG_GRID_LICENSE_KEY` | browser                      | AG Grid / AG Studio license string (not an API key) |

`NEXT_PUBLIC_` values are inlined at build time, so set them in Vercel before building. No server secrets belong in this app. If a variable is missing, route handlers return an error that names it and the dashboard shows a notice. Nothing crashes, and values are never shown.

## Routes

- `/`: landing page. `/login` and `/register`: owner sign-in and sign-up.
- `/dashboard/*` (needs the session cookie, otherwise redirects to `/login`): overview, agents (one-time key dialog, kill switch, policy editor), intents (AG Grid), approvals, live monitor, vault.
- `POST /api/auth/register`: creates the owner account and never sets a cookie. `POST /api/vault/link-test-card`: links the Braintree sandbox test card with the fixed nonce `fake-valid-nonce`.
- `GET /api/health`: calls the API `GET /healthz`. It returns 200 with the upstream status, 502 if the API is down or slow, and 500 if `API_BASE_URL` is missing.
- `POST /api/auth/login`, `POST /api/auth/logout`: store or clear the owner JWT in the `ap_session` cookie (httpOnly, Secure, SameSite=Lax). The token never reaches browser JavaScript.
- `GET|POST|PUT /api/owner/...`: an allowlisted proxy to owner API routes with the cookie JWT as a Bearer token. Unknown paths return 404, and a missing cookie returns 401. Agent API keys pass through only on `POST agents` and are scrubbed from every other response.
- Live updates: the browser fetches a 60-second stream token through the proxy and opens `GET /events` directly on `NEXT_PUBLIC_API_BASE_URL`. Each reconnect gets a new token, with backoff from 1s up to 30s. After 3 failures the dashboard also polls every 2s. The API must list the Vercel URL in `WEB_ORIGIN` for CORS.

## Render cold starts

A sleeping Render instance can take up to about 60 seconds to answer the first request. The health, login and proxy routes set `maxDuration = 60` and wait up to 55 seconds for the API. Vercel plan limits may cap function duration. The first sign-in after idle may be slow.

## Local development

```sh
pnpm install
pnpm --filter @agentpurse/shared run build
pnpm --filter @agentpurse/web dev      # http://localhost:3000, needs API_BASE_URL in web/.env.local
pnpm --filter @agentpurse/web build    # next build
pnpm check:web-bundle                  # after a build: no server-only names in the browser bundle
```

`web/.env.local` is git-ignored. Put only the three names above in it.

## Later (spec-09)

AG Studio components are client-only. They load with `next/dynamic(() => import(...), { ssr: false })` inside a `"use client"` wrapper. The assistant goes through Next route handlers to the API's `POST /assistant`, and the browser never calls a model. Live updates use a stream token from `POST /api/owner/events/token` to open SSE directly to `NEXT_PUBLIC_API_BASE_URL/events`, with a fallback to polling every 2 seconds.
