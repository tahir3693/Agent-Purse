# Implementation Plan

spec-11a demo agent. Offline tests, no secrets printed, existing tests stay green.

## Overview

Make the two API changes, scaffold the demo-agent with its core modules, then add scenarios, runner and CLI, the AI key check, root scripts, README and CI, then verify and commit.

## Tasks

- [x] 1. API changes: productId and above-limit stage
  - `api/src/intents/schema.ts`: add `productId: z.string().trim().min(1).max(200).optional()`; `service.ts`: pass it to `evaluateRisk` and strip it before `intents.create` (not persisted)
  - `api/src/risk/combine.ts`: deterministic stage escalating when amount is above `autoApproveBelowCents`, with precedence from the design (rules, injection, price high, above limit, AI failure, AI not approved, AI risk, approve)
  - Tests: productId valid, empty, over 200, absent, not persisted; combine stage; fast-check Property 3 (never approve above limit or price "high", regardless of AI), tagged `Feature: spec-11a-demo-agent, Property 3`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 6.2, 8.3_

- [x] 2. Demo-agent scaffold and core modules
  - `demo-agent/package.json` (`@agentpurse/demo-agent`, scripts `start` = `node --env-file-if-exists=../.env --import tsx src/cli.ts`, `typecheck` = `tsc --noEmit`, `build` = `tsc --noEmit`; `tsx` as exact-pinned devDependency); `tsconfig.json` without `rootDir` or `outDir`
  - `config.ts` (loadConfig, missing variable names only), `money.ts` (integer-only formatCents), `transcript.ts` (line, redact to 8 chars plus "...", cap 200), `api.ts` (AgentApi interface plus HttpAgentApi with Bearer key), `catalog.ts` (Catalog over `../../api/src/channel3/index.js`, pickOffer)
  - Tests: config missing/empty names variable and no values, formatCents, redaction, pickOffer cheapest in-stock within budget and none; fast-check Property 2 (offer selection minimal), tagged `Feature: spec-11a-demo-agent, Property 2`
  - `.env.example` lists DEMO_API_BASE_URL, DEMO_AGENT_KEY, DEMO_PAYMENT_METHOD_ID with placeholders; update the secrets-checker allowlist if needed
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 7.2, 7.4, 8.1, 8.2_

- [x] 3. Scenarios, runner and CLI with tests
  - `scenarios.ts` with the six scenarios (small-safe, needs-approval, over-cap, overpriced, injection, replay) using injected clock and sleep; `runner.ts` prints the sandbox banner first, PASS or FAIL per scenario, non-zero exit if any fails; `cli.ts` parses `--scenario <name|all>`, lists valid names on missing or unknown
  - Tests with stub AgentApi and Catalog: each scenario PASS and FAIL path, needs-approval polling and timeout, no offer within budget submits no intent, CLI arg parsing and exit codes; fast-check Property 1 (transcript never leaks DEMO_AGENT_KEY or a full token), tagged `Feature: spec-11a-demo-agent, Property 1`
  - _Requirements: 2.3, 2.4, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.3, 7.4, 8.2_

- [x] 4. demo:check AI key and model check
  - `api/src/risk/check.ts`: one Anthropic Messages call (`max_tokens` 5) using ANTHROPIC_API_KEY and AI_MODEL, prints only `AI check: OK (model ...)` or `AI check: FAILED (auth|quota|model|network|unknown)`; pure `classifyAnthropicError` (401/403 auth, 429/529 quota, 404/400 model, fetch/abort network)
  - api script `ai:check`; root script `demo:check` = `pnpm --filter @agentpurse/api run ai:check`
  - Tests for `classifyAnthropicError` only; no live call in tests
  - _Requirements: 8.1, 8.4, 9.4_

- [x] 5. Root scripts, README and CI
  - Root `package.json`: `demo:run` = `pnpm --filter @agentpurse/demo-agent run start`
  - `demo-agent/README.md`: exact command for each of the six scenarios and `--scenario all`, variable names only, Braintree sandbox no real money, Channel3 real catalog data, how the Channel3 module is shared
  - `.github/workflows/ci.yml`: build workspace packages before the typecheck step
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 8.4_

- [x] 6. Verify gates and commit
  - `pnpm -r run typecheck`, `pnpm lint`, `pnpm -r run build`, `pnpm test`, `pnpm check:env-example`
  - Commit "feat(demo-agent): shopping agent scenarios (spec-11a)": stage by explicit path, check staged file names for secrets (names only, never values), confirm `.env` is not staged, no push
  - _Requirements: 1.4, 8.4_

## Notes

- Never print keys or tokens. Do not run live calls or smoke scripts.
- Tests with `*` are not used here; tests live inside their tasks.
- TODO(verify): live Channel3 results, whether the AI approves small-safe, Render cold start on first call.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3", "4"] },
    { "id": 2, "tasks": ["5"] },
    { "id": 3, "tasks": ["6"] }
  ]
}
```
