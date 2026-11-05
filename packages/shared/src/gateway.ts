import { z } from "zod";

/**
 * Identifiers for the deterministic gateway rules. The order mirrors the
 * first-failure evaluation order in the engine (api/src/gateway). All money
 * is integer cents; no floats, no secrets.
 */
export type RuleId =
  | "currency_mismatch"
  | "payee_blocked"
  | "payee_not_allowed"
  | "category_not_allowed"
  | "per_purchase_cap"
  | "daily_budget"
  | "velocity_hour"
  | "velocity_day";

export const RuleIdSchema = z.enum([
  "currency_mismatch",
  "payee_blocked",
  "payee_not_allowed",
  "category_not_allowed",
  "per_purchase_cap",
  "daily_budget",
  "velocity_hour",
  "velocity_day",
]);

/** Spending policy for an agent. All limits are integer cents. */
export interface Policy {
  dailyBudgetCents: number; // integer cents, >= 0
  perPurchaseCapCents: number; // integer cents, >= 0
  allowedCategories: string[];
  blockedPayees: string[];
  allowedPayees?: string[];
  velocityPerHour: number; // integer count, >= 0
  velocityPerDay: number; // integer count, >= 0
}

export const PolicySchema = z.object({
  dailyBudgetCents: z.number().int().nonnegative(),
  perPurchaseCapCents: z.number().int().nonnegative(),
  allowedCategories: z.array(z.string()),
  blockedPayees: z.array(z.string()),
  allowedPayees: z.array(z.string()).optional(),
  velocityPerHour: z.number().int().nonnegative(),
  velocityPerDay: z.number().int().nonnegative(),
});

/** A purchase intent evaluated by the rules engine. */
export interface RuleIntent {
  agentId: string;
  payee: string;
  amountCents: number; // integer cents, >= 0
  currency: string; // ISO 4217 three-letter code
  category?: string;
  description?: string;
}

export const RuleIntentSchema = z.object({
  agentId: z.string().min(1),
  payee: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  category: z.string().optional(),
  description: z.string().optional(),
});

/** A prior transaction used to compute spend and velocity windows. */
export interface TransactionRecord {
  amountCents: number; // integer cents, >= 0
  currency: string; // ISO 4217 three-letter code
  payee: string;
  createdAtMs: number; // epoch milliseconds, >= 0
}

export const TransactionRecordSchema = z.object({
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  payee: z.string(),
  createdAtMs: z.number().int().nonnegative(),
});

/** Result of evaluating the deterministic rules against an intent. */
export interface RuleEvaluationResult {
  passed: boolean;
  reason?: string;
  remainingBudgetCents: number; // integer cents
  matchedRule?: RuleId;
}

export const RuleEvaluationResultSchema = z.object({
  passed: z.boolean(),
  reason: z.string().optional(),
  remainingBudgetCents: z.number().int(),
  matchedRule: RuleIdSchema.optional(),
});
