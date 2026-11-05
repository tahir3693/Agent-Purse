// Unit tests for registerPayPalWebhookRoute via Fastify inject() (no network).
//
// A stub verify() and an in-memory store drive the route. Assertions cover the
// fail-closed/dedupe matrix (Requirements 7.1-7.5) and confirm the raw-body
// parser is active: the handler must see the body as a string, and verify() is
// called with the exact raw JSON string that was POSTed.

import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { createSeenEventStore } from "../dedupe.js";
import { registerPayPalWebhookRoute } from "../routes.js";

function buildApp(verify: (h: Record<string, string | undefined>, b: string) => Promise<boolean>) {
  const app = Fastify();
  const store = createSeenEventStore();
  registerPayPalWebhookRoute(app, { verify, store });
  return app;
}

function post(app: ReturnType<typeof Fastify>, body: string) {
  return app.inject({
    method: "POST",
    url: "/webhooks/paypal",
    headers: { "content-type": "application/json" },
    payload: body,
  });
}

describe("POST /webhooks/paypal", () => {
  it("returns 400 when the signature is unverified", async () => {
    const verify = vi.fn().mockResolvedValue(false);
    const app = buildApp(verify);
    await app.ready();

    const res = await post(app, JSON.stringify({ id: "EVT-1" }));

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 200 for a verified new event", async () => {
    const verify = vi.fn().mockResolvedValue(true);
    const app = buildApp(verify);
    await app.ready();

    const res = await post(app, JSON.stringify({ id: "EVT-1" }));

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("dedupes a repeated event id: 200 again, reported as duplicate, not re-processed", async () => {
    const verify = vi.fn().mockResolvedValue(true);
    const app = buildApp(verify);
    await app.ready();

    const body = JSON.stringify({ id: "EVT-DUP" });
    const first = await post(app, body);
    const second = await post(app, body);

    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body)).toEqual({ status: "ok" });
    expect(second.statusCode).toBe(200);
    // The repeat is acknowledged as a duplicate, so it is NOT re-processed.
    expect(JSON.parse(second.body)).toEqual({ status: "duplicate" });
    // The route (correctly) verifies the signature on every delivery - a
    // replayed id is only trusted for dedupe after its signature checks out -
    // so verify runs on both deliveries while processing happens only once.
    expect(verify).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it("returns 400 for a malformed body", async () => {
    const verify = vi.fn().mockResolvedValue(true);
    const app = buildApp(verify);
    await app.ready();

    const res = await post(app, "not json {");

    expect(res.statusCode).toBe(400);
    // Fail closed: verification never runs on an unparseable body.
    expect(verify).not.toHaveBeenCalled();
    await app.close();
  });

  it("passes the raw JSON string to verify (raw-body parser active)", async () => {
    const seen: string[] = [];
    const verify = vi.fn(async (_h: Record<string, string | undefined>, raw: string) => {
      seen.push(raw);
      return true;
    });
    const app = buildApp(verify);
    await app.ready();

    const body = JSON.stringify({ id: "EVT-RAW", extra: "keep-bytes" });
    await post(app, body);

    // The handler received a string (not a parsed object) and verify saw the
    // exact bytes that were POSTed - essential for signature verification.
    expect(typeof seen[0]).toBe("string");
    expect(seen[0]).toBe(body);
    await app.close();
  });
});
