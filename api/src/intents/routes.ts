// Intent routes (spec-08, spec-06b). Agent key: POST /intents, GET /intents/:id,
// POST /intents/:id/mandate, POST /intents/:id/execute. Owner JWT:
// POST /intents/:id/approve and /deny. Thin handlers; logic lives in service.ts.
// Bodies, tokens and keys are never logged. Token responses are no-store.

import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticateOwner } from "../vault/auth.js";
import { authenticateAgent } from "./auth.js";
import { ExecuteIntentBodySchema } from "./schema.js";
import {
  approveIntent,
  createIntent,
  denyIntent,
  executeIntent,
  getIntentForAgent,
  IntentServiceError,
  issueMandateForIntent,
  ValidationError,
  type IntentDeps,
} from "./service.js";

export interface IntentRoutesDeps extends IntentDeps {
  /** JWT_SECRET; when set together with `agents`, owner approve/deny routes are registered. */
  ownerSecret?: string;
}

const GENERIC_MESSAGES: Record<number, string> = {
  400: "Invalid request",
  401: "Invalid mandate token",
  404: "Not found",
  409: "Intent cannot be executed",
  422: "Invalid payment method",
  502: "Upstream error",
};

export function sendIntentError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ValidationError) {
    return reply.code(400).send({ error: "invalid_body", fields: err.fields });
  }
  if (err instanceof IntentServiceError) {
    const message = GENERIC_MESSAGES[err.status] ?? "Request failed";
    return reply.code(err.status).send({ error: err.code, message });
  }
  return reply.code(500).send({ error: "internal", message: "Internal error" });
}

export function registerIntentRoutes(app: FastifyInstance, deps: IntentRoutesDeps): void {
  app.post("/intents", async (req, reply) => {
    const agent = await authenticateAgent(deps.policies, req, reply);
    if (!agent) return reply;
    try {
      const result = await createIntent(deps, agent, req.body);
      if (result.mandateToken) reply.header("Cache-Control", "no-store");
      return reply.code(result.mandateToken ? 201 : 200).send({
        intentId: result.intentId,
        state: result.state,
        decision: result.decision,
        riskScore: result.riskScore,
        reason: result.reason,
        ...(result.mandateToken
          ? {
              mandateToken: result.mandateToken,
              expiresAt: result.expiresAt?.toISOString(),
            }
          : {}),
      });
    } catch (err) {
      return sendIntentError(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>("/intents/:id", async (req, reply) => {
    const agent = await authenticateAgent(deps.policies, req, reply);
    if (!agent) return reply;
    try {
      return reply.code(200).send(await getIntentForAgent(deps, agent, req.params.id));
    } catch (err) {
      return sendIntentError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/intents/:id/mandate", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const agent = await authenticateAgent(deps.policies, req, reply);
    if (!agent) return reply;
    try {
      const r = await issueMandateForIntent(deps, agent, req.params.id);
      return reply.code(201).send({
        intentId: r.intentId,
        mandateToken: r.mandateToken,
        expiresAt: r.expiresAt.toISOString(),
      });
    } catch (err) {
      return sendIntentError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/intents/:id/execute", async (req, reply) => {
    const agent = await authenticateAgent(deps.policies, req, reply);
    if (!agent) return reply;

    const parsed = ExecuteIntentBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "body"))];
      return reply.code(400).send({ error: "invalid_body", fields });
    }
    try {
      const result = await executeIntent(deps, agent, req.params.id, parsed.data.mandateToken);
      return reply.code(200).send(result);
    } catch (err) {
      return sendIntentError(reply, err);
    }
  });

  const ownerSecret = deps.ownerSecret;
  if (!ownerSecret || !deps.agents) return;
  const now = deps.now ?? (() => new Date());

  for (const action of ["approve", "deny"] as const) {
    app.post<{ Params: { id: string } }>(`/intents/:id/${action}`, async (req, reply) => {
      const ownerId = await authenticateOwner(ownerSecret, req, reply, now);
      if (!ownerId) return reply;
      try {
        const fn = action === "approve" ? approveIntent : denyIntent;
        return reply.code(200).send(await fn(deps, ownerId, req.params.id));
      } catch (err) {
        if (err instanceof IntentServiceError && err.status === 409) {
          return reply.code(409).send({ error: "conflict", message: "Intent is not awaiting approval" });
        }
        return sendIntentError(reply, err);
      }
    });
  }
}