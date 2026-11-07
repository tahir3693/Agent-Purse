// Test harness for spec-08: in-memory stores, scripted fake provider, fake risk.
// No live calls. All keys are obviously fake.

import {
  createMemoryAgentRegistry,
  createMemoryAuditStore,
  createMemoryAuthorizationStore,
  createMemoryIntentStore,
  createMemoryMandateStore,
  createMemoryOwnerStore,
  createMemoryVaultStore,
  createMemoryWebhookEventStore,
} from "../../db/memory.js";
import { createEventBus, type OwnerEvent } from "../../events/bus.js";
import { Writable } from "node:stream";
import { signOwnerToken } from "../../owners/tokens.js";
import { buildServer } from "../../server.js";
import type {
  AuthorizeInput,
  PaymentProvider,
  PaymentStatus,
  WebhookEvent,
} from "../../payments/types.js";
import type { RiskDecision, RiskInput } from "../../risk/index.js";
import { hashApiKey } from "../auth.js";
import type { IntentRoutesDeps } from "../routes.js";

export const TEST_MANDATE_KEY = "test-only-mandate-signing-key-0123456789abcdef";
export const AGENT_KEY = "test-only-agent-api-key-aaaaaaaaaaaaaaaaaaaa";
export const OTHER_AGENT_KEY = "test-only-agent-api-key-bbbbbbbbbbbbbbbbbbbb";
export const KILLED_AGENT_KEY = "test-only-agent-api-key-cccccccccccccccccccc";
export const OWNERLESS_AGENT_KEY = "test-only-agent-api-key-dddddddddddddddddddd";
export const OWNER_ID = "owner-1";
export const OTHER_OWNER_ID = "owner-2";
export const TEST_OWNER_SECRET = "test-only-owner-jwt-secret-0123456789abcdef";
/** Vault method ids; the provider tokens behind them never appear in requests. */
export const VAULT_METHOD_ID = "vm-test-1";
export const OTHER_OWNER_METHOD_ID = "vm-test-2";
export const RAW_PROVIDER_TOKEN = "pm_fake_token";

export const VALID_POLICY = {
  dailyBudgetCents: 100_000,
  perPurchaseCapCents: 50_000,
  allowedCategories: ["office"],
  blockedPayees: [],
  velocityPerHour: 10,
  velocityPerDay: 50,
};

export const INTENT_TEXT = {
  description: "SECRET-DESCRIPTION-xyz standing desk",
  justification: "SECRET-JUSTIFICATION-xyz needed for the office",
};

export const validBody = {
  amountCents: 1234,
  currency: "USD",
  payee: "shop.example.com",
  category: "office",
  description: INTENT_TEXT.description,
  justification: INTENT_TEXT.justification,
  paymentMethodRef: VAULT_METHOD_ID,
};

export interface ProviderScript {
  authorizeFails?: boolean;
  captureFails?: boolean;
  voidFails?: boolean;
  parseWebhook?: (f: Record<string, string | undefined>) => Promise<WebhookEvent>;
}

export interface FakeProvider extends PaymentProvider {
  authorizeCalls: AuthorizeInput[];
  captureCalls: { authorizationId: string; amountCents: number }[];
  voidCalls: string[];
  script: ProviderScript;
}

export function createFakeProvider(script: ProviderScript = {}): FakeProvider {
  let n = 0;
  const p: FakeProvider = {
    authorizeCalls: [],
    captureCalls: [],
    voidCalls: [],
    script,
    async authorize(input) {
      p.authorizeCalls.push(input);
      if (p.script.authorizeFails) throw new Error("provider authorize boom");
      n++;
      return { authorizationId: `txn_fake_${n}`, status: "authorized" };
    },
    async capture(authorizationId, amountCents) {
      p.captureCalls.push({ authorizationId, amountCents });
      if (p.script.captureFails) throw new Error("provider capture boom");
      return { captureId: `cap_${authorizationId}`, status: "captured" };
    },
    async void(authorizationId) {
      p.voidCalls.push(authorizationId);
      if (p.script.voidFails) throw new Error("provider void boom");
      return { voidId: `void_${authorizationId}`, status: "voided" };
    },
    async getStatus() {
      return { status: "authorized" as PaymentStatus };
    },
    async parseWebhook(f) {
      if (!p.script.parseWebhook) throw new Error("not scripted");
      return p.script.parseWebhook(f);
    },
    async linkPaymentMethod() {
      return { customerId: "cust_fake", paymentMethodToken: "pm_fake_token" };
    },
  };
  return p;
}

export function riskDecision(decision: RiskDecision["decision"]): RiskDecision {
  return {
    decision,
    riskScore: decision === "approve" ? 10 : 80,
    reason: `fake ${decision}`,
    audit: {
      stageReached: "rules",
      aiOutcome: "skipped",
      flagPromptInjection: false,
      riskScore: decision === "approve" ? 10 : 80,
    },
  };
}

export interface HarnessOptions {
  decision?: RiskDecision["decision"];
  riskThrows?: boolean;
  script?: ProviderScript;
  startMs?: number;
}

