// Gateway audit metadata.
//
// toAuditMeta projects a rule evaluation result + intent into a flat,
// secret-free shape safe to write to the audit log. Only structured fields
// are included: the free-text description/justification is deliberately
// omitted because it is untrusted input and could carry prompt injection or
// sensitive data. No secrets, no mutation of inputs.

import type { RuleEvaluationResult, RuleId, RuleIntent } from "@agentpurse/shared";

/** Flat, audit-safe metadata for a single rule evaluation. */
export interface AuditMeta {
  agentId: string;
  payee: string;
  amountCents: number;
  currency: string;
  decision: "pass" | "fail";
  matchedRule?: RuleId;
  remainingBudgetCents: number;
}

/**
 * Build audit-safe metadata from a rule evaluation result and the intent it
 * was evaluated against. Includes only structured fields; excludes free-text
 * (description/justification) to avoid leaking untrusted or sensitive content.
 */
export function toAuditMeta(result: RuleEvaluationResult, intent: RuleIntent): AuditMeta {
  const meta: AuditMeta = {
    agentId: intent.agentId,
    payee: intent.payee,
    amountCents: intent.amountCents,
    currency: intent.currency,
    decision: result.passed ? "pass" : "fail",
    remainingBudgetCents: result.remainingBudgetCents,
  };
  if (result.matchedRule !== undefined) {
    meta.matchedRule = result.matchedRule;
  }
  return meta;
}
