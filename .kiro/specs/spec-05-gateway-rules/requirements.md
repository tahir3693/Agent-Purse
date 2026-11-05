# Requirements Document

spec-05 Gateway Rules

## Introduction

The deterministic rules engine at `/api/src/gateway/` validates an agent purchase intent before any AI Risk Guard evaluation or PayPal call. It is pure, synchronous, and side-effect free: given an intent, a policy, and recent transaction history, it returns a structured decision. Deterministic rules run first and fail fast, so a rejected intent never incurs LLM latency/credits or a payment call. Shared types/schemas live in `/packages/shared`. All money is integer cents. The AI layer (spec-07) may only make a decision stricter, never loosen these rules.

## Glossary

- Intent: an agent purchase request { agentId, payee, description, amountCents, currency, category?, justification, channel3ProductId? }.
- Policy: per-agent limits { dailyBudgetCents, perPurchaseCapCents, allowedCategories[], blockedPayees[], allowedPayees?[], velocityPerHour, velocityPerDay }.
- Transaction history: prior committed/authorized spends for the agent, each { amountCents, currency, payee, createdAtMs }, used for budget and velocity.
- RuleEvaluationResult: { passed, reason?, remainingBudgetCents, matchedRule? }.
- matchedRule: the id of the first failing rule (e.g. "per_purchase_cap").
- Allowlist mode: when allowedPayees/allowedCategories are non-empty, only listed values pass (restricted); empty means unrestricted except blocklist.
- Fast-fail: evaluation stops at the first failing rule and returns immediately.

## Requirements

### Requirement 1: Policy and intent data model (shared, integer cents)

**User Story:** As an API developer, I want typed policy/intent/result shapes in shared, so every layer agrees on the contract and money stays in cents.

#### Acceptance Criteria
1. The system SHALL define in `/packages/shared` zod schemas + types for Policy, RuleIntent, TransactionRecord, and RuleEvaluationResult.
2. All monetary fields (dailyBudgetCents, perPurchaseCapCents, amountCents) SHALL be validated as integers (z.number().int()).
3. Policy SHALL include dailyBudgetCents, perPurchaseCapCents, allowedCategories (string[]), blockedPayees (string[]), optional allowedPayees (string[]), velocityPerHour (int), velocityPerDay (int).
4. RuleEvaluationResult SHALL be { passed: boolean, reason?: string, remainingBudgetCents: number, matchedRule?: string }.

### Requirement 2: Deterministic evaluation pipeline

**User Story:** As the gateway, I want ordered fast-fail checks, so a bad intent is rejected before any AI or payment step.

#### Acceptance Criteria
1. The system SHALL export `evaluateRules(intent, policy, history): RuleEvaluationResult` that is pure, synchronous, and side-effect free.
2. The pipeline SHALL evaluate rules in this fixed order and stop at the first failure: (a) currency match, (b) payee allowlist/blocklist, (c) category allowlist, (d) per-purchase cap, (e) daily budget, (f) velocity per hour, (g) velocity per day.
3. WHEN the payee is in blockedPayees THEN result SHALL be passed=false, matchedRule="payee_blocked".
4. WHEN allowedPayees is non-empty AND the payee is not listed THEN passed=false, matchedRule="payee_not_allowed".
5. WHEN allowedCategories is non-empty AND the intent category is missing or not listed THEN passed=false, matchedRule="category_not_allowed".
6. WHEN amountCents > perPurchaseCapCents THEN passed=false, matchedRule="per_purchase_cap".
7. WHEN (spentTodayCents + amountCents) > dailyBudgetCents THEN passed=false, matchedRule="daily_budget".
8. WHEN transactions in the last hour >= velocityPerHour THEN passed=false, matchedRule="velocity_hour".
9. WHEN transactions in the last 24h >= velocityPerDay THEN passed=false, matchedRule="velocity_day".
10. WHEN all checks pass THEN passed=true with no matchedRule and no reason.

### Requirement 3: Budget accounting and remainingBudgetCents

**User Story:** As a caller, I want the remaining daily budget in every result, so the UI and AI layer can reason about headroom.

#### Acceptance Criteria
1. spentTodayCents SHALL be the sum of history amounts whose currency matches and whose createdAtMs falls within the current day window (rolling 24h from now).
2. remainingBudgetCents SHALL equal max(0, dailyBudgetCents - spentTodayCents) and SHALL never be negative.
3. remainingBudgetCents SHALL be present in both pass and fail results.
4. Only same-currency history SHALL count toward spentTodayCents; a currency mismatch on the intent itself SHALL fail at rule (a) with matchedRule="currency_mismatch".

### Requirement 4: Fail-fast, no downstream side effects

**User Story:** As the platform, I want a failed rule check to halt the request, so no AI or PayPal work happens on a doomed intent.

#### Acceptance Criteria
1. evaluateRules SHALL NOT perform I/O, network calls, logging, time mutation, or throw for ordinary rule failures (failures are returned, not thrown).
2. The function SHALL read "now" from an injected clock parameter (default Date.now) so tests are deterministic.
3. Callers SHALL treat passed=false as a hard stop that skips AI and payment (documented contract; enforced by returning early).

### Requirement 5: Structured errors and audit metadata

**User Story:** As an operator, I want typed errors for malformed input and safe audit metadata, so failures are diagnosable without leaking secrets.

#### Acceptance Criteria
1. WHEN intent/policy/history fail schema validation THEN the system SHALL surface a typed validation error naming the offending field, never a secret.
2. The engine SHALL expose audit metadata (evaluated rule id, decision, remainingBudgetCents) suitable for the audit log.
3. No token, key, or secret SHALL ever be logged by this module.

### Requirement 6: Tests and coverage

**User Story:** As a maintainer, I want exhaustive deterministic tests, so every boundary is locked down.

#### Acceptance Criteria
1. Unit tests SHALL cover each rule passing and failing, including order (first failure wins) and all boundary equalities (amount == cap passes; spent+amount == budget passes; count == limit fails).
2. A fast-check property test SHALL assert remainingBudgetCents >= 0 for arbitrary policy/history, and that amount <= cap AND spent+amount <= budget AND within velocity implies passed=true (when allowlists permit).
3. Tests SHALL achieve full branch coverage of the rule boundaries and run under `vitest run` with no live calls.