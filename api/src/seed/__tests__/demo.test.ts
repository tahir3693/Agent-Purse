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
import { DEMO_NONCE, DEMO_POLICY, seedDemo } from "../demo.js";

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