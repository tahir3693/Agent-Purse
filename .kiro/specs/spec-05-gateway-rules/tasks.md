# Implementation Plan

spec-05 Gateway Rules. Pure deterministic engine at /api/src/gateway/ with shared contracts in /packages/shared. No I/O; injected clock; tests have no live calls.

## Overview

Shared schemas first, then budget/velocity helpers, then evaluateRules with ordered fast-fail, then errors/audit, then unit + property tests, then verify gates.

## Tasks

- [x] 1. Shared contracts (packages/shared)
  - Add shared/src/gateway.ts: zod schemas + types for Policy, RuleIntent, TransactionRecord, RuleEvaluationResult, RuleId. All money fields z.number().int()
  - Re-export from shared/src/index.ts
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Budget + velocity helpers
  - budget.ts: spentTodayCents(history, currency, now) (same-currency, within rolling 24h); remainingBudget(dailyBudgetCents, spent) = max(0, diff)
  - velocity.ts: countWithin(history, windowMs, now)
  - _Requirements: 3.1, 3.2, 2.8, 2.9_

- [x] 3. evaluateRules pipeline
  - rules.ts: evaluateRules(intent, policy, history, now=Date.now) pure/sync; ordered fast-fail per design (payee_blocked, payee_not_allowed, category_not_allowed, per_purchase_cap, daily_budget, velocity_hour, velocity_day); always set remainingBudgetCents; boundaries: amount==cap pass, spent+amount==budget pass, count==limit fail
  - errors.ts: GatewayValidationError(field); validate inputs via shared schemas, throw only on malformed input
  - audit.ts: toAuditMeta(result, intent) secret-free
  - index.ts: public surface
  - _Requirements: 2.1-2.10, 3.3, 3.4, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3_

- [x] 4. Unit tests (all permutations + boundaries)
  - Each rule pass+fail; first-failure ordering; boundary equalities; currency exclusion from spend; validation error names field; no secrets logged
  - _Requirements: 6.1, 6.3_

- [x] 5. Property tests (fast-check, >=100 iters)
  - Property 1: remainingBudgetCents >= 0 for arbitrary policy/history. Tag: `// Feature: spec-05-gateway-rules, Property 1: remaining budget non-negative`
  - Property 2: in-limits intent => passed=true. Tag: `// Feature: spec-05-gateway-rules, Property 2: in-limits intent passes`
  - _Requirements: 6.2_

- [x] 6. Verify gates
  - pnpm --filter @agentpurse/api typecheck; pnpm -r run typecheck; build; lint; vitest run; fix failures
  - _Requirements: 6.3_

## Notes

- Engine is pure/sync/side-effect free; rule failures returned not thrown; clock injected.
- Money is integer cents throughout; remainingBudgetCents never negative.
- No tokens/secrets logged. TODO(verify): single budget currency assumption (currency_mismatch reserved); rolling-24h vs calendar-day window.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3"] },
    { "id": 3, "tasks": ["4", "5"] },
    { "id": 4, "tasks": ["6"] }
  ]
}
```