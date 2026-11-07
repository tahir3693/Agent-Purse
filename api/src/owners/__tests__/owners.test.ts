// spec-06b: owner accounts, agents, isolation, payment-method safety, approvals,
// reads and the root route. Offline: in-memory stores, fake provider.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  AGENT_KEY,
  OTHER_OWNER_ID,
  OTHER_OWNER_METHOD_ID,
  OWNERLESS_AGENT_KEY,
  OWNER_ID,
  RAW_PROVIDER_TOKEN,
  TEST_OWNER_SECRET,
  VALID_POLICY,
  createHarness,
  validBody,
  type Harness,
} from "../../intents/__tests__/helpers.js";
import { hashApiKey } from "../../intents/auth.js";
import { verifyOwnerToken } from "../../vault/auth.js";
import { hashPassword, verifyPassword } from "../password.js";

const PASSWORD = "test-only-owner-password-123";
const LOW = { N: 2 ** 10, r: 8, p: 1, keyLen: 32 };

const post = (h: Harness, url: string, payload?: object, headers: Record<string, string> = {}) =>
  h.app.inject({ method: "POST", url, payload: payload ?? {}, headers });
const get = (h: Harness, url: string, headers: Record<string, string> = {}) =>
  h.app.inject({ method: "GET", url, headers });

async function createAgentFor(h: Harness, ownerId: string, name = "bot") {
  const res = await post(h, "/agents", { name, policy: VALID_POLICY }, h.asOwner(ownerId));
  expect(res.statusCode).toBe(201);
  return res.json() as { agent: { id: string; name: string; killed: boolean }; apiKey: string };
}

describe("root route", () => {
  it("GET / and HEAD / answer without auth", async () => {
    const h = createHarness();
    const res = await get(h, "/");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: "agentpurse-api", status: "ok" });
    expect((await h.app.inject({ method: "HEAD", url: "/" })).statusCode).toBe(200);
  });
});

