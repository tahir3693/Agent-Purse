# AGENTPURSE: COMPLETE BUILD PROMPT (v2, for Kiro)

Save this file as `docs/MASTER_PROMPT.md` in the repo. It is the **single source of truth** and **replaces** any earlier master or kickoff prompt. Read it completely before doing anything.

You are the lead engineer building **AgentPurse** for the "Build What's Next with PayPal and AI" hackathon on Devpost. Hard deadline: **Nov 12, 2026, 12:00 pm PST** (Nov 13, 1:00 am in Pakistan). About 7 days remain. Work spec-first, keep scope tight, and prioritize a **working end-to-end demo** over breadth.

---

## 0. Current state (do not redo finished work)

- **Spec 01 (scaffold) is already done and verified:** pnpm workspace with `/api`, `/web`, `/mobile`, `/demo-agent`, `/packages/shared`; `.gitignore`, MIT `LICENSE`, `.env.example`, README stub; API with `/healthz`; lint, typecheck, build and tests passing; `render.yaml` exists.
- **Two things change from the scaffold:** (1) `/web` becomes a **Next.js** app deployed on **Vercel**; (2) `render.yaml` keeps only the API web service and Postgres (remove any static-site service for the web app).
- Not done yet: steering files, Channel3 skill and module, PayPal module, everything else.

---

## 1. Working agreements

1. **Spec-driven.** One Kiro spec per slice (section 13). Show me each design before executing its tasks.
2. **Never invent APIs.** For PayPal, AG Studio, Channel3, Render and Vercel, read the official docs and the Channel3 skill. If a detail is uncertain, put the call behind an interface, leave `TODO(verify)`, and tell me.
3. **Never claim something works unless you ran it.** Report results and failures plainly.
4. **Save credits.** Small targeted edits. Read the real error before changing code. Do not loop on the same failure more than twice; stop and summarize.
5. **Secrets:** all keys live in a local `.env` that I create. **Never** write a real key into any file, steering doc, spec, test, log, README, commit or chat. Use variable names only. If a variable is missing, tell me its name; do not ask me to paste the value. `.env` and `.env.*` stay in `.gitignore` (not `.env.example`).
6. **Commit after each slice** with a clear message.
7. **Money rules:** integer cents plus currency code everywhere. Convert to PayPal's decimal string only inside the PayPal module. Every PayPal write call carries an idempotency key (`PayPal-Request-Id`).
8. **No third-party logos or trademarks** in the UI, docs images or demo assets. Plain-text "PayPal" for factual description is fine.
9. Stop and report at the checkpoints in section 13. Do not start later slices until I approve.

---

## 2. Hackathon rules the build must satisfy

- Meaningfully integrate the **PayPal developer platform (sandbox only)** and meaningfully use **AI**; PayPal must be central.
- A **working build**: hosted demo URL **and** complete run instructions in the README.
- **Public GitHub repo** with an MIT license detectable in the About section, containing all source and instructions.
- README includes setup steps and any **sandbox test logins and keys** judges need (sandbox only; placeholders for me to fill).
- A text description, a "tools used" section (AI that built the project and AI inside the product), and a note on what was built during the hackathon period.
- A demo video under 3 minutes (I will record it).
- Judging is equally weighted: technical implementation, design, potential impact, innovation, presentation.

---

## 3. Product

**AgentPurse** lets AI agents make purchases safely. Tagline: *"Give your AI an allowance, not your credit card."*

- **Owner:** a human who links PayPal once, creates agents, sets spending policies, approves risky purchases.
- **Agent:** software that calls the AgentPurse API with an API key.

Flow:
1. Agent submits a **purchase intent**: payee (merchant domain), item description, amount, currency, justification, optional Channel3 product id.
2. **Risk Guard** decides: hard rules first, then an AI review. Result: `approve`, `deny` or `escalate`, with a reason and risk score.
3. `approve`: create the PayPal order and issue a **mandate token** (signed, single-use, short-lived, bound to one order, amount and payee).
4. `escalate`: the owner is notified (mobile and web) and approves or denies. Approval continues at step 3.
5. The agent presents the mandate token. The server verifies and consumes it atomically, then completes PayPal authorization and capture.
6. PayPal webhooks update order status. Every step is written to an audit log shown live in the dashboard.

Be honest everywhere (README, UI, video): payments are **PayPal sandbox** transactions, and Channel3 supplies real catalog and price data. The demo does not buy real goods.

