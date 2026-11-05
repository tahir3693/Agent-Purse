# Design Document

## Overview

This design covers the **scaffold slice (spec-01)** of AgentPurse. The goal is a pnpm workspace monorepo with five workspace skeletons, shared tooling, a minimal Fastify API exposing a health endpoint, a Render Blueprint for deployment, secret-free environment templating, an MIT license, documented repo-wide conventions, and an initialized Git repository with one initial commit.

**Definition of done (Requirement 9):** a live Render HTTPS URL returns `GET /healthz` → `200` with a JSON body indicating a healthy state.

Out of scope for this slice (and explicitly deferred to later specs): PayPal integration, Risk Guard, dashboard logic, mobile feature logic, and demo-agent logic. The `/web`, `/mobile`, and `/demo-agent` workspaces are trivial placeholders here. In particular, `/web` will later be replaced/adapted from the official PayPal AG Studio starter in **spec-07** — this slice does **not** pull that starter in.

### Design principles

- **Minimal but real.** Every workspace is a valid, installable, type-checkable package, but only the API has behavior (the health endpoint).
- **Conventions first.** The money convention (integer cents + ISO 4217), secrets-via-env, public MIT, and no third-party logos are recorded now because later slices depend on them (Requirement 8).
- **No secrets in the repo.** Secret values live only in the Render Dashboard or an untracked local `.env`; the repo ships `.env.example` placeholders only (Requirements 5, 8.2).
- **Honest testing scope.** The only meaningfully testable units in a scaffold are the healthz response shape and env/port parsing. The live Render check is a manual, out-of-band verification step (Requirement 9).

---

## Architecture

### Monorepo layout

```text
agentpurse/
├─ package.json                 # private:true, root scripts, devDeps for shared tooling
├─ pnpm-workspace.yaml          # lists the five workspaces
├─ tsconfig.base.json           # shared compiler options; workspaces extend this
├─ tsconfig.json                # root project refs / solution file (for editor + typecheck)
├─ eslint.config.js             # ESLint flat config for TS
├─ .prettierrc.json             # Prettier config
├─ vitest.config.ts             # root Vitest config (workspace-aware)
├─ render.yaml                  # Render Blueprint: api web service + web static site + postgres
├─ .env.example                 # exactly 12 placeholder keys
├─ .gitignore                   # node_modules, dist/build, .env + .env.* (except .env.example)
├─ LICENSE                      # MIT
├─ README.md                    # includes CONVENTIONS section (money, secrets, license, branding)
├─ test/
│  └─ placeholder.test.ts       # keeps `pnpm test` green with zero real tests yet
├─ api/
│  ├─ package.json              # name: @agentpurse/api
│  ├─ tsconfig.json             # extends ../tsconfig.base.json
│  └─ src/
│     ├─ config.ts              # env/port/host parsing with defaults
│     ├─ server.ts              # buildServer(): Fastify instance + /healthz route
│     └─ index.ts               # bootstrap: build, listen, exit non-zero on bind failure
├─ web/
│  ├─ package.json              # name: @agentpurse/web (trivial placeholder)
│  └─ src/index.ts              # placeholder entry
├─ mobile/
│  ├─ package.json              # name: @agentpurse/mobile (trivial placeholder)
│  └─ src/index.ts              # placeholder entry
├─ demo-agent/
│  ├─ package.json              # name: @agentpurse/demo-agent (trivial placeholder)
│  └─ src/index.ts              # placeholder entry
└─ packages/
   └─ shared/
      ├─ package.json           # name: @agentpurse/shared
      ├─ tsconfig.json          # extends ../../tsconfig.base.json
      └─ src/
         ├─ money.ts            # Money type + placeholder zod schema (money convention)
         └─ index.ts            # re-exports placeholder types + schema
```

Maps to Requirement 1.1–1.7 (five workspaces, unique names, placeholder-only behavior except API).

### Component relationships

```mermaid
graph TD
    Root[Root workspace: tooling + scripts] --> API[api: Fastify + /healthz]
    Root --> Web[web: placeholder]
    Root --> Mobile[mobile: placeholder]
    Root --> Demo[demo-agent: placeholder]
    Root --> Shared[packages/shared: types + zod]
    API -. may import .-> Shared
    Web -. may import .-> Shared
    Mobile -. may import .-> Shared
    Demo -. may import .-> Shared
    Blueprint[render.yaml] --> APIsvc[(Render web service: api)]
    Blueprint --> WebSite[(Render static site: web)]
    Blueprint --> DB[(Render managed Postgres)]
    DB -- fromDatabase DATABASE_URL --> APIsvc
    Client[Client / Render health check] -- GET /healthz --> APIsvc
```

