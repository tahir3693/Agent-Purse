// Risk Guard types (spec-07).
//
// Provider-neutral and secret-free. All money is integer cents (money-rules.md).
// Nothing here references Anthropic or any other AI provider.

import type { PriceCheckResult } from "../channel3/index.js";
import type { Policy, RuleId, RuleIntent, TransactionRecord } from "@agentpurse/shared";

/** The three possible outcomes of a risk evaluation. */
export type Decision = "approve" | "deny" | "escalate";

/** Strictly validated AI review output (see schema.ts). */
export interface AiReview {
  approved: boolean;
  /** Integer 0-100. */
  riskScore: number;
  reason: string;
  flagPromptInjection: boolean;
}

/** Outcome of the AI review stage. `skipped` means the stage was never reached. */
export type AiOutcome = "ok" | "ai_error" | "ai_timeout" | "ai_parse" | "skipped";

/** Result of the AI stage as consumed by combine. */
export type AiResult =
  | { outcome: "ok"; review: AiReview }
  | { outcome: "ai_error" | "ai_timeout" | "ai_parse" };

/** Last pipeline stage that ran for a decision. */
export type RiskStage = "rules" | "price" | "ai";

/** Everything the guard needs to evaluate one purchase intent. */
export interface RiskInput {
  /** Structured intent for the deterministic rules (includes description, category). */
  intent: RuleIntent;
  /** Agent's free-text justification. Untrusted. */
  justification: string;
  /** Optional Channel3 product id for an exact price comparison. */
  productId?: string;
  /** Optional product title for a search-based price comparison. */
  title?: string;
  policy: Policy;
  history: TransactionRecord[];
}

/** Audit-safe metadata. Never contains intent text, prompts, or keys. */
export interface RiskAuditMeta {
  stageReached: RiskStage;
  matchedRule?: RuleId;
  priceStatus?: PriceCheckResult["status"];
  /** Channel3 market median in integer cents, when the price check found offers. */
  priceMedianCents?: number | null;
  /** Number of offers the median was computed from. */
  priceSampleSize?: number;
  aiOutcome: AiOutcome;
  flagPromptInjection: boolean;
  /** Integer 0-100. */
  riskScore: number;
}

export interface RiskDecision {
  decision: Decision;
  /** Integer 0-100. */
  riskScore: number;
  /** Short, non-sensitive reason. Does not echo intent text. */
  reason: string;
  audit: RiskAuditMeta;
}

/** Tunables supplied by the caller (owner policy storage is spec-08). */
export interface RiskGuardConfig {
  /** Amounts above this are never auto-approved (deterministic escalate). */
  autoApproveBelowCents: number;
  /** AI riskScore above this escalates. */
  maxAutoApproveRisk: number;
  /** Abort the reviewer call after this many ms. */
  aiTimeoutMs: number;
}
