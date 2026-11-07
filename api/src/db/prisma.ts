// Prisma client factory and store implementations. Prisma types stay in this file.
import { Prisma, PrismaClient } from "@prisma/client";
import type {
  AgentPolicyStore,
  AuditStore,
  AuthorizationStore,
  IntentRecord,
  IntentState,
  IntentStore,
  MandateStore,
  VaultStore,
  WebhookEventStore,
} from "./stores.js";

export type Db = PrismaClient;

/** Creates a client. Fails by naming DATABASE_URL if it is missing. */
export function createPrismaClient(databaseUrl = process.env["DATABASE_URL"]): Db {
  if (!databaseUrl) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

function toIntent(r: {
  id: string;
  agentId: string;
  amountCents: number;
  currency: string;
  payee: string;
  category: string;
  description: string;
  justification: string;
  paymentMethodRef: string;
  state: string;
  decision: string | null;
  riskScore: number | null;
  createdAt: Date;
}): IntentRecord {
  return { ...r, state: r.state as IntentState };
}

export function createPrismaIntentStore(db: Db): IntentStore {
  return {
    async create(input) {
      return toIntent(await db.intent.create({ data: input }));
    },
    async get(id) {
      const r = await db.intent.findUnique({ where: { id } });
      return r ? toIntent(r) : null;
    },
    async getForAgent(id, agentId) {
      const r = await db.intent.findFirst({ where: { id, agentId } });
      return r ? toIntent(r) : null;
    },
    async update(id, patch) {
      return toIntent(await db.intent.update({ where: { id }, data: patch }));
    },
    async listRecentForAgent(agentId, limit) {
      const rows = await db.intent.findMany({
        where: { agentId, state: { in: ["authorized", "captured"] } },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return rows.map(toIntent);
    },
  };
}

export function createPrismaAuthorizationStore(db: Db): AuthorizationStore {
  return {
    create: (data) => db.authorization.create({ data }),
    getByIntent: (intentId) => db.authorization.findUnique({ where: { intentId } }),
    async updateStatusByProviderTxnId(providerTxnId, status) {
      const r = await db.authorization.updateMany({
        where: { providerTxnId },
        data: { status },
      });
      return r.count;
    },
  };
}

export function createPrismaMandateStore(db: Db): MandateStore {
  return {
    async create(m) {
      await db.mandate.create({ data: { ...m, consumedAt: null } });
    },
    get: (jti) => db.mandate.findUnique({ where: { jti } }),
    async consume(jti, now) {
      const r = await db.mandate.updateMany({
        where: { jti, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      return r.count === 1;
    },
  };
}

export function createPrismaAuditStore(db: Db): AuditStore {
  return {
    async append({ intentId, event, meta }) {
      await db.auditLog.create({
        data: {
          intentId,
          event,
          meta: (meta ?? {}) as Prisma.InputJsonValue,
        },
      });
    },
    async listByIntent(intentId) {
      const rows = await db.auditLog.findMany({
        where: { intentId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((r) => ({
        ...r,
        meta: (r.meta ?? {}) as Record<string, unknown>,
      }));
    },
  };
}

export function createPrismaWebhookEventStore(db: Db): WebhookEventStore {
  return {
    async claim(eventId) {
      try {
        await db.webhookEvent.create({ data: { eventId } });
        return true;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return false;
        }
        throw err;
      }
    },
  };
}

export function createPrismaAgentPolicyStore(db: Db): AgentPolicyStore {
  return {
    findAgentByKeyHash: (apiKeyHash) =>
      db.agent.findUnique({
        where: { apiKeyHash },
        select: { id: true, apiKeyHash: true, killed: true },
      }),
    async getPolicy(agentId) {
      const r = await db.policy.findUnique({ where: { agentId } });
      return r ? { policy: r.policy, riskConfig: r.riskConfig } : null;
    },
  };
}

export function createPrismaVaultStore(db: Db): VaultStore {
  return {
    async create(m) {
      try {
        return await db.vaultMethod.create({
          data: {
            ownerId: m.ownerId,
            customerId: m.customerId,
            token: m.token,
            cardType: m.cardType ?? null,
            last4: m.last4 ?? null,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new Error("Unique constraint: ownerId+token");
        }
        throw err;
      }
    },
    findByOwnerAndToken: (ownerId, token) =>
      db.vaultMethod.findUnique({ where: { ownerId_token: { ownerId, token } } }),
    listByOwner: (ownerId) =>
      db.vaultMethod.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" } }),
  };
}
