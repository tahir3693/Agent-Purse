// Intents (spec-08, extended in spec-06b). Money is integer cents + currency.
// Audit meta and live events carry codes, ids and states only: never intent
// text, provider tokens, keys or raw provider errors.
// paymentMethodRef is a vault method id; it is resolved server-side to the
// provider token, and only for methods owned by the agent's owner.

import { PolicySchema, type Policy, type TransactionRecord } from "@agentpurse/shared";
import type {
  AgentAdminStore,
  AgentPolicyStore,
  AgentRecord,
  AuditStore,
  AuthorizationStore,
  IntentRecord,
  IntentStore,
  MandateStore,
  VaultStore,
} from "../db/stores.js";
import type { EventPublisher, OwnerEventType } from "../events/bus.js";
import { issueMandate, verifyAgainstAuthorization, verifyMandate } from "../mandates/index.js";
import type { PaymentProvider } from "../payments/types.js";
import type { RiskDecision, RiskInput } from "../risk/index.js";
import { CreateIntentBodySchema } from "./schema.js";

export class IntentServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
export class NotFoundError extends IntentServiceError {
  constructor(message = "Intent not found") {
    super(404, "not_found", message);
  }
}
export class UnauthorizedError extends IntentServiceError {
  constructor(message = "Invalid mandate token") {
    super(401, "unauthorized", message);
  }
}
export class ConflictError extends IntentServiceError {
  constructor(message = "Intent cannot be executed") {
    super(409, "conflict", message);
  }
}
export class BadGatewayError extends IntentServiceError {
  constructor(message = "Payment provider error") {
    super(502, "bad_gateway", message);
  }
}
export class ValidationError extends IntentServiceError {
  constructor(readonly fields: string[]) {
    super(400, "invalid_body", "Invalid request body");
  }
}
/** paymentMethodRef is unknown, a raw token, or not owned by the agent's owner. */
export class InvalidPaymentMethodError extends IntentServiceError {
  constructor() {
    super(422, "invalid_payment_method", "Invalid payment method");
  }
}

export interface IntentDeps {
  intents: IntentStore;
  authorizations: AuthorizationStore;
  mandates: MandateStore;
  audit: AuditStore;
  policies: AgentPolicyStore;
  vault: Pick<VaultStore, "findByIdForOwner">;
  provider: PaymentProvider;
  evaluateRisk: (input: RiskInput) => Promise<RiskDecision>;
  mandateKey: string;
  /** Required for owner approve/deny. */
  agents?: Pick<AgentAdminStore, "getForOwner">;
  events?: EventPublisher;
  now?: () => Date;
}

export type AgentRef = Pick<AgentRecord, "id" | "ownerId">;

export interface CreateIntentResult {
  intentId: string;
  state: IntentRecord["state"];
  decision: "approve" | "deny" | "escalate";
  riskScore: number;
  reason: string;
  /** Present only when authorized; returned once. */
  mandateToken?: string;
  expiresAt?: Date;
}

export interface ExecuteIntentResult {
  intentId: string;
  state: "captured";
}

const HISTORY_LIMIT = 200;
export const REASON_MAX = 280;
export const capReason = (r: string): string => (r.length > REASON_MAX ? r.slice(0, REASON_MAX) : r);
const MANDATE_TTL_SECONDS = 300;

const nowOf = (deps: IntentDeps): Date => (deps.now ? deps.now() : new Date());

/** One mandate per intent: the fixed jti is a primary key, so a second issue fails. */
export const mandateJti = (intentId: string): string => `${intentId}:m1`;

function audit(
  deps: IntentDeps,
  intentId: string,
  event: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  return deps.audit.append({ intentId, event, meta });
}

function emit(
  deps: IntentDeps,
  ownerId: string | null | undefined,
  type: OwnerEventType,
  intent: Pick<IntentRecord, "id" | "agentId">,
  extra: { state?: string; decision?: string } = {},
): void {
  if (!ownerId || !deps.events) return;
  try {
    deps.events.publish(ownerId, { type, intentId: intent.id, agentId: intent.agentId, ...extra });
  } catch {
    // live feed failures never affect payments
  }
}