### Deploy / health flow

```mermaid
sequenceDiagram
    participant R as Render
    participant A as API service (node dist)
    participant C as Client
    R->>R: Read render.yaml Blueprint
    R->>A: build (pnpm install + filtered build), then start
    A->>A: parse HOST (default 0.0.0.0), PORT (Render-provided)
    A->>A: listen; on bind failure log + exit non-zero
    R->>A: GET /healthz (configured healthCheckPath)
    A-->>R: 200 { "status": "ok" }
    C->>A: GET https://<app>.onrender.com/healthz
    A-->>C: 200 { "status": "ok" }
```

---

## Components and Interfaces

### Root workspace (tooling)

**`pnpm-workspace.yaml`** lists exactly the five workspaces (Requirement 1.1):

```yaml
packages:
  - "api"
  - "web"
  - "mobile"
  - "demo-agent"
  - "packages/*"
```

> `packages/*` is the idiomatic glob and resolves to `packages/shared`. The app dirs are listed explicitly. This produces exactly the five required workspaces.

**Root `package.json`** sets `"private": true` (Requirement 1.2) and defines scripts that fan out with `pnpm -r` (recursive across workspaces) (Requirement 2):

| Script | Command | Behavior |
| --- | --- | --- |
| `lint` | `eslint .` | ESLint flat config over TS; non-zero exit + file/line on violations (Req 2.6, 2.7) |
| `format` | `prettier --write "**/*.{ts,json,md}"` | Formats `.ts`, `.json`, `.md` (Req 2.8) |
| `typecheck` | `pnpm -r run typecheck` | Each workspace runs `tsc --noEmit`; success exit when clean (Req 2.5, 1.9) |
| `test` | `vitest run` | Runs placeholder test; success when passing / none; non-zero + failed test ids on failure (Req 2.9, 2.10) |
| `build` | `pnpm -r run build` | Each workspace builds (API compiles to `dist`); success when clean (Req 1.9) |

> `vitest run` is the non-watch, single-execution form. Never use watch mode in CI or scripted runs.

**`tsconfig.base.json`** holds shared compiler options (`strict: true`, `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `esModuleInterop`, `skipLibCheck`). Every workspace `tsconfig.json` extends it (Requirement 2.1). A root `tsconfig.json` references the workspace tsconfigs so editor + root typecheck resolve project-wide.

**`eslint.config.js`** — ESLint flat config (ESLint v9 style) using `typescript-eslint` for TS files (Requirement 2.2).

**`.prettierrc.json`** — Prettier config applied repo-wide (Requirement 2.3).

**`vitest.config.ts` + `test/placeholder.test.ts`** — Vitest is the Test_Runner (Requirement 2.4). The placeholder test asserts a trivial truth so `pnpm test` passes before any real tests exist (Requirement 2.9).

### `/api` — Fastify API service

Target: Node 20 + TypeScript + Fastify (Requirement 3.1). Three small source files keep the server testable without binding a port.

**`src/config.ts`** — env parsing with defaults:

```ts
export interface ServerConfig {
  host: string; // HOST env or "0.0.0.0"
  port: number; // PORT env (Render-provided) or 3000
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = env.HOST && env.HOST.trim() !== "" ? env.HOST : "0.0.0.0";
  const parsed = Number(env.PORT);
  const port =
    env.PORT && Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535
      ? parsed
      : 3000;
  return { host, port };
}
```

Defaults: host `0.0.0.0`, port `3000` (Requirements 3.6, 3.7). Render injects `PORT` at runtime (Requirement 3.5).

**`src/server.ts`** — builds the Fastify instance and registers the health route. Exported as a pure factory so tests can use Fastify's `inject()` without opening a socket:

```ts
import Fastify, { type FastifyInstance } from "fastify";

export interface HealthResponse {
  status: "ok";
}

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.get("/healthz", async (): Promise<HealthResponse> => {
    return { status: "ok" };
  });
  return app;
}
```

**Health endpoint contract** (Requirements 3.2, 3.3, 3.4; see Correctness Properties):
- Route: `GET /healthz`
- Status: `200`
- Body: JSON object `{ "status": "ok" }` — the `status` field value `"ok"` indicates a healthy service.

**`src/index.ts`** — bootstrap: build the server, read config, `listen`, and on bind failure log the error and exit with a non-zero code (Requirements 3.5, 3.8, 3.9):

```ts
import { buildServer } from "./server.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const app = buildServer();
  const { host, port } = loadConfig();
  try {
    await app.listen({ host, port });
  } catch (err) {
    app.log.error(err, `failed to bind on ${host}:${port}`);
    process.exit(1);
  }
}

