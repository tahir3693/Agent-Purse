import { buildChannel3Client, createChannel3Module } from "./channel3/index.js";
import { loadConfig } from "./config.js";
import {
  createPrismaAgentPolicyStore,
  createPrismaAuditStore,
  createPrismaAuthorizationStore,
  createPrismaClient,
  createPrismaIntentStore,
  createPrismaMandateStore,
  createPrismaWebhookEventStore,
} from "./db/prisma.js";
import { createPaymentProvider } from "./payments/factory.js";
import { AnthropicRiskReviewer } from "./risk/anthropic.js";
import { loadAnthropicConfig } from "./risk/config.js";
import { evaluateRisk, type RiskGuardConfig } from "./risk/index.js";
import { buildServer } from "./server.js";

// Risk Guard defaults (owner-tunable policy storage is a later slice).
const AUTO_APPROVE_BELOW_CENTS = 5000;
const MAX_AUTO_APPROVE_RISK = 40;
const AI_TIMEOUT_MS = 15_000;
const MIN_MANDATE_KEY_LENGTH = 32;

function fail(message: string): never {
  // Messages name variables only, never values.
  console.error(message);
  process.exit(1);
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) fail(`Missing required environment variable: ${name}`);
  return v;
}

async function main(): Promise<void> {
  const env = process.env;

  requireEnv("DATABASE_URL");
  const mandateKey = requireEnv("MANDATE_SIGNING_KEY");
  if (mandateKey.length < MIN_MANDATE_KEY_LENGTH) {
    fail(`Invalid environment variable: MANDATE_SIGNING_KEY (must be at least ${MIN_MANDATE_KEY_LENGTH} characters)`);
  }
  requireEnv("ANTHROPIC_API_KEY");
  requireEnv("CHANNEL3_API_KEY");

  let wiring;
  try {
    const paymentProvider = createPaymentProvider(env);
    const anthropic = loadAnthropicConfig(env);
    const channel3 = createChannel3Module({ client: buildChannel3Client(env) });
    const db = createPrismaClient();

    const riskConfig: RiskGuardConfig = {
      autoApproveBelowCents: AUTO_APPROVE_BELOW_CENTS,
      maxAutoApproveRisk: MAX_AUTO_APPROVE_RISK,
      aiTimeoutMs: AI_TIMEOUT_MS,
    };
    const reviewer = new AnthropicRiskReviewer({ config: anthropic, timeoutMs: AI_TIMEOUT_MS });

    const authorizations = createPrismaAuthorizationStore(db);
    wiring = {
      paymentProvider,
      webhookEventStore: createPrismaWebhookEventStore(db),
      authorizationStore: authorizations,
      intents: {
        intents: createPrismaIntentStore(db),
        authorizations,
        mandates: createPrismaMandateStore(db),
        audit: createPrismaAuditStore(db),
        policies: createPrismaAgentPolicyStore(db),
        provider: paymentProvider,
        evaluateRisk: (input: Parameters<typeof evaluateRisk>[1]) =>
          evaluateRisk(
            { priceCheck: channel3.priceCheck, reviewer, config: riskConfig },
            input,
          ),
        mandateKey,
      },
    };
  } catch (err) {
    // Config errors name the variable only, never a value.
    const message = err instanceof Error ? err.message : "Invalid configuration";
    return fail(message);
  }

  const app = buildServer(wiring);
  const { host, port } = loadConfig();
  try {
    await app.listen({ host, port });
  } catch (err) {
    app.log.error(err, `failed to bind on ${host}:${port}`);
    process.exit(1);
  }
}

void main();
