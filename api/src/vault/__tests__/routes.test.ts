import { describe, expect, it } from "vitest";

import { createMemoryAuditStore, createMemoryVaultStore } from "../../db/memory.js";
import type { VaultStore } from "../../db/stores.js";
import { ProviderError } from "../../payments/errors.js";
import {
  NONCE,
  NOW_S,
  WRONG_SECRET,
  b64,
  createFakeProvider,
  createVaultHarness,
  ownerToken,
  signOwner,
} from "./helpers.js";

const REDACTED_KEYS = ["cardType", "createdAt", "id", "last4", "tokenRef"];

describe("POST /vault/link success", () => {
  it("201 with exactly the redacted method; audit vault_linked has ids only", async () => {
    const h = await createVaultHarness({
      fake: createFakeProvider({ token: () => "tok_abcdef_1234", customerId: "cust_internal_9" }),
    });
    const res = await h.link({ ownerId: "owner_1", nonce: NONCE }, ownerToken("owner_1"));
    expect(res.statusCode).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    const { method } = res.json() as { method: Record<string, unknown> };
    expect(Object.keys(method).sort()).toEqual(REDACTED_KEYS);
    expect(method).toMatchObject({ cardType: "Visa", last4: "1111", tokenRef: "****1234" });
    expect(typeof method.id).toBe("string");
    expect(new Date(method.createdAt as string).toISOString()).toBe(method.createdAt);

    expect(h.provider.calls).toEqual([{ ownerId: "owner_1", nonce: NONCE }]);
    const stored = await h.vault.listByOwner("owner_1");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ token: "tok_abcdef_1234", customerId: "cust_internal_9" });

    const events = await h.auditEvents();
    expect(events).toEqual([
      { event: "vault_linked", meta: { ownerId: "owner_1", vaultMethodId: method.id } },
    ]);
  });

  it("stores null cardType/last4 when the provider omits them", async () => {
    const provider = {
      async linkPaymentMethod() {
        return { customerId: "c", paymentMethodToken: "tok_plain_0001" };
      },
    };
    const h = await createVaultHarness({ provider: provider as never });
    const res = await h.link({ ownerId: "o", nonce: NONCE }, ownerToken("o"));
    expect(res.statusCode).toBe(201);
    expect((res.json() as { method: Record<string, unknown> }).method).toMatchObject({
      cardType: null,
      last4: null,
      tokenRef: "****0001",
    });
  });
});

describe("POST /vault/link provider failures (fail closed)", () => {
  it("invalid nonce => 422 payment_method_rejected, zero records, no vault_linked audit", async () => {
    const h = await createVaultHarness();
    const res = await h.link({ ownerId: "o", nonce: "bad-nonce-xyz" }, ownerToken("o"));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "payment_method_rejected",
      message: "Payment method was rejected",
    });
    expect(await h.vault.listByOwner("o")).toHaveLength(0);
    expect((await h.auditEvents()).map((e) => e.event)).not.toContain("vault_linked");
    expect(res.body).not.toContain("bad-nonce-xyz");
  });

  it.each(["rejected", "declined"])("provider code %s => 422", async (code) => {
    const h = await createVaultHarness({
      fake: createFakeProvider({
        fail: new ProviderError({ provider: "braintree", code, message: "x" }),
      }),
    });
    const res = await h.link({ ownerId: "o", nonce: NONCE }, ownerToken("o"));
    expect(res.statusCode).toBe(422);
  });

  it("unexpected provider error => 502 provider_unavailable, zero records", async () => {
    const h = await createVaultHarness({
      fake: createFakeProvider({ fail: new Error("boom tok_leak_9999 secret-nonce") }),
    });
    const res = await h.link({ ownerId: "o", nonce: NONCE }, ownerToken("o"));
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      error: "provider_unavailable",
      message: "Payment provider error",
    });
    expect(res.body).not.toContain("tok_leak_9999");
    expect(await h.vault.listByOwner("o")).toHaveLength(0);
  });

  it("provider_error ProviderError code => 502", async () => {
    const h = await createVaultHarness({
      fake: createFakeProvider({
        fail: new ProviderError({ provider: "braintree", code: "provider_error", message: "x" }),
      }),
    });
    const res = await h.link({ ownerId: "o", nonce: NONCE }, ownerToken("o"));
    expect(res.statusCode).toBe(502);
  });
});