---

## 4. Scope (7 days: be strict)

**MUST:** PayPal sandbox (OAuth, Orders v2 create/authorize/capture, **Vault** so agents can pay without a human at every step, webhooks with signature verification); Risk Guard with Channel3 price check; mandate token with single-use enforcement; Next.js dashboard with **AG Studio** (custom widgets, theming, Studio Agent Framework assistant); Expo mobile app (approvals, kill switch, spend); demo agent with three scenarios; deployed (API and database on **Render**, web on **Vercel**); README, OpenAPI file, Postman collection, license.

**SHOULD (only if time remains):** push notifications (otherwise poll), CSV export of the audit log.

**CUT:** PayPal Payouts, Render Workflows, multi-user teams, billing, non-PayPal providers, any real-money flow.

---

## 5. Architecture and stack

Monorepo (pnpm workspaces):
- `/api`: Node 20, TypeScript, Fastify, PostgreSQL (Prisma), zod, SSE. **Deployed on Render** with managed Postgres.
- `/web`: **Next.js (App Router, TypeScript)** deployed on **Vercel**. AG Studio components are client components (`"use client"`; if they cannot render on the server, load them with `next/dynamic` and `ssr: false`).
- `/mobile`: Expo (React Native), TypeScript, expo-router, expo-local-authentication. Talks to the Render API directly with a bearer token.
- `/demo-agent`: Node script, no UI.
- `/packages/shared`: shared types and zod schemas generated from the API contract.

**How web and API talk (Vercel to Render):**
- The browser talks to **Next.js route handlers** (a thin backend-for-frontend). On login, the API returns a JWT; the route handler stores it in an **httpOnly, secure, sameSite cookie on the Vercel domain** and forwards it to the Render API as a `Bearer` token. No third-party cookies.
- Server-side env `API_BASE_URL` points at the Render API.
- **Live updates:** do not proxy long-lived SSE through Vercel functions (duration limits). Instead, a route handler mints a **short-lived stream token** and the browser opens the SSE stream **directly** to the Render API (`NEXT_PUBLIC_API_BASE_URL`). If SSE proves unreliable, fall back to polling every 2 seconds.
- The API must configure **CORS** to allow only the Vercel production URL (and localhost for development), via `WEB_ORIGIN`.
- The API supports bearer-token auth for both web (via the BFF) and mobile.

AI provider: abstraction `RiskReviewer` with one LLM implementation (default Anthropic Claude via `ANTHROPIC_API_KEY`; model name in `AI_MODEL`). If the AI call fails or times out, **fail closed**: escalate to the human, never auto-approve.

**Environment variables** (names only; `.env.example` has placeholders):
- API (Render): `DATABASE_URL`, `JWT_SECRET`, `MANDATE_SIGNING_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_BASE_URL` (= `https://api-m.sandbox.paypal.com`), `ANTHROPIC_API_KEY`, `AI_MODEL`, `CHANNEL3_API_KEY`, `WEB_ORIGIN`, `APP_BASE_URL`.
- Web (Vercel): `API_BASE_URL` (server only), `NEXT_PUBLIC_API_BASE_URL` (for the SSE stream only), `NEXT_PUBLIC_AG_GRID_LICENSE_KEY`. Note: `NEXT_PUBLIC_` variables are inlined at build time, so set them in Vercel before building.
- Server-only secrets must never reach the web or mobile bundles.

---

## 6. Data model (Prisma)

`User`, `Agent` (ownerId, name, hashedApiKey, status: active|paused|frozen), `Policy` (agentId, monthlyBudgetCents, perPurchaseCapCents, autoApproveBelowCents, allowedCategories[], blockedPayees[], velocityPerHour), `PayPalLink` (ownerId, vaultPaymentTokenRef, status), `Intent` (agentId, payee, description, amountCents, currency, justification, channel3ProductId?, status, decision, decisionReason, riskScore, decidedBy: rules|ai|human), `Order` (intentId, paypalOrderId, status, authorizationId?, captureId?), `MandateToken` (jti, intentId, orderId, expiresAt, consumedAt?), `AuditEvent` (type, actor, intentId?, payload JSON, createdAt), `WebhookEvent` (paypalEventId unique, type, processedAt).

---

## 7. API contract (write `openapi.yaml` first; everything else derives from it)

