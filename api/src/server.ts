import Fastify, { type FastifyInstance } from "fastify";

import { createSeenKeyStore, type SeenKeyStore } from "./payments/dedupe.js";
import { registerPaymentsWebhookRoute } from "./payments/routes.js";
import type { PaymentProvider } from "./payments/types.js";

export interface HealthResponse {
  status: "ok";
}

export interface BuildServerOptions {
  /** When provided, registers POST /webhooks/payments. */
  paymentProvider?: PaymentProvider;
  /** Optional dedupe store override (defaults to in-memory). */
  webhookStore?: SeenKeyStore;
}

export function buildServer(opts: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });
  app.get("/healthz", async (): Promise<HealthResponse> => {
    return { status: "ok" };
  });
  if (opts.paymentProvider) {
    registerPaymentsWebhookRoute(app, {
      provider: opts.paymentProvider,
      store: opts.webhookStore ?? createSeenKeyStore(),
    });
  }
  return app;
}