describe("password hashing", () => {
  it("scrypt round-trips and rejects wrong passwords and malformed hashes", async () => {
    const hash = await hashPassword(PASSWORD, LOW);
    expect(hash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}x`, hash)).toBe(false);
    expect(await verifyPassword(PASSWORD, "scrypt$bad")).toBe(false);
  });
});

describe("register and login", () => {
  it("register stores a hash only; login issues an HS256 owner JWT with sub = ownerId and <= 1h expiry", async () => {
    const h = createHarness();
    const reg = await post(h, "/auth/register", { email: "Owner@Example.com", password: PASSWORD });
    expect(reg.statusCode).toBe(201);
    const { ownerId, email } = reg.json() as { ownerId: string; email: string };
    expect(email).toBe("owner@example.com");
    expect(reg.body).not.toContain(PASSWORD);
    const stored = await h.owners.findById(ownerId);
    expect(stored?.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(stored?.passwordHash).not.toContain(PASSWORD);

    const res = await post(h, "/auth/login", { email: "owner@example.com", password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json() as { accessToken: string; expiresAt: string };
    const nowS = Math.floor(h.clock.ms / 1000);
    const v = verifyOwnerToken(body.accessToken, TEST_OWNER_SECRET, nowS);
    expect(v.ok && v.claims.sub).toBe(ownerId);
    expect(v.ok && v.claims.exp - nowS).toBeLessThanOrEqual(3600);
    expect(h.logs()).not.toContain(PASSWORD);
  });

  it("duplicate email => 409; weak password => 400 with field names only", async () => {
    const h = createHarness();
    await post(h, "/auth/register", { email: "a@example.com", password: PASSWORD });
    expect((await post(h, "/auth/register", { email: "a@example.com", password: PASSWORD })).statusCode).toBe(409);
    const weak = await post(h, "/auth/register", { email: "b@example.com", password: "short" });
    expect(weak.statusCode).toBe(400);
    expect(weak.json()).toMatchObject({ fields: ["password"] });
    expect(weak.body).not.toContain("short");
  });

  it("unknown email and wrong password return the same generic 401", async () => {
    const h = createHarness();
    await post(h, "/auth/register", { email: "a@example.com", password: PASSWORD });
    const wrong = await post(h, "/auth/login", { email: "a@example.com", password: "wrong-password-123" });
    const unknown = await post(h, "/auth/login", { email: "nobody@example.com", password: PASSWORD });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.body).toBe(unknown.body);
  });

  it("rate-limits login per IP and email (6th attempt => 429)", async () => {
    const h = createHarness();
    await post(h, "/auth/register", { email: "a@example.com", password: PASSWORD });
    for (let i = 0; i < 5; i++) {
      expect((await post(h, "/auth/login", { email: "a@example.com", password: "nope-nope-nope" })).statusCode).toBe(401);
    }
    const limited = await post(h, "/auth/login", { email: "a@example.com", password: PASSWORD });
    expect(limited.statusCode).toBe(429);
    h.clock.ms += 15 * 60 * 1000 + 1;
    expect((await post(h, "/auth/login", { email: "a@example.com", password: PASSWORD })).statusCode).toBe(200);
  });

  it("a stream token is not accepted as a bearer token", async () => {
    const h = createHarness();
    const st = await post(h, "/events/token", {}, h.asOwner());
    const { streamToken } = st.json() as { streamToken: string };
    expect((await get(h, "/agents", { authorization: `Bearer ${streamToken}` })).statusCode).toBe(401);
  });
});

describe("agents: key shown once, owner-scoped management", () => {
  it("create returns the key once; only its sha256 hash is stored; list never returns key material", async () => {
    const h = createHarness();
    const { agent, apiKey } = await createAgentFor(h, OWNER_ID);
    expect(apiKey).toMatch(/^agk_/);
    const rec = await h.registry.adminStore.getForOwner(agent.id, OWNER_ID);
    expect(rec?.apiKeyHash).toBe(hashApiKey(apiKey));
    expect(JSON.stringify(rec)).not.toContain(apiKey);

    const list = await get(h, "/agents", h.asOwner());
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(apiKey);
    expect(list.body).not.toContain(hashApiKey(apiKey));
    expect(list.body).not.toContain("apiKey");
    expect(h.logs()).not.toContain(apiKey);

    // The new key authenticates as that agent.
    const intent = await h.create(validBody, apiKey);
    expect(intent.statusCode).toBe(201);
  });

  it("kill switch blocks the agent (403) and restore re-enables it", async () => {
    const h = createHarness();
    const { agent, apiKey } = await createAgentFor(h, OWNER_ID);
    expect((await post(h, `/agents/${agent.id}/kill`, {}, h.asOwner())).json()).toEqual({ id: agent.id, killed: true });
    expect((await h.create(validBody, apiKey)).statusCode).toBe(403);
    await post(h, `/agents/${agent.id}/restore`, {}, h.asOwner());
    expect((await h.create(validBody, apiKey)).statusCode).toBe(201);
  });

  it("policy get/set validates with PolicySchema", async () => {
    const h = createHarness();
    const { agent } = await createAgentFor(h, OWNER_ID);
    const url = `/agents/${agent.id}/policy`;
    expect((await get(h, url, h.asOwner())).json()).toEqual({ agentId: agent.id, policy: VALID_POLICY });
    const bad = await h.app.inject({ method: "PUT", url, headers: h.asOwner(), payload: { ...VALID_POLICY, dailyBudgetCents: 1.5 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ fields: ["dailyBudgetCents"] });
    const next = { ...VALID_POLICY, dailyBudgetCents: 777 };
    expect((await h.app.inject({ method: "PUT", url, headers: h.asOwner(), payload: next })).statusCode).toBe(200);
    expect((await get(h, url, h.asOwner())).json()).toEqual({ agentId: agent.id, policy: next });
  });

  it("all owner routes require the owner JWT", async () => {
    const h = createHarness();
    for (const [m, u] of [["GET", "/agents"], ["POST", "/agents"], ["GET", "/owner/intents"], ["GET", "/owner/stats"], ["POST", "/events/token"]] as const) {
      expect((await h.app.inject({ method: m, url: u })).statusCode).toBe(401);
    }
    // An agent API key is not an owner token.
    expect((await get(h, "/agents", { authorization: `Bearer ${AGENT_KEY}` })).statusCode).toBe(401);
  });
});

describe("ownership isolation (Property 1)", () => {
  it("owner B cannot see or change owner A's agents, intents or methods", async () => {
    const h = createHarness({ decision: "escalate" });
    const { agent } = await createAgentFor(h, OWNER_ID);
    const created = await h.create();
    const intentId = (created.json() as { intentId: string }).intentId;
    const B = h.asOwner(OTHER_OWNER_ID);

    expect((await get(h, "/agents", B)).json()).toEqual({ agents: [] });
    expect((await post(h, `/agents/${agent.id}/kill`, {}, B)).statusCode).toBe(404);
    expect((await get(h, `/agents/${agent.id}/policy`, B)).statusCode).toBe(404);
    expect((await h.app.inject({ method: "PUT", url: `/agents/${agent.id}/policy`, headers: B, payload: VALID_POLICY })).statusCode).toBe(404);
    expect((await get(h, "/owner/intents", B)).json()).toEqual({ intents: [] });
    expect((await get(h, `/owner/intents/${intentId}`, B)).statusCode).toBe(404);
    expect((await post(h, `/intents/${intentId}/approve`, {}, B)).statusCode).toBe(404);
    expect((await post(h, `/intents/${intentId}/deny`, {}, B)).statusCode).toBe(404);

    // Nothing changed for A.
    expect((await h.registry.adminStore.getForOwner(agent.id, OWNER_ID))?.killed).toBe(false);
    expect((await h.stores.intents.get(intentId))?.state).toBe("escalated");
    expect(h.provider.authorizeCalls).toHaveLength(0);
  });

  it("property: arbitrary foreign or unknown ids always 404 for another owner", async () => {
    const h = createHarness({ decision: "escalate" });
    const { agent } = await createAgentFor(h, OWNER_ID);
    const intentId = ((await h.create()).json() as { intentId: string }).intentId;
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(agent.id, intentId, "x", "agent-1"), fc.uuid(), async (id, other) => {
        const B = h.asOwner(other);
        expect((await get(h, `/agents/${id}/policy`, B)).statusCode).toBe(404);
        expect((await get(h, `/owner/intents/${id}`, B)).statusCode).toBe(404);
        expect((await post(h, `/intents/${id}/approve`, {}, B)).statusCode).toBe(404);
      }),
      { numRuns: 25 },
    );
    expect((await h.stores.intents.get(intentId))?.state).toBe("escalated");
  });
});

describe("payment method safety (Property 2)", () => {
  it("raw provider token => 422 invalid_payment_method, nothing persisted, no provider call", async () => {
    const h = createHarness();
    const res = await h.create({ ...validBody, paymentMethodRef: RAW_PROVIDER_TOKEN });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_payment_method", message: "Invalid payment method" });
    expect(await h.stores.intents.listByAgents(["agent-1"], { limit: 10 })).toEqual([]);
    expect(h.provider.authorizeCalls).toHaveLength(0);
  });

  it("another owner's method and ownerless agents => 422", async () => {
    const h = createHarness();
    expect((await h.create({ ...validBody, paymentMethodRef: OTHER_OWNER_METHOD_ID })).statusCode).toBe(422);
    expect((await h.create(validBody, OWNERLESS_AGENT_KEY)).statusCode).toBe(422);
    expect(h.provider.authorizeCalls).toHaveLength(0);
  });

  it("the vault id resolves server-side to the provider token", async () => {
    const h = createHarness();
    expect((await h.create()).statusCode).toBe(201);
    expect(h.provider.authorizeCalls[0]?.paymentMethodRef).toBe(RAW_PROVIDER_TOKEN);
  });

  it("property: any string that is not the owner's vault id is rejected", async () => {
    const h = createHarness();
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0 && s.trim() !== "vm-test-1"),
        async (ref) => {
          const res = await h.create({ ...validBody, paymentMethodRef: ref });
          expect(res.statusCode).toBe(422);
        },
      ),
      { numRuns: 50 },
    );
    expect(await h.stores.intents.listByAgents(["agent-1"], { limit: 10 })).toEqual([]);
    expect(h.provider.authorizeCalls).toHaveLength(0);
  });
});

describe("owner approval of escalated intents", () => {
  async function escalated() {
    const h = createHarness({ decision: "escalate" });
    const res = await h.create();
    expect(res.statusCode).toBe(200);
    const intentId = (res.json() as { intentId: string }).intentId;
    return { h, intentId };
  }

  it("approve => authorized hold; agent gets one mandate and captures", async () => {
    const { h, intentId } = await escalated();
    const ap = await post(h, `/intents/${intentId}/approve`, {}, h.asOwner());
    expect(ap.statusCode).toBe(200);
    expect(ap.json()).toEqual({ intentId, state: "authorized" });
    expect(h.provider.authorizeCalls).toHaveLength(1);
    expect(h.provider.authorizeCalls[0]).toMatchObject({ intentId, paymentMethodRef: RAW_PROVIDER_TOKEN });
    const events = (await h.stores.audit.listByIntent(intentId)).map((e) => e.event);
    expect(events).toEqual(expect.arrayContaining(["owner_approved", "authorized"]));

    const status = await get(h, `/intents/${intentId}`, { authorization: `Bearer ${AGENT_KEY}` });
    expect(status.json()).toMatchObject({ intentId, state: "authorized", decision: "approve" });

    const m = await post(h, `/intents/${intentId}/mandate`, {}, { authorization: `Bearer ${AGENT_KEY}` });
    expect(m.statusCode).toBe(201);
    expect(m.headers["cache-control"]).toBe("no-store");
    const { mandateToken } = m.json() as { mandateToken: string };
    expect((await post(h, `/intents/${intentId}/mandate`, {}, { authorization: `Bearer ${AGENT_KEY}` })).statusCode).toBe(409);

    expect((await h.execute(intentId, mandateToken)).statusCode).toBe(200);
    expect(h.provider.captureCalls).toHaveLength(1);
    expect((await post(h, `/intents/${intentId}/approve`, {}, h.asOwner())).statusCode).toBe(409);
  });

  it("deny => denied, audit owner_denied, provider untouched", async () => {
    const { h, intentId } = await escalated();
    const res = await post(h, `/intents/${intentId}/deny`, {}, h.asOwner());
    expect(res.json()).toEqual({ intentId, state: "denied" });
    expect((await h.stores.intents.get(intentId))?.state).toBe("denied");
    expect((await h.stores.audit.listByIntent(intentId)).map((e) => e.event)).toContain("owner_denied");
    expect(h.provider.authorizeCalls).toHaveLength(0);
    expect((await post(h, `/intents/${intentId}/approve`, {}, h.asOwner())).statusCode).toBe(409);
  });

  it("approve/deny require state escalated and the owner JWT (not an agent key)", async () => {
    const h = createHarness({ decision: "approve" });
    const intentId = ((await h.create()).json() as { intentId: string }).intentId;
    expect((await post(h, `/intents/${intentId}/approve`, {}, h.asOwner())).statusCode).toBe(409);
    expect((await post(h, `/intents/${intentId}/deny`, {}, { authorization: `Bearer ${AGENT_KEY}` })).statusCode).toBe(401);
    // Auto-approved intents already carry their one mandate.
    expect((await post(h, `/intents/${intentId}/mandate`, {}, { authorization: `Bearer ${AGENT_KEY}` })).statusCode).toBe(409);
  });

  it("approve when the provider fails => 502 and state failed", async () => {
    const { h, intentId } = await escalated();
    h.provider.script.authorizeFails = true;
    expect((await post(h, `/intents/${intentId}/approve`, {}, h.asOwner())).statusCode).toBe(502);
    expect((await h.stores.intents.get(intentId))?.state).toBe("failed");
  });
});

describe("owner reads", () => {
  it("lists intents by state, returns one intent with audit events, and stats", async () => {
    const h = createHarness({ startMs: Date.now() });
    const a = ((await h.create()).json() as { intentId: string; mandateToken: string });
    await h.execute(a.intentId, a.mandateToken);
    h.state.decision = "escalate";
    await h.create({ ...validBody, amountCents: 999 });
    h.state.decision = "deny";
    await h.create({ ...validBody, amountCents: 5 });

    const all = (await get(h, "/owner/intents", h.asOwner())).json() as { intents: { state: string }[] };
    expect(all.intents).toHaveLength(3);
    const esc = (await get(h, "/owner/intents?state=escalated", h.asOwner())).json() as { intents: { amountCents: number }[] };
    expect(esc.intents.map((i) => i.amountCents)).toEqual([999]);
    expect((await get(h, "/owner/intents?state=bogus", h.asOwner())).statusCode).toBe(400);

    const one = (await get(h, `/owner/intents/${a.intentId}`, h.asOwner())).json() as {
      intent: { state: string; paymentMethodId: string };
      events: { event: string }[];
    };
    expect(one.intent.state).toBe("captured");
    expect(one.intent.paymentMethodId).toBe("vm-test-1");
    expect(one.events.map((e) => e.event)).toEqual(expect.arrayContaining(["intent_created", "captured"]));
    expect(JSON.stringify(one)).not.toContain(RAW_PROVIDER_TOKEN);

    const s = (await get(h, "/owner/stats", h.asOwner())).json() as {
      spentToday: { currency: string; amountCents: number }[];
      countsByDecision: Record<string, number>;
    };
    expect(s.spentToday).toEqual([{ currency: "USD", amountCents: 1234 }]);
    expect(s.countsByDecision).toEqual({ approve: 1, deny: 1, escalate: 1, none: 0 });
    expect((await get(h, "/owner/stats", h.asOwner(OTHER_OWNER_ID))).json()).toMatchObject({ spentToday: [] });
  });
});