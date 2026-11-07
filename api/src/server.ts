import Fastify, { type FastifyInstance } from "fastify";

import { createMemoryWebhookEventStore } from "./db/memory.js";
import type { AuthorizationStore, WebhookEventStore } from "./db/stores.js";
import { registerIntentRoutes, type IntentRoutesDeps } from "./intents/routes.js";
import { registerPaymentsWebhookRoute } from "./payments/routes.js";
import type { PaymentProvider } from "./payments/types.js";

export interface HealthResponse {
  status: "ok";
}

export interface BuildServerOptions {
  /** When provided, registers POST /webhooks/payments. */
  paymentProvider?: PaymentProvider;
  /** Optional webhook dedupe store (defaults to in-memory). */
  webhookEventStore?: WebhookEventStore;
  /** Optional: lets verified webhooks update authorization status. */
  authorizationStore?: Pick<AuthorizationStore, "updateStatusByProviderTxnId">;
  /** When provided, registers POST /intents and POST /intents/:id/execute. */
  intents?: IntentRoutesDeps;
}

export function buildServer(opts: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      // Defense in depth: bodies and headers are not logged by default.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.body.mandateToken",
          "*.mandateToken",
          "mandateToken",
        ],
        censor: "[redacted]",
      },
    },
  });
  app.get("/healthz", async (): Promise<HealthResponse> => {
    return { status: "ok" };
  });
  if (opts.paymentProvider) {
    registerPaymentsWebhookRoute(app, {
      provider: opts.paymentProvider,
      store: opts.webhookEventStore ?? createMemoryWebhookEventStore(),
      authorizations: opts.authorizationStore,
    });
  }
  if (opts.intents) {
    registerIntentRoutes(app, opts.intents);
  }
  return app;
}
