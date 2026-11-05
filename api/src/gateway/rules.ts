// Deterministic gateway rules engine (spec-05), layer 1 of the Risk Guard.
//
// evaluateRules runs ordered fast-fail checks and returns a
// RuleEvaluationResult. It is PURE and SYNCHRONOUS: no I/O, no logging, no
// secrets, no mutation of inputs. The clock is injected as `nowMs` for
// determinism. All money is integer cents (see money-rules.md). Rule
// failures are RETURNED, never thrown; only schema-invalid input throws
// (GatewayValidationError).

import {
  PolicySchema,
  RuleIntentSchema,
  TransactionRecordSchema,
  type Policy,
  type RuleIntent,
  type TransactionRecord,
  type RuleEvaluationResult,
} from "@agentpurse/shared";

import { remainingBudget, spentTodayCents } from "./budget.js";
import { GatewayValidationError } from "./errors.js";
import { countWithin, DAY_MS, HOUR_MS } from "./velocity.js";

/** Minimal structural shape of a zod validation error (avoids a direct zod dep). */
interface ValidationIssueCarrier {
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number> }>;
}

/** Join the first validation issue path into a dotted field name (e.g. "policy.allowedPayees.0"). */
function fieldFromValidationError(prefix: string, error: ValidationIssueCarrier): string {
  const issue = error.issues[0];
  const path = issue?.path ?? [];
  return [prefix, ...path.map((segment) => String(segment))].join(".");
}

/**
 * Evaluate the deterministic spending rules for a single purchase intent.
 *
 * Validates inputs with the shared zod schemas first; on failure throws
 * GatewayValidationError naming the first offending field. Does NOT throw for
 * rule failures.
 *
 * remainingBudgetCents is computed once and included in EVERY result (pass or
 * fail). Rules are checked in a fixed order; the first failure wins.
 *
 * Boundaries: amount == cap PASSES; spent + amount == budget PASSES;
 * count == limit FAILS.
 */
export function evaluateRules(
  intent: RuleIntent,
  policy: Policy,
  history: TransactionRecord[],
  nowMs: number = Date.now(),
): RuleEvaluationResult {
  // --- Input validation (throws only on malformed input, never rule failure) ---
  const intentParsed = RuleIntentSchema.safeParse(intent);
  if (!intentParsed.success) {
    throw new GatewayValidationError({
      field: fieldFromValidationError("intent", intentParsed.error),
    });
  }
  const policyParsed = PolicySchema.safeParse(policy);
  if (!policyParsed.success) {
    throw new GatewayValidationError({
      field: fieldFromValidationError("policy", policyParsed.error),
    });
  }
  const historyParsed = TransactionRecordSchema.array().safeParse(history);
  if (!historyParsed.success) {
    throw new GatewayValidationError({
      field: fieldFromValidationError("history", historyParsed.error),
    });
  }

  // --- Budget math (same-currency spend within rolling 24h) ---
  const spent = spentTodayCents(history, intent.currency, nowMs);
  const remainingBudgetCents = remainingBudget(policy.dailyBudgetCents, spent);

  // currency_mismatch: reserved in RuleId but NOT triggered in this slice. We
  // assume a single budget currency per agent; other-currency history is
  // simply excluded from spend by budget.ts, so no dedicated check fires here.

  // a. payee_blocked
  if (policy.blockedPayees.includes(intent.payee)) {
    return {
      passed: false,
      matchedRule: "payee_blocked",
      reason: "payee is blocked",
      remainingBudgetCents,
    };
  }

  // b. payee_not_allowed (only enforced when an allowlist is set)
  if (
    policy.allowedPayees &&
    policy.allowedPayees.length > 0 &&
    !policy.allowedPayees.includes(intent.payee)
  ) {
    return {
      passed: false,
      matchedRule: "payee_not_allowed",
      reason: "payee is not in the allowlist",
      remainingBudgetCents,
    };
  }

  // c. category_not_allowed (only enforced when an allowlist is set)
  if (
    policy.allowedCategories.length > 0 &&
    (!intent.category || !policy.allowedCategories.includes(intent.category))
  ) {
    return {
      passed: false,
      matchedRule: "category_not_allowed",
      reason: "category is not in the allowlist",
      remainingBudgetCents,
    };
  }

  // d. per_purchase_cap (amount == cap PASSES)
  if (intent.amountCents > policy.perPurchaseCapCents) {
    return {
      passed: false,
      matchedRule: "per_purchase_cap",
      reason: "amount exceeds per-purchase cap",
      remainingBudgetCents,
    };
  }

  // e. daily_budget (spent + amount == budget PASSES)
  if (spent + intent.amountCents > policy.dailyBudgetCents) {
    return {
      passed: false,
      matchedRule: "daily_budget",
      reason: "amount exceeds remaining daily budget",
      remainingBudgetCents,
    };
  }

  // f. velocity_hour (count == limit FAILS)
  if (countWithin(history, HOUR_MS, nowMs) >= policy.velocityPerHour) {
    return {
      passed: false,
      matchedRule: "velocity_hour",
      reason: "hourly transaction velocity limit reached",
      remainingBudgetCents,
    };
  }

  // g. velocity_day (count == limit FAILS)
  if (countWithin(history, DAY_MS, nowMs) >= policy.velocityPerDay) {
    return {
      passed: false,
      matchedRule: "velocity_day",
      reason: "daily transaction velocity limit reached",
      remainingBudgetCents,
    };
  }

  // All rules passed.
  return { passed: true, remainingBudgetCents };
}
