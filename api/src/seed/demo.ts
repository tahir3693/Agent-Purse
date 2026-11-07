// Demo seed (spec-06b): a demo owner, one agent with a policy, and a vaulted
// sandbox card linked with the Braintree test nonce. Returns the secrets that
// must be shown once (owner password, agent API key). The provider token never
// leaves the vault store.

import { randomBytes } from "node:crypto";
import type { Policy } from "@agentpurse/shared";

import type { AgentAdminStore, AuditStore, OwnerStore, VaultStore } from "../db/stores.js";
import { DEFAULT_SCRYPT, hashPassword, type ScryptParams } from "../owners/password.js";
import { generateApiKey, hashKey } from "../owners/service.js";
import type { PaymentProvider } from "../payments/types.js";
import { linkMethod } from "../vault/service.js";

export const DEMO_EMAIL = "demo-owner@agentpurse.example";
export const DEMO_NONCE = "fake-valid-nonce";

export const DEMO_POLICY: Policy = {
  dailyBudgetCents: 50_000,
  perPurchaseCapCents: 20_000,
  allowedCategories: ["office", "electronics", "books", "software"],
  blockedPayees: [],
  velocityPerHour: 10,
  velocityPerDay: 30,
};

export interface SeedDeps {
  owners: OwnerStore;
  agents: AgentAdminStore;
  vault: VaultStore;
  audit: AuditStore;
  provider: PaymentProvider;
  scrypt?: ScryptParams;
  email?: string;
}

export interface SeedResult {
  email: string;
  /** null when the owner already existed (password unchanged, not known). */
  password: string | null;
  ownerId: string;
  agentId: string;
  apiKey: string;
  vaultMethodId: string;
}

export async function seedDemo(deps: SeedDeps): Promise<SeedResult> {
  const email = (deps.email ?? DEMO_EMAIL).toLowerCase();
  let password: string | null = null;
  let owner = await deps.owners.findByEmail(email);
  if (!owner) {
    password = `demo-${randomBytes(12).toString("base64url")}`;
    owner = await deps.owners.create({
      email,
      passwordHash: await hashPassword(password, deps.scrypt ?? DEFAULT_SCRYPT),
    });
  }

  const apiKey = generateApiKey();
  const agent = await deps.agents.create({
    ownerId: owner.id,
    name: "demo-agent",
    apiKeyHash: hashKey(apiKey),
  });
  await deps.agents.setPolicy(agent.id, DEMO_POLICY, {});

  // Idempotent: linkMethod returns the existing method for the same (owner, token).
  const linked = await linkMethod(
    { vault: deps.vault, audit: deps.audit, provider: deps.provider },
    owner.id,
    { ownerId: owner.id, nonce: DEMO_NONCE },
  );

  return {
    email,
    password,
    ownerId: owner.id,
    agentId: agent.id,
    apiKey,
    vaultMethodId: linked.method.id,
  };
}

export const DEMO_PASSWORD_ENV = "DEMO_OWNER_PASSWORD";
/** Same bounds as POST /auth/register (owners/service.ts CredentialsSchema). */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

/** Messages name the variable or the account, never the password. */
export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedError";
  }
}

export interface SetPasswordDeps {
  owners: OwnerStore;
  scrypt?: ScryptParams;
  email?: string;
}

/**
 * Sets the existing demo owner's password from DEMO_OWNER_PASSWORD, hashed
 * with the same scrypt scheme as register. Never returns or logs the password.
 */
export async function setDemoOwnerPassword(
  deps: SetPasswordDeps,
  env: Record<string, string | undefined>,
): Promise<{ email: string; ownerId: string }> {
  const password = env[DEMO_PASSWORD_ENV];
  if (!password || password.trim() === "") {
    throw new SeedError(`Missing required environment variable: ${DEMO_PASSWORD_ENV}`);
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new SeedError(
      `Invalid environment variable: ${DEMO_PASSWORD_ENV} (must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters)`,
    );
  }
  const email = (deps.email ?? DEMO_EMAIL).toLowerCase();
  const owner = await deps.owners.findByEmail(email);
  if (!owner) {
    throw new SeedError(`Demo owner ${email} not found. Run pnpm seed:demo first.`);
  }
  const hash = await hashPassword(password, deps.scrypt ?? DEFAULT_SCRYPT);
  if (!(await deps.owners.setPasswordHash(owner.id, hash))) {
    throw new SeedError(`Demo owner ${email} not found. Run pnpm seed:demo first.`);
  }
  return { email, ownerId: owner.id };
}