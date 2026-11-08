# Tools used

Everything AgentPurse is built with, and what each piece is for. Versions come from the `package.json` files (exact versions are pinned in `pnpm-lock.yaml`); `^` means a compatible range.

## Payments and data

| Tool | Version | Used for |
| --- | --- | --- |
| **Braintree sandbox** (a PayPal service) | `braintree` ^3.41.0 | Payment provider: vault a test card, authorize (hold), capture, void, signed webhooks. Behind the `PaymentProvider` interface in `api/src/payments/`. |
| **PayPal REST API** (optional) | no SDK; plain `fetch` | Optional second provider selected with `PAYMENT_PROVIDER=paypal` (`api/src/paypal/`). |
| **Channel3** | `@channel3/sdk` ^4.8.0 | Real product catalog search for the demo agent and the market price check inside Risk Guard. |
| **PostgreSQL** | managed, external (`DATABASE_URL`) | Stores owners, agents, policies, intents, authorizations, mandates, vault methods, audit log. |
| **Prisma** | `prisma` and `@prisma/client` 6.19.0 | Schema, migrations (`api/prisma/migrations`) and database access. |

## AI providers (switchable with `AI_PROVIDER`)

| Provider | Used for |
| --- | --- |
| **Anthropic API** (Claude models) | Default Risk Guard review and the AG Studio assistant. Plain `fetch` against the Messages API. |
| **Google Gemini API** | Risk Guard review on its free tier. Plain `fetch`. |
| **OpenAI-compatible chat completions** (Groq, OpenRouter) | Risk Guard review and assistant tool calls on free tiers. Default model `openai/gpt-oss-20b` on Groq. Plain `fetch`. |
| `off` | No AI call; rules and price check only. |

No AI SDKs are installed; each adapter lives behind the `RiskReviewer` or `AssistantModel` interface so tests use mocked `fetch`.

## Dashboard

| Tool | Version | Used for |
| --- | --- | --- |
| **Next.js** (App Router) | 16.4.5 | Web app, route handlers as a thin backend-for-frontend (BFF). |
| **React** | 19.3.1 | UI. |
| **AG Grid** (`ag-grid-community`, `ag-grid-enterprise`, `ag-grid-react`) | 36.3.0 | Intents table, themed with the Theme API and the app's CSS variables. |
| **AG Studio** (`ag-studio`, `ag-studio-react`) | 3.1.0 | Build-your-own dashboard: three custom widgets, theming, layout persistence and the Studio Agent Framework assistant. |
| **lucide-react** | 1.70.0 | Icons. |
| **Inter** via `next/font` | n/a | Typography. |

## Backend and shared code

| Tool | Version | Used for |
| --- | --- | --- |
| **Fastify** | ^5.2.1 | HTTP API, Server-Sent Events, NDJSON streaming. |
| **zod** | 3.25.76 (api), ^3.24.1 (shared) | Request validation and shared schemas (`packages/shared`). |
| **TypeScript** | ^5.7.2 | Strict mode everywhere. |
| **tsx** | ^4.19.2 (api), 4.23.15 (demo agent) | Run TypeScript scripts: seed, smoke checks, demo agent. |
| **Node.js** | 20 or newer | Runtime (CI uses 20). Uses `node:crypto` for HMAC, scrypt and SHA-256, so there are no JWT or password libraries. |

## Hosting and delivery

| Tool | Used for |
| --- | --- |
| **Vercel** | Hosts the Next.js web app. |
| **Render** | Hosts the API as a web service (free plan), configured by `render.yaml`. |
| **GitHub Actions** | CI: placeholder check, lint, typecheck, tests (`.github/workflows/ci.yml`). |
| **pnpm** 9.12.0 | Workspace package manager (monorepo: `api`, `web`, `mobile`, `demo-agent`, `packages/shared`). |

## Quality and tooling

| Tool | Version | Used for |
| --- | --- | --- |
| **Vitest** | ^2.1.8 | Test runner; all tests are offline with fixtures and stubs. |
| **fast-check** | ^3.23.2 | Property-based tests (budget math, single-use tokens, rate limits). |
| **ESLint** (+ `typescript-eslint`) | ^9.17.0 / ^8.18.1 | Linting, flat config. |
| **Prettier** | ^3.4.2 | Formatting. |
| **Redocly CLI** | run with `npx` | Lints `docs/openapi.yaml`. |
| **Postman** | n/a | Collection and environment in `docs/postman`. |
| Custom scripts in `scripts/` | n/a | `check-env-example`, `scan-staged` (secret scan), `check-web-bundle`, pre-commit hook installer. |

## How it was built

- **Kiro** was the IDE and coding agent. The work followed **spec-driven development**: one spec per slice (requirements, design, tasks) in `.kiro/specs/`, with steering files in `.kiro/steering/` holding the product, tech, structure and money rules. Smaller fixes were done in plain chat.
- **Claude** helped with planning and review.
