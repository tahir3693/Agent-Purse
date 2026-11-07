import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { createMemoryWebhookEventStore } from "./db/memory.js";
import type { AuthorizationStore, WebhookEventStore } from "./db/stores.js";
import { registerEventRoutes, type EventRoutesDeps } from "./events/sse.js";
import { registerIntentRoutes, type IntentRoutesDeps } from "./intents/routes.js";
import { registerOwnerRoutes, type OwnerRoutesDeps } from "./owners/routes.js";
import { registerPaymentsWebhookRoute } from "./payments/routes.js";
import type { PaymentProvider } from "./payments/types.js";
import { registerVaultRoutes, type VaultRoutesDeps } from "./vault/routes.js";

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
  /** When provided, registers the intent routes (agent key; owner approve/deny when ownerSecret+agents are set). */
  intents?: IntentRoutesDeps;
  /** When provided, registers POST /vault/link and GET /vault/methods. */
  vault?: VaultRoutesDeps;
  /** When provided, registers /auth, /agents and /owner routes. */
  owners?: OwnerRoutesDeps;
  /** When provided, registers POST /events/token and GET /events (SSE). */
  events?: EventRoutesDeps;
  /** Test hook: custom logger destination. */
  logStream?: NodeJS.WritableStream;
}

/** Logged URLs never include a query string (stream tokens travel in ?stream_token=). */
export function redactUrl(url: string | undefined): string {
  if (!url) return "";
  const i = url.indexOf("?");
  return i === -1 ? url : url.slice(0, i);
}

export function buildServer(opts: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      ...(opts.logStream ? { stream: opts.logStream } : {}),
      // Defense in depth: bodies and headers are not logged by default.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.body.mandateToken",
          "*.mandateToken",
          "mandateToken",
          "req.body.nonce",
          "*.nonce",
          "nonce",
          "req.body.password",
          "*.password",
          "*.apiKey",
          "*.accessToken",
          "*.streamToken",
        ],
        censor: "[redacted]",
      },
      serializers: {
        req(req: FastifyRequest) {
          return {
            method: req.method,
            url: redactUrl(req.url),
            host: req.headers?.host,
            remoteAddress: req.ip,
          };
        },
      },
    },
  });
  app.get("/", async () => ({ name: "agentpurse-api", status: "ok" as const }));
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
  if (opts.vault) {
    registerVaultRoutes(app, opts.vault);
  }
  if (opts.owners) {
    registerOwnerRoutes(app, opts.owners);
  }
  if (opts.events) {
    registerEventRoutes(app, opts.events);
  }
  return app;
}