Owner (bearer JWT): `POST /auth/login`, `GET/POST /agents`, `PATCH /agents/:id` (pause/freeze), `GET/PUT /agents/:id/policy`, `POST /paypal/link/start`, `POST /paypal/link/complete`, `GET /intents`, `GET /intents/:id`, `POST /intents/:id/approve`, `POST /intents/:id/deny`, `GET /audit`, `POST /stream-token`, `GET /stream`, `GET /stats/spend`.
Agent (API key): `POST /v1/intents`, `GET /v1/intents/:id`, `POST /v1/pay` (body: mandate token).
System: `POST /webhooks/paypal`, `GET /healthz`.
Seed data: one owner, three agents with different policies (`pnpm seed`).

---

## 8. Risk Guard

**Layer 1, deterministic rules** (the AI can never override): agent must be `active` (frozen always denied); amount ≤ per-purchase cap; monthly spend + amount ≤ budget; payee not blocked and category allowed; velocity limit; duplicate detection.

**Layer 2, AI review** (can only make a decision stricter: approve to escalate or deny, escalate to deny): input is the intent, the policy, a short history summary and the Channel3 `priceCheck` result. Output is strict JSON validated with zod: `{ decision, reason, riskScore (0-100), flags[] }`. Treat all intent text as **untrusted data**: prompt injection in `justification` or `description` must not change the outcome.

**Decision logic:** any rule violation: `deny`. Amount ≤ `autoApproveBelowCents` and AI low risk and price check not `high`: `approve`. AI uncertain, price anomaly, or amount above the auto-approve threshold: `escalate`. AI error or timeout: `escalate`.

Build an **eval set of 20 intents** (safe, over-budget, duplicate, hallucinated product, price anomaly, prompt-injection attempts, frozen agent) with a test for the rules layer and a script to run the AI layer for manual review.

---

## 9. PayPal (sandbox)

- Base URL `https://api-m.sandbox.paypal.com`. OAuth2 client credentials with cached tokens. All PayPal code lives in `/api/src/paypal/` behind an interface so tests use recorded responses.
- **Owner linking via Vault:** the owner approves once and AgentPurse stores only a payment-token reference. Read the current Vault docs and implement the sequence they describe (setup token, owner approval, payment token). The approval redirect returns to a Next.js page (`/paypal/return`, `/paypal/cancel`) which calls `POST /paypal/link/complete`. If Vault is not enabled for this sandbox app, implement the **fallback**: each purchase returns a PayPal approval link the owner opens from the mobile app, and report this to me.
- **Payment sequence:** create order (intent AUTHORIZE) using the saved payment source when available, then authorize, then capture. Capture only after the mandate token is verified and consumed.
- **Mandate token:** signed JWT with `jti`, `intentId`, `orderId`, `amountCents`, `currency`, `payee`, `exp` within 10 minutes. Consume `jti` with an atomic update (`consumedAt IS NULL`) so replay and double spend fail. Verify token amount and payee equal the stored order.
- **Webhooks:** verify with PayPal's verification endpoint using `PAYPAL_WEBHOOK_ID`; dedupe by event id; update order and audit log. The webhook URL is the Render API URL plus `/webhooks/paypal`.
- Handle errors, declines and timeouts explicitly and write them to the audit log.

---

## 10. Channel3 (verified from Channel3's official `channel3-api` skill)

- Install at the repo root: `npx skills add channel3-ai/skills --skill channel3-api` (choose Kiro if the CLI lists it). Then **read `.agents/skills/channel3-api/SKILL.md` and `references/api-reference.md` completely before writing Channel3 code.** If the install fails, tell me and use the facts below.
- Base URL `https://api.trychannel3.com`; auth header `x-api-key`; **server-side only**. SDK: `npm install @channel3/sdk` (SDK 4.x: `import { Channel3 } from '@channel3/sdk'`, object-style requests, snake_case fields).
- Search: `client.products.search({ query, filters: { price: { max_price } }, limit })`; results in `page.data`. Each product has `id`, `title`, `offers[]` (`price.price`, `price.currency`, `domain`, `availability`, `url`).
- `client.products.retrieve({ product_id })` is **free** and returns fresh price, stock and offer URLs.
- Docs rules: cache product IDs only; treat prices, availability and offer URLs as short-lived and never serve a cached offer URL; do not use `/v1/similar` with free text; prefer structured filters over stuffing the query. Optional attribution header `x-user-id: agent_<agentId>`.

