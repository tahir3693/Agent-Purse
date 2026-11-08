# Hackathon progress log

Built for **Build What's Next with PayPal and AI** (deadline 12 November 2026, 12:00 pm PST). This log comes from `git log --date=short`, grouped by day, oldest first. Commit subjects are quoted as written.

## 5 November 2026: scaffold

- `a92d272` Initial scaffold: pnpm monorepo, Fastify health API, Render Blueprint
- `5988932` Initial commit
- `29ca36c` More Updates

Result: workspaces for `api`, `web`, `mobile`, `demo-agent` and `packages/shared`; a health endpoint; a Render Blueprint; MIT license; lint, typecheck and test setup.

## 6 November 2026: payments and Risk Guard

- `d06c551`, `95ce86c`, `c7c1245` fix: update render buildCommand to build workspace packages in order (three attempts at the Render build order)
- `6c8db48` feat(payments): add provider-neutral payment seam with Braintree sandbox primary
- `251422e` feat(risk): build fail-closed AI Risk Guard with injection defense and market price checks

Result: the `PaymentProvider` interface with a Braintree sandbox adapter (authorize, capture, void, signed webhooks) and the Risk Guard pipeline: deterministic rules, Channel3 price check, injection check and AI review that can only tighten.

## 7 November 2026: owners, agents, approvals and the web app

- `a356745`, `8d9c4f1` Updates
- `e9dd97c` chore: add .env.example placeholder check and pre-commit guard script
- `ad5e81f` chore(env): placeholder-only .env.example, allowlisted checker, tracked pre-commit hook, CI env check
- `3d7b4cd` feat(api): owner accounts, agents, approvals, SSE live feed, demo seed (spec-06b)
- `64fc75c` feat(web): next.js app router with login and health route (spec-04)
- `0ce33b1` chore(env): align .env.example with code, add PORT and HOST
- `c57bdb6` chore(render): use external database

Result: owner accounts and agent keys, owner approve and deny, mandate issue and execute, SSE live feed, demo seed, the Next.js BFF with cookie sessions, and the secret-hygiene guard rails (placeholder check, pre-commit hook, CI).

## 8 November 2026: dashboard, Studio, AI providers, demo agent, polish

- `6ab00f7` feat(seed): set demo owner password from env
- `b4f0061` feat(demo-agent): shopping agent scenarios (spec-11a)
- `e5bd6c8` feat(web): owner dashboard (spec-09a)
- `a224470` feat(web): AG Studio dashboard and assistant (spec-09b)
- `70d59fa` fix(risk): diagnose AI review failures and fix request
- `140516e` feat(ai): switchable AI provider with Gemini free tier
- `6f60298` fix(ai): lower Gemini latency and make AI timeout configurable
- `6894447` feat(web): visual redesign (design tokens, app shell, UI primitives, landing)
- `834cb64` feat(ai): OpenAI-compatible provider for Risk Guard and assistant
- `50d9417` feat(ai): token budget for OpenAI-compatible provider (low reasoning, small max_tokens, retry-after, review cache)
- `486995b` fix(studio): schema fields match layout state
- `b4728d3` fix(demo-agent): realistic needs-approval product and price
- docs: README, OpenAPI, Postman, tools used, progress log (this commit)

Result: the full owner dashboard (overview, agents, intents with AG Grid, approvals, live monitor, vault), AG Studio with three custom widgets and a read-only assistant, a six-scenario demo agent, three switchable AI providers (Anthropic, Gemini, OpenAI-compatible such as Groq) after the first free-tier models timed out or lacked credit, a visual redesign with light and dark themes, a Studio schema fix, and judge-ready documentation.

## What I'd do next

- Build the Expo mobile app (approvals, kill switch, spend). The `mobile` workspace is only a placeholder today.
- Push notifications for escalations; polling is the current fallback.
- CSV export of the audit log.
- Move the in-memory rate limiters and event bus to a shared store so the API can run on more than one instance.
- Wire a PayPal REST webhook route end to end for the optional second provider, and exercise that provider in a live sandbox run.
- Generate the shared request and response types from `docs/openapi.yaml`, and run the spec through contract tests in CI.
- Add `check:web-bundle` and the secret scan to CI (today they run locally and in the pre-commit hook).
- Replace the Studio layout in `localStorage` with a per-owner saved layout on the server.
- Record token usage per AI review so owners can see what the free tier is costing them.
