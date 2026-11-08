---
inclusion: always
---

# Tech Stack and Engineering Rules

## Stack

Monorepo via pnpm workspaces. Node 20, TypeScript everywhere.

- /api: Fastify, PostgreSQL via Prisma, zod, SSE. Deployed on Render with managed Postgres.
- /web: Next.js (App Router, TypeScript) deployed on Vercel. AG Studio components are client components ("use client"; if they cannot render on the server, load with next/dynamic and ssr: false).
- /mobile: Expo (React Native), TypeScript, expo-router, expo-local-authentication. Talks to the Render API directly with a bearer token.
- /demo-agent: Node script, no UI.
- /packages/shared: shared types and zod schemas derived from the API contract.

## Web <-> API (Vercel to Render)

- Browser talks to Next.js route handlers (a thin BFF). On login the API returns a JWT; the route handler stores it in an httpOnly, secure, sameSite cookie on the Vercel domain and forwards it to the Render API as a Bearer token. No third-party cookies.
- Server-side env API_BASE_URL points at the Render API.
- Live updates: do NOT proxy long-lived SSE through Vercel functions. A route handler mints a short-lived stream token; the browser opens the SSE stream directly to the Render API (NEXT_PUBLIC_API_BASE_URL). If SSE is unreliable, fall back to polling every 2 seconds.
- API configures CORS to allow only the Vercel production URL and localhost (dev), via WEB_ORIGIN.
- API supports bearer-token auth for both web (via BFF) and mobile.

## AI provider

Abstraction RiskReviewer with switchable implementations via AI_PROVIDER = anthropic (default, ANTHROPIC_API_KEY) | gemini (GEMINI_API_KEY, default model gemini-3.8-flash) | off (no AI call; rules and price check only, reasons say "AI review disabled"). Model in AI_MODEL. If the AI call fails or times out, FAIL CLOSED: escalate to the human, never auto-approve. GEMINI_API_KEY is a server-only secret.

## Engineering working agreements

1. Spec-driven: one Kiro spec per slice. Show the design before executing tasks.
2. Never invent APIs. For PayPal, AG Studio, Channel3, Render, Vercel, read official docs / the Channel3 skill. If uncertain, put the call behind an interface, leave TODO(verify), and report it.
3. Never claim something works unless it was run. Report results and failures plainly.
4. Save credits: small targeted edits; read the real error before changing code; do not loop on the same failure more than twice - stop and summarize.
5. Commit after each slice with a clear message.
6. External provider code (PayPal, Channel3, AI) lives behind an interface; tests use recorded fixtures/responses, no live calls in tests.

## Payment provider (decision update)

Primary: Braintree Sandbox (a PayPal service; organizers confirmed it satisfies the PayPal requirement). The existing PayPal REST code (api/src/paypal/) is kept as an optional second provider. All payment code lives behind the provider-neutral PaymentProvider interface in api/src/payments/; no Braintree or PayPal types leak outside the adapters. PAYMENT_PROVIDER = braintree | paypal, default braintree. PAYPAL_* keys are optional and only required when PAYMENT_PROVIDER=paypal; missing PayPal keys must never break startup or tests.

Money flow: Approved intent -> Authorize (hold, no settlement) -> single-use mandate token (bound to authorizationId, amount, currency, payee) -> Capture (submit for settlement) -> Void (if the token expires or downstream execution fails).

## Environment variables (names only; values live in local .env, never committed)

API (Render): DATABASE_URL, JWT_SECRET, MANDATE_SIGNING_KEY, PAYMENT_PROVIDER (braintree|paypal, default braintree), BRAINTREE_ENV (sandbox), BRAINTREE_MERCHANT_ID, BRAINTREE_PUBLIC_KEY, BRAINTREE_PRIVATE_KEY, ANTHROPIC_API_KEY, AI_MODEL (claude-sonnet-5-5), CHANNEL3_API_KEY, WEB_ORIGIN, APP_BASE_URL.

Optional (only when PAYMENT_PROVIDER=paypal): PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_BASE_URL (= https://api-m.sandbox.paypal.com).

Web (Vercel): API_BASE_URL (server only), NEXT_PUBLIC_API_BASE_URL (SSE stream only), NEXT_PUBLIC_AG_GRID_LICENSE_KEY (replaces the old AG_GRID_LICENSE_KEY). NEXT_PUBLIC_ vars are inlined at build time - set them in Vercel before building.

Server-only secrets (CHANNEL3_API_KEY, BRAINTREE_PRIVATE_KEY, PAYPAL_CLIENT_SECRET, ANTHROPIC_API_KEY, JWT_SECRET, MANDATE_SIGNING_KEY) must never reach the web or mobile bundles.

If a variable is missing at runtime, name the variable and stop; never print key values or ask for them to be pasted.
## Quality gates

Tests must cover: budget math, single-use token, replay and tamper rejection, idempotency, webhook signature, fail-closed on AI error, CORS allows only the web origin. A fresh clone must run locally from the README alone. Both hosted URLs must work from a cold start with seeded data. No secrets in git history; MIT license detected by GitHub.

## Addendum (Nov 5)

- AI_MODEL default is claude-sonnet-5-5 (claude-3-5-sonnet is outdated).
- AG Grid license key is NOT an API key: it is a browser-side string in NEXT_PUBLIC_AG_GRID_LICENSE_KEY.
- AG Studio ships no LLM. Its assistant uses an adapter implementing executeTurn. Never call a model provider from the browser. The API exposes POST /assistant (bearer auth, rate limited) holding ANTHROPIC_API_KEY and streaming the reply; the AG Studio adapter reaches it via the Next.js backend routes.
- Before the dashboard slice, read AG Studio ai-quickstart and ai-adapter docs; report whether AG Grid offers a hosted model endpoint and whether the license key includes AI.
- Working mode: full Spec mode only for paypal-core, risk-guard, mandate-and-pay; normal chat mode for the other slices; same checkpoints; keep spec docs short.