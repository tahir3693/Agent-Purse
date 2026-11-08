// Offline stubs: a scripted AgentApi and an in-memory Catalog. No network.
import type { AgentApi, ApiResult, CreateIntentBody } from "../api.js";
import type { Catalog, Product } from "../catalog.js";
import type { ScenarioContext } from "../scenarios.js";
import { Transcript } from "../transcript.js";

export const AGENT_KEY = "test-only-agent-key-0123456789abcdefghij";
export const TOKEN = "test-only-mandate-header.payload.signature-0123456789";
export const METHOD_ID = "vm-test-1";

export type Availability = "InStock" | "OutOfStock";
export type OfferSpec = [
  domain: string,
  price: number,
  availability?: Availability,
  currency?: string,
];

export function product(id: string, offers: OfferSpec[]): Product {
  return {
    id,
    title: `Test ${id}`,
    offers: offers.map(
      ([domain, price, availability = "InStock", currency = "USD"]) => ({
        url: `https://${domain}/p`,
        domain,
        price: { price, currency },
        availability,
      })
    ),
  };
}

export const CABLE = product("prod-cable", [
  ["shop-a.test", 12.99],
  ["shop-b.test", 9.99],
]);
export const KEYBOARD = product("prod-kb", [["keys.test", 129.0]]);

export function stubCatalog(
  byQuery: Record<string, Product[]> = {
    "usb c cable": [CABLE],
    "mechanical keyboard": [KEYBOARD],
  }
) {
  const calls: { query: string; max: number; min?: number }[] = [];
  const catalog: Catalog = {
    async search(query, max, min) {
      calls.push({ query, max, ...(min !== undefined ? { min } : {}) });
      return byQuery[query] ?? [];
    },
  };
  return { catalog, calls };
}

type Handler = (body: CreateIntentBody) => ApiResult;

export interface StubApiScript {
  create?: Handler;
  states?: string[]; // successive GET /intents/:id states
  mandate?: ApiResult;
  execute?: (n: number) => ApiResult;
}

export const ok = (
  status: number,
  body: Record<string, unknown>
): ApiResult => ({ status, body });

export function approveCreate(body: CreateIntentBody): ApiResult {
  return ok(201, {
    intentId: "int-1",
    state: "authorized",
    decision: "approve",
    riskScore: 10,
    reason: `ok for ${body.amountCents}`,
    mandateToken: TOKEN,
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
}

export function stubApi(script: StubApiScript = {}) {
  const created: CreateIntentBody[] = [];
  const calls: string[] = [];
  let polls = 0;
  let executes = 0;
  const api: AgentApi = {
    async createIntent(body) {
      calls.push("create");
      created.push(body);
      return (script.create ?? approveCreate)(body);
    },
    async getIntent(id) {
      calls.push("get");
      const states = script.states ?? ["captured"];
      const state = states[Math.min(polls, states.length - 1)]!;
      polls++;
      return ok(200, {
        intentId: id,
        state,
        decision: "approve",
        riskScore: 10,
      });
    },
    async getMandate() {
      calls.push("mandate");
      return (
        script.mandate ??
        ok(201, {
          intentId: "int-1",
          mandateToken: TOKEN,
          expiresAt: "2030-01-01T00:00:00.000Z",
        })
      );
    },
    async execute(id) {
      calls.push("execute");
      executes++;
      return script.execute
        ? script.execute(executes)
        : executes === 1
          ? ok(200, { intentId: id, state: "captured" })
          : ok(409, {
              error: "conflict",
              message: "Intent cannot be executed",
            });
    },
  };
  return { api, created, calls };
}

export function context(api: AgentApi, catalog: Catalog) {
  let now = 0;
  const transcript = new Transcript(() => undefined);
  transcript.protect(AGENT_KEY, "hide");
  const ctx: ScenarioContext = {
    api,
    catalog,
    transcript,
    paymentMethodId: METHOD_ID,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
  return { ctx, transcript, elapsed: () => now };
}
