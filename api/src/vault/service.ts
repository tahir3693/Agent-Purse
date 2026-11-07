// Vault linking service (spec-06). Errors are typed and generic: provider
// messages (which may reference nonces or tokens) are never propagated.

import type { AuditStore, VaultMethodRecord, VaultStore } from "../db/stores.js";
import { ProviderError } from "../payments/errors.js";
import type { PaymentProvider } from "../payments/types.js";
import { LinkMethodBodySchema } from "./schema.js";

export interface VaultDeps {
  vault: VaultStore;
  audit: AuditStore;
  provider: PaymentProvider;
}

export interface RedactedMethod {
  id: string;
  cardType: string | null;
  last4: string | null;
  tokenRef: string;
  createdAt: string;
}

export class VaultServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VaultServiceError";
  }
}

export class VaultValidationError extends VaultServiceError {
  constructor(readonly fields: string[]) {
    super(400, "invalid_body", "Invalid request body");
    this.name = "VaultValidationError";
  }
}

export function toRedacted(record: VaultMethodRecord): RedactedMethod {
  return {
    id: record.id,
    cardType: record.cardType,
    last4: record.last4,
    tokenRef: `****${record.token.slice(-4)}`,
    createdAt: record.createdAt.toISOString(),
  };
}

const REJECTED_CODES = new Set(["invalid_request", "rejected", "declined"]);

function mapProviderError(err: unknown): VaultServiceError {
  if (err instanceof ProviderError && REJECTED_CODES.has(err.code)) {
    return new VaultServiceError(422, "payment_method_rejected", "Payment method was rejected");
  }
  return new VaultServiceError(502, "provider_unavailable", "Payment provider error");
}

export interface LinkResult {
  method: RedactedMethod;
  /** true when the (ownerId, token) link already existed. */
  existing: boolean;
}

export async function linkMethod(
  deps: VaultDeps,
  authOwnerId: string,
  body: unknown,
): Promise<LinkResult> {
  const parsed = LinkMethodBodySchema.safeParse(body);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "body"))];
    throw new VaultValidationError(fields);
  }
  const { ownerId, nonce } = parsed.data;
  if (ownerId !== authOwnerId) {
    throw new VaultServiceError(403, "forbidden", "Owner mismatch");
  }

  let linked;
  try {
    linked = await deps.provider.linkPaymentMethod({ ownerId, nonce });
  } catch (err) {
    throw mapProviderError(err);
  }

  const existing = await findExisting(deps, ownerId, linked.paymentMethodToken);
  if (existing) return { method: toRedacted(existing), existing: true };

  let created: VaultMethodRecord;
  try {
    created = await deps.vault.create({
      ownerId,
      customerId: linked.customerId,
      token: linked.paymentMethodToken,
      cardType: linked.cardType ?? null,
      last4: linked.last4 ?? null,
    });
  } catch {
    await safeAudit(deps, "vault_persist_failed", { ownerId });
    throw new VaultServiceError(502, "persist_failed", "Could not store payment method");
  }

  await safeAudit(deps, "vault_linked", { ownerId, vaultMethodId: created.id });
  return { method: toRedacted(created), existing: false };
}

async function findExisting(
  deps: VaultDeps,
  ownerId: string,
  token: string,
): Promise<VaultMethodRecord | null> {
  try {
    return await deps.vault.findByOwnerAndToken(ownerId, token);
  } catch {
    await safeAudit(deps, "vault_persist_failed", { ownerId });
    throw new VaultServiceError(502, "persist_failed", "Could not store payment method");
  }
}

/** Audit failures must not leak or change the outcome. Ids only in meta. */
async function safeAudit(
  deps: VaultDeps,
  event: string,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await deps.audit.append({ intentId: null, event, meta });
  } catch {
    // intentionally swallowed
  }
}

export async function listMethods(deps: VaultDeps, ownerId: string): Promise<RedactedMethod[]> {
  let records: VaultMethodRecord[];
  try {
    records = await deps.vault.listByOwner(ownerId);
  } catch {
    throw new VaultServiceError(502, "persist_failed", "Could not load payment methods");
  }
  return records.map(toRedacted);
}
