// POST /assistant (spec-09b): owner JWT, strict body, per-owner rate limit,
// NDJSON stream. The LLM key lives only in the model on the server.
import type { FastifyInstance } from "fastify";

import { createRateLimiter, type RateLimiter } from "../owners/rateLimit.js";
import { authenticateOwner } from "../vault/auth.js";
import { AssistantRequestSchema, type AssistantEvent } from "./schema.js";
import { runAssistant, type AssistantDeps } from "./service.js";

export interface AssistantRoutesDeps extends Omit<AssistantDeps, "model"> {
  /** null when the selected AI provider cannot back the assistant: the route replies with a friendly message. */
  model: AssistantDeps["model"] | null;
  /** Shown to the owner when model is null. */
  unavailableMessage?: string;
  jwtSecret: string;
  limiter?: RateLimiter;
  now?: () => Date;
}

export const ASSISTANT_UNAVAILABLE_MESSAGE =
  "The AI assistant is not available right now because the configured AI provider does not support it. " +
  "Purchase approvals and the rest of the dashboard are unaffected.";

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
      // Friendly in-band reply (not an HTTP error) so the chat UI shows it as is.
      const text = deps.unavailableMessage ?? ASSISTANT_UNAVAILABLE_MESSAGE;
      const events: AssistantEvent[] = [{ type: "text", delta: text }, { type: "done" }];
      return reply
        .code(200)
        .header("Content-Type", "application/x-ndjson; charset=utf-8")
        .send(events.map((e) => JSON.stringify(e)).join("\n") + "\n");
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
