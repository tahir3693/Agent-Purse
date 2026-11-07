// In-memory fakes with the same semantics as the Prisma stores (for tests).
import { randomUUID } from "node:crypto";
import type {
  AgentAdminStore,
  OwnerRecord,
  OwnerStore,
  AgentPolicyRecord,
  AgentPolicyStore,
  AgentRecord,
  AuditEntry,
  AuditStore,
  AuthorizationRecord,
  AuthorizationStore,
  IntentRecord,
  IntentStore,
  MandateRecord,
  MandateStore,
  VaultMethodRecord,
  VaultStore,
  WebhookEventStore,
} from "./stores.js";

export function createMemoryVaultStore(seed: VaultMethodRecord[] = []): VaultStore {
  const rows: VaultMethodRecord[] = seed.map((r) => ({ ...r }));
  return {
    async create(m) {
      if (rows.some((r) => r.ownerId === m.ownerId && r.token === m.token)) {
        throw new Error("Unique constraint: ownerId+token");
      }
      const rec: VaultMethodRecord = {
        id: randomUUID(),
        ownerId: m.ownerId,
        customerId: m.customerId,
        token: m.token,
        cardType: m.cardType ?? null,
        last4: m.last4 ?? null,
        createdAt: new Date(),
      };
      rows.push(rec);
      return { ...rec };
    },
    async findByOwnerAndToken(ownerId, token) {
      const r = rows.find((x) => x.ownerId === ownerId && x.token === token);
      return r ? { ...r } : null;
    },
    async listByOwner(ownerId) {
      // Insertion order is chronological; reverse for newest first (stable on equal timestamps).
      return rows
        .filter((r) => r.ownerId === ownerId)
        .reverse()
        .map((r) => ({ ...r }));
    },
    async findByIdForOwner(id, ownerId) {
      const r = rows.find((x) => x.id === id && x.ownerId === ownerId);
      return r ? { ...r } : null;
    },
  };
}

export function createMemoryIntentStore(): IntentStore {
  const rows = new Map<string, IntentRecord>();
  return {
    async create(input) {
      const rec: IntentRecord = {
        ...input,
        id: input.id ?? randomUUID(),
        state: "pending",
        decision: null,
        riskScore: null,
        createdAt: new Date(),
      };
      rows.set(rec.id, rec);
      return { ...rec };
    },
    async get(id) {
      const r = rows.get(id);
      return r ? { ...r } : null;
    },
    async getForAgent(id, agentId) {
      const r = rows.get(id);
      return r && r.agentId === agentId ? { ...r } : null;
    },
    async update(id, patch) {
      const r = rows.get(id);
      if (!r) throw new Error("Intent not found");
      const next = { ...r, ...patch };
      rows.set(id, next);
      return { ...next };
    },
    async listRecentForAgent(agentId, limit) {
      return [...rows.values()]
        .filter(
          (r) =>
            r.agentId === agentId &&
            (r.state === "authorized" || r.state === "captured")
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
    async listByAgents(agentIds, opts) {
      if (agentIds.length === 0) return [];
      const ids = new Set(agentIds);
      return [...rows.values()]
        .reverse() // stable sort then keeps newest-inserted first on equal timestamps
        .filter(
          (r) =>
            ids.has(r.agentId) &&
            (opts.state === undefined || r.state === opts.state) &&
            (opts.since === undefined ||
              r.createdAt.getTime() >= opts.since.getTime())
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, opts.limit)
        .map((r) => ({ ...r }));
    },
  };
}

export function createMemoryAuthorizationStore(): AuthorizationStore {
  const byIntent = new Map<string, AuthorizationRecord>();
  return {
    async create(input) {
      if (byIntent.has(input.intentId))
        throw new Error("Unique constraint: intentId");
      const rec = { id: randomUUID(), ...input };
      byIntent.set(input.intentId, rec);
      return { ...rec };
    },
    async getByIntent(intentId) {
      const r = byIntent.get(intentId);
      return r ? { ...r } : null;
    },
    async updateStatusByProviderTxnId(providerTxnId, status) {
      let n = 0;
      for (const r of byIntent.values()) {
        if (r.providerTxnId === providerTxnId) {
          r.status = status;
          n++;
        }
      }
      return n;
    },
  };
}

export function createMemoryMandateStore(): MandateStore {
  const rows = new Map<string, MandateRecord>();
  return {
    async create(m) {
      if (rows.has(m.jti)) throw new Error("Unique constraint: jti");
      rows.set(m.jti, { ...m, consumedAt: null });
    },
    async get(jti) {
      const r = rows.get(jti);
      return r ? { ...r } : null;
    },
    async consume(jti, now) {
      // Synchronous check-and-set: atomic within the single-threaded event loop.
      const r = rows.get(jti);
      if (
        !r ||
        r.consumedAt !== null ||
        r.expiresAt.getTime() <= now.getTime()
      ) {
        return false;
      }
      r.consumedAt = now;
      return true;
    },
  };
}

export function createMemoryAuditStore(): AuditStore {
  const rows: AuditEntry[] = [];
  return {
    async append({ intentId, event, meta }) {
      rows.push({
        id: randomUUID(),
        intentId,
        event,
        meta: { ...(meta ?? {}) },
        createdAt: new Date(),
      });
    },
    async listByIntent(intentId) {
      return rows.filter((r) => r.intentId === intentId).map((r) => ({ ...r }));
    },
  };
}

export function createMemoryWebhookEventStore(): WebhookEventStore {
  const ids = new Set<string>();
  return {
    async claim(eventId) {
      if (ids.has(eventId)) return false;
      ids.add(eventId);
      return true;
    },
  };
}

type AgentSeed = { agent: AgentRecord; policy?: AgentPolicyRecord };

/** One shared in-memory agent registry exposing both the policy and admin stores. */
export function createMemoryAgentRegistry(seed: AgentSeed[] = []): {
  policyStore: AgentPolicyStore;
  adminStore: AgentAdminStore;
} {
  const createdAt = new WeakMap<AgentRecord, Date>();
  const withDate = (a: AgentRecord) => ({
    ...a,
    createdAt: createdAt.get(a) ?? new Date(0),
  });
  const policyStore: AgentPolicyStore = {
    async findAgentByKeyHash(apiKeyHash) {
      return seed.find((s) => s.agent.apiKeyHash === apiKeyHash)?.agent ?? null;
    },
    async getPolicy(agentId) {
      return seed.find((s) => s.agent.id === agentId)?.policy ?? null;
    },
  };
  const adminStore: AgentAdminStore = {
    async create({ ownerId, name, apiKeyHash }) {
      if (seed.some((s) => s.agent.apiKeyHash === apiKeyHash)) {
        throw new Error("Unique constraint: apiKeyHash");
      }
      const agent: AgentRecord = {
        id: randomUUID(),
        apiKeyHash,
        killed: false,
        ownerId,
        name,
      };
      createdAt.set(agent, new Date());
      seed.push({ agent });
      return withDate(agent);
    },
    async listByOwner(ownerId) {
      // Insertion order is chronological; reverse for newest first.
      return seed
        .filter((s) => s.agent.ownerId === ownerId)
        .reverse()
        .map((s) => withDate(s.agent));
    },
    async getForOwner(id, ownerId) {
      const s = seed.find(
        (x) => x.agent.id === id && x.agent.ownerId === ownerId
      );
      return s ? withDate(s.agent) : null;
    },
    async setKilled(id, ownerId, killed) {
      const s = seed.find(
        (x) => x.agent.id === id && x.agent.ownerId === ownerId
      );
      if (!s) return false;
      s.agent.killed = killed;
      return true;
    },
    async setPolicy(agentId, policy, riskConfig) {
      const s = seed.find((x) => x.agent.id === agentId);
      if (!s) throw new Error("Agent not found");
      s.policy = { policy, riskConfig };
    },
  };
  return { policyStore, adminStore };
}

export function createMemoryAgentPolicyStore(
  seed: AgentSeed[] = []
): AgentPolicyStore {
  return createMemoryAgentRegistry(seed).policyStore;
}

export function createMemoryOwnerStore(): OwnerStore {
  const rows: OwnerRecord[] = [];
  return {
    async create({ email, passwordHash }) {
      const e = email.toLowerCase();
      if (rows.some((r) => r.email === e))
        throw new Error("Unique constraint: email");
      const rec: OwnerRecord = {
        id: randomUUID(),
        email: e,
        passwordHash,
        createdAt: new Date(),
      };
      rows.push(rec);
      return { ...rec };
    },
    async findByEmail(email) {
      const r = rows.find((x) => x.email === email.toLowerCase());
      return r ? { ...r } : null;
    },
    async findById(id) {
      const r = rows.find((x) => x.id === id);
      return r ? { ...r } : null;
    },
  };
}
