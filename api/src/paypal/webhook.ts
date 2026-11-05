// PayPal webhook signature verification.
//
// Verifies an incoming PayPal webhook against PayPal's own
// verify-webhook-signature endpoint and returns a plain boolean. This fails
// CLOSED: any missing configuration, transport error, non-2xx response, or
// non-SUCCESS verification status yields `false` (treated as unverified). The
// function NEVER throws out of verifyWebhook, so the route can always respond
// deterministically (design.md "Webhook flow" / "Error Handling",
// Requirements 7.1-7.5).
//
// Secrets discipline: the bearer token comes from the shared TokenProvider and
// is never logged. If PAYPAL_WEBHOOK_ID is missing we log the variable NAME
// only, never a value (money-rules.md).
//
// CRITICAL (raw body): `webhook_event` MUST be the event parsed from the exact
// raw request body string, parsed once here. PayPal's signature covers the raw
// bytes, so re-serializing a reparsed object would change key order/whitespace
// and break verification. The route hands us the untouched raw string.
//
// Verified against PayPal docs:
//   POST {baseUrl}/v1/notifications/verify-webhook-signature
//   Authorization: Bearer <access_token>
//   body: { auth_algo, cert_url, transmission_id, transmission_sig,
//           transmission_time, webhook_id, webhook_event }
//   -> { verification_status: "SUCCESS" | "FAILURE" }

import type { PayPalConfig } from "./config.js";
import type { TokenProvider } from "./token.js";

/** Minimal logger seam so callers can route warnings; defaults to console. */
export interface WebhookLogger {
  warn(message: string): void;
}

export interface WebhookVerifyDeps {
  config: PayPalConfig;
  token: TokenProvider;
  /** Injectable fetch for testability; defaults to the global fetch. */
  fetch?: typeof fetch;
  /**
   * The configured PAYPAL_WEBHOOK_ID. The caller typically reads this from the
   * environment. If missing/blank, verification fails closed (returns false).
   */
  webhookId?: string;
  /** Optional logger; defaults to console. Only variable NAMES are logged. */
  logger?: WebhookLogger;
}

/** The five PayPal signature headers, read case-insensitively. */
const HEADER_AUTH_ALGO = "paypal-auth-algo";
const HEADER_CERT_URL = "paypal-cert-url";
const HEADER_TRANSMISSION_ID = "paypal-transmission-id";
const HEADER_TRANSMISSION_SIG = "paypal-transmission-sig";
const HEADER_TRANSMISSION_TIME = "paypal-transmission-time";

/** Shape of the fields we read from the verify-webhook-signature response. */
interface VerifyResponseBody {
  verification_status?: string;
}

/**
 * Read a header by name, case-insensitively, from a loose header map.
 *
 * Fastify lowercases incoming header keys, but we normalize defensively so the
 * verifier does not depend on the caller's casing.
 */
function readHeader(
  headers: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const direct = headers[name];
  if (direct !== undefined) return direct;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) return headers[key];
  }
  return undefined;
}

/**
 * Verify a PayPal webhook signature. Returns true only when PayPal responds
 * with `verification_status === "SUCCESS"`. Fails closed (returns false) on a
 * missing webhook id, a missing signature header, a bad request body, a
 * transport error, or any non-SUCCESS result. Never throws.
 */
export async function verifyWebhook(
  deps: WebhookVerifyDeps,
  headers: Record<string, string | undefined>,
  rawBody: string,
): Promise<boolean> {
  const logger: WebhookLogger = deps.logger ?? console;
  const fetchImpl = deps.fetch ?? globalThis.fetch;

  const webhookId = deps.webhookId?.trim();
  if (!webhookId) {
    // Fail closed. Log the variable NAME only - never a value.
    logger.warn(
      "Missing required environment variable: PAYPAL_WEBHOOK_ID (webhook verification fails closed)",
    );
    return false;
  }

  try {
    const authAlgo = readHeader(headers, HEADER_AUTH_ALGO);
    const certUrl = readHeader(headers, HEADER_CERT_URL);
    const transmissionId = readHeader(headers, HEADER_TRANSMISSION_ID);
    const transmissionSig = readHeader(headers, HEADER_TRANSMISSION_SIG);
    const transmissionTime = readHeader(headers, HEADER_TRANSMISSION_TIME);

    // A missing signature header can never verify; fail closed.
    if (
      !authAlgo ||
      !certUrl ||
      !transmissionId ||
      !transmissionSig ||
      !transmissionTime
    ) {
      return false;
    }

    // Parse the raw body exactly once; `webhook_event` is this parsed object.
    // Never re-serialize a reparsed object - PayPal signs the raw bytes.
    const webhookEvent: unknown = JSON.parse(rawBody);

    const body = {
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: webhookId,
      webhook_event: webhookEvent,
    };

    const accessToken = await deps.token.getToken();
    const base = deps.config.baseUrl.replace(/\/+$/, "");

    const res = await fetchImpl(
      `${base}/v1/notifications/verify-webhook-signature`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      // Non-2xx from the verify endpoint => unverified (fail closed).
      return false;
    }

    const data = (await res.json()) as VerifyResponseBody;
    return data.verification_status === "SUCCESS";
  } catch {
    // Any error (bad JSON, token failure, network) => unverified. Never throw;
    // never log the error body since it could echo request content.
    return false;
  }
}