describe("GET /vault/methods", () => {
  it("returns all of the owner's methods newest first, never another owner's", async () => {
    const h = await createVaultHarness({
      fake: createFakeProvider({ token: (n) => `tok_${n}_${String(n).repeat(4)}` }),
    });
    const ids: string[] = [];
    for (const owner of ["alice", "alice", "bob", "alice"]) {
      const res = await h.link({ ownerId: owner, nonce: NONCE }, ownerToken(owner));
      expect(res.statusCode).toBe(201);
      ids.push((res.json() as { method: { id: string } }).method.id);
    }
    const res = await h.list(ownerToken("alice"));
    expect(res.statusCode).toBe(200);
    const { methods } = res.json() as { methods: Record<string, unknown>[] };
    expect(methods.map((m) => m.id)).toEqual([ids[3], ids[1], ids[0]]);
    for (const m of methods) expect(Object.keys(m).sort()).toEqual(REDACTED_KEYS);
    expect(methods.map((m) => m.id)).not.toContain(ids[2]);

    const bob = (await h.list(ownerToken("bob"))).json() as { methods: { id: string }[] };
    expect(bob.methods.map((m) => m.id)).toEqual([ids[2]]);
  });

  it("returns an empty list for an owner with nothing linked", async () => {
    const h = await createVaultHarness();
    const res = await h.list(ownerToken("nobody"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ methods: [] });
  });

  it("store failure => 502 persist_failed", async () => {
    const vault: VaultStore = {
      ...createMemoryVaultStore(),
      listByOwner: async () => {
        throw new Error("db down tok_leak");
      },
    };
    const h = await createVaultHarness({ vault });
    const res = await h.list(ownerToken("o"));
    expect(res.statusCode).toBe(502);
    expect((res.json() as { error: string }).error).toBe("persist_failed");
    expect(res.body).not.toContain("tok_leak");
  });
});

describe("duplicate link and owner binding", () => {
  it("relinking the same token => 200, same id, one record", async () => {
    const h = await createVaultHarness({ fake: createFakeProvider({ token: () => "tok_same_7777" }) });
    const first = await h.link({ ownerId: "o", nonce: NONCE }, ownerToken("o"));
    const second = await h.link({ ownerId: "o", nonce: NONCE }, ownerToken("o"));
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect((second.json() as { method: { id: string } }).method.id).toBe(
      (first.json() as { method: { id: string } }).method.id,
    );
    expect(await h.vault.listByOwner("o")).toHaveLength(1);
    expect((await h.auditEvents()).filter((e) => e.event === "vault_linked")).toHaveLength(1);
  });

  it("owner mismatch => 403 and provider NOT called", async () => {
    const h = await createVaultHarness();
    const res = await h.link({ ownerId: "victim", nonce: NONCE }, ownerToken("attacker"));
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe("forbidden");
    expect(h.provider.calls).toHaveLength(0);
    expect(await h.vault.listByOwner("victim")).toHaveLength(0);
  });
});

describe("authentication", () => {
  const good = { ownerId: "o", nonce: NONCE };
  const claims = { sub: "o", iat: NOW_S - 10, exp: NOW_S + 3600 };

  function badTokens(): [string, string | null][] {
    const valid = ownerToken("o");
    const [h, , s] = valid.split(".") as [string, string, string];
    return [
      ["missing header", null],
      ["expired", ownerToken("o", { exp: NOW_S - 1 })],
      ["wrong secret", signOwner(claims, WRONG_SECRET)],
      ["tampered payload", `${h}.${b64({ ...claims, sub: "other" })}.${s}`],
      [
        "alg none",
        `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`,
      ],
      ["garbage", "not-a-jwt"],
    ];
  }

  it.each(badTokens())("POST %s => 401 and provider NOT called", async (_n, token) => {
    const h = await createVaultHarness();
    const res = await h.link(good, token);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
    expect(h.provider.calls).toHaveLength(0);
    expect(await h.vault.listByOwner("o")).toHaveLength(0);
  });

  it.each(badTokens())("GET %s => 401", async (_n, token) => {
    const h = await createVaultHarness();
    const res = await h.list(token);
    expect(res.statusCode).toBe(401);
  });
});

