# Design Document

spec-05 Gateway Rules

## Overview

A pure deterministic rules engine at `/api/src/gateway/` with shared contracts in `/packages/shared`. `evaluateRules(intent, policy, history, now?)` runs ordered fast-fail checks and returns `RuleEvaluationResult`. No I/O, no throw on rule failure, clock injected. This is layer 1 of the Risk Guard; the AI layer (spec-07) may only make a decision stricter.

## Architecture

```
packages/shared/src/
  gateway.ts     zod schemas + types: Policy, RuleIntent, TransactionRecord, RuleEvaluationResult, RuleId
  (index.ts re-exports)
api/src/gateway/
  rules.ts       evaluateRules(...) + the ordered rule list
  budget.ts      spentTodayCents(history, currency, now) + remainingBudget(policy, spent)
  velocity.ts    countWithin(history, windowMs, now)
  errors.ts      GatewayValidationError (field-named, secret-free)
  audit.ts       toAuditMeta(result, intent) -> safe metadata
  index.ts       public surface
  __tests__/     unit + property tests, fixtures
```

## Components and Interfaces

```ts
// shared/gateway.ts
export type RuleId =
  | "currency_mismatch" | "payee_blocked" | "payee_not_allowed"
  | "category_not_allowed" | "per_purchase_cap" | "daily_budget"
  | "velocity_hour" | "velocity_day";

export interface Policy {
  dailyBudgetCents: number; perPurchaseCapCents: number;
  allowedCategories: string[]; blockedPayees: string[];
  allowedPayees?: string[]; velocityPerHour: number; velocityPerDay: number;
}
export interface RuleIntent {
  agentId: string; payee: string; amountCents: number; currency: string;
  category?: string; description?: string;
}
export interface TransactionRecord { amountCents: number; currency: string; payee: string; createdAtMs: number; }
export interface RuleEvaluationResult {
  passed: boolean; reason?: string; remainingBudgetCents: number; matchedRule?: RuleId;
}
```

```ts
// api/src/gateway/rules.ts
export function evaluateRules(
  intent: RuleIntent, policy: Policy, history: TransactionRecord[], now?: () => number,
): RuleEvaluationResult;
```

### Rule order (first failure wins)

1. currency_mismatch - any history currency differing is simply ignored in budget; the check here is intent-level only if a required currency is enforced. (We treat the intent currency as the budget currency; history in other currencies does not count.)
2. payee_blocked - `policy.blockedPayees.includes(intent.payee)`.
3. payee_not_allowed - `allowedPayees?.length && !allowedPayees.includes(payee)`.
4. category_not_allowed - `allowedCategories.length && (!category || !allowedCategories.includes(category))`.
5. per_purchase_cap - `amountCents > perPurchaseCapCents`.
6. daily_budget - `spentTodayCents + amountCents > dailyBudgetCents`.
7. velocity_hour - `countWithin(history, 1h) >= velocityPerHour`.
8. velocity_day - `countWithin(history, 24h) >= velocityPerDay`.

Boundaries: `amount == cap` passes; `spent + amount == budget` passes; `count == limit` fails (limit is the max allowed before this one, i.e. an inclusive ceiling reached). `remainingBudgetCents = max(0, dailyBudgetCents - spentTodayCents)` always in the result.

Note on currency_mismatch: the master data model has a single budget currency per agent. We define the intent currency as authoritative; same-currency history counts toward spend, other-currency history is excluded (Requirement 3.1/3.4). A dedicated currency_mismatch rule fires only if a future policy pins an allowed currency; for now it is reserved in RuleId and not triggered unless policy gains an allowedCurrency. (TODO(verify): confirm single-currency assumption with spec-07.)

## Data Models

Defined in shared (above). Persistence of intents/policies is spec-08; this slice is stateless and reads history as an argument.

## Error Handling

- `GatewayValidationError extends Error` with `field: string`; thrown only for schema-invalid input (not for rule failures). Message names the field, never a value/secret.
- Rule failures are returned as `{ passed:false, matchedRule, reason }`, never thrown.
- No logging inside the engine; callers log via `toAuditMeta`.

## Correctness Properties

### Property 1: remaining budget is never negative

For any valid Policy and TransactionRecord[], `evaluateRules(...).remainingBudgetCents >= 0`.

**Validates: Requirements 3.2**

### Property 2: in-limits intent passes

For any intent/policy/history where amountCents <= perPurchaseCapCents, spentToday + amountCents <= dailyBudgetCents, hour-count < velocityPerHour, day-count < velocityPerDay, payee not blocked, and allowlists (if set) permit payee+category, `passed === true` with no matchedRule.

**Validates: Requirements 2.10, 3.2**

## Testing Strategy

Vitest, no live calls, injected clock. Unit tests: each rule's pass+fail, first-failure ordering, and boundary equalities (cap ==, budget ==, velocity ==). Currency exclusion from spend. Validation errors name the field. Property tests as above (fast-check, >=100 runs). Aim for full branch coverage of rule boundaries.

## TODO(verify)

- Single budget currency per agent (vs multi-currency) - confirm with spec-07/08; currency_mismatch rule is reserved accordingly.
- Day window is rolling 24h from now; if a calendar-day reset is required later, swap the window helper.