export function createHarness(opts: HarnessOptions = {}) {
  const clock = { ms: opts.startMs ?? Date.UTC(2030, 0, 1, 12, 0, 0) };
  const provider = createFakeProvider(opts.script);
  const riskCalls: RiskInput[] = [];
  const state = { decision: opts.decision ?? "approve", throws: opts.riskThrows ?? false };

  const stores = {
    intents: createMemoryIntentStore(),
    authorizations: createMemoryAuthorizationStore(),
    mandates: createMemoryMandateStore(),
    audit: createMemoryAuditStore(),
    webhookEvents: createMemoryWebhookEventStore(),
    vault: createMemoryVaultStore([
      {
        id: VAULT_METHOD_ID,
        ownerId: OWNER_ID,
        customerId: "cust_fake_1",
        token: RAW_PROVIDER_TOKEN,
        cardType: "Visa",
        last4: "1111",
        createdAt: new Date(0),
      },
      {
        id: OTHER_OWNER_METHOD_ID,
        ownerId: OTHER_OWNER_ID,
        customerId: "cust_fake_2",
        token: "pm_other_owner_token",
        cardType: "Visa",
        last4: "2222",
        createdAt: new Date(0),
      },
    ]),
  };
  const registry = createMemoryAgentRegistry([
    {
      agent: { id: "agent-1", apiKeyHash: hashApiKey(AGENT_KEY), killed: false, ownerId: OWNER_ID },
      policy: { policy: VALID_POLICY, riskConfig: {} },
    },
    {
      agent: { id: "agent-2", apiKeyHash: hashApiKey(OTHER_AGENT_KEY), killed: false, ownerId: OWNER_ID },
      policy: { policy: VALID_POLICY, riskConfig: {} },
    },
    {
      agent: { id: "agent-3", apiKeyHash: hashApiKey(KILLED_AGENT_KEY), killed: true, ownerId: OWNER_ID },
      policy: { policy: VALID_POLICY, riskConfig: {} },
    },
    {
      agent: { id: "agent-4", apiKeyHash: hashApiKey(OWNERLESS_AGENT_KEY), killed: false, ownerId: null },
      policy: { policy: VALID_POLICY, riskConfig: {} },
    },
  ]);
  const bus = createEventBus(() => new Date(clock.ms));
  const events: { ownerId: string; event: OwnerEvent }[] = [];
  for (const o of [OWNER_ID, OTHER_OWNER_ID]) bus.subscribe(o, (event) => events.push({ ownerId: o, event }));

  const deps: IntentRoutesDeps = {
    ...stores,
    policies: registry.policyStore,
    agents: registry.adminStore,
    events: bus,
    ownerSecret: TEST_OWNER_SECRET,
    provider,
    mandateKey: TEST_MANDATE_KEY,
    now: () => new Date(clock.ms),
    evaluateRisk: async (input) => {
      riskCalls.push(input);
      if (state.throws) throw new Error("risk boom");
      return riskDecision(state.decision);
    },
  };

  let logs = "";
  const logStream = new Writable({
    write(chunk, _enc, cb) {
      logs += chunk.toString();
      cb();
    },
  });
  const owners = createMemoryOwnerStore();
  const now = () => new Date(clock.ms);
  const app = buildServer({
    intents: deps,
    paymentProvider: provider,
    webhookEventStore: stores.webhookEvents,
    authorizationStore: stores.authorizations,
    owners: {
      owners,
      agents: registry.adminStore,
      policies: registry.policyStore,
      intents: stores.intents,
      audit: stores.audit,
      jwtSecret: TEST_OWNER_SECRET,
      // Low scrypt cost for fast tests only.
      scrypt: { N: 2 ** 10, r: 8, p: 1, keyLen: 32 },
      now,
    },
    events: { bus, jwtSecret: TEST_OWNER_SECRET, allowedOrigins: ["http://localhost:3000"], now },
    logStream,
  });

  const ownerToken = (ownerId = OWNER_ID) => signOwnerToken(ownerId, TEST_OWNER_SECRET, now()).token;
  const asOwner = (ownerId = OWNER_ID) => ({ authorization: `Bearer ${ownerToken(ownerId)}` });

  const auth = (key = AGENT_KEY) => ({ authorization: `Bearer ${key}` });

  const create = (body: unknown = validBody, key: string | null = AGENT_KEY) =>
    app.inject({
      method: "POST",
      url: "/intents",
      headers: key ? auth(key) : {},
      payload: body as object,
    });

  const execute = (id: string, token: unknown, key: string | null = AGENT_KEY) =>
    app.inject({
      method: "POST",
      url: `/intents/${id}/execute`,
      headers: key ? auth(key) : {},
      payload: { mandateToken: token } as object,
    });

  return {
    app,
    deps,
    stores,
    registry,
    owners,
    bus,
    events,
    provider,
    clock,
    state,
    riskCalls,
    create,
    execute,
    ownerToken,
    asOwner,
    logs: () => logs,
  };
}

export type Harness = ReturnType<typeof createHarness>;

/** Deterministically change one character so the result always differs. */
export function mutateChar(s: string, index: number, alphabet: string): string {
  const i = index % s.length;
  const orig = s[i]!;
  let k = 0;
  let repl = alphabet[k]!;
  while (repl === orig) {
    k++;
    repl = alphabet[k]!;
  }
  return s.slice(0, i) + repl + s.slice(i + 1);
}