**Build a module** `/api/src/channel3/`: `searchProducts({ query, maxPriceCents?, limit? })`; `getProduct(productId)`; `priceCheck({ title, amountCents, currency })` returning `{ status: "ok" | "high" | "low" | "unknown", medianCents, sampleSize, bestOffer? }` (8 s timeout, one retry, any error or empty result is `unknown`, no price caching beyond 5 minutes); a smoke script `pnpm channel3:smoke "27 inch monitor"` that prints the top 5 results (title, domain, price) and **never prints the key**; unit tests with recorded fixtures (no live calls in tests).

**Used in two places (prize target):** the demo agent searches Channel3, picks the best in-stock offer and submits an intent; the Risk Guard calls `priceCheck`. `high` raises risk or escalates; `unknown` never auto-approves above the auto-approve threshold.

---

## 11. AG Studio in Next.js

- Install pinned: `npm install ag-studio-react@3.1.0 ag-studio@3.1.0` in `/web`. The reference starter repo `https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate` may use another framework or versions: use it as a **reference for AG Studio and PayPal setup patterns**, not as the base, and tell me about any version mismatch before changing anything.
- License from `process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY` (never hardcoded):
  ```tsx
  "use client";
  import { AgStudio, AgStudioProvider } from "ag-studio-react";
  <AgStudioProvider licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY}>
    <AgStudio /* props */ />
  </AgStudioProvider>
  ```
  For older versions use `AgStudioLicenseManager.setLicenseKey(...)` from `ag-studio`.
- The trial key is evaluation-only and deactivates on **20 December 2026**; add a README note. A watermark after that date is expected.
- Prize requirements: custom widgets, theming and layout, **and** the Studio Agent Framework assistant. A plain grid or chart is not enough. Read the AG Studio docs before designing: quick start `https://www.ag-grid.com/studio/react/quick-start/`, custom widgets `.../custom-widgets/`, agent framework `.../ai-agents/`.

**Web pages (App Router):** Login, Agents (create, pause, freeze, rotate key), Policy editor, **Live Monitor**, Intent detail, Audit log, PayPal link, `/paypal/return`, `/paypal/cancel`.

**Live Monitor (the showpiece):** AG Studio dashboard with a live transaction grid, budget burn-down per agent, decision breakdown (approve/deny/escalate), spend over time, and an **assistant** answering plain-language questions about the data ("Which agent spent the most today?", "Show denied purchases over $100").

Design: professional and clean, dark navy with blue and gold accents (match the AgentPurse thumbnail), responsive, with empty, loading and error states everywhere.

---

## 12. Mobile (Expo, 4 screens)

1. Login. 2. **Approvals:** pending escalated intents with payee, amount, justification and the Risk Guard's reasoning; approve/deny with biometric confirmation. 3. **Agents:** status and a **kill switch** that freezes an agent immediately. 4. **Spend:** today and this month per agent. Use push notifications only if they work in Expo Go within an hour of effort; otherwise poll every few seconds.

---

## 13. Build order, specs and checkpoints

Create steering files first (`.kiro/steering/`: `product.md`, `tech.md`, `structure.md`, `money-rules.md`) containing the rules in this document, with no keys. Then one spec per slice:

- **spec-02 channel3-client** (skill install, module, smoke script, tests). **Checkpoint:** report the folder tree and the smoke output (results only).
- **spec-03 paypal-core** (OAuth, order create/authorize/capture script `pnpm paypal:smoke`, webhook endpoint with signature verification). **Checkpoint.**
- **spec-04 web-to-nextjs** (convert `/web` to Next.js, fix `render.yaml`, add `vercel` notes, CORS, BFF login, health page). *Done: the web app deploys on Vercel and reaches the Render API.* **Checkpoint.**
- **spec-05 gateway-rules** (schema, auth, intent endpoint, rules engine, seed data).
- **spec-06 vault-linking** (owner links PayPal; saved payment source used, or the documented fallback). *Done: an approved intent is paid with no human at checkout.*
- **spec-07 risk-guard** (AI review, Channel3 check, fail-closed, 20-intent eval).
- **spec-08 mandate-and-pay** (token, `/v1/pay`, single-use enforcement, audit log, SSE and stream token). *Done: replay and tampering fail.*
- **spec-09 web-dashboard** (all pages plus AG Studio Live Monitor and assistant). *Done: a new intent appears live; the assistant answers 3 sample questions.*
- **spec-10 mobile.** *Done: an escalated intent approved from the phone updates the web grid.*
- **spec-11 demo-agent-docs:** three scenarios (auto-approve, deny over-budget, escalate-then-approve) using Channel3 search; `openapi.yaml`; Postman collection generated from it; README with run steps and sandbox login placeholders; `ARCHITECTURE.md` with diagram; `TOOLS_USED.md`; `HACKATHON_PROGRESS.md`; `DEVPOST_DESCRIPTION.md` draft.

