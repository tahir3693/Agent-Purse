// PayPalRestProvider: PaymentProvider over the spec-03 PayPalClient.
// paymentMethodRef is an already-approved PayPal order id. PayPal types and
// errors stay inside this file; callers only see ProviderError.

import { PayPalError } from "../../paypal/errors.js";
import type { PayPalClient } from "../../paypal/client.js";
import { ProviderError } from "../errors.js";
import type { PaymentProvider, PaymentStatus } from "../types.js";

const PROVIDER = "paypal" as const;

/** Authorization status -> normalized. Unknown/PENDING never reads as authorized. */
export function mapPayPalAuthorizationStatus(status: string): PaymentStatus {
  switch (status.toUpperCase()) {
    case "CREATED":
      return "authorized";
    case "CAPTURED":
    case "PARTIALLY_CAPTURED":
      return "captured";
    case "VOIDED":
      return "voided";
    case "EXPIRED":
      return "expired";
    case "DENIED":
      return "declined";
    default:
      return "failed";
  }
}

/** Capture status -> normalized. */
function mapPayPalCaptureStatus(status: string): PaymentStatus {
  switch (status.toUpperCase()) {
    case "COMPLETED":
      return "captured";
    case "PENDING":
      return "capture_pending";
    case "DECLINED":
      return "declined";
    default:
      return "failed";
  }
}

function wrap(err: unknown, action: string): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof PayPalError) {
    const code =
      err.status === 404
        ? "not_found"
        : err.status === 422
          ? "rejected"
          : err.status >= 400 && err.status < 500
            ? "invalid_request"
            : "provider_error";
    return new ProviderError({
      provider: PROVIDER,
      code,
      message: `PayPal ${action} failed (status ${err.status})`,
      ...(err.paypalName ? { processorCode: err.paypalName } : {}),
    });
  }
  const name = err instanceof Error ? err.name : "UnknownError";
  return new ProviderError({
    provider: PROVIDER,
    code: "provider_error",
    message: `PayPal ${action} failed (${name})`,
  });
}

async function guard<T>(action: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw wrap(err, action);
  }
}

function unsupported(what: string): ProviderError {
  return new ProviderError({
    provider: PROVIDER,
    code: "unsupported",
    message: `${what} is not supported by the PayPal REST provider`,
  });
}

export function createPayPalRestProvider(deps: {
  client: PayPalClient;
}): PaymentProvider {
  const { client } = deps;

  return {
    async authorize({ intentId, paymentMethodRef }) {
      // Amount/currency were fixed when the order was created; the order id is
      // the payment method reference. Idempotency key derives from intentId.
      return guard("authorize", async () => {
        const auth = await client.authorizeOrder(paymentMethodRef, intentId);
        const status = mapPayPalAuthorizationStatus(auth.status);
        if (status === "declined" || status === "failed") {
          throw new ProviderError({
            provider: PROVIDER,
            code: status === "declined" ? "declined" : "rejected",
            message: `PayPal authorize unsuccessful (${status})`,
            transactionId: auth.id,
          });
        }
        return { authorizationId: auth.id, status };
      });
    },

    async capture(authorizationId, _amountCents) {
      // TODO(verify): partial capture amounts; the client captures in full.
      void _amountCents;
      return guard("capture", async () => {
        const cap = await client.captureAuthorization(
          authorizationId,
          authorizationId,
        );
        return {
          captureId: cap.id,
          status: mapPayPalCaptureStatus(cap.status),
        };
      });
    },

    async void(authorizationId) {
      return guard("void", async () => {
        await client.voidAuthorization(authorizationId, authorizationId);
        return { voidId: authorizationId, status: "voided" as const };
      });
    },

    async getStatus(authorizationId) {
      return guard("getStatus", async () => {
        // TODO(verify): GET /v2/payments/authorizations/{id} (see client).
        const auth = await client.getAuthorization(authorizationId);
        return { status: mapPayPalAuthorizationStatus(auth.status) };
      });
    },

    async parseWebhook() {
      // PayPal webhooks are handled by /webhooks/paypal (spec-03).
      throw unsupported("parseWebhook");
    },

    async linkPaymentMethod() {
      // TODO: PayPal Vault is a later slice.
      throw unsupported("linkPaymentMethod");
    },
  };
}
