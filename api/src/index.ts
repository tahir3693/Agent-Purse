import { AnthropicAssistantModel } from "./assistant/model.js";
import { readOnlyView } from "./assistant/service.js";
import { buildChannel3Client, createChannel3Module } from "./channel3/index.js";
import { loadConfig } from "./config.js";
import {
  createPrismaAgentAdminStore,
  createPrismaAgentPolicyStore,
  createPrismaOwnerStore,
  createPrismaAuditStore,
  createPrismaAuthorizationStore,
  createPrismaClient,
  createPrismaIntentStore,
  createPrismaMandateStore,
  createPrismaVaultStore,
  createPrismaWebhookEventStore,
} from "./db/prisma.js";
import { createEventBus } from "./events/bus.js";
import { createPaymentProvider } from "./payments/factory.js";
import { loadAiConfig } from "./risk/config.js";
import { createRiskReviewer } from "./risk/provider.js";
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
  const jwtSecret = requireEnv("JWT_SECRET");
  if (jwtSecret.length < MIN_MANDATE_KEY_LENGTH) {
    fail(`Invalid environment variable: JWT_SECRET (must be at least ${MIN_MANDATE_KEY_LENGTH} characters)`);
  }
  // The selected provider's key (ANTHROPIC_API_KEY or GEMINI_API_KEY) is validated by loadAiConfig.
  requireEnv("CHANNEL3_API_KEY");

  const appLog: { current?: { warn(obj: object, msg: string): void } } = {};
  let wiring;
  try {
    const paymentProvider = createPaymentProvider(env);
    const ai = loadAiConfig(env);
    const channel3 = createChannel3Module({ client: buildChannel3Client(env) });
    const db = createPrismaClient();

    const riskConfig: RiskGuardConfig = {
      autoApproveBelowCents: AUTO_APPROVE_BELOW_CENTS,
      maxAutoApproveRisk: MAX_AUTO_APPROVE_RISK,
      aiTimeoutMs: AI_TIMEOUT_MS,
    };
    const reviewer = createRiskReviewer(ai, {
      timeoutMs: AI_TIMEOUT_MS,
      // The app logger exists only after buildServer; fall back to console before that.
      logger: {
        warn: (obj, msg) =>
          appLog.current
            ? appLog.current.warn(obj, msg)
            : console.warn(JSON.stringify({ msg, ...obj })),
      },
    });

    const authorizations = createPrismaAuthorizationStore(db);
    const audit = createPrismaAuditStore(db);
    const vaultStore = createPrismaVaultStore(db);
    const agents = createPrismaAgentAdminStore(db);
    const policies = createPrismaAgentPolicyStore(db);
    const intentStore = createPrismaIntentStore(db);
    const bus = createEventBus();
    // Only origins listed in WEB_ORIGIN (comma-separated) may open the SSE stream.
    const webOrigins = (env["WEB_ORIGIN"] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean);
    wiring = {
      paymentProvider,
      vault: {
        vault: vaultStore,
        audit,
        provider: paymentProvider,
        ownerSecret: jwtSecret,
      },
      webhookEventStore: createPrismaWebhookEventStore(db),
      authorizationStore: authorizations,
      intents: {
        intents: intentStore,
        authorizations,
        mandates: createPrismaMandateStore(db),
        audit,
        policies,
        vault: vaultStore,
        agents,
        events: bus,
        ownerSecret: jwtSecret,
        provider: paymentProvider,
        evaluateRisk: (input: Parameters<typeof evaluateRisk>[1]) =>
          evaluateRisk(
            { priceCheck: channel3.priceCheck, reviewer, config: riskConfig },
            input,
          ),
        mandateKey,
      },
      owners: {
        owners: createPrismaOwnerStore(db),
        agents,
        policies,
        intents: intentStore,
        audit,
        jwtSecret,
      },
      events: { bus, jwtSecret, allowedOrigins: webOrigins },
      // Read-only AI assistant: only lookup store methods are passed in.
      assistant: {
        reads: readOnlyView({ agents, policies, intents: intentStore, audit }),
        // Only the Anthropic provider backs the assistant; others get a friendly in-chat message.
        model: ai.provider === "anthropic" ? new AnthropicAssistantModel(ai) : null,
        jwtSecret,
      },
    };
  } catch (err) {
    // Config errors name the variable only, never a value.
    const message = err instanceof Error ? err.message : "Invalid configuration";
    return fail(message);
  }

  const app = buildServer(wiring);
  appLog.current = app.log;
  const { host, port } = loadConfig();
  try {
    await app.listen({ host, port });
  } catch (err) {
    app.log.error(err, `failed to bind on ${host}:${port}`);
    process.exit(1);
  }
}

void main();
