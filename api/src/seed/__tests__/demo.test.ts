// seedDemo with in-memory stores and a fake provider (no live calls).

import { describe, expect, it } from "vitest";

import {
  createMemoryAgentRegistry,
  createMemoryAuditStore,
  createMemoryOwnerStore,
  createMemoryVaultStore,
} from "../../db/memory.js";
import { hashApiKey } from "../../intents/auth.js";
import { verifyPassword } from "../../owners/password.js";
import type { PaymentProvider } from "../../payments/types.js";
import { login } from "../../owners/service.js";
import { DEMO_EMAIL, DEMO_NONCE, DEMO_POLICY, SeedError, seedDemo, setDemoOwnerPassword } from "../demo.js";

const TOKEN = "pm_fake_seed_token_SECRET";

function deps() {
  const nonces: string[] = [];
  const provider = {
    async linkPaymentMethod({ nonce }: { ownerId: string; nonce: string }) {
      nonces.push(nonce);
      return { customerId: "cust_fake", paymentMethodToken: TOKEN, cardType: "Visa", last4: "1111" };
    },
  } as unknown as PaymentProvider;
  const registry = createMemoryAgentRegistry();
  return {
    nonces,
    registry,
    d: {
      owners: createMemoryOwnerStore(),
      agents: registry.adminStore,
      vault: createMemoryVaultStore(),
      audit: createMemoryAuditStore(),
      provider,
      scrypt: { N: 2 ** 10, r: 8, p: 1, keyLen: 32 },
    },
  };
}

describe("seedDemo", () => {
  it("creates owner, agent with policy and a vaulted test card; never returns the provider token", async () => {
    const { d, nonces, registry } = deps();
    const r = await seedDemo(d);
    expect(nonces).toEqual([DEMO_NONCE]);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(r.password).toBeTruthy();
    const owner = await d.owners.findByEmail(r.email);
    expect(await verifyPassword(r.password!, owner!.passwordHash)).toBe(true);
    expect(await registry.policyStore.findAgentByKeyHash(hashApiKey(r.apiKey))).toMatchObject({ id: r.agentId, ownerId: r.ownerId });
    expect(await registry.policyStore.getPolicy(r.agentId)).toEqual({ policy: DEMO_POLICY, riskConfig: {} });
    expect((await d.vault.findByIdForOwner(r.vaultMethodId, r.ownerId))?.token).toBe(TOKEN);
  });

  it("re-running keeps the owner (no password shown) and reuses the vault method", async () => {
    const { d } = deps();
    const first = await seedDemo(d);
    const second = await seedDemo(d);
    expect(second.ownerId).toBe(first.ownerId);
    expect(second.password).toBeNull();
    expect(second.vaultMethodId).toBe(first.vaultMethodId);
    expect(second.apiKey).not.toBe(first.apiKey);
  });
});

describe("setDemoOwnerPassword", () => {
  const LOW_COST = { N: 2 ** 10, r: 8, p: 1, keyLen: 32 };
  const NEW_PASSWORD = "test-only-new-demo-password";

  it("updates the existing demo owner with a register-compatible hash and never returns the password", async () => {
    const { d } = deps();
    const seeded = await seedDemo(d);
    const r = await setDemoOwnerPassword(
      { owners: d.owners, scrypt: LOW_COST },
      { DEMO_OWNER_PASSWORD: NEW_PASSWORD },
    );
    expect(r).toEqual({ email: seeded.email, ownerId: seeded.ownerId });
    expect(JSON.stringify(r)).not.toContain(NEW_PASSWORD);
    const owner = await d.owners.findByEmail(seeded.email);
    expect(owner!.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(owner!.passwordHash).not.toContain(NEW_PASSWORD);
    expect(await verifyPassword(NEW_PASSWORD, owner!.passwordHash)).toBe(true);
    expect(await verifyPassword(seeded.password!, owner!.passwordHash)).toBe(false);
  });

  it("fails with a message naming the variable when missing or shorter than 12 characters", async () => {
    const { d } = deps();
    await seedDemo(d);
    const before = (await d.owners.findByEmail(DEMO_EMAIL))!.passwordHash;
    await expect(setDemoOwnerPassword({ owners: d.owners }, {})).rejects.toThrow(
      "Missing required environment variable: DEMO_OWNER_PASSWORD",
    );
    const short = "test-only1";
    const err = await setDemoOwnerPassword({ owners: d.owners }, { DEMO_OWNER_PASSWORD: short }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(SeedError);
    expect((err as Error).message).toContain("DEMO_OWNER_PASSWORD");
    expect((err as Error).message).toContain("12");
    expect((err as Error).message).not.toContain(short);
    expect((await d.owners.findByEmail(DEMO_EMAIL))!.passwordHash).toBe(before);
  });

  it("fails clearly when the demo owner does not exist", async () => {
    const { d } = deps();
    await expect(
      setDemoOwnerPassword({ owners: d.owners, scrypt: LOW_COST }, { DEMO_OWNER_PASSWORD: NEW_PASSWORD }),
    ).rejects.toThrow(/not found\. Run pnpm seed:demo first/);
  });

  it("the new password works with the real login flow", async () => {
    const { d } = deps();
    await seedDemo(d);
    await setDemoOwnerPassword({ owners: d.owners, scrypt: LOW_COST }, { DEMO_OWNER_PASSWORD: NEW_PASSWORD });
    const r = await login(
      {
        owners: d.owners,
        agents: d.agents,
        policies: d.agents as never,
        intents: {} as never,
        audit: d.audit,
        jwtSecret: "test-only-jwt-secret-0123456789abcdef",
        scrypt: LOW_COST,
      },
      { email: DEMO_EMAIL, password: NEW_PASSWORD },
    );
    expect(r.ownerId).toBeTruthy();
  });
});