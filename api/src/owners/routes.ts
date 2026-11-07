// Owner routes (spec-06b). Owner JWT (Bearer) on everything except register
// and login. Responses are no-store. Passwords, keys and tokens are never logged.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { authenticateOwner } from "../vault/auth.js";
import { createRateLimiter, type RateLimiter } from "./rateLimit.js";
import {
  createAgent,
  getAgentPolicy,
  getIntent,
  listAgents,
  listIntents,
  login,
  OwnerServiceError,
  register,
  setAgentKilled,
  setAgentPolicy,
  stats,
  type OwnerDeps,
} from "./service.js";

export interface OwnerRoutesDeps extends OwnerDeps {
  loginLimiter?: RateLimiter;
  registerLimiter?: RateLimiter;
}

const FIFTEEN_MIN = 15 * 60 * 1000;

export function sendOwnerError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof OwnerServiceError) {
    return reply
      .code(err.status)
      .send({ error: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) });
  }
  return reply.code(500).send({ error: "internal", message: "Internal error" });
}

const tooMany = (reply: FastifyReply) =>
  reply.code(429).header("Retry-After", "900").send({ error: "rate_limited", message: "Too many attempts" });

function emailOf(body: unknown): string {
  const e = (body as { email?: unknown } | null)?.email;
  return typeof e === "string" ? e.trim().toLowerCase().slice(0, 254) : "";
}

export function registerOwnerRoutes(app: FastifyInstance, deps: OwnerRoutesDeps): void {
  const now = deps.now ?? (() => new Date());
  const clock = () => now().getTime();
  const loginLimiter = deps.loginLimiter ?? createRateLimiter({ limit: 5, windowMs: FIFTEEN_MIN, now: clock });
  const ipLimiter = createRateLimiter({ limit: 30, windowMs: FIFTEEN_MIN, now: clock });
  const registerLimiter =
    deps.registerLimiter ?? createRateLimiter({ limit: 10, windowMs: FIFTEEN_MIN, now: clock });

  const owner = (req: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    return authenticateOwner(deps.jwtSecret, req, reply, now);
  };

  app.post("/auth/register", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!registerLimiter.hit(`register|${req.ip}`)) return tooMany(reply);
    try {
      return reply.code(201).send(await register(deps, req.body));
    } catch (err) {
      return sendOwnerError(reply, err);
    }
  });

  app.post("/auth/login", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const ipOk = ipLimiter.hit(`login-ip|${req.ip}`);
    if (!ipOk || !loginLimiter.hit(`login|${req.ip}|${emailOf(req.body)}`)) return tooMany(reply);
    try {
      const r = await login(deps, req.body);
      return reply.code(200).send({
        ownerId: r.ownerId,
        accessToken: r.token,
        tokenType: "Bearer",
        expiresAt: r.expiresAt.toISOString(),
      });
    } catch (err) {
      return sendOwnerError(reply, err);
    }
  });

  app.post("/agents", async (req, reply) => {
    const ownerId = await owner(req, reply);
    if (!ownerId) return reply;
    try {
      return reply.code(201).send(await createAgent(deps, ownerId, req.body));
    } catch (err) {
      return sendOwnerError(reply, err);
    }
  });

  app.get("/agents", async (req, reply) => {
    const ownerId = await owner(req, reply);
    if (!ownerId) return reply;
    try {
      return reply.code(200).send({ agents: await listAgents(deps, ownerId) });
    } catch (err) {
      return sendOwnerError(reply, err);
    }
  });

  for (const [action, killed] of [["kill", true], ["restore", false]] as const) {
    app.post<{ Params: { id: string } }>(`/agents/:id/${action}`, async (req, reply) => {
      const ownerId = await owner(req, reply);
      if (!ownerId) return reply;
      try {
        return reply.code(200).send(await setAgentKilled(deps, ownerId, req.params.id, killed));
      } catch (err) {
        return sendOwnerError(reply, err);
      }
    });
  }

  app.get<{ Params: { id: string } }>("/agents/:id/policy", async (req, reply) => {
    const ownerId = await owner(req, reply);
    if (!ownerId) return reply;
    try {
      return reply.code(200).send(await getAgentPolicy(deps, ownerId, req.params.id));
    } catch (err) {
      return sendOwnerError(reply, err);
    }
  });

  app.put<{ Params: { id: string } }>("/agents/:id/policy", async (req, reply) => {
    const ownerId = await owner(req, reply);
    if (!ownerId) return reply;
    try {
      return reply.code(200).send(await setAgentPolicy(deps, ownerId, req.params.id, req.body));
    } catch (err) {
      return sendOwnerError(reply, err);
    }
  });

  app.get("/owner/intents", async (req, reply) => {
    const ownerId = await owner(req, reply);
    if (!ownerId) return reply;
    try {
      return reply.code(200).send({ intents: await listIntents(deps, ownerId, req.query) });
    } catch (err) {
      return sendOwnerError(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>("/owner/intents/:id", async (req, reply) => {
    const ownerId = await owner(req, reply);
    if (!ownerId) return reply;
    try {
      return reply.code(200).send(await getIntent(deps, ownerId, req.params.id));
    } catch (err) {
      return sendOwnerError(reply, err);
    }
  });

  app.get("/owner/stats", async (req, reply) => {
    const ownerId = await owner(req, reply);
    if (!ownerId) return reply;
    try {
      return reply.code(200).send(await stats(deps, ownerId));
    } catch (err) {
      return sendOwnerError(reply, err);
    }
  });
}