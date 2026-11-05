# Implementation Plan: AgentPurse Scaffold (spec-01)

## Overview

This plan builds the AgentPurse scaffold slice incrementally: root monorepo tooling first, then the shared package, then the Fastify API with its health endpoint and tests, then the three placeholder workspaces, then deployment/templating artifacts (render.yaml, .env.example, .gitignore, LICENSE, README conventions), and finally Git init + initial commit. The Render Blueprint is only committed after an early research task confirms the current Render Blueprint field names so the design's `TODO(verify)` markers are resolved rather than guessed.

Scope is strictly the scaffold. No PayPal, Risk Guard, dashboard, mobile, or demo-agent behavior is implemented here — those workspaces are trivial placeholders. Definition of done: a live Render HTTPS URL returns `200` healthy from `GET /healthz` (verified manually in the final task).

## Tasks

- [x] 1. Research and confirm current Render Blueprint spec
  - Fetch the current Render Blueprint spec documentation (https://render.com/docs/blueprint-spec) and confirm: the static-site block shape (`type`/`runtime`/`env` field and the static publish-path field name), the valid `plan` names for `databases` and `web` services on the account's tier, and how pnpm is provided on a Node runtime (corepack enable prefix vs. `packageManager` field in root package.json)
  - Record the confirmed values in a short note to carry into task 10, resolving every `TODO(verify)` marker in design.md before render.yaml is written
  - This is a research/verification task — do not guess field names; base them on the fetched current spec
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 9.1_

- [x] 2. Set up root monorepo structure and shared tooling
  - [x] 2.1 Create root package.json, pnpm-workspace.yaml, and TypeScript base config
    - Create root `package.json` with `"private": true` and root scripts: `lint` (`eslint .`), `format` (`prettier --write "**/*.{ts,json,md}"`), `typecheck` (`pnpm -r run typecheck`), `test` (`vitest run`), `build` (`pnpm -r run build`); add shared devDependencies (typescript, eslint, typescript-eslint, prettier, vitest, fast-check)
    - Create `pnpm-workspace.yaml` listing exactly `api`, `web`, `mobile`, `demo-agent`, `packages/*`
    - Create `tsconfig.base.json` with `strict: true`, `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `esModuleInterop`, `skipLibCheck`
    - Create root `tsconfig.json` referencing the workspace tsconfigs for editor + root typecheck resolution
    - _Requirements: 1.1, 1.2, 2.1_

  - [x] 2.2 Create ESLint flat config and Prettier config
    - Create `eslint.config.js` (ESLint v9 flat config) using `typescript-eslint` for `.ts` files so `eslint .` exits non-zero with file/line on violations
    - Create `.prettierrc.json` applied repo-wide to `.ts`, `.json`, `.md`
    - _Requirements: 2.2, 2.3, 2.6, 2.7, 2.8_

  - [x] 2.3 Create Vitest config and placeholder test
    - Create `vitest.config.ts` (workspace-aware) wiring Vitest as the Test_Runner
    - Create `test/placeholder.test.ts` asserting a trivial truth so `vitest run` passes before real tests exist
    - _Requirements: 2.4, 2.9, 2.10_

- [x] 3. Implement the shared package (@agentpurse/shared)
  - [x] 3.1 Create shared package skeleton with Money type and zod schema
    - Create `packages/shared/package.json` (name `@agentpurse/shared`), `packages/shared/tsconfig.json` extending `../../tsconfig.base.json` with a `typecheck` and `build` script
    - Create `packages/shared/src/money.ts` with the `Money` interface (`amountCents: number` signed integer, `currency: string` ISO 4217) and `MoneySchema` zod schema (`amountCents: z.number().int()`, `currency: z.string().length(3)`)
    - Create `packages/shared/src/index.ts` re-exporting the placeholder types and schema
    - _Requirements: 1.7, 8.1_

- [x] 4. Implement the /api Fastify service
  - [x] 4.1 Create api package skeleton and config loader
    - Create `api/package.json` (name `@agentpurse/api`) with scripts: `dev` (`tsx watch src/index.ts`), `build` (`tsc -p tsconfig.json`), `start` (`node dist/index.js`), `typecheck` (`tsc --noEmit`); add deps fastify, tsx, and `@agentpurse/shared` via `workspace:*`
    - Create `api/tsconfig.json` extending `../tsconfig.base.json`
    - Create `api/src/config.ts` exporting `ServerConfig` and `loadConfig(env)` with HOST default `0.0.0.0` (fallback when unset/blank) and PORT default `3000` (fallback for any value not an integer in `[0, 65535]`)
    - _Requirements: 3.1, 3.5, 3.6, 3.7_

  - [x] 4.2 Implement buildServer and the /healthz route
    - Create `api/src/server.ts` exporting `HealthResponse` and a pure `buildServer()` factory that returns a Fastify instance with a `GET /healthz` route responding `200` and body `{ status: "ok" }`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 4.3 Implement the bootstrap entry point
    - Create `api/src/index.ts` that builds the server, reads config, calls `listen({ host, port })`, and on bind failure logs the error via the Fastify logger and calls `process.exit(1)`
    - _Requirements: 3.5, 3.8, 3.9_

  - [ ]* 4.4 Write unit tests for loadConfig and the health endpoint
    - Example tests for `loadConfig`: unset → `0.0.0.0`/`3000`, and valid set values returned as-is
    - Health handler test: build with `buildServer()` and use Fastify `inject()` to assert `GET /healthz` → `200` with body `{ status: "ok" }` (no socket bind)
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 4.5 Write property test for the health endpoint contract
    - **Property 1: Health endpoint returns the healthy contract**
    - For any number of `inject()` `GET /healthz` requests against a freshly built server, assert status `200` and body deep-equal to `{ "status": "ok" }`; ≥100 iterations
    - Tag: `// Feature: agentpurse-scaffold, Property 1: Health endpoint returns the healthy contract`
    - **Validates: Requirements 3.2, 3.3, 3.4, 9.3**

  - [ ]* 4.6 Write property test for PORT parsing fallback
    - **Property 2: Port parsing falls back to the default for any invalid input**
    - For any PORT not an integer in `[0, 65535]` (empty/unset, non-numeric, negative, fractional, out-of-range) → `port === 3000`; for any integer string in range → that integer; ≥100 iterations
    - Tag: `// Feature: agentpurse-scaffold, Property 2: Port parsing falls back to the default for any invalid input`
    - **Validates: Requirements 3.5, 3.7**

  - [ ]* 4.7 Write property test for HOST parsing fallback
    - **Property 3: Host parsing falls back to the default when unset or blank**
    - For any HOST unset or blank (empty/whitespace-only) → `host === "0.0.0.0"`; for any non-blank string → that string; ≥100 iterations
    - Tag: `// Feature: agentpurse-scaffold, Property 3: Host parsing falls back to the default when unset or blank`
    - **Validates: Requirements 3.5, 3.6**

- [x] 5. Create the /web, /mobile, and /demo-agent placeholder skeletons
  - [x] 5.1 Create the three placeholder workspaces
    - Create `web/package.json` (name `@agentpurse/web`) and `web/src/index.ts` placeholder entry with no behavior
    - Create `mobile/package.json` (name `@agentpurse/mobile`) and `mobile/src/index.ts` placeholder entry with no behavior
    - Create `demo-agent/package.json` (name `@agentpurse/demo-agent`) and `demo-agent/src/index.ts` placeholder entry with no behavior
    - Keep each installable and type-checkable (do NOT scaffold React/Vite, Expo, or pull the AG Studio starter — that is spec-07)
    - _Requirements: 1.4, 1.5, 1.6_

- [x] 6. Checkpoint — install, typecheck, build, lint, and test
  - Run `pnpm install` at root and confirm all five workspaces resolve with success exit; run `pnpm -r run typecheck`, `pnpm -r run build`, `eslint .`, and `vitest run` and confirm all pass
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 1.8, 1.9, 2.5, 2.6, 2.9_

- [x] 7. Create the environment template (.env.example)
  - Create `.env.example` with exactly the 12 keys (`DATABASE_URL`, `JWT_SECRET`, `MANDATE_SIGNING_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_BASE_URL`, `ANTHROPIC_API_KEY`, `AI_MODEL`, `CHANNEL3_API_KEY`, `AG_GRID_LICENSE_KEY`, `APP_BASE_URL`), each exactly once, with non-empty placeholder tokens that are obviously not real credentials
  - _Requirements: 5.1, 5.2, 5.5_

- [x] 8. Create .gitignore
  - Create `.gitignore` excluding `node_modules/`, `dist/`, `build/`, `.env`, and `.env.*`, with a negation `!.env.example` so the template stays tracked
  - _Requirements: 5.3, 5.4, 7.4, 7.5_

- [x] 9. Create the MIT LICENSE file
  - Create `LICENSE` (no extension) at repo root with the complete MIT text: copyright line (four-digit year + holder), the permission-notice paragraph, and the warranty-disclaimer paragraph
  - _Requirements: 6.1, 6.2, 6.3, 8.5_

- [x] 10. Create render.yaml Blueprint using the confirmed spec from task 1
  - Create `render.yaml` with exactly one API web service (`healthCheckPath: /healthz`, build runs filtered pnpm install + `@agentpurse/api...` build, start `node api/dist/index.js`), exactly one web static site, and exactly one managed Postgres
  - Wire `DATABASE_URL` from the managed DB via `fromDatabase` → `connectionString`; declare all other secret env vars by name with `sync: false` (no literal secret values in the file)
  - Apply the confirmed static-site field shape, plan names, and pnpm-on-Render approach (corepack prefix or `packageManager`) from task 1 — remove all `TODO(verify)` markers
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 11. Write the README CONVENTIONS section
  - Create/extend `README.md` with a CONVENTIONS section documenting: the Money_Convention (signed integer cents + ISO 4217) with a worked example (`$12.34 USD` → `{ amountCents: 1234, currency: "USD" }`); secrets supplied exclusively via environment variables and never committed; the required env var names and that their values are excluded from version control; the public MIT license; and the no-third-party-logos/trademarks rule (only first-party or license-cleared assets)
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [-] 12. Initialize Git and create the initial commit
  - Run `git init` at the monorepo root; stage all non-ignored scaffold files and create a single initial commit on the default branch
  - Confirm ignored files/dirs are excluded from the committed content; if nothing is staged, the commit aborts with a "nothing to commit" indication and the repo is left with no commits
  - _Requirements: 7.1, 7.2, 7.3, 7.5_

- [~] 13. Manual deploy + live health verification (Definition of Done)
  - **MANUAL / OUT-OF-BAND — not fully automatable by the agent.** The Repository_Maintainer performs this step with a live Render account.
  - Run `render blueprints validate` against `render.yaml` to catch `fromDatabase` name typos and field-name issues before deploy
  - Push the repo to the Git remote connected to Render, create the Blueprint deployment, and wait for the API web service, web static site, and managed Postgres to provision
  - Send `GET https://<app>.onrender.com/healthz` and confirm HTTP `200` within 2000 ms with a JSON body indicating a healthy state (`{ "status": "ok" }`); if not 200/healthy or unreachable within a 10-second timeout, treat the slice as NOT meeting its definition of done
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

## Notes

- Tasks marked with `*` are optional (test sub-tasks) and can be skipped for a faster MVP, but they implement the design's Correctness Properties and are recommended.
- Property tests (4.5–4.7) use `fast-check` on top of Vitest, run ≥100 iterations each, and are tagged with the exact property name from the design's Correctness Properties section.
- Task 1 is intentionally first: it resolves the design's `TODO(verify)` markers (Render Blueprint field names, plan names, pnpm-on-Render) so render.yaml in task 10 is written from confirmed facts, not guesses.
- Task 13 is a manual, out-of-band maintainer step (live Render deploy + health check); it is the only task the agent cannot fully automate because it depends on an external Render account and a live deployment.
- Each task references the specific requirement sub-clauses it satisfies for traceability.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "3.1"] },
    { "id": 2, "tasks": ["4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3"] },
    { "id": 4, "tasks": ["4.4", "4.5", "4.6", "4.7", "5.1"] },
    { "id": 5, "tasks": ["7", "8", "9", "10", "11"] },
    { "id": 6, "tasks": ["12"] },
    { "id": 7, "tasks": ["13"] }
  ]
}
```
