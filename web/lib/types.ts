// Shapes returned by the owner API (spec-06b, spec-09a). Money is integer cents.
export type IntentState =
  | "pending"
  | "denied"
  | "escalated"
  | "authorized"
  | "captured"
  | "voided"
  | "failed";
export const INTENT_STATES: IntentState[] = [
  "pending",
  "escalated",
  "authorized",
  "captured",
  "denied",
  "voided",
  "failed",
];

export interface Intent {
  id: string;
  agentId: string;
  amountCents: number;
  currency: string;
  payee: string;
  category: string;
  description: string;
  justification: string;
  paymentMethodId: string;
  state: IntentState;
  decision: string | null;
  riskScore: number | null;
  createdAt: string;
}

export interface AuditEvent {
  event: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface IntentDetail {
  intent: Intent;
  events: AuditEvent[];
}

export interface Stats {
  since: string;
  spentToday: { currency: string; amountCents: number }[];
  countsByDecision: Partial<
    Record<"approve" | "deny" | "escalate" | "none", number>
  >;
  countsByState: Record<string, number>;
}

export interface Agent {
  id: string;
  name: string;
  killed: boolean;
  createdAt: string;
}

export interface VaultMethod {
  id: string;
  cardType: string | null;
  last4: string | null;
  tokenRef: string;
  createdAt: string;
}

export interface DecisionInfo {
  reason: string | null;
  priceStatus: string;
  priceMedianCents: number | null;
  priceSampleSize: number;
}

const DECISION_EVENTS = new Set([
  "intent_escalated",
  "intent_denied",
  "risk_approved",
]);

/** Extract the Risk Guard decision record from audit events (spec-09a). */
export function decisionInfo(events: AuditEvent[]): DecisionInfo {
  const e = [...events].reverse().find((x) => DECISION_EVENTS.has(x.event));
  const m = e?.meta ?? {};
  return {
    reason: typeof m["reason"] === "string" ? m["reason"] : null,
    priceStatus:
      typeof m["priceStatus"] === "string" ? m["priceStatus"] : "unknown",
    priceMedianCents:
      typeof m["priceMedianCents"] === "number" ? m["priceMedianCents"] : null,
    priceSampleSize:
      typeof m["priceSampleSize"] === "number" ? m["priceSampleSize"] : 0,
  };
}