async function loadPolicy(deps: IntentDeps, agentId: string): Promise<Policy | null> {
  try {
    const rec = await deps.policies.getPolicy(agentId);
    if (!rec) return null;
    const parsed = PolicySchema.safeParse(rec.policy);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Resolve a vault method id to its provider token for this owner, or throw 422. */
async function resolveMethodToken(
  deps: IntentDeps,
  ownerId: string | null | undefined,
  ref: string,
): Promise<string> {
  if (!ownerId) throw new InvalidPaymentMethodError();
  let method;
  try {
    method = await deps.vault.findByIdForOwner(ref, ownerId);
  } catch {
    throw new InvalidPaymentMethodError();
  }
  if (!method) throw new InvalidPaymentMethodError();
  return method.token;
}

/** Void a hold; never throws. Returns whether the void succeeded. */
async function safeVoid(
  deps: IntentDeps,
  intentId: string,
  providerAuthId: string,
  reason: string,
): Promise<boolean> {
  try {
    await deps.provider.void(providerAuthId);
    await audit(deps, intentId, "authorization_voided", { reason });
    return true;
  } catch {
    await audit(deps, intentId, "void_failed", { reason }).catch(() => undefined);
    return false;
  }
}

/** Place the hold. On provider failure marks the intent failed and throws 502. */
async function placeHold(
  deps: IntentDeps,
  intent: IntentRecord,
  methodToken: string,
): Promise<string> {
  try {
    const auth = await deps.provider.authorize({
      intentId: intent.id,
      amountCents: intent.amountCents,
      currency: intent.currency,
      paymentMethodRef: methodToken,
    });
    return auth.authorizationId;
  } catch {
    await deps.intents.update(intent.id, { state: "failed" });
    await audit(deps, intent.id, "authorize_failed", { code: "provider_error" });
    throw new BadGatewayError("Authorization failed");
  }
}

async function signFor(
  deps: IntentDeps,
  intent: IntentRecord,
  providerAuthId: string,
): Promise<{ token: string; expiresAt: Date }> {
  return issueMandate(
    {
      intentId: intent.id,
      authorizationId: providerAuthId,
      amountCents: intent.amountCents,
      currency: intent.currency,
      payee: intent.payee,
    },
    {
      store: deps.mandates,
      key: deps.mandateKey,
      now: nowOf(deps),
      ttlSeconds: MANDATE_TTL_SECONDS,
      jti: mandateJti(intent.id),
    },
  );
}

export async function createIntent(
  deps: IntentDeps,
  agent: AgentRef,
  body: unknown,
): Promise<CreateIntentResult> {
  const parsed = CreateIntentBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError([...new Set(parsed.error.issues.map((i) => i.path.join(".")))]);
  }
  // productId only feeds the price check; it is never persisted.
  const { productId, ...b } = parsed.data;
  const agentId = agent.id;
  const ownerId = agent.ownerId ?? null;

  // Resolve before persisting anything: raw tokens and foreign methods never get stored.
  const methodToken = await resolveMethodToken(deps, ownerId, b.paymentMethodRef);

  const intent = await deps.intents.create({ agentId, ...b });
  await audit(deps, intent.id, "intent_created", {
    amountCents: b.amountCents,
    currency: b.currency,
  });
  emit(deps, ownerId, "intent.created", intent, { state: intent.state });

  const finish = async (
    state: IntentRecord["state"],
    decision: CreateIntentResult["decision"],
    riskScore: number,
    reason: string,
    event: string,
    meta: Record<string, unknown>,
  ): Promise<CreateIntentResult> => {
    await deps.intents.update(intent.id, { state, decision, riskScore });
    await audit(deps, intent.id, event, { state, decision, riskScore, ...meta });
    emit(deps, ownerId, "intent.decided", intent, { state, decision });
    if (state === "denied") emit(deps, ownerId, "intent.denied", intent, { state });
    return { intentId: intent.id, state, decision, riskScore, reason };
  };

  // Fail closed when the policy is missing or invalid.
  const policy = await loadPolicy(deps, agentId);
  if (!policy) {
    return finish("denied", "deny", 100, "No valid policy", "intent_denied", {
      code: "policy_missing",
      reason: "No valid policy",
      priceStatus: "unknown",
      priceMedianCents: null,
      priceSampleSize: 0,
    });
  }

  const recent = await deps.intents.listRecentForAgent(agentId, HISTORY_LIMIT);
  const history: TransactionRecord[] = recent.map((r) => ({
    amountCents: r.amountCents,
    currency: r.currency,
    payee: r.payee,
    createdAtMs: r.createdAt.getTime(),
  }));

  let risk: RiskDecision;
  try {
    risk = await deps.evaluateRisk({
      intent: {
        agentId,
        payee: b.payee,
        amountCents: b.amountCents,
        currency: b.currency,
        category: b.category,
        description: b.description,
      },
      justification: b.justification,
      ...(productId !== undefined ? { productId } : {}),
      policy,
      history,
    });
  } catch {
    await deps.intents.update(intent.id, { state: "failed" });
    await audit(deps, intent.id, "risk_failed", { code: "risk_error" });
    throw new BadGatewayError("Risk evaluation unavailable");
  }

  // Decision record (spec-09a). Structured fields plus the Risk Guard reason,
  // which is a fixed template from combine/rules; still capped and treated as
  // untrusted on render. Never the justification, description or other intent text.
  const riskMeta = {
    stageReached: risk.audit.stageReached,
    matchedRule: risk.audit.matchedRule,
    aiOutcome: risk.audit.aiOutcome,
    reason: capReason(risk.reason),
    priceStatus: risk.audit.priceStatus ?? "unknown",
    priceMedianCents: risk.audit.priceMedianCents ?? null,
    priceSampleSize: risk.audit.priceSampleSize ?? 0,
  };

  if (risk.decision === "deny") {
    return finish("denied", "deny", risk.riskScore, risk.reason, "intent_denied", riskMeta);
  }
  if (risk.decision === "escalate") {
    return finish("escalated", "escalate", risk.riskScore, risk.reason, "intent_escalated", riskMeta);
  }

  // approve: place the hold.
  await deps.intents.update(intent.id, {
    decision: "approve",
    riskScore: risk.riskScore,
  });
  await audit(deps, intent.id, "risk_approved", { riskScore: risk.riskScore, ...riskMeta });
  emit(deps, ownerId, "intent.decided", intent, { state: "pending", decision: "approve" });

  const providerAuthId = await placeHold(deps, intent, methodToken);

  try {
    await deps.authorizations.create({
      intentId: intent.id,
      providerTxnId: providerAuthId,
      status: "authorized",
    });
    await deps.intents.update(intent.id, { state: "authorized" });
    await audit(deps, intent.id, "authorized", { providerTxnId: providerAuthId });
    emit(deps, ownerId, "intent.authorized", intent, { state: "authorized" });

    const { token, expiresAt } = await signFor(deps, intent, providerAuthId);
    await audit(deps, intent.id, "mandate_issued", { expiresAt: expiresAt.toISOString() });
    return {
      intentId: intent.id,
      state: "authorized",
      decision: "approve",
      riskScore: risk.riskScore,
      reason: risk.reason,
      mandateToken: token,
      expiresAt,
    };
  } catch {
    await safeVoid(deps, intent.id, providerAuthId, "mandate_issue_failed");
    await deps.intents.update(intent.id, { state: "failed" }).catch(() => undefined);
    await audit(deps, intent.id, "mandate_issue_failed", { code: "internal" }).catch(
      () => undefined,
    );
    throw new BadGatewayError("Could not issue mandate");
  }
}

export async function executeIntent(
  deps: IntentDeps,
  agent: AgentRef,
  intentId: string,
  token: string,
): Promise<ExecuteIntentResult> {
  const intent = await deps.intents.getForAgent(intentId, agent.id);
  if (!intent) throw new NotFoundError();

  if (intent.state !== "authorized") {
    await audit(deps, intent.id, "execute_rejected", { code: "bad_state", state: intent.state });
    throw new ConflictError();
  }
  const authz = await deps.authorizations.getByIntent(intent.id);
  if (!authz) {
    await audit(deps, intent.id, "execute_rejected", { code: "no_authorization" });
    throw new ConflictError();
  }

  const now = nowOf(deps);
  const rejectToken = async (code: string): Promise<never> => {
    await audit(deps, intent.id, "execute_rejected", { code });
    await safeVoid(deps, intent.id, authz.providerTxnId, code);
    await deps.authorizations
      .updateStatusByProviderTxnId(authz.providerTxnId, "voided")
      .catch(() => undefined);
    await deps.intents.update(intent.id, { state: "voided" });
    throw new UnauthorizedError();
  };

  const verified = verifyMandate(token, deps.mandateKey, now);
  if (!verified.ok) return rejectToken(`token_${verified.reason}`);

  const match = verifyAgainstAuthorization(verified.claims, {
    intentId: intent.id,
    authorizationId: authz.providerTxnId,
    amountCents: intent.amountCents,
    currency: intent.currency,
    payee: intent.payee,
  });
  if (!match.ok) return rejectToken(`claim_mismatch_${match.field}`);

  // Consume BEFORE capture. Replay: no capture, no void.
  const consumed = await deps.mandates.consume(verified.claims.jti, now);
  if (!consumed) {
    await audit(deps, intent.id, "execute_rejected", { code: "replay" });
    throw new ConflictError("Mandate already used or expired");
  }
  await audit(deps, intent.id, "mandate_consumed", { jti: verified.claims.jti });

  let captureOk = false;
  try {
    const cap = await deps.provider.capture(authz.providerTxnId, intent.amountCents);
    captureOk = cap.status === "captured" || cap.status === "capture_pending";
  } catch {
    captureOk = false;
  }

  if (!captureOk) {
    await audit(deps, intent.id, "capture_failed", { code: "provider_error" });
    await safeVoid(deps, intent.id, authz.providerTxnId, "capture_failed");
    await deps.authorizations
      .updateStatusByProviderTxnId(authz.providerTxnId, "voided")
      .catch(() => undefined);
    await deps.intents.update(intent.id, { state: "voided" });
    throw new BadGatewayError();
  }

  await deps.authorizations
    .updateStatusByProviderTxnId(authz.providerTxnId, "captured")
    .catch(() => undefined);
  await deps.intents.update(intent.id, { state: "captured" });
  await audit(deps, intent.id, "captured", { providerTxnId: authz.providerTxnId });
  emit(deps, agent.ownerId, "intent.captured", intent, { state: "captured" });
  return { intentId: intent.id, state: "captured" };
}

/** Loads an intent only if its agent belongs to ownerId; otherwise 404. */
async function loadOwnedIntent(
  deps: IntentDeps,
  ownerId: string,
  intentId: string,
): Promise<{ intent: IntentRecord; agent: AgentRecord }> {
  if (!deps.agents) throw new NotFoundError();
  const intent = await deps.intents.get(intentId);
  if (!intent) throw new NotFoundError();
  const agent = await deps.agents.getForOwner(intent.agentId, ownerId);
  if (!agent) throw new NotFoundError();
  return { intent, agent };
}

export interface OwnerDecisionResult {
  intentId: string;
  state: IntentRecord["state"];
}

/** Owner approves an escalated intent: places the hold (state authorized). */
export async function approveIntent(
  deps: IntentDeps,
  ownerId: string,
  intentId: string,
): Promise<OwnerDecisionResult> {
  const { intent, agent } = await loadOwnedIntent(deps, ownerId, intentId);
  if (intent.state !== "escalated") throw new ConflictError("Intent is not awaiting approval");
  if (agent.killed) throw new ConflictError("Agent is disabled");

  const methodToken = await resolveMethodToken(deps, ownerId, intent.paymentMethodRef);
  await deps.intents.update(intent.id, { decision: "approve" });
  await audit(deps, intent.id, "owner_approved", {});
  emit(deps, ownerId, "intent.decided", intent, { state: "escalated", decision: "approve" });

  const providerAuthId = await placeHold(deps, intent, methodToken);
  try {
    await deps.authorizations.create({
      intentId: intent.id,
      providerTxnId: providerAuthId,
      status: "authorized",
    });
  } catch {
    // A concurrent approve already stored this hold (provider is idempotent on
    // orderId = intentId). Never void a hold another request owns.
    const existing = await deps.authorizations.getByIntent(intent.id).catch(() => null);
    if (existing) throw new ConflictError("Intent is not awaiting approval");
    await safeVoid(deps, intent.id, providerAuthId, "persist_failed");
    await deps.intents.update(intent.id, { state: "failed" }).catch(() => undefined);
    throw new BadGatewayError("Could not store authorization");
  }
  await deps.intents.update(intent.id, { state: "authorized" });
  await audit(deps, intent.id, "authorized", { providerTxnId: providerAuthId });
  emit(deps, ownerId, "intent.authorized", intent, { state: "authorized" });
  return { intentId: intent.id, state: "authorized" };
}

/** Owner denies an escalated intent: closes it without touching the provider. */
export async function denyIntent(
  deps: IntentDeps,
  ownerId: string,
  intentId: string,
): Promise<OwnerDecisionResult> {
  const { intent } = await loadOwnedIntent(deps, ownerId, intentId);
  if (intent.state !== "escalated") throw new ConflictError("Intent is not awaiting approval");
  await deps.intents.update(intent.id, { state: "denied", decision: "deny" });
  await audit(deps, intent.id, "owner_denied", {});
  emit(deps, ownerId, "intent.decided", intent, { state: "denied", decision: "deny" });
  emit(deps, ownerId, "intent.denied", intent, { state: "denied" });
  return { intentId: intent.id, state: "denied" };
}

/** Agent fetches its mandate after owner approval. One mandate per intent. */
export async function issueMandateForIntent(
  deps: IntentDeps,
  agent: AgentRef,
  intentId: string,
): Promise<{ intentId: string; mandateToken: string; expiresAt: Date }> {
  const intent = await deps.intents.getForAgent(intentId, agent.id);
  if (!intent) throw new NotFoundError();
  if (intent.state !== "authorized") throw new ConflictError("Intent is not authorized");
  const authz = await deps.authorizations.getByIntent(intent.id);
  if (!authz) throw new ConflictError("Intent is not authorized");
  if (await deps.mandates.get(mandateJti(intent.id))) {
    throw new ConflictError("Mandate already issued");
  }
  let issued;
  try {
    issued = await signFor(deps, intent, authz.providerTxnId);
  } catch {
    // Lost a race to issue (duplicate jti) or storage error: never issue twice.
    throw new ConflictError("Mandate already issued");
  }
  await audit(deps, intent.id, "mandate_issued", { expiresAt: issued.expiresAt.toISOString() });
  return { intentId: intent.id, mandateToken: issued.token, expiresAt: issued.expiresAt };
}

export async function getIntentForAgent(
  deps: IntentDeps,
  agent: AgentRef,
  intentId: string,
): Promise<Pick<IntentRecord, "state" | "decision" | "riskScore"> & { intentId: string }> {
  const intent = await deps.intents.getForAgent(intentId, agent.id);
  if (!intent) throw new NotFoundError();
  return {
    intentId: intent.id,
    state: intent.state,
    decision: intent.decision,
    riskScore: intent.riskScore,
  };
}