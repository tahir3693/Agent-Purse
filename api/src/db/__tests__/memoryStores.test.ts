import { describe, expect, it } from "vitest";
import {
  createMemoryAgentRegistry,
  createMemoryIntentStore,
  createMemoryOwnerStore,
  createMemoryVaultStore,
} from "../memory.js";

const intentInput = (agentId: string) => ({
  agentId,
  amountCents: 1000,
  currency: "USD",
  payee: "shop.example",
  category: "general",
  description: "d",
  justification: "j",
  paymentMethodRef: "vm-1",
});

describe("memory OwnerStore", () => {
  it("lowercases email and rejects duplicates", async () => {
    const owners = createMemoryOwnerStore();
    const o = await owners.create({
      email: "Ann@Example.com",
      passwordHash: "h",
    });
    expect(o.email).toBe("ann@example.com");
    expect((await owners.findByEmail("ANN@example.COM"))?.id).toBe(o.id);
    expect((await owners.findById(o.id))?.email).toBe("ann@example.com");
    await expect(
      owners.create({ email: "ann@EXAMPLE.com", passwordHash: "x" })
    ).rejects.toThrow("Unique constraint: email");
    expect(await owners.findByEmail("none@example.com")).toBeNull();
  });
});

describe("memory AgentAdminStore", () => {
  it("scopes reads and writes by owner and shares data with the policy store", async () => {
    const { adminStore, policyStore } = createMemoryAgentRegistry();
    const a = await adminStore.create({
      ownerId: "o1",
      name: "a",
      apiKeyHash: "k1",
    });
    const b = await adminStore.create({
      ownerId: "o1",
      name: "b",
      apiKeyHash: "k2",
    });
    await adminStore.create({ ownerId: "o2", name: "c", apiKeyHash: "k3" });

    expect((await adminStore.listByOwner("o1")).map((x) => x.id)).toEqual([
      b.id,
      a.id,
    ]);
    expect(await adminStore.getForOwner(a.id, "o2")).toBeNull();
    expect((await adminStore.getForOwner(a.id, "o1"))?.name).toBe("a");

    expect(await adminStore.setKilled(a.id, "o2", true)).toBe(false);
    expect((await policyStore.findAgentByKeyHash("k1"))?.killed).toBe(false);
    expect(await adminStore.setKilled(a.id, "o1", true)).toBe(true);
    const found = await policyStore.findAgentByKeyHash("k1");
    expect(found?.killed).toBe(true);
    expect(found?.ownerId).toBe("o1");

    expect(await policyStore.getPolicy(a.id)).toBeNull();
    await adminStore.setPolicy(a.id, { p: 1 }, { r: 1 });
    await adminStore.setPolicy(a.id, { p: 2 }, { r: 2 });
    expect(await policyStore.getPolicy(a.id)).toEqual({
      policy: { p: 2 },
      riskConfig: { r: 2 },
    });
  });
});

describe("memory IntentStore.listByAgents", () => {
  it("filters by agents, state, since and limit, newest first", async () => {
    const store = createMemoryIntentStore();
    const i1 = await store.create(intentInput("a1"));
    const i2 = await store.create(intentInput("a1"));
    const i3 = await store.create(intentInput("a2"));
    await store.create(intentInput("a3"));
    await store.update(i2.id, { state: "escalated" });

    expect(await store.listByAgents([], { limit: 10 })).toEqual([]);
    const all = await store.listByAgents(["a1", "a2"], { limit: 10 });
    expect(all.map((x) => x.id).sort()).toEqual([i1.id, i2.id, i3.id].sort());
    expect(all.every((x) => x.agentId !== "a3")).toBe(true);
    expect(
      (
        await store.listByAgents(["a1", "a2"], {
          state: "escalated",
          limit: 10,
        })
      ).map((x) => x.id)
    ).toEqual([i2.id]);
    expect(await store.listByAgents(["a1"], { limit: 1 })).toHaveLength(1);
    expect(
      await store.listByAgents(["a1"], {
        since: new Date(Date.now() + 60_000),
        limit: 10,
      })
    ).toEqual([]);
  });
});

describe("memory VaultStore.findByIdForOwner", () => {
  it("returns the method only for its owner", async () => {
    const vault = createMemoryVaultStore();
    const m = await vault.create({
      ownerId: "o1",
      customerId: "c",
      token: "t",
    });
    expect((await vault.findByIdForOwner(m.id, "o1"))?.token).toBe("t");
    expect(await vault.findByIdForOwner(m.id, "o2")).toBeNull();
    expect(await vault.findByIdForOwner("t", "o1")).toBeNull();
  });
});
