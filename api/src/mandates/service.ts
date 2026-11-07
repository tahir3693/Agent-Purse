import { randomUUID } from "node:crypto";
import type { MandateStore } from "../db/stores.js";
import { signMandate, type MandateClaims } from "./token.js";

export interface IssueMandateInput {
  intentId: string;
  authorizationId: string;
  amountCents: number;
  currency: string;
  payee: string;
}

export interface IssueMandateDeps {
  store: MandateStore;
  key: string;
  now: Date;
  ttlSeconds?: number;
}

export async function issueMandate(
  input: IssueMandateInput,
  deps: IssueMandateDeps,
): Promise<{ token: string; expiresAt: Date }> {
  const ttl = deps.ttlSeconds ?? 300;
  const iat = Math.floor(deps.now.getTime() / 1000);
  const exp = iat + ttl;
  const claims: MandateClaims = { jti: randomUUID(), ...input, iat, exp };
  // Sign first so an invalid ttl or claim never leaves a stored row behind.
  const token = signMandate(claims, deps.key, deps.now);
  const expiresAt = new Date(exp * 1000);
  await deps.store.create({ jti: claims.jti, intentId: input.intentId, expiresAt });
  return { token, expiresAt };
}

export type MandateMismatchField = "intentId" | "authorizationId" | "amountCents" | "currency" | "payee";

export function verifyAgainstAuthorization(
  claims: MandateClaims,
  expected: IssueMandateInput,
): { ok: true } | { ok: false; field: MandateMismatchField } {
  const fields: MandateMismatchField[] = [
    "intentId",
    "authorizationId",
    "amountCents",
    "currency",
    "payee",
  ];
  for (const f of fields) {
    if (claims[f] !== expected[f]) return { ok: false, field: f };
  }
  return { ok: true };
}

export function consumeMandate(jti: string, store: MandateStore, now: Date): Promise<boolean> {
  return store.consume(jti, now);
}
