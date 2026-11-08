// POST /assistant (spec-09b): owner JWT, strict body, per-owner rate limit,
// NDJSON stream. The LLM key lives only in the model on the server.
import type { FastifyInstance } from "fastify";

import { createRateLimiter, type RateLimiter } from "../owners/rateLimit.js";
import { authenticateOwner } from "../vault/auth.js";
import { AssistantRequestSchema, type AssistantEvent } from "./schema.js";
import { runAssistant, type AssistantDeps } from "./service.js";

export interface AssistantRoutesDeps extends Omit<AssistantDeps, "model"> {
  /** null when ANTHROPIC_API_KEY is not configured: the route answers 503. */
  model: AssistantDeps["model"] | null;
  jwtSecret: string;
  limiter?: RateLimiter;
  now?: () => Date;
}

export const ASSISTANT_RATE = { limit: 10, windowMs: 60_000 };

export function registerAssistantRoutes(
  app: FastifyInstance,
  deps: AssistantRoutesDeps
): void {
  const now = deps.now ?? (() => new Date());
  const limiter =
    deps.limiter ??
    createRateLimiter({ ...ASSISTANT_RATE, now: () => now().getTime() });

  app.post("/assistant", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const ownerId = await authenticateOwner(deps.jwtSecret, req, reply, now);
    if (!ownerId) return reply;
    if (!deps.model) {
      return reply
        .code(503)
        .send({
          error: "assistant_unavailable",
          message: "Missing required environment variable: ANTHROPIC_API_KEY",
        });
    }
    const parsed = AssistantRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const fields = [
        ...new Set(parsed.error.issues.map((i) => i.path.join(".") || "body")),
      ];
      return reply.code(400).send({ error: "invalid_body", fields });
    }
    if (!limiter.hit(`assistant|${ownerId}`)) {
      return reply
        .code(429)
        .header("Retry-After", "60")
        .send({
          error: "rate_limited",
          message: "Too many assistant requests",
        });
    }

    const model = deps.model;
    const ac = new AbortController();
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    req.raw.on("close", () => {
      if (!res.writableEnded) ac.abort();
    });
    const emit = (e: AssistantEvent) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(e)}\n`);
    };
    await runAssistant(
      { ...deps, model },
      ownerId,
      parsed.data.messages,
      emit,
      ac.signal
    );
    emit({ type: "done" });
    res.end();
  });
}
