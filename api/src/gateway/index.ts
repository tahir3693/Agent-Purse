// Public surface of the deterministic gateway rules engine (spec-05).
//
// Pure, synchronous, secret-free. Callers import evaluateRules plus the
// audit projection and error type from here. Shared contracts are re-exported
// for convenience so consumers need not reach into @agentpurse/shared.

export { evaluateRules } from "./rules.js";
export { GatewayValidationError } from "./errors.js";
export type { GatewayValidationErrorOptions } from "./errors.js";
export { toAuditMeta } from "./audit.js";
export type { AuditMeta } from "./audit.js";

// Re-export shared gateway types for convenience.
export type {
  RuleId,
  Policy,
  RuleIntent,
  TransactionRecord,
  RuleEvaluationResult,
} from "@agentpurse/shared";