void main();
```

**`/api` scripts:**

| Script | Command | Purpose |
| --- | --- | --- |
| `dev` | `tsx watch src/index.ts` | Local development with reload (Req 3.9) |
| `build` | `tsc -p tsconfig.json` | Compile TS → `dist/` |
| `start` | `node dist/index.js` | Launch compiled server (Req 3.9) |
| `typecheck` | `tsc --noEmit` | Type-check only (Req 1.9, 2.5) |

> Using `tsx` for dev (fast, zero-config TS runner). `ts-node` is an acceptable equivalent; `tsx` is the chosen default. Build with `tsc`, run with `node dist`.

### `/packages/shared` — shared types + zod

Package name `@agentpurse/shared`, consumable by other workspaces via the workspace protocol (`"@agentpurse/shared": "workspace:*"`). Exposes placeholder types and a placeholder zod schema encoding the money convention (Requirements 1.7, 8.1):

```ts
// src/money.ts
import { z } from "zod";

/** Money convention: signed integer cents + ISO 4217 currency code. */
export interface Money {
  amountCents: number; // signed integer; no fractional component
  currency: string; // ISO 4217 three-letter code, e.g. "USD"
}

export const MoneySchema = z.object({
  amountCents: z.number().int(),
  currency: z.string().length(3),
});
```

> This is a placeholder shape, not a full money library. It exists so later slices import a single agreed-upon `Money` type and schema. Worked example (Requirement 8.3): `$12.34 USD` → `{ amountCents: 1234, currency: "USD" }`.

### `/web`, `/mobile`, `/demo-agent` — placeholder skeletons

Each has a `package.json` with a unique name (`@agentpurse/web`, `@agentpurse/mobile`, `@agentpurse/demo-agent`) and a single placeholder entry (`src/index.ts`) with no behavior (Requirements 1.4, 1.5, 1.6). They are installable and type-checkable but do nothing.

> **`/web` note:** kept intentionally trivial. Spec-07 will replace/adapt it from the PayPal AG Studio starter. Do **not** scaffold React/Vite or pull the starter in this slice.

### `render.yaml` — Render Blueprint

Declares exactly one API web service, one web static site, and one managed Postgres (Requirements 4.1–4.3). `DATABASE_URL` is wired from the managed DB via `fromDatabase` → `property: connectionString` ([Render: wiring with fromDatabase](https://render.com/tutorials/postgres-on-render/wiring-with-fromdatabase)). Secret env vars are referenced by name with `sync: false` so values are set in the Render Dashboard, never in the file (Requirements 4.5, 5, 8.2) ([Render: cross-service wiring / sync:false](https://render.com/tutorials/advanced-blueprint-patterns/cross-service-wiring)). The API web service sets `healthCheckPath: /healthz` (Requirement 4.4).

```yaml
# render.yaml — AgentPurse scaffold Blueprint
# Resource names (keep wiring references in sync):
#   db:  agentpurse-db
#   api: agentpurse-api   (web service)
#   web: agentpurse-web   (static site)

databases:
  - name: agentpurse-db
    plan: free # TODO(verify): confirm available free/basic plan name in your Render account

services:
  - type: web
    name: agentpurse-api
    runtime: node
    plan: free # TODO(verify): confirm plan name
    healthCheckPath: /healthz
    buildCommand: pnpm install --frozen-lockfile && pnpm --filter @agentpurse/api... run build
    startCommand: node api/dist/index.js
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: agentpurse-db
          property: connectionString
      # Secrets — set in Render Dashboard, not committed (sync: false)
      - key: JWT_SECRET
        sync: false
      - key: MANDATE_SIGNING_KEY
        sync: false
      - key: PAYPAL_CLIENT_ID
        sync: false
      - key: PAYPAL_CLIENT_SECRET
        sync: false
      - key: PAYPAL_WEBHOOK_ID
        sync: false
      - key: PAYPAL_BASE_URL
        sync: false
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: AI_MODEL
        sync: false
      - key: CHANNEL3_API_KEY
        sync: false
      - key: AG_GRID_LICENSE_KEY
        sync: false
      - key: APP_BASE_URL
        sync: false

  # TODO(verify): static site block shape. Render static sites use
  # `type: web` with `runtime: static` in current docs; older Blueprints
  # used `type: web` + `env: static`. Confirm the current field against
  # https://render.com/docs/blueprint-spec before first deploy.
  - type: web
    name: agentpurse-web
    runtime: static
    buildCommand: pnpm install --frozen-lockfile && pnpm --filter @agentpurse/web... run build
    staticPublishPath: web/dist # TODO(verify): field name for static publish dir