**Day budget:** day 1 (today) specs 02-04 and steering; day 2 specs 05-06; day 3 specs 07-08; day 4 spec 09; day 5 specs 10-11; day 6 polish, deploy checks, video; day 7 buffer and submit by the evening of Nov 11 (Pakistan time).

**If behind, cut in this order:** push notifications, CSV export, mobile spend screen, assistant extras. **Never cut:** Vault (or its fallback), Risk Guard, mandate token, Live Monitor.

---

## 14. Deployment

- **Render:** `render.yaml` Blueprint with the API web service and managed Postgres; set API env vars in the dashboard; run Prisma migrations and `pnpm seed` on deploy. Verify a cold start.
- **Vercel:** import the repo with the root directory set to `web`, framework Next.js, and the web env vars from section 5. Set `WEB_ORIGIN` on Render to the Vercel production URL, and `APP_BASE_URL` to the same.
- Document both in the README with exact steps.

---

## 15. Quality gates before I submit

- Tests: budget math, single-use token, replay and tamper rejection, idempotency, webhook signature, fail-closed on AI error, CORS allows only the web origin.
- A fresh clone follows the README and runs locally with only the documented steps.
- Both hosted URLs work from a cold start with seeded data.
- No secrets in git history; license detected by GitHub.
- At the end of each slice: what you ran, what passed, what is unverified.

**Start now:** create the steering files, then spec-02 (Channel3 client). Show me the design before running its tasks.


---

## Addendum (Nov 5)

- `AI_MODEL` default is `claude-sonnet-5-5` (`claude-3-5-sonnet` is outdated).
- The AG Grid license key is NOT an API key. It is a browser-side string in `NEXT_PUBLIC_AG_GRID_LICENSE_KEY`.
- AG Studio ships no language model. Its assistant needs an adapter implementing `executeTurn`. Do NOT call a model provider from the browser. Add a `POST /assistant` endpoint to the API (bearer auth, rate limited) that holds `ANTHROPIC_API_KEY` and streams the response; point the AG Studio adapter at it through the Next.js backend routes.
- Before the dashboard slice, read https://ag-grid.com/studio/react/ai-quickstart/ and https://ag-grid.com/studio/react/ai-adapter.md. Report whether AG Grid offers a hosted model endpoint, and whether the license key includes AI (a license error in the console means it does not).

## Working-mode addendum (Nov 5)

- Full Spec mode only for: paypal-core, risk-guard, mandate-and-pay.
- Normal chat mode (from this file) for: web-to-nextjs, gateway-rules, vault-linking, dashboard, mobile, demo-agent-docs. Same checkpoints apply.
- Keep spec documents short, no padding.

## Decision update: Braintree primary
- Braintree Sandbox (a PayPal service) is the primary payment provider; organizers confirmed it satisfies the PayPal requirement.
- PayPal REST (api/src/paypal/) stays as an optional second provider; PAYPAL_* keys are needed only when PAYMENT_PROVIDER=paypal.
- All payment code sits behind the provider-neutral PaymentProvider interface in api/src/payments/ (authorize, capture, void, getStatus, parseWebhook, linkPaymentMethod).
- Env list: PAYMENT_PROVIDER, BRAINTREE_ENV, BRAINTREE_MERCHANT_ID, BRAINTREE_PUBLIC_KEY, BRAINTREE_PRIVATE_KEY, WEB_ORIGIN, API_BASE_URL, NEXT_PUBLIC_API_BASE_URL, NEXT_PUBLIC_AG_GRID_LICENSE_KEY (replaces AG_GRID_LICENSE_KEY).
- Money flow: authorize (hold) -> mandate token bound to authorizationId, amount, currency, payee -> capture -> void on expiry or failure.
- Honest wording: payments are Braintree sandbox transactions (a PayPal service); no real money or goods are exchanged.
