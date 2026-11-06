// Public surface of the Risk Guard module (spec-07).

export { evaluateRisk } from "./guard.js";
export type { RiskGuardDeps } from "./guard.js";
export { combine } from "./combine.js";
export { detectInjection } from "./injection.js";
export { AiReviewSchema, parseAiReview } from "./schema.js";
export { toRiskAuditMeta } from "./audit.js";
export type { ReviewRequest, RiskReviewer } from "./reviewer.js";
export type {
  AiOutcome,
  AiResult,
  AiReview,
  Decision,
  RiskAuditMeta,
  RiskDecision,
  RiskGuardConfig,
  RiskInput,
  RiskStage,
} from "./types.js";