```

**Service build/start commands.** On Render, pnpm must be available; the build command runs a workspace-filtered install + build (`pnpm --filter @agentpurse/api... run build` builds the API and its workspace deps, e.g. `@agentpurse/shared`), then the service starts with `node api/dist/index.js` (Requirement 9.1).

> **TODO(verify) — pnpm on Render.** Confirm how Render provides pnpm for a Node runtime (e.g. `corepack enable` prefix in the build command, or a `packageManager` field in root `package.json`). If pnpm is not auto-available, prefix the build command with `corepack enable && corepack prepare pnpm@<version> --activate`. Verify against Render's monorepo/pnpm docs before first deploy.

> **TODO(verify) — Blueprint field names.** `plan` values, the static-site `type`/`runtime`/publish-path fields, and `healthCheckPath` casing should be validated with `render blueprints validate` against the current [Render Blueprint spec](https://render.com/docs/blueprint-spec) before committing. Content was rephrased from Render docs for compliance.

If the API web service, the web static site, or the managed Postgres is missing, the Blueprint deploy is rejected with the missing component indicated (Requirement 4.7) — this is Render's own validation behavior, not something the repo enforces.

### `.env.example` — environment template

Exactly the 12 required keys, each once, with non-empty placeholder tokens that are obviously not real credentials (Requirements 5.1, 5.2, 5.5):

```dotenv
DATABASE_URL=postgres://user:password@localhost:5432/agentpurse
JWT_SECRET=replace-with-a-long-random-string
MANDATE_SIGNING_KEY=replace-with-mandate-signing-key
PAYPAL_CLIENT_ID=your-paypal-client-id
PAYPAL_CLIENT_SECRET=your-paypal-client-secret
PAYPAL_WEBHOOK_ID=your-paypal-webhook-id
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
ANTHROPIC_API_KEY=your-anthropic-api-key
AI_MODEL=claude-3-5-sonnet
CHANNEL3_API_KEY=your-channel3-api-key
AG_GRID_LICENSE_KEY=your-ag-grid-license-key
APP_BASE_URL=http://localhost:3000
```

### `.gitignore`

Excludes dependency and build-artifact directories and all env files except the template (Requirements 5.3, 5.4, 7.4, 7.5):

```gitignore
node_modules/
dist/
build/
.env
.env.*
!.env.example
```

### `LICENSE`

Full MIT text at repo root, filename `LICENSE`, no extension, including the copyright line (four-digit year + holder), the permission-notice paragraph, and the warranty-disclaimer paragraph (Requirements 6.1–6.3, 8.5).

### README CONVENTIONS section

Documents (Requirement 8): the money convention with a worked example (8.1, 8.3), secrets-exclusively-via-env (8.2), the required env var names + their exclusion from version control (8.4), the public MIT license (8.5), and the no-third-party-logos/trademarks rule (8.6).

### Git

Initialize the repo at the monorepo root; after the scaffold is complete, make one initial commit on the default branch of every non-ignored file (Requirements 7.1, 7.2). If nothing is staged the commit aborts with a "nothing to commit" indication (Requirement 7.3). Ignored files/dirs are excluded from the committed content (Requirement 7.5).

---

## Data Models

The only data model in the scaffold is the shared **Money** type (a placeholder for later slices):

| Field | Type | Constraint | Notes |
| --- | --- | --- | --- |
| `amountCents` | integer | signed, no fractional component | e.g. `1234` for `$12.34` |
| `currency` | string | ISO 4217, three letters | e.g. `"USD"` |

Validated by `MoneySchema` (zod): `amountCents` is `z.number().int()`, `currency` is `z.string().length(3)`.

The health response is a fixed-shape object: `{ status: "ok" }` (type `HealthResponse`).

The server config is `{ host: string; port: number }` produced by `loadConfig`.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

For a scaffold, most acceptance criteria are structural (files exist, workspaces resolve, lint runs) or external (Render deploy) and are **not** amenable to property-based testing. The genuinely testable pure-logic units are **env/port parsing** (`loadConfig`) and the **health endpoint contract**. The properties below are kept minimal and honest; they are implemented with a property-based testing library (`fast-check`) on top of Vitest. See the prework analysis that informed these.

### Property 1: Health endpoint returns the healthy contract

*For any* number of `GET /healthz` requests against a freshly built server, each response SHALL have HTTP status `200` and a JSON body deep-equal to `{ "status": "ok" }`.

**Validates: Requirements 3.2, 3.3, 3.4, 9.3**

> The endpoint takes no input, so "for all requests" is the universal quantifier. This is tested via Fastify `inject()` (no socket bind) and may be exercised repeatedly; the contract is deterministic.

### Property 2: Port parsing falls back to the default for any invalid input

*For any* string value of the `PORT` environment variable that is not an integer in `[0, 65535]` (including empty/unset, non-numeric, negative, fractional, and out-of-range values), `loadConfig` SHALL return `port === 3000`; and *for any* integer string in `[0, 65535]`, `loadConfig` SHALL return that integer as `port`.

**Validates: Requirements 3.5, 3.7**

### Property 3: Host parsing falls back to the default when unset or blank

*For any* `HOST` environment value that is unset or blank (empty/whitespace-only), `loadConfig` SHALL return `host === "0.0.0.0"`; and *for any* non-blank string, `loadConfig` SHALL return that string as `host`.

**Validates: Requirements 3.5, 3.6**

> **Prework note (property reflection):** Candidate properties about "adding/removing a workspace" or "Money round-trip" were considered and dropped. Workspace resolution is a structural/install concern verified by `pnpm install` succeeding (an example/integration check), not a property over inputs. A Money serialization round-trip is not justified yet because the scaffold introduces no money encode/decode logic — only a type and schema; adding a round-trip property now would be over-engineering for a scaffold. The three properties above are the minimal non-redundant set.

---

## Error Handling

| Condition | Handling | Requirement |
| --- | --- | --- |
| API cannot bind host/port | Catch `listen` rejection, log error via Fastify logger, `process.exit(1)` | 3.8 |
| `PORT` env invalid/unset | `loadConfig` falls back to `3000` (no throw) | 3.7 |
| `HOST` env unset/blank | `loadConfig` falls back to `0.0.0.0` (no throw) | 3.6 |
| Lint violation | `eslint .` exits non-zero and prints file + line per violation | 2.7 |
| Test failure | `vitest run` exits non-zero and reports failed test identities | 2.10 |
| Empty initial commit (nothing staged) | Git aborts commit with "nothing to commit"; repo left with no commits | 7.3 |
| Missing Blueprint component | Render rejects the deploy, indicating the missing component | 4.7 |
| Live healthz not 200 / unhealthy / unreachable within timeout | Maintainer treats DoD as not met (manual verification) | 9.4, 9.5 |

---

## Testing Strategy

### Unit tests (Vitest)

- **`loadConfig` parsing** — example cases for defaults (unset → `0.0.0.0`/`3000`) and set values, plus the property tests above for exhaustive input coverage (Requirements 3.5–3.7).
- **Health handler** — build the server with `buildServer()` and use Fastify `inject()` to assert `GET /healthz` → `200` with body `{ status: "ok" }` (Requirements 3.2–3.4). No real port is bound, so tests are fast and isolated.
- **Placeholder test** — `test/placeholder.test.ts` keeps `pnpm test` green until real tests land, satisfying "passes when a placeholder test passes or no tests are present" (Requirement 2.9).

### Property-based tests (fast-check + Vitest)

- Implement Properties 1–3 above, each with **minimum 100 iterations**.
- Tag each with a comment referencing the design property:
  `// Feature: agentpurse-scaffold, Property 2: Port parsing falls back to the default for any invalid input`
- Use an existing library (`fast-check`); do not hand-roll generators/shrinkers.

### Structural / smoke checks (example-based, not PBT)

- `pnpm install` at root resolves all five workspaces and exits success (Requirement 1.8) — verified by running the command, not a unit test.
- `pnpm -r run typecheck` and `pnpm -r run build` complete without errors (Requirements 1.9, 2.5).
- `eslint .`, `prettier`, and `vitest run` are runnable from the root (Requirement 2).

### Manual / out-of-band verification (cannot be automated from the repo)

- **Live Render health check (Definition of Done, Requirement 9):** after deploying the Blueprint, the maintainer sends `GET https://<app>.onrender.com/healthz` and confirms `200` with a healthy body within the stated timeouts. This depends on an external Render account and a live deployment, so it is a manual step the maintainer performs; it is not expressible as a repo test.
- **Blueprint validation:** run `render blueprints validate` to catch `fromDatabase` name typos and field-name issues flagged as `TODO(verify)` before the first deploy.

### Test configuration notes

- Always use `vitest run` (single execution), never watch mode, in scripts/CI.
- Property tests: ≥100 iterations each; keep inputs in-memory and cheap (pure `loadConfig` + in-process `inject()`), so high iteration counts are justified.
