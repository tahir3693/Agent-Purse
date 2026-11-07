// Vault routes (spec-06): POST /vault/link and GET /vault/methods.
// Thin handlers; bodies, nonces and tokens are never logged or echoed.
// POST /vault/link returns 201 for a new link and 200 when the same
// (ownerId, token) was already linked (the existing method is returned).

import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticateOwner } from "./auth.js";
import {
  linkMethod,
  listMethods,
  VaultServiceError,
  VaultValidationError,
  type VaultDeps,
} from "./service.js";

export interface VaultRoutesDeps extends VaultDeps {
  ownerSecret: string;
  now?: () => Date;
}

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof VaultValidationError) {
    return reply.code(400).send({ error: "invalid_body", fields: err.fields });
  }
  if (err instanceof VaultServiceError) {
    return reply.code(err.status).send({ error: err.code, message: err.message });
  }
  return reply.code(500).send({ error: "internal", message: "Internal error" });
}

export function registerVaultRoutes(app: FastifyInstance, deps: VaultRoutesDeps): void {
  const now = deps.now ?? (() => new Date());

  app.post("/vault/link", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const ownerId = await authenticateOwner(deps.ownerSecret, req, reply, now);
    if (!ownerId) return reply;
    try {
      const result = await linkMethod(deps, ownerId, req.body);
      return reply.code(result.existing ? 200 : 201).send({ method: result.method });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/vault/methods", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const ownerId = await authenticateOwner(deps.ownerSecret, req, reply, now);
    if (!ownerId) return reply;
    try {
      return reply.code(200).send({ methods: await listMethods(deps, ownerId) });
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
