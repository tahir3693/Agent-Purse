// In-memory fakes with the same semantics as the Prisma stores (for tests).
import { randomUUID } from "node:crypto";
import type {
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

export function createMemoryVaultStore(): VaultStore {
  const rows: VaultMethodRecord[] = [];
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
          (r) => r.agentId === agentId && (r.state === "authorized" || r.state === "captured"),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
  };
}

export function createMemoryAuthorizationStore(): AuthorizationStore {
  const byIntent = new Map<string, AuthorizationRecord>();
  return {
    async create(input) {
      if (byIntent.has(input.intentId)) throw new Error("Unique constraint: intentId");
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
      if (!r || r.consumedAt !== null || r.expiresAt.getTime() <= now.getTime()) {
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

export function createMemoryAgentPolicyStore(
  seed: { agent: AgentRecord; policy?: AgentPolicyRecord }[] = [],
): AgentPolicyStore {
  return {
    async findAgentByKeyHash(apiKeyHash) {
      return seed.find((s) => s.agent.apiKeyHash === apiKeyHash)?.agent ?? null;
    },
    async getPolicy(agentId) {
      return seed.find((s) => s.agent.id === agentId)?.policy ?? null;
    },
  };
}
