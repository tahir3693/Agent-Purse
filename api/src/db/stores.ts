// Store interfaces (spec-08). Services depend on these; Prisma and in-memory
// implementations satisfy them. No Prisma types here. Money = int cents + currency.

export type IntentState =
  | "pending"
  | "denied"
  | "escalated"
  | "authorized"
  | "captured"
  | "voided"
  | "failed";

export interface IntentRecord {
  id: string;
  agentId: string;
  amountCents: number;
  currency: string;
  payee: string;
  category: string;
  description: string;
  justification: string;
  paymentMethodRef: string;
  state: IntentState;
  decision: string | null;
  riskScore: number | null;
  createdAt: Date;
}

export type NewIntent = Omit<
  IntentRecord,
  "id" | "state" | "decision" | "riskScore" | "createdAt"
> &
  Partial<Pick<IntentRecord, "id">>;

export interface IntentStore {
  create(input: NewIntent): Promise<IntentRecord>;
  get(id: string): Promise<IntentRecord | null>;
  /** Returns the intent only if owned by agentId. */
  getForAgent(id: string, agentId: string): Promise<IntentRecord | null>;
  update(
    id: string,
    patch: Partial<Pick<IntentRecord, "state" | "decision" | "riskScore">>,
  ): Promise<IntentRecord>;
  /** Recent authorized/captured intents for risk history. */
  listRecentForAgent(agentId: string, limit: number): Promise<IntentRecord[]>;
}

export interface AuthorizationRecord {
  id: string;
  intentId: string;
  providerTxnId: string;
  status: string;
}

export interface AuthorizationStore {
  create(input: {
    intentId: string;
    providerTxnId: string;
    status: string;
  }): Promise<AuthorizationRecord>;
  getByIntent(intentId: string): Promise<AuthorizationRecord | null>;
  updateStatusByProviderTxnId(providerTxnId: string, status: string): Promise<number>;
}

export interface MandateRecord {
  jti: string;
  intentId: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface MandateStore {
  create(m: { jti: string; intentId: string; expiresAt: Date }): Promise<void>;
  get(jti: string): Promise<MandateRecord | null>;
  /**
   * Atomic single-use consume: sets consumedAt only where consumedAt is null
   * and expiresAt > now. Returns true iff exactly one row was updated.
   */
  consume(jti: string, now: Date): Promise<boolean>;
}

export interface AuditEntry {
  id: string;
  intentId: string | null;
  event: string;
  meta: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditStore {
  /** meta must never contain intent text, tokens or keys. */
  append(entry: {
    intentId: string | null;
    event: string;
    meta?: Record<string, unknown>;
  }): Promise<void>;
  listByIntent(intentId: string): Promise<AuditEntry[]>;
}

export interface WebhookEventStore {
  /** true = newly claimed; false = duplicate. */
  claim(eventId: string): Promise<boolean>;
}

export interface AgentRecord {
  id: string;
  apiKeyHash: string;
  killed: boolean;
}

export interface AgentPolicyRecord {
  /** spec-05 Policy JSON (validated by the caller). */
  policy: unknown;
  riskConfig: unknown;
}

export interface AgentPolicyStore {
  findAgentByKeyHash(apiKeyHash: string): Promise<AgentRecord | null>;
  getPolicy(agentId: string): Promise<AgentPolicyRecord | null>;
}
