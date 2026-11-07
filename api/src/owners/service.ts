// Owner accounts, agent management and owner-scoped reads (spec-06b).
// Every agent/intent lookup is filtered by the authenticated ownerId; a
// foreign id is indistinguishable from an unknown one (404).
// Never returns or logs passwords, hashes, API keys or provider tokens.

import { randomBytes } from "node:crypto";
import { PolicySchema } from "@agentpurse/shared";
import { z } from "zod";

import type {
  AgentAdminStore,
  AgentPolicyStore,
  AgentRecord,
  AuditEntry,
  AuditStore,
  IntentRecord,
  IntentState,
  IntentStore,
  OwnerStore,
} from "../db/stores.js";
import { hashApiKey } from "../intents/auth.js";
import { DEFAULT_SCRYPT, hashPassword, verifyPassword, type ScryptParams } from "./password.js";
import { signOwnerToken, signStreamToken, type IssuedToken } from "./tokens.js";

export class OwnerServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: string[],
  ) {
    super(message);
    this.name = "OwnerServiceError";
  }
}

const notFound = () => new OwnerServiceError(404, "not_found", "Not found");
const badBody = (issues: z.ZodIssue[]) =>
  new OwnerServiceError(400, "invalid_body", "Invalid request body", [
    ...new Set(issues.map((i) => i.path.join(".") || "body")),
  ]);

export interface OwnerDeps {
  owners: OwnerStore;
  agents: AgentAdminStore;
  policies: Pick<AgentPolicyStore, "getPolicy">;
  intents: Pick<IntentStore, "get" | "listByAgents">;
  audit: AuditStore;
  jwtSecret: string;
  scrypt?: ScryptParams;
  now?: () => Date;
}

const nowOf = (d: OwnerDeps) => (d.now ? d.now() : new Date());

export const CredentialsSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(12).max(256),
  })
  .strict();

const LoginSchema = z
  .object({ email: z.string().trim().toLowerCase().max(254), password: z.string().max(256) })
  .strict();

export async function register(
  deps: OwnerDeps,
  body: unknown,
): Promise<{ ownerId: string; email: string }> {
  const parsed = CredentialsSchema.safeParse(body);
  if (!parsed.success) throw badBody(parsed.error.issues);
  const passwordHash = await hashPassword(parsed.data.password, deps.scrypt ?? DEFAULT_SCRYPT);
  try {
    const owner = await deps.owners.create({ email: parsed.data.email, passwordHash });
    await safeAudit(deps, "owner_registered", { ownerId: owner.id });
    return { ownerId: owner.id, email: owner.email };
  } catch {
    throw new OwnerServiceError(409, "email_taken", "Email already registered");
  }
}

let dummyHash: Promise<string> | null = null;
let dummyParams: ScryptParams | null = null;

/** Same work and the same generic 401 for unknown email and wrong password. */
export async function login(deps: OwnerDeps, body: unknown): Promise<IssuedToken & { ownerId: string }> {
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) throw badBody(parsed.error.issues);
  const owner = await deps.owners.findByEmail(parsed.data.email);
  const params = deps.scrypt ?? DEFAULT_SCRYPT;
  if (!owner) {
    if (!dummyHash || dummyParams !== params) {
      dummyParams = params;
      dummyHash = hashPassword(randomBytes(16).toString("hex"), params);
    }
    await verifyPassword(parsed.data.password, await dummyHash);
    throw new OwnerServiceError(401, "unauthorized", "Invalid credentials");
  }
  if (!(await verifyPassword(parsed.data.password, owner.passwordHash))) {
    throw new OwnerServiceError(401, "unauthorized", "Invalid credentials");
  }
  return { ownerId: owner.id, ...signOwnerToken(owner.id, deps.jwtSecret, nowOf(deps)) };
}

export function mintStreamToken(deps: OwnerDeps, ownerId: string): IssuedToken {
  return signStreamToken(ownerId, deps.jwtSecret, nowOf(deps));
}

// ---- agents ----

export interface AgentView {
  id: string;
  name: string;
  killed: boolean;
  createdAt: string;
}

const toAgentView = (a: AgentRecord & { createdAt: Date }): AgentView => ({
  id: a.id,
  name: a.name ?? "agent",
  killed: a.killed,
  createdAt: a.createdAt.toISOString(),
});

export const generateApiKey = (): string => `agk_${randomBytes(32).toString("base64url")}`;
export const hashKey = hashApiKey;

const CreateAgentSchema = z
  .object({ name: z.string().trim().min(1).max(80), policy: PolicySchema.optional() })
  .strict();

/** Returns the API key exactly once; only its sha256 hash is stored. */
export async function createAgent(
  deps: OwnerDeps,
  ownerId: string,
  body: unknown,
): Promise<{ agent: AgentView; apiKey: string }> {
  const parsed = CreateAgentSchema.safeParse(body ?? {});
  if (!parsed.success) throw badBody(parsed.error.issues);
  const apiKey = generateApiKey();
  const agent = await deps.agents.create({ ownerId, name: parsed.data.name, apiKeyHash: hashKey(apiKey) });
  if (parsed.data.policy) await deps.agents.setPolicy(agent.id, parsed.data.policy, {});
  await safeAudit(deps, "agent_created", { ownerId, agentId: agent.id });
  return { agent: toAgentView(agent), apiKey };
}

