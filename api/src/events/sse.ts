// Live feed (spec-06b). POST /events/token (owner Bearer JWT) mints a 60s
// stream token (scp "sse"); GET /events?stream_token= streams that owner's
// events. EventSource cannot send headers, hence the query token. The token is
// checked once at connect; the open stream is not cut at expiry.
// Request logs drop the query string for /events (see server.ts serializer).

import type { FastifyInstance } from "fastify";

import { signStreamToken, STREAM_SCOPE } from "../owners/tokens.js";
import { authenticateOwner, verifyOwnerToken } from "../vault/auth.js";
import type { EventBus } from "./bus.js";

export interface EventRoutesDeps {
  bus: EventBus;
  jwtSecret: string;
  /** Allowed browser origin for the direct SSE connection (WEB_ORIGIN). */
  allowedOrigins?: string[];
  heartbeatMs?: number;
  now?: () => Date;
}

export function registerEventRoutes(app: FastifyInstance, deps: EventRoutesDeps): void {
  const now = deps.now ?? (() => new Date());
  const heartbeatMs = deps.heartbeatMs ?? 25_000;

  app.post("/events/token", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const ownerId = await authenticateOwner(deps.jwtSecret, req, reply, now);
    if (!ownerId) return reply;
    const t = signStreamToken(ownerId, deps.jwtSecret, now());
    return reply.code(201).send({ streamToken: t.token, expiresAt: t.expiresAt.toISOString() });
  });

  app.get<{ Querystring: { stream_token?: string } }>("/events", async (req, reply) => {
    const token = typeof req.query.stream_token === "string" ? req.query.stream_token : "";
    const result = token
      ? verifyOwnerToken(token, deps.jwtSecret, Math.floor(now().getTime() / 1000), { scope: STREAM_SCOPE })
      : null;
    if (!result?.ok) {
      return reply.code(401).header("Cache-Control", "no-store").send({ error: "unauthorized" });
    }
    const ownerId = result.claims.sub;

    const origin = req.headers.origin;
    const headers: Record<string, string> = {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    };
    if (typeof origin === "string" && deps.allowedOrigins?.includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Vary"] = "Origin";
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, headers);
    res.write(": connected\n\n");

    const unsubscribe = deps.bus.subscribe(ownerId, (e) => {
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    });
    const beat = setInterval(() => res.write(": ping\n\n"), heartbeatMs);
    beat.unref?.();
    const close = () => {
      clearInterval(beat);
      unsubscribe();
    };
    req.raw.on("close", close);
    res.on("close", close);
  });
}