describe("body validation", () => {
  it.each([
    ["missing nonce", { ownerId: "o" }, ["nonce"]],
    ["missing ownerId", { nonce: NONCE }, ["ownerId"]],
    ["extra keys", { ownerId: "o", nonce: NONCE, extra: 1 }, ["body"]],
    ["wrong types", { ownerId: 5, nonce: { a: 1 } }, ["ownerId", "nonce"]],
    ["empty nonce", { ownerId: "o", nonce: "" }, ["nonce"]],
  ])("%s => 400 with field names only, nothing persisted", async (_n, body, fields) => {
    const h = await createVaultHarness();
    const res = await h.link(body, ownerToken("o"));
    expect(res.statusCode).toBe(400);
    const json = res.json() as { error: string; fields: string[] };
    expect(json.error).toBe("invalid_body");
    expect(json.fields.sort()).toEqual([...fields].sort());
    expect(Object.keys(json).sort()).toEqual(["error", "fields"]);
    expect(h.provider.calls).toHaveLength(0);
    expect(await h.vault.listByOwner("o")).toHaveLength(0);
  });
});

describe("persistence failure", () => {
  it("vault.create throws => 502 and audit vault_persist_failed with ids only", async () => {
    const vault: VaultStore = {
      ...createMemoryVaultStore(),
      create: async () => {
        throw new Error("insert failed tok_secret_1_WXYZ");
      },
    };
    const h = await createVaultHarness({ vault, audit: createMemoryAuditStore() });
    const res = await h.link({ ownerId: "o", nonce: NONCE }, ownerToken("o"));
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      error: "persist_failed",
      message: "Could not store payment method",
    });
    expect(await h.auditEvents()).toEqual([
      { event: "vault_persist_failed", meta: { ownerId: "o" } },
    ]);
    expect(res.body).not.toContain("WXYZ");
  });

  it("an audit store failure does not change the success outcome", async () => {
    const audit = createMemoryAuditStore();
    audit.append = async () => {
      throw new Error("audit down");
    };
    const h = await createVaultHarness({ audit });
    // harness wraps audit.append; the wrapper still delegates to the throwing original
    const res = await h.link({ ownerId: "o", nonce: NONCE }, ownerToken("o"));
    expect(res.statusCode).toBe(201);
  });
});

describe("secret-free output", () => {
  it("responses, audit meta and logs never contain nonce, token, customerId, JWT or secret", async () => {
    const SECRET_NONCE = NONCE;
    const h = await createVaultHarness({
      fake: createFakeProvider({
        token: () => "tok_rawsecret_QRST",
        customerId: "cust_internal_secret_42",
      }),
    });
    const jwt = ownerToken("owner_x");
    const bodies: string[] = [];

    bodies.push((await h.link({ ownerId: "owner_x", nonce: SECRET_NONCE }, jwt)).body);
    bodies.push((await h.link({ ownerId: "owner_x", nonce: SECRET_NONCE }, jwt)).body);
    bodies.push((await h.link({ ownerId: "other", nonce: SECRET_NONCE }, jwt)).body);
    bodies.push((await h.link({ ownerId: "owner_x", nonce: "bad-nonce-xyz" }, jwt)).body);
    bodies.push((await h.link({ ownerId: "owner_x" }, jwt)).body);
    bodies.push((await h.link({ ownerId: "owner_x", nonce: SECRET_NONCE }, "bad.jwt.value")).body);
    bodies.push((await h.list(jwt)).body);

    const audit = JSON.stringify(await h.auditEvents());
    const logs = h.logs();
    expect(logs.length).toBeGreaterThan(0);

    const forbidden = [
      "tok_rawsecret_QRST",
      "cust_internal_secret_42",
      jwt,
      jwt.split(".")[2]!,
      "test-owner-secret",
      "bad-nonce-xyz",
      "bad.jwt.value",
    ];
    for (const needle of forbidden) {
      for (const b of bodies) expect(b).not.toContain(needle);
      expect(audit).not.toContain(needle);
      expect(logs).not.toContain(needle);
    }
    // The nonce may only appear in request payloads we sent, never in outputs.
    for (const b of bodies) expect(b).not.toContain(SECRET_NONCE);
    expect(audit).not.toContain(SECRET_NONCE);
    expect(logs).not.toContain(SECRET_NONCE);
    // tokenRef is the masked suffix.
    expect(bodies[0]).toContain("****QRST");
  });
});
