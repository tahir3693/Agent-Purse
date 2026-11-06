// PayPal Orders v2 / Payments v2 client (fetch implementation).
//
// The whole PayPal surface sits behind the PayPalClient interface so production
// uses this fetch-based implementation while tests inject a stub or a fake
// fetch returning recorded fixtures (no live calls). Integer cents are turned
// into PayPal decimal strings only here, via ./money.js. Every write carries a
// deterministic PayPal-Request-Id so retries reuse the key and never
// double-charge (money-rules.md, Requirements 3.1-3.7, 4.1, 5.1, 5.2).
//
// Tokens, secrets, and Authorization headers are NEVER logged. Non-2xx
// responses map to a single PayPalError (secret-free). Response parsing is
// defensive: a required id missing from a 2xx body throws a clear, secret-free
// PayPalError rather than returning undefined downstream.
//
// Verified endpoints (PayPal official docs, not guessed):
//   POST {base}/v2/checkout/orders
//   POST {base}/v2/checkout/orders/{orderId}/authorize
//   GET  {base}/v2/checkout/orders/{orderId}
//   POST {base}/v2/payments/authorizations/{authorizationId}/capture
//   POST {base}/v2/payments/authorizations/{authorizationId}/void

import type { PayPalConfig } from "./config.js";
import { PayPalError } from "./errors.js";
import { requestId } from "./idempotency.js";
import { centsToDecimal } from "./money.js";
import type { TokenProvider } from "./token.js";

// ---------------------------------------------------------------------------
// Data models (the module's typed shapes; see design.md "Components and
// Interfaces"). Persistence of these belongs to spec-08.
// ---------------------------------------------------------------------------

export interface Money {
  amountCents: number;
  currency: string;
}

export interface CreateOrderInput {
  amountCents: number;
  currency: string;
  referenceId: string;
  returnUrl: string;
  cancelUrl: string;
  /** Drives idempotency: the PayPal-Request-Id is derived from it. */
  intentId: string;
}

export interface CreatedOrder {
  id: string;
  status: string;
  /** Payer approval URL from the create-order links, or null if absent. */
  approvalUrl: string | null;
}

export interface Authorization {
  id: string;
  status: string;
}

export interface Capture {
  id: string;
  status: string;
}

export interface PayPalClient {
  createOrder(input: CreateOrderInput): Promise<CreatedOrder>;
  authorizeOrder(orderId: string, intentId: string): Promise<Authorization>;
  captureAuthorization(
    authorizationId: string,
    intentId: string,
  ): Promise<Capture>;
  voidAuthorization(authorizationId: string, intentId: string): Promise<void>;
  /**
   * GET /v2/payments/authorizations/{id}. TODO(verify): confirm endpoint and
   * status values (CREATED, CAPTURED, PARTIALLY_CAPTURED, VOIDED, DENIED,
   * EXPIRED, PENDING) against the official Payments v2 docs.
   */
  getAuthorization(authorizationId: string): Promise<Authorization>;
  getOrder(orderId: string): Promise<{ id: string; status: string }>;
  verifyWebhook(
    headers: Record<string, string | undefined>,
    rawBody: string,
  ): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Internal response shapes (only the fields we read; parsing stays defensive).
// ---------------------------------------------------------------------------

interface Link {
  rel?: string;
  href?: string;
}

interface OrderCreateResponse {
  id?: string;
  status?: string;
  links?: Link[];
}

interface OrderResponse {
  id?: string;
  status?: string;
}

interface AuthorizeResponse {
  purchase_units?: Array<{
    payments?: {
      authorizations?: Array<{ id?: string; status?: string }>;
    };
  }>;
}

interface CaptureResponse {
  id?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface PayPalClientDeps {
  config: PayPalConfig;
  token: TokenProvider;
  /** Injectable fetch for testability; defaults to the global fetch. */
  fetch?: typeof fetch;
  /**
   * Webhook verification seam. spec-03 task 4 (webhook.ts) wires a real
   * verifier here. Kept as an optional collaborator so this slice does not
   * depend on webhook.ts existing yet; if absent, verifyWebhook throws a typed,
   * secret-free PayPalError directing callers to the webhook module.
   */
  verifyWebhook?: (
    config: PayPalConfig,
    headers: Record<string, string | undefined>,
    rawBody: string,
    fetchImpl: typeof fetch,
  ) => Promise<boolean>;
}

type WriteOp = "create" | "authorize" | "capture" | "void";

export function createHttpPayPalClient(deps: PayPalClientDeps): PayPalClient {
  const { config, token } = deps;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const base = config.baseUrl.replace(/\/+$/, "");

  /**
   * Perform an authenticated PayPal HTTP call.
   *
   * Always sets Authorization: Bearer, Accept, and Content-Type. For write
   * operations (POST with an `intentId`/`op`), sets a deterministic
   * PayPal-Request-Id. Non-2xx responses throw a secret-free PayPalError.
   * Returns the parsed JSON body, or null for an empty body (e.g. 204 void).
   */
  async function call<T>(
    method: "GET" | "POST",
    path: string,
    opts: {
      body?: unknown;
      idempotency?: { intentId: string; op: WriteOp };
    } = {},
  ): Promise<T | null> {
    const accessToken = await token.getToken();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    if (opts.idempotency) {
      headers["PayPal-Request-Id"] = requestId(
        opts.idempotency.intentId,
        opts.idempotency.op,
      );
    }

    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });

