// Payments webhook route: POST /webhooks/payments.
//
// Braintree posts application/x-www-form-urlencoded with bt_signature and
// bt_payload. The route lives in an encapsulated plugin so its form parser
// does not affect other routes. Behaviour (Requirements 4.1-4.4):
//   - parseWebhook error (bad/missing signature or payload) -> 400 (fail closed)
//   - duplicate key -> 200 { status: "duplicate" }
//   - new key       -> claim (atomic), 200 { status: "ok" }
// Nothing from the request body is logged.

import type { FastifyInstance } from "fastify";

import type { AuthorizationStore, WebhookEventStore } from "../db/stores.js";
import type { PaymentProvider } from "./types.js";

export interface PaymentsWebhookRouteDeps {
  provider: PaymentProvider;
  store: WebhookEventStore;
  /** Optional: when provided, verified events update authorization status. */
  authorizations?: Pick<AuthorizationStore, "updateStatusByProviderTxnId">;
}

export function registerPaymentsWebhookRoute(
  app: FastifyInstance,
  deps: PaymentsWebhookRouteDeps,
): void {
  app.register(async (instance) => {
    instance.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_req, body, done) => {
        try {
          const params = new URLSearchParams(body as string);
          const fields: Record<string, string> = {};
          for (const [k, v] of params) fields[k] = v;
          done(null, fields);
        } catch {
          done(null, {});
        }
      },
    );

    instance.post("/webhooks/payments", async (req, reply) => {
      const body = req.body;
      const fields: Record<string, string | undefined> =
        body && typeof body === "object"
          ? {
              bt_signature: (body as Record<string, string>).bt_signature,
              bt_payload: (body as Record<string, string>).bt_payload,
            }
          : {};

      let event;
      try {
        event = await deps.provider.parseWebhook(fields);
      } catch {
        // Fail closed; no detail echoed.
        return reply.code(400).send({ error: "invalid_webhook" });
      }

      // Claim only after the signature verified (never claim on parse failure).
      const claimed = await deps.store.claim(event.key);
      if (!claimed) {
        return reply.code(200).send({ status: "duplicate" });
      }
      if (deps.authorizations && event.transactionId && event.status) {
        await deps.authorizations.updateStatusByProviderTxnId(
          event.transactionId,
          event.status,
        );
      }
      return reply.code(200).send({ status: "ok" });
    });
  });
}
