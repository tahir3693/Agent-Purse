// createIntent / executeIntent (spec-08). Money is integer cents + currency.
// Audit meta carries codes and ids only: never intent text, tokens, keys or
// raw provider errors.

import { PolicySchema, type Policy, type TransactionRecord } from "@agentpurse/shared";
import type {
  AgentPolicyStore,
  AuditStore,
  AuthorizationStore,
  IntentRecord,
  IntentStore,
  MandateStore,
} from "../db/stores.js";
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

export interface IntentDeps {
  intents: IntentStore;
  authorizations: AuthorizationStore;
  mandates: MandateStore;
  audit: AuditStore;
  policies: AgentPolicyStore;
  provider: PaymentProvider;
  evaluateRisk: (input: RiskInput) => Promise<RiskDecision>;
  mandateKey: string;
  now?: () => Date;
}

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
const MANDATE_TTL_SECONDS = 300;

const nowOf = (deps: IntentDeps): Date => (deps.now ? deps.now() : new Date());

function audit(
  deps: IntentDeps,
  intentId: string,
  event: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  return deps.audit.append({ intentId, event, meta });
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

export async function createIntent(
  deps: IntentDeps,
  agentId: string,
  body: unknown,
): Promise<CreateIntentResult> {
  const parsed = CreateIntentBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError([...new Set(parsed.error.issues.map((i) => i.path.join(".")))]);
  }
  const b = parsed.data;

  const intent = await deps.intents.create({ agentId, ...b });
  await audit(deps, intent.id, "intent_created", {
    amountCents: b.amountCents,
    currency: b.currency,
  });

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
    return { intentId: intent.id, state, decision, riskScore, reason };
  };

  // Fail closed when the policy is missing or invalid.
  const policy = await loadPolicy(deps, agentId);
  if (!policy) {
    return finish("denied", "deny", 100, "No valid policy", "intent_denied", {
      code: "policy_missing",
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
      policy,
      history,
    });
  } catch {
    await deps.intents.update(intent.id, { state: "failed" });
    await audit(deps, intent.id, "risk_failed", { code: "risk_error" });
    throw new BadGatewayError("Risk evaluation unavailable");
  }

  const riskMeta = {
    stageReached: risk.audit.stageReached,
    matchedRule: risk.audit.matchedRule,
    aiOutcome: risk.audit.aiOutcome,
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

  let providerAuthId: string;
  try {
    const auth = await deps.provider.authorize({
      intentId: intent.id,
      amountCents: b.amountCents,
      currency: b.currency,
      paymentMethodRef: b.paymentMethodRef,
    });
    providerAuthId = auth.authorizationId;
  } catch {
    await deps.intents.update(intent.id, { state: "failed" });
    await audit(deps, intent.id, "authorize_failed", { code: "provider_error" });
    throw new BadGatewayError("Authorization failed");
  }

  try {
    await deps.authorizations.create({
      intentId: intent.id,
      providerTxnId: providerAuthId,
      status: "authorized",
    });
    await deps.intents.update(intent.id, { state: "authorized" });
    await audit(deps, intent.id, "authorized", { providerTxnId: providerAuthId });

    const { token, expiresAt } = await issueMandate(
      {
        intentId: intent.id,
        authorizationId: providerAuthId,
        amountCents: b.amountCents,
        currency: b.currency,
        payee: b.payee,
      },
      { store: deps.mandates, key: deps.mandateKey, now: nowOf(deps), ttlSeconds: MANDATE_TTL_SECONDS },
    );
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
  agentId: string,
  intentId: string,
  token: string,
): Promise<ExecuteIntentResult> {
  const intent = await deps.intents.getForAgent(intentId, agentId);
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
  return { intentId: intent.id, state: "captured" };
}