    if (!res.ok) {
      // fromResponse extracts only the secret-free status/name/debug_id.
      throw await PayPalError.fromResponse(res);
    }

    const text = await res.text();
    if (text.trim() === "") {
      return null;
    }
    return JSON.parse(text) as T;
  }

  /** Throw a secret-free PayPalError when a 2xx body is missing a required id. */
  function requireField(
    value: string | undefined,
    field: string,
  ): string {
    if (typeof value !== "string" || value === "") {
      throw new PayPalError({
        status: 502,
        name: "MALFORMED_PAYPAL_RESPONSE",
        message: `PayPal response missing required field: ${field}`,
      });
    }
    return value;
  }

  async function createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    const body = {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: input.referenceId,
          amount: {
            currency_code: input.currency,
            value: centsToDecimal(input.amountCents, input.currency),
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    };

    const data = await call<OrderCreateResponse>(
      "POST",
      "/v2/checkout/orders",
      { body, idempotency: { intentId: input.intentId, op: "create" } },
    );

    const id = requireField(data?.id, "id");
    const status = requireField(data?.status, "status");

    // TODO(verify): exact approval link rel in the current sandbox response.
    // Prefer "payer-action"; fall back to "approve"; null if neither is present.
    const links = data?.links ?? [];
    const approvalUrl =
      links.find((l) => l.rel === "payer-action")?.href ??
      links.find((l) => l.rel === "approve")?.href ??
      null;

    return { id, status, approvalUrl };
  }

  async function authorizeOrder(
    orderId: string,
    intentId: string,
  ): Promise<Authorization> {
    const data = await call<AuthorizeResponse>(
      "POST",
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
      { body: {}, idempotency: { intentId, op: "authorize" } },
    );

    const auth = data?.purchase_units?.[0]?.payments?.authorizations?.[0];
    const id = requireField(auth?.id, "purchase_units[0].payments.authorizations[0].id");
    const status = requireField(
      auth?.status,
      "purchase_units[0].payments.authorizations[0].status",
    );

    return { id, status };
  }

  async function captureAuthorization(
    authorizationId: string,
    intentId: string,
  ): Promise<Capture> {
    const data = await call<CaptureResponse>(
      "POST",
      `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
      { body: {}, idempotency: { intentId, op: "capture" } },
    );

    const id = requireField(data?.id, "id");
    const status = requireField(data?.status, "status");

    return { id, status };
  }

  async function voidAuthorization(
    authorizationId: string,
    intentId: string,
  ): Promise<void> {
    // A successful void returns 204 No Content; call() yields null for that.
    await call<unknown>(
      "POST",
      `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
      { idempotency: { intentId, op: "void" } },
    );
  }

  async function getAuthorization(
    authorizationId: string,
  ): Promise<Authorization> {
    // TODO(verify): GET /v2/payments/authorizations/{id} per Payments v2 docs.
    const data = await call<CaptureResponse>(
      "GET",
      `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`,
    );
    const id = requireField(data?.id, "id");
    const status = requireField(data?.status, "status");
    return { id, status };
  }

  async function getOrder(
    orderId: string,
  ): Promise<{ id: string; status: string }> {
    const data = await call<OrderResponse>(
      "GET",
      `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    );

    const id = requireField(data?.id, "id");
    const status = requireField(data?.status, "status");

    return { id, status };
  }

  async function verifyWebhook(
    headers: Record<string, string | undefined>,
    rawBody: string,
  ): Promise<boolean> {
    // Seam for spec-03 task 4: webhook.ts supplies the real verifier via
    // deps.verifyWebhook. Until then, fail loudly (and closed) rather than
    // silently claiming a webhook is verified.
    if (!deps.verifyWebhook) {
      throw new PayPalError({
        status: 501,
        name: "WEBHOOK_VERIFY_NOT_WIRED",
        message:
          "verifyWebhook not implemented in client; wire deps.verifyWebhook (see webhook.ts, spec-03 task 4)",
      });
    }
    return deps.verifyWebhook(config, headers, rawBody, fetchImpl);
  }

  return {
    createOrder,
    authorizeOrder,
    captureAuthorization,
    voidAuthorization,
    getAuthorization,
    getOrder,
    verifyWebhook,
  };
}