export async function listAgents(deps: OwnerDeps, ownerId: string): Promise<AgentView[]> {
  return (await deps.agents.listByOwner(ownerId)).map(toAgentView);
}

export async function setAgentKilled(
  deps: OwnerDeps,
  ownerId: string,
  agentId: string,
  killed: boolean,
): Promise<{ id: string; killed: boolean }> {
  if (!(await deps.agents.setKilled(agentId, ownerId, killed))) throw notFound();
  await safeAudit(deps, killed ? "agent_killed" : "agent_restored", { ownerId, agentId });
  return { id: agentId, killed };
}

export async function getAgentPolicy(
  deps: OwnerDeps,
  ownerId: string,
  agentId: string,
): Promise<{ agentId: string; policy: unknown }> {
  if (!(await deps.agents.getForOwner(agentId, ownerId))) throw notFound();
  const rec = await deps.policies.getPolicy(agentId);
  return { agentId, policy: rec?.policy ?? null };
}

export async function setAgentPolicy(
  deps: OwnerDeps,
  ownerId: string,
  agentId: string,
  body: unknown,
): Promise<{ agentId: string; policy: unknown }> {
  if (!(await deps.agents.getForOwner(agentId, ownerId))) throw notFound();
  const parsed = PolicySchema.strict().safeParse(body);
  if (!parsed.success) throw badBody(parsed.error.issues);
  const existing = await deps.policies.getPolicy(agentId);
  await deps.agents.setPolicy(agentId, parsed.data, existing?.riskConfig ?? {});
  await safeAudit(deps, "policy_updated", { ownerId, agentId });
  return { agentId, policy: parsed.data };
}

// ---- reads ----

const STATES = ["pending", "denied", "escalated", "authorized", "captured", "voided", "failed"] as const;
const ListQuerySchema = z.object({
  state: z.enum(STATES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export interface IntentView {
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

const toIntentView = (r: IntentRecord): IntentView => ({
  id: r.id,
  agentId: r.agentId,
  amountCents: r.amountCents,
  currency: r.currency,
  payee: r.payee,
  category: r.category,
  description: r.description,
  justification: r.justification,
  paymentMethodId: r.paymentMethodRef,
  state: r.state,
  decision: r.decision,
  riskScore: r.riskScore,
  createdAt: r.createdAt.toISOString(),
});

async function ownedAgentIds(deps: OwnerDeps, ownerId: string): Promise<string[]> {
  return (await deps.agents.listByOwner(ownerId)).map((a) => a.id);
}

export async function listIntents(deps: OwnerDeps, ownerId: string, query: unknown): Promise<IntentView[]> {
  const parsed = ListQuerySchema.safeParse(query ?? {});
  if (!parsed.success) throw badBody(parsed.error.issues);
  const ids = await ownedAgentIds(deps, ownerId);
  const rows = await deps.intents.listByAgents(ids, { state: parsed.data.state, limit: parsed.data.limit });
  return rows.map(toIntentView);
}

export async function getIntent(
  deps: OwnerDeps,
  ownerId: string,
  intentId: string,
): Promise<{ intent: IntentView; events: { event: string; meta: Record<string, unknown>; createdAt: string }[] }> {
  const intent = await deps.intents.get(intentId);
  if (!intent || !(await deps.agents.getForOwner(intent.agentId, ownerId))) throw notFound();
  const events: AuditEntry[] = await deps.audit.listByIntent(intent.id);
  return {
    intent: toIntentView(intent),
    events: events.map((e) => ({ event: e.event, meta: e.meta, createdAt: e.createdAt.toISOString() })),
  };
}

export interface OwnerStats {
  /** UTC day start used for the window. */
  since: string;
  /** Captured intents created today, summed per currency (integer cents). */
  spentToday: { currency: string; amountCents: number }[];
  countsByDecision: { approve: number; deny: number; escalate: number; none: number };
  countsByState: Record<string, number>;
}

const STATS_WINDOW_LIMIT = 5000;

/** TODO(verify): bounded in-process aggregation; "today" = intent createdAt in the UTC day. */
export async function stats(deps: OwnerDeps, ownerId: string): Promise<OwnerStats> {
  const n = nowOf(deps);
  const since = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
  const ids = await ownedAgentIds(deps, ownerId);
  const rows = await deps.intents.listByAgents(ids, { since, limit: STATS_WINDOW_LIMIT });
  const spent = new Map<string, number>();
  const countsByDecision = { approve: 0, deny: 0, escalate: 0, none: 0 };
  const countsByState: Record<string, number> = {};
  for (const r of rows) {
    if (r.state === "captured") spent.set(r.currency, (spent.get(r.currency) ?? 0) + r.amountCents);
    const d = r.decision;
    if (d === "approve" || d === "deny" || d === "escalate") countsByDecision[d]++;
    else countsByDecision.none++;
    countsByState[r.state] = (countsByState[r.state] ?? 0) + 1;
  }
  return {
    since: since.toISOString(),
    spentToday: [...spent].map(([currency, amountCents]) => ({ currency, amountCents })),
    countsByDecision,
    countsByState,
  };
}

async function safeAudit(deps: OwnerDeps, event: string, meta: Record<string, unknown>): Promise<void> {
  try {
    await deps.audit.append({ intentId: null, event, meta });
  } catch {
    // audit failures never change the outcome
  }
}