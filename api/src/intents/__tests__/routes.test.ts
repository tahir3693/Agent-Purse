import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { registerIntentRoutes } from "../routes.js";
import { signMandate, type MandateClaims } from "../../mandates/index.js";
import {
  AGENT_KEY,
  KILLED_AGENT_KEY,
  OTHER_AGENT_KEY,
  TEST_MANDATE_KEY,
  createHarness,
  mutateChar,
  validBody,
  INTENT_TEXT,
  type Harness,
} from "./helpers.js";

async function approved(h: Harness) {
  const res = await h.create();
  expect(res.statusCode).toBe(201);
  const body = res.json() as { intentId: string; mandateToken: string };
  return { id: body.intentId, token: body.mandateToken };
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("POST /intents + execute: happy path", () => {
  it("approve => 201 token, authorize once (orderId=intentId), execute => captured once", async () => {
    const h = createHarness();
    const res = await h.create();
    expect(res.statusCode).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json() as Record<string, unknown>;
    expect(body.decision).toBe("approve");
    expect(typeof body.mandateToken).toBe("string");

    expect(h.provider.authorizeCalls).toHaveLength(1);
    expect(h.provider.authorizeCalls[0]).toMatchObject({
      intentId: body.intentId,
      amountCents: 1234,
      currency: "USD",
    });

    const ex = await h.execute(body.intentId as string, body.mandateToken);
    expect(ex.statusCode).toBe(200);
    expect(ex.json()).toEqual({ intentId: body.intentId, state: "captured" });
    expect(h.provider.captureCalls).toHaveLength(1);
    expect(h.provider.captureCalls[0]).toMatchObject({ amountCents: 1234 });
    expect(h.provider.voidCalls).toHaveLength(0);
    expect((await h.stores.intents.get(body.intentId as string))?.state).toBe("captured");
    const authz = await h.stores.authorizations.getByIntent(body.intentId as string);
    expect(authz?.status).toBe("captured");
  });
});

describe("execute rejection paths", () => {
  it("replay: second execute => 409, capture stays 1, void 0", async () => {
    const h = createHarness();
    const { id, token } = await approved(h);
    expect((await h.execute(id, token)).statusCode).toBe(200);
    const again = await h.execute(id, token);
    expect(again.statusCode).toBe(409);
    expect(h.provider.captureCalls).toHaveLength(1);
    expect(h.provider.voidCalls).toHaveLength(0);
  });

  it("expired token => 401, void once, state voided", async () => {
    const h = createHarness();
    const { id, token } = await approved(h);
    h.clock.ms += 301_000;
    const res = await h.execute(id, token);
    expect(res.statusCode).toBe(401);
    expect(h.provider.voidCalls).toHaveLength(1);
    expect(h.provider.captureCalls).toHaveLength(0);
    expect((await h.stores.intents.get(id))?.state).toBe("voided");
  });

  it("tampered token => 401 and void", async () => {
    const h = createHarness();
    const { id, token } = await approved(h);
    const bad = mutateChar(token, token.indexOf(".") + 5, "Aa0");
    expect(bad).not.toBe(token);
    const res = await h.execute(id, bad);
    expect(res.statusCode).toBe(401);
    expect(h.provider.voidCalls).toHaveLength(1);
    expect(h.provider.captureCalls).toHaveLength(0);
    expect((await h.stores.intents.get(id))?.state).toBe("voided");
  });

  it.each([
    ["amount", { amountCents: 9999 }],
    ["payee", { payee: "evil.example.com" }],
    ["currency", { currency: "EUR" }],
  ])("claim mismatch (%s) => 401 and void", async (_n, override) => {
    const h = createHarness();
    const { id } = await approved(h);
    const authz = await h.stores.authorizations.getByIntent(id);
    const now = Math.floor(h.clock.ms / 1000);
    const claims: MandateClaims = {
      jti: "forged-jti-1",
      intentId: id,
      authorizationId: authz!.providerTxnId,
      amountCents: 1234,
      currency: "USD",
      payee: "shop.example.com",
      iat: now,
      exp: now + 300,
      ...override,
    };
    const forged = signMandate(claims, TEST_MANDATE_KEY);
    const res = await h.execute(id, forged);
    expect(res.statusCode).toBe(401);
    expect(h.provider.voidCalls).toHaveLength(1);
    expect(h.provider.captureCalls).toHaveLength(0);
  });

  it("alg none and wrong-alg tokens are rejected and void", async () => {
    const h = createHarness();
    const { id, token } = await approved(h);
    const payload = token.split(".")[1]!;
    const none = `${b64({ alg: "none", typ: "JWT" })}.${payload}.${"A".repeat(43)}`;
    const hs512Header = b64({ alg: "HS512", typ: "JWT" });
    const sig = createHmac("sha512", TEST_MANDATE_KEY)
      .update(`${hs512Header}.${payload}`)
      .digest("base64url");
    const wrong = `${hs512Header}.${payload}.${sig}`;

    expect((await h.execute(id, none)).statusCode).toBe(401);
    // intent now voided; a second attempt on a voided intent is a conflict.
    expect((await h.execute(id, wrong)).statusCode).toBe(409);
    expect(h.provider.captureCalls).toHaveLength(0);
    expect(h.provider.voidCalls).toHaveLength(1);

    const h2 = createHarness();
    const a = await approved(h2);
    const p2 = a.token.split(".")[1]!;
    const hs = b64({ alg: "HS512", typ: "JWT" });
    const s2 = createHmac("sha512", TEST_MANDATE_KEY).update(`${hs}.${p2}`).digest("base64url");
    expect((await h2.execute(a.id, `${hs}.${p2}.${s2}`)).statusCode).toBe(401);
    expect(h2.provider.voidCalls).toHaveLength(1);
  });

  it("capture failure => void, 502, state voided", async () => {
    const h = createHarness({ script: { captureFails: true } });
    const { id, token } = await approved(h);
    const res = await h.execute(id, token);
    expect(res.statusCode).toBe(502);
    expect(h.provider.captureCalls).toHaveLength(1);
    expect(h.provider.voidCalls).toHaveLength(1);
    expect((await h.stores.intents.get(id))?.state).toBe("voided");
    const events = (await h.stores.audit.listByIntent(id)).map((e) => e.event);
    expect(events).toContain("capture_failed");
    expect(events).toContain("authorization_voided");
  });

  it("void failure on top of capture failure still returns 502 and audits", async () => {
    const h = createHarness({ script: { captureFails: true, voidFails: true } });
    const { id, token } = await approved(h);
    const res = await h.execute(id, token);
    expect(res.statusCode).toBe(502);
    const events = (await h.stores.audit.listByIntent(id)).map((e) => e.event);
    expect(events).toContain("capture_failed");
    expect(events).toContain("void_failed");
  });

  it("other agent's intent id => 404, nothing captured or voided", async () => {
    const h = createHarness();
    const { id, token } = await approved(h);
    const res = await h.execute(id, token, OTHER_AGENT_KEY);
    expect(res.statusCode).toBe(404);
    expect(h.provider.captureCalls).toHaveLength(0);
    expect(h.provider.voidCalls).toHaveLength(0);
  });

  it("invalid execute body => 400 with field names only", async () => {
    const h = createHarness();
    const { id } = await approved(h);
    const res = await h.app.inject({
      method: "POST",
      url: `/intents/${id}/execute`,
      headers: { authorization: `Bearer ${AGENT_KEY}` },
      payload: { nope: 1 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /intents non-approve and failure paths", () => {
  it("authorize failure => intent failed, no token, 502", async () => {
    const h = createHarness({ script: { authorizeFails: true } });
    const res = await h.create();
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.json())).not.toContain("mandateToken");
    expect(h.provider.authorizeCalls).toHaveLength(1);
  });

  it("authorize failure persists state failed", async () => {
    const h = createHarness({ script: { authorizeFails: true } });
    const create = vi.spyOn(h.stores.intents, "create");
    await h.create();
    const row = await create.mock.results[0]!.value;
    expect((await h.stores.intents.get(row.id))?.state).toBe("failed");
  });

  it.each(["deny", "escalate"] as const)("%s => 200 with decision, no hold, state stored", async (d) => {
    const h = createHarness({ decision: d });
    const res = await h.create();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { intentId: string; decision: string; mandateToken?: string };
    expect(body.decision).toBe(d);
    expect(body.mandateToken).toBeUndefined();
    expect(h.provider.authorizeCalls).toHaveLength(0);
    const rec = await h.stores.intents.get(body.intentId);
    expect(rec?.state).toBe(d === "deny" ? "denied" : "escalated");
    expect(rec?.decision).toBe(d);
  });

  it("evaluateRisk throwing => no hold, failed, 502", async () => {
    const h = createHarness({ riskThrows: true });
    const create = vi.spyOn(h.stores.intents, "create");
    const res = await h.create();
    expect(res.statusCode).toBe(502);
    expect(h.provider.authorizeCalls).toHaveLength(0);
    const row = await create.mock.results[0]!.value;
    expect((await h.stores.intents.get(row.id))?.state).toBe("failed");
  });
});

describe("authentication and validation", () => {
  it("unauthenticated => 401, nothing persisted", async () => {
    const h = createHarness();
    const create = vi.spyOn(h.stores.intents, "create");
    expect((await h.create(validBody, null)).statusCode).toBe(401);
    expect((await h.create(validBody, "test-only-unknown-key-zzzzzzzzzzzz")).statusCode).toBe(401);
    expect(create).not.toHaveBeenCalled();
    expect(h.riskCalls).toHaveLength(0);
  });

  it("unauthenticated execute => 401", async () => {
    const h = createHarness();
    expect((await h.execute("x", "t", null)).statusCode).toBe(401);
  });

  it("killed agent => 403, nothing persisted", async () => {
    const h = createHarness();
    const create = vi.spyOn(h.stores.intents, "create");
    expect((await h.create(validBody, KILLED_AGENT_KEY)).statusCode).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("invalid body => 400 with field names only, nothing persisted", async () => {
    const h = createHarness();
    const create = vi.spyOn(h.stores.intents, "create");
    const res = await h.create({
      ...validBody,
      amountCents: 12.5,
      currency: "usd",
      description: "LEAKY-INVALID-TEXT",
    });
    expect(res.statusCode).toBe(400);
    const json = res.json() as { fields: string[] };
    expect(json.fields).toEqual(expect.arrayContaining(["amountCents", "currency"]));
    expect(res.body).not.toContain("LEAKY-INVALID-TEXT");
    expect(create).not.toHaveBeenCalled();
    expect(h.provider.authorizeCalls).toHaveLength(0);
  });
});

describe("webhook dedupe via route", () => {
  it("duplicate returns 200 duplicate without reprocessing; status updated once", async () => {
    const h = createHarness();
    const { id } = await approved(h);
    const authz = await h.stores.authorizations.getByIntent(id);
    h.provider.script.parseWebhook = async () => ({
      key: "evt-1",
      kind: "transaction_settled",
      timestampMs: 1,
      transactionId: authz!.providerTxnId,
      status: "captured",
    });
    const spy = vi.spyOn(h.stores.authorizations, "updateStatusByProviderTxnId");
    const send = () =>
      h.app.inject({
        method: "POST",
        url: "/webhooks/payments",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "bt_signature=fake&bt_payload=fake",
      });
    const first = await send();
    expect(first.json()).toEqual({ status: "ok" });
    const second = await send();
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ status: "duplicate" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await h.stores.authorizations.getByIntent(id))?.status).toBe("captured");
  });

  it("memory store: claim true then false", async () => {
    const h = createHarness();
    expect(await h.stores.webhookEvents.claim("e1")).toBe(true);
    expect(await h.stores.webhookEvents.claim("e1")).toBe(false);
  });
});

describe("secrets never leak", () => {
  it("token, key and intent text absent from audit meta, error responses and logs", async () => {
    // Use a dedicated server with a capturing log stream (buildServer logs to stdout).
    const h = createHarness({ script: { captureFails: true } });
    let logs = "";
    const stream = new Writable({
      write(chunk, _enc, cb) {
        logs += chunk.toString();
        cb();
      },
    });
    const app = Fastify({ logger: { level: "trace", stream } });
    registerIntentRoutes(app, h.deps);
    await app.ready();

    const headers = { authorization: `Bearer ${AGENT_KEY}` };
    const created = await app.inject({ method: "POST", url: "/intents", headers, payload: validBody });
    const { intentId, mandateToken } = created.json() as { intentId: string; mandateToken: string };
    const failed = await app.inject({
      method: "POST",
      url: `/intents/${intentId}/execute`,
      headers,
      payload: { mandateToken },
    });
    expect(failed.statusCode).toBe(502);
    const replay = await app.inject({
      method: "POST",
      url: `/intents/${intentId}/execute`,
      headers,
      payload: { mandateToken },
    });
    const bad = await app.inject({ method: "POST", url: "/intents", headers, payload: { ...validBody, amountCents: -1 } });

    const auditJson = JSON.stringify(await h.stores.audit.listByIntent(intentId));
    const secrets = [mandateToken, AGENT_KEY, TEST_MANDATE_KEY, INTENT_TEXT.description, INTENT_TEXT.justification];
    const surfaces = [auditJson, logs, failed.body, replay.body, bad.body];
    for (const s of surfaces) {
      for (const secret of secrets) expect(s).not.toContain(secret);
    }
    expect(auditJson.length).toBeGreaterThan(10);
    expect(logs.length).toBeGreaterThan(0);
    await app.close();
  });
});
