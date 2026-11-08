// Pure decision combiner (spec-07). No I/O, no logging, no mutation.
//
// Precedence (first match wins). The AI can only keep or tighten a decision:
//   0. rules failed                                   -> deny (score 100)
//   1. injection heuristic hit or AI flagPromptInjection -> deny
//   2. price "high"                                    -> escalate
//   3. amount > autoApproveBelowCents (deterministic)  -> escalate
//   4. AI failure (error / timeout / parse)            -> escalate (score 100)
//   5. AI approved === false                           -> escalate
//   6. AI riskScore > maxAutoApproveRisk               -> escalate
//   7. otherwise                                       -> approve
// Stages 2 and 3 do not depend on the AI, so a high price or an amount above
// the auto-approve limit can never end in approve (spec-11a).
// riskScore = max(AI score, floors): high price 70, unknown 50, injection 100.
// Note: Requirement 5.2 says "at least escalate" for a heuristic hit; the
// design's stricter `deny` satisfies that (deny is stricter than escalate).

import type { RuleEvaluationResult } from "@agentpurse/shared";

import type { PriceCheckResult } from "../channel3/index.js";
import { toRiskAuditMeta } from "./audit.js";
import type {
  AiResult,
  Decision,
  RiskAuditMeta,
  RiskDecision,
  RiskGuardConfig,
} from "./types.js";

export const PRICE_HIGH_FLOOR = 70;
export const PRICE_UNKNOWN_FLOOR = 50;
export const INJECTION_FLOOR = 100;

export interface CombineSignals {
  rules: RuleEvaluationResult;
  price: PriceCheckResult;
  /** Result of the deterministic injection heuristic over Intent_Text. */
  injectionHit: boolean;
  ai: AiResult;
  /** Intent amount in integer cents (needed for the unknown-price threshold). */
  amountCents: number;
}

export function combine(
  signals: CombineSignals,
  config: RiskGuardConfig
): RiskDecision {
  const { rules, price, injectionHit, ai, amountCents } = signals;

  // 0. Deterministic rules always win; the later stages never ran.
  if (!rules.passed) {
    return {
      decision: "deny",
      riskScore: 100,
      reason: rules.reason ?? "denied by policy rules",
      audit: toRiskAuditMeta({
        stageReached: "rules",
        ...(rules.matchedRule !== undefined
          ? { matchedRule: rules.matchedRule }
          : {}),
        aiOutcome: "skipped",
        flagPromptInjection: false,
        riskScore: 100,
      }),
    };
  }

  const aiOk = ai.outcome === "ok" ? ai.review : undefined;
  const flagPromptInjection =
    injectionHit || aiOk?.flagPromptInjection === true;

  let floor = 0;
  if (price.status === "high") floor = Math.max(floor, PRICE_HIGH_FLOOR);
  if (price.status === "unknown") floor = Math.max(floor, PRICE_UNKNOWN_FLOOR);
  if (flagPromptInjection) floor = Math.max(floor, INJECTION_FLOOR);
  if (!aiOk) floor = 100;
  const riskScore = Math.max(aiOk?.riskScore ?? 0, floor);

  let decision: Decision;
  let reason: string;
  if (flagPromptInjection) {
    decision = "deny";
    reason = "possible prompt injection in intent text";
  } else if (price.status === "high") {
    decision = "escalate";
    reason = "amount is well above the market price";
  } else if (amountCents > config.autoApproveBelowCents) {
    decision = "escalate";
    reason = "amount above auto-approve limit; owner approval required";
  } else if (!aiOk) {
    decision = "escalate";
    reason = `AI review unavailable (${ai.outcome}); human review required`;
  } else if (!aiOk.approved) {
    decision = "escalate";
    reason = "AI review did not approve; human review required";
  } else if (aiOk.riskScore > config.maxAutoApproveRisk) {
    decision = "escalate";
    reason = "AI risk score above auto-approve limit";
  } else {
    decision = "approve";
    reason = "passed rules, price check and AI review";
  }

  const audit: RiskAuditMeta = toRiskAuditMeta({
    stageReached: "ai",
    priceStatus: price.status,
    aiOutcome: ai.outcome,
    flagPromptInjection,
    riskScore,
  });
  return { decision, riskScore: audit.riskScore, reason, audit };
}
