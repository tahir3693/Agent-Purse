// PayPal webhook route: POST /webhooks/paypal.
//
// PayPal signs the RAW request bytes, so this route must verify against the
// exact body string - not a Fastify-parsed object. We register the route
// inside an ENCAPSULATED child plugin (app.register(async (instance) => ...))
// and add an `application/json` content-type parser with { parseAs: "string" }
// on that child instance only. Fastify content-type parsers are per
// encapsulated context, so the rest of the app keeps its default JSON parsing
// and only this route sees the raw string (design.md "Webhook flow";
// TODO(verify) resolved: encapsulation confirmed below).
//
// Behaviour (Requirements 7.1-7.5):
//   - Parse the event id from the raw body (JSON.parse(rawBody).id).
//   - Verify the signature via deps.verify(headers, rawBody).
//   - Not verified         -> 400 (fail closed).
//   - Verified + duplicate  -> 200 immediately (dedupe by event id).
//   - Verified + new        -> markSeen, (processing hook in spec-08), 200.
//   - Unparseable body      -> 400.
// The handler responds quickly and does no heavy work.

import type { FastifyInstance } from "fastify";

import type { SeenEventStore } from "./dedupe.js";

export interface PayPalWebhookRouteDeps {
  /** Verifies the signature against the raw body; must fail closed. */
  verify: (
    headers: Record<string, string | undefined>,
    rawBody: string,
  ) => Promise<boolean>;
  /** In-memory (spec-03) or DB-backed (spec-08) seen-event store. */
  store: SeenEventStore;
}

/** Shape of the webhook envelope fields we read. */
interface WebhookEnvelope {
  id?: unknown;
}

/**
 * Register POST /webhooks/paypal on `app`.
 *
 * The route lives inside an encapsulated child plugin so its raw-string body
 * parser does not affect any other route on `app`.
 */
export function registerPayPalWebhookRoute(
  app: FastifyInstance,
  deps: PayPalWebhookRouteDeps,
): void {
  app.register(async (instance) => {
    // Scoped to THIS encapsulated instance only: keep the raw JSON string so we
    // can verify the exact signed bytes. The parent app's default JSON parser
    // is unaffected.
    instance.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (_req, body, done) => {
        done(null, body);
      },
    );

    instance.post("/webhooks/paypal", async (req, reply) => {
      const rawBody = typeof req.body === "string" ? req.body : "";

      let eventId: string;
      try {
        const parsed = JSON.parse(rawBody) as WebhookEnvelope;
        if (typeof parsed.id !== "string" || parsed.id === "") {
          return reply.code(400).send({ error: "invalid_webhook" });
        }
        eventId = parsed.id;
      } catch {
        return reply.code(400).send({ error: "invalid_webhook" });
      }

      const headers = req.headers as Record<string, string | undefined>;
      const verified = await deps.verify(headers, rawBody);
      if (!verified) {
        // Fail closed: unverified signature.
        return reply.code(400).send({ error: "unverified" });
      }

      if (deps.store.seen(eventId)) {
        // Duplicate delivery: acknowledge without re-processing.
        return reply.code(200).send({ status: "duplicate" });
      }

      deps.store.markSeen(eventId);
      // TODO(spec-08): hand the verified event to the processing pipeline
      // (persist WebhookEvent, update order/authorization status, audit log).
      return reply.code(200).send({ status: "ok" });
    });
  });
}
