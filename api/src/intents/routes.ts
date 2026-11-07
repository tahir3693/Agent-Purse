// Intent routes (spec-08): POST /intents and POST /intents/:id/execute.
// Thin handlers; logic lives in service.ts. Bodies, tokens and keys are never
// logged. Responses containing a token are sent with Cache-Control: no-store.

import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticateAgent } from "./auth.js";
import { ExecuteIntentBodySchema } from "./schema.js";
import {
  createIntent,
  executeIntent,
  IntentServiceError,
  ValidationError,
  type IntentDeps,
} from "./service.js";

export type IntentRoutesDeps = IntentDeps;

const GENERIC_MESSAGES: Record<number, string> = {
  400: "Invalid request",
  401: "Invalid mandate token",
  404: "Not found",
  409: "Intent cannot be executed",
  502: "Upstream error",
};

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
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
      const result = await createIntent(deps, agent.id, req.body);
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
      return sendError(reply, err);
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
      const result = await executeIntent(deps, agent.id, req.params.id, parsed.data.mandateToken);
      return reply.code(200).send(result);
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
