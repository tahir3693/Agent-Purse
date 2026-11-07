// Test helpers for spec-06 vault tests. Offline: fake provider, in-memory stores.
// All secrets here are obviously fake test values.

import { createHmac } from "node:crypto";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { Writable } from "node:stream";

import { createMemoryAuditStore, createMemoryVaultStore } from "../../db/memory.js";
import type { AuditStore, VaultStore } from "../../db/stores.js";
import { ProviderError } from "../../payments/errors.js";
import type { PaymentProvider } from "../../payments/types.js";
import { registerVaultRoutes } from "../routes.js";

export const OWNER_SECRET = "test-owner-secret-0123456789-abcdefghij-FAKE";
export const WRONG_SECRET = "another-wrong-secret-0123456789-abcdefghij-FAKE";
export const NONCE = "fake-valid-nonce";
export const NOW = new Date("2026-01-01T00:00:00.000Z");
export const NOW_S = Math.floor(NOW.getTime() / 1000);

export const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");

export function signOwner(
  claims: Record<string, unknown>,
  secret = OWNER_SECRET,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" },
  algo: "sha256" | "sha512" = "sha256",
): string {
  const h = b64(header);
  const p = b64(claims);
  const sig = createHmac(algo, secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

export function ownerToken(ownerId: string, over: Record<string, unknown> = {}): string {
  return signOwner({ sub: ownerId, iat: NOW_S - 10, exp: NOW_S + 3600, ...over });
}

export interface LinkCall {
  ownerId: string;
  nonce: string;
}

export interface FakeProviderOpts {
  /** Token minted per call; default derives a deterministic one from the call count. */
  token?: (n: number) => string;
  cardType?: string;
  last4?: string;
  customerId?: string;
  /** If set, linkPaymentMethod rejects with this. */
  fail?: unknown;
}

export function createFakeProvider(opts: FakeProviderOpts = {}) {
  const calls: LinkCall[] = [];
  let failure: unknown = opts.fail;
  const provider = {
    async linkPaymentMethod(input: LinkCall) {
      calls.push({ ...input });
      if (failure) throw failure;
      if (input.nonce !== NONCE) {
        throw new ProviderError({
          provider: "braintree",
          code: "invalid_request",
          message: "Braintree linkPaymentMethod unsuccessful (invalid_request)",
        });
      }
      const token = opts.token ? opts.token(calls.length) : `tok_secret_${calls.length}_WXYZ`;
      return {
        customerId: opts.customerId ?? input.ownerId,
        paymentMethodToken: token,
        ...(opts.cardType !== undefined ? { cardType: opts.cardType } : { cardType: "Visa" }),
        ...(opts.last4 !== undefined ? { last4: opts.last4 } : { last4: "1111" }),
      };
    },
  } as unknown as PaymentProvider;
  return {
    provider,
    calls,
    setFailure(f: unknown) {
      failure = f;
    },
  };
}

export interface VaultHarness {
  app: FastifyInstance;
  vault: VaultStore;
  audit: AuditStore;
  provider: ReturnType<typeof createFakeProvider>;
  logs: () => string;
  auditEvents: () => Promise<{ event: string; meta: Record<string, unknown> }[]>;
  link(body: unknown, token?: string | null): Promise<LightMyRequestResponse>;
  list(token?: string | null): Promise<LightMyRequestResponse>;
}

export async function createVaultHarness(
  over: {
    provider?: PaymentProvider;
    fake?: ReturnType<typeof createFakeProvider>;
    vault?: VaultStore;
    audit?: AuditStore;
  } = {},
): Promise<VaultHarness> {
  const fake = over.fake ?? createFakeProvider();
  const provider = over.provider ?? fake.provider;
  const vault = over.vault ?? createMemoryVaultStore();
  const audit = over.audit ?? createMemoryAuditStore();

  let logs = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      logs += chunk.toString();
      cb();
    },
  });
  const app = Fastify({
    logger: {
      level: "trace",
      stream,
      redact: ["req.headers.authorization", "req.body.nonce"],
    },
  });
  registerVaultRoutes(app, { vault, audit, provider, ownerSecret: OWNER_SECRET, now: () => NOW });
  await app.ready();

  // The in-memory audit store has no list-all; track appends via a wrapper listing.
  const events: { event: string; meta: Record<string, unknown> }[] = [];
  const origAppend = audit.append.bind(audit);
  audit.append = async (e) => {
    events.push({ event: e.event, meta: { ...(e.meta ?? {}) } });
    return origAppend(e);
  };

  const headers = (token?: string | null) =>
    token === null || token === undefined ? {} : { authorization: `Bearer ${token}` };

  return {
    app,
    vault,
    audit,
    provider: fake,
    logs: () => logs,
    auditEvents: async () => events,
    link: (body, token) =>
      app.inject({ method: "POST", url: "/vault/link", payload: body as object, headers: headers(token) }),
    list: (token) => app.inject({ method: "GET", url: "/vault/methods", headers: headers(token) }),
  };
}
