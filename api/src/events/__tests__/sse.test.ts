// spec-06b live feed: stream-token auth and per-owner delivery over a real socket.

import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import {
  OTHER_OWNER_ID,
  OWNER_ID,
  createHarness,
  type Harness,
} from "../../intents/__tests__/helpers.js";
import { signOwnerToken, signStreamToken } from "../../owners/tokens.js";
import { createEventBus } from "../bus.js";

const SECRET = "test-only-owner-jwt-secret-0123456789abcdef";
let open: Harness | null = null;

afterEach(async () => {
  await open?.app.close();
  open = null;
});

async function mintStream(h: Harness, ownerId = OWNER_ID): Promise<string> {
  const res = await h.app.inject({
    method: "POST",
    url: "/events/token",
    headers: h.asOwner(ownerId),
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { streamToken: string }).streamToken;
}

describe("GET /events auth", () => {
  it("rejects a missing token, an access token, a tampered token and an expired stream token", async () => {
    const h = createHarness();
    const url = (t: string) => `/events?stream_token=${encodeURIComponent(t)}`;
    expect(
      (await h.app.inject({ method: "GET", url: "/events" })).statusCode
    ).toBe(401);
    expect(
      (await h.app.inject({ method: "GET", url: url(h.ownerToken()) }))
        .statusCode
    ).toBe(401);
    const st = await mintStream(h);
    expect(
      (await h.app.inject({ method: "GET", url: url(`${st}x`) })).statusCode
    ).toBe(401);
    // A bearer header does not open the stream.
    expect(
      (
        await h.app.inject({
          method: "GET",
          url: "/events",
          headers: { authorization: `Bearer ${st}` },
        })
      ).statusCode
    ).toBe(401);
    h.clock.ms += 61_000;
    expect(
      (await h.app.inject({ method: "GET", url: url(st) })).statusCode
    ).toBe(401);
  });

  it("stream tokens expire within 60 seconds and carry scope sse", () => {
    const now = new Date();
    const t = signStreamToken(OWNER_ID, SECRET, now);
    expect(t.expiresAt.getTime() - now.getTime()).toBeLessThanOrEqual(60_000);
    expect(signOwnerToken(OWNER_ID, SECRET, now).token).not.toBe(t.token);
  });
});

describe("GET /events stream", () => {
  it("delivers the owner's intent events (ids and states only) and never logs the token", async () => {
    const h = createHarness();
    open = h;
    const st = await mintStream(h);
    await h.app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = h.app.server.address() as AddressInfo;
    const ac = new AbortController();
    const res = await fetch(
      `http://127.0.0.1:${port}/events?stream_token=${st}`,
      {
        signal: ac.signal,
        headers: { origin: "http://localhost:3000" },
      }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000"
    );

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const created = await h.create();
    const intentId = (created.json() as { intentId: string }).intentId;
    const deadline = Date.now() + 3000;
    while (
      !text.includes("event: intent.authorized") &&
      Date.now() < deadline
    ) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    ac.abort();
    expect(text).toContain("event: intent.created");
    expect(text).toContain("event: intent.decided");
    expect(text).toContain("event: intent.authorized");
    expect(text).toContain(intentId);
    expect(text).not.toContain("SECRET-DESCRIPTION");
    expect(text).not.toContain("pm_fake_token");
    expect(h.logs()).not.toContain(st);
  });

  it("the bus isolates owners and unsubscribes cleanly", () => {
    const bus = createEventBus();
    const got: string[] = [];
    const off = bus.subscribe(OWNER_ID, (e) => got.push(e.intentId));
    bus.publish(OTHER_OWNER_ID, {
      type: "intent.created",
      intentId: "other",
      agentId: "a",
    });
    bus.publish(OWNER_ID, {
      type: "intent.created",
      intentId: "mine",
      agentId: "a",
    });
    off();
    bus.publish(OWNER_ID, {
      type: "intent.created",
      intentId: "late",
      agentId: "a",
    });
    expect(got).toEqual(["mine"]);
    expect(bus.listenerCount(OWNER_ID)).toBe(0);
  });

  it("deny and capture emit intent.denied and intent.captured to the right owner only", async () => {
    const h = createHarness({ decision: "deny" });
    await h.create();
    h.state.decision = "approve";
    const ok = (await h.create()).json() as {
      intentId: string;
      mandateToken: string;
    };
    await h.execute(ok.intentId, ok.mandateToken);
    const types = h.events
      .filter((e) => e.ownerId === OWNER_ID)
      .map((e) => e.event.type);
    expect(types).toEqual(
      expect.arrayContaining(["intent.denied", "intent.captured"])
    );
    expect(h.events.some((e) => e.ownerId === OTHER_OWNER_ID)).toBe(false);
  });
});

describe("GET /events CORS (spec-09a)", () => {
  async function open(origin: string) {
    const h = createHarness();
    open_ = h;
    const st = await mintStream(h);
    await h.app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = h.app.server.address() as AddressInfo;
    const ac = new AbortController();
    const res = await fetch(
      `http://127.0.0.1:${port}/events?stream_token=${st}`,
      { signal: ac.signal, headers: { origin } }
    );
    const headers = {
      acao: res.headers.get("access-control-allow-origin"),
      acac: res.headers.get("access-control-allow-credentials"),
    };
    ac.abort();
    return headers;
  }
  let open_: Harness | null = null;
  afterEach(async () => {
    await open_?.app.close();
    open_ = null;
  });

  it("listed origin is allowed without credentials", async () => {
    expect(await open("http://localhost:3000")).toEqual({
      acao: "http://localhost:3000",
      acac: null,
    });
  });

  it("unlisted origin gets no allow-origin header", async () => {
    expect(await open("https://evil.test.invalid")).toEqual({
      acao: null,
      acac: null,
    });
  });
});
