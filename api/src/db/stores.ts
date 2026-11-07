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
    patch: Partial<Pick<IntentRecord, "state" | "decision" | "riskScore">>
  ): Promise<IntentRecord>;
  /** Recent authorized/captured intents for risk history. */
  listRecentForAgent(agentId: string, limit: number): Promise<IntentRecord[]>;
  /** Intents of the given agents, newest first. Empty agentIds => []. */
  listByAgents(
    agentIds: string[],
    opts: { state?: IntentState; since?: Date; limit: number }
  ): Promise<IntentRecord[]>;
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
  updateStatusByProviderTxnId(
    providerTxnId: string,
    status: string
  ): Promise<number>;
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
  ownerId?: string | null;
  name?: string;
}

export interface OwnerRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface OwnerStore {
  /** Email is stored lowercased. Duplicate throws plain Error('Unique constraint: email'). */
  create(input: { email: string; passwordHash: string }): Promise<OwnerRecord>;
  /** Lowercases the lookup email. */
  findByEmail(email: string): Promise<OwnerRecord | null>;
  findById(id: string): Promise<OwnerRecord | null>;
  /** Replaces the stored hash. Returns false if the owner does not exist. */
  setPasswordHash(id: string, passwordHash: string): Promise<boolean>;
}

export interface AgentAdminStore {
  create(input: {
    ownerId: string;
    name: string;
    apiKeyHash: string;
  }): Promise<AgentRecord & { createdAt: Date }>;
  /** Newest first. */
  listByOwner(ownerId: string): Promise<(AgentRecord & { createdAt: Date })[]>;
  /** null if the agent does not belong to ownerId. */
  getForOwner(
    id: string,
    ownerId: string
  ): Promise<(AgentRecord & { createdAt: Date }) | null>;
  /** false if the agent does not belong to ownerId. */
  setKilled(id: string, ownerId: string, killed: boolean): Promise<boolean>;
  /** Upsert. Callers validate policy/riskConfig first. */
  setPolicy(
    agentId: string,
    policy: unknown,
    riskConfig: unknown
  ): Promise<void>;
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

export interface VaultMethodRecord {
  id: string;
  ownerId: string;
  customerId: string;
  token: string;
  cardType: string | null;
  last4: string | null;
  createdAt: Date;
}
export interface VaultStore {
  /** Unique on (ownerId, token); a duplicate throws a plain Error. */
  create(m: {
    ownerId: string;
    customerId: string;
    token: string;
    cardType?: string | null;
    last4?: string | null;
  }): Promise<VaultMethodRecord>;
  findByOwnerAndToken(
    ownerId: string,
    token: string
  ): Promise<VaultMethodRecord | null>;
  /** Newest first. */
  listByOwner(ownerId: string): Promise<VaultMethodRecord[]>;
  /** Returns the method only if it belongs to ownerId. */
  findByIdForOwner(
    id: string,
    ownerId: string
  ): Promise<VaultMethodRecord | null>;
}
