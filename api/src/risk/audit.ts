// Risk audit metadata (Requirement 6.1).
//
// Builds a flat, secret-free projection. Takes only structured fields, so
// intent text, prompts and keys cannot leak into it by construction.

import type { RiskAuditMeta } from "./types.js";

/** Build audit metadata, omitting undefined optional fields and clamping the score to 0-100. */
export function toRiskAuditMeta(parts: RiskAuditMeta): RiskAuditMeta {
  const meta: RiskAuditMeta = {
    stageReached: parts.stageReached,
    aiOutcome: parts.aiOutcome,
    flagPromptInjection: parts.flagPromptInjection,
    riskScore: Math.min(100, Math.max(0, Math.round(parts.riskScore))),
  };
  if (parts.matchedRule !== undefined) meta.matchedRule = parts.matchedRule;
  if (parts.priceStatus !== undefined) meta.priceStatus = parts.priceStatus;
  return meta;
}
