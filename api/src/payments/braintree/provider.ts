// BraintreeProvider: PaymentProvider over a structural BraintreeGatewayLike.
// authorizationId = captureId = voidId = Braintree transaction id.

import { ProviderError } from "../errors.js";
import type { PaymentProvider, PaymentStatus, WebhookEvent } from "../types.js";
import type { BraintreeGatewayLike, BtResult, BtTransaction } from "./gateway.js";
import { centsToDecimal } from "./money.js";
import { mapStatus } from "./status.js";

const PROVIDER = "braintree" as const;

function isNotFound(err: unknown): boolean {
  return err instanceof Error && err.name === "notFoundError";
}

/** Convert any unexpected SDK error into a safe ProviderError (class name only). */
function wrapUnexpected(err: unknown, action: string): ProviderError {
  if (err instanceof ProviderError) return err;
  const name = err instanceof Error ? err.name : "UnknownError";
  return new ProviderError({
    provider: PROVIDER,
    code: "provider_error",
    message: `Braintree ${action} failed (${name})`,
  });
}

async function guard<T>(action: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw wrapUnexpected(err, action);
  }
}

function failureFrom(result: BtResult, action: string): ProviderError {
  const tx = result.transaction;
  let code = "invalid_request";
  if (tx?.status === "processor_declined" || tx?.status === "settlement_declined") {
    code = "declined";
  } else if (tx?.status === "gateway_rejected") {
    code = "rejected";
  }
  return new ProviderError({
    provider: PROVIDER,
    code,
    message: `Braintree ${action} unsuccessful (${code})`,
    ...(tx?.id !== undefined ? { transactionId: tx.id } : {}),
    ...(tx?.processorResponseCode !== undefined
      ? { processorCode: tx.processorResponseCode }
      : {}),
  });
}

async function findByOrderId(
  gateway: BraintreeGatewayLike,
  orderId: string,
): Promise<BtTransaction[]> {
  return new Promise<BtTransaction[]>((resolve, reject) => {
    const found: BtTransaction[] = [];
    // TODO(verify): search index lag may briefly miss a just-created transaction.
    const stream = gateway.transaction.search((search) => {
      search.orderId().is(orderId);
    });
    stream.on("data", (tx: BtTransaction) => found.push(tx));
    stream.on("error", reject);
    stream.on("end", () => resolve(found));
  });
}

export function createBraintreeProvider(deps: {
  gateway: BraintreeGatewayLike;
}): PaymentProvider {
  const { gateway } = deps;

  return {
    async authorize({ amountCents, currency, intentId, paymentMethodRef }) {
      // TODO(verify): Braintree charges in the merchant account currency; multi-currency
      // needs merchantAccountId. Only USD is supported for now.
      if (currency !== "USD") {
        throw new ProviderError({
          provider: PROVIDER,
          code: "invalid_request",
          message: "Unsupported currency for Braintree adapter",
        });
      }
      const amount = centsToDecimal(amountCents);

      return guard("authorize", async () => {
        const existing = (await findByOrderId(gateway, intentId))
          .map((tx) => ({ id: tx.id, status: mapStatus(tx.status) }))
          .find((tx) => tx.status !== "declined" && tx.status !== "failed");
        if (existing) {
          return { authorizationId: existing.id, status: existing.status };
        }

        const result = await gateway.transaction.sale({
          amount,
          paymentMethodToken: paymentMethodRef,
          orderId: intentId,
          options: { submitForSettlement: false },
        });
        if (!result.success || !result.transaction) {
          throw failureFrom(result, "authorize");
        }
        return {
          authorizationId: result.transaction.id,
          status: mapStatus(result.transaction.status),
        };
      });
    },

    async capture(authorizationId, amountCents) {
      const amount = centsToDecimal(amountCents);
      return guard("capture", async () => {
        const result = await gateway.transaction.submitForSettlement(
          authorizationId,
          amount,
        );
        if (!result.success) throw failureFrom(result, "capture");
        return {
          captureId: authorizationId,
          status: mapStatus(result.transaction?.status ?? ""),
        };
      });
    },

    async void(authorizationId) {
      return guard("void", async () => {
        const result = await gateway.transaction.void(authorizationId);
        if (!result.success) throw failureFrom(result, "void");
        return {
          voidId: authorizationId,
          status: mapStatus(result.transaction?.status ?? ""),
        };
      });
    },

    async getStatus(authorizationId) {
      try {
        const tx = await gateway.transaction.find(authorizationId);
        return { status: mapStatus(tx.status) };
      } catch (err) {
        if (isNotFound(err)) {
          throw new ProviderError({
            provider: PROVIDER,
            code: "not_found",
            message: "Transaction not found",
            transactionId: authorizationId,
          });
        }
        throw wrapUnexpected(err, "getStatus");
      }
    },

    async linkPaymentMethod({ ownerId, nonce }) {
      return guard("linkPaymentMethod", async () => {
        let customerExists = true;
        try {
          await gateway.customer.find(ownerId);
        } catch (err) {
          if (!isNotFound(err)) throw err;
          customerExists = false;
        }

        if (customerExists) {
          const result = await gateway.paymentMethod.create({
            customerId: ownerId,
            paymentMethodNonce: nonce,
          });
          const token = result.paymentMethod?.token;
          if (!result.success || !token) throw failureFrom(result, "linkPaymentMethod");
          return {
            customerId: ownerId,
            paymentMethodToken: token,
            ...(result.paymentMethod?.cardType !== undefined
              ? { cardType: result.paymentMethod.cardType }
              : {}),
            ...(result.paymentMethod?.last4 !== undefined
              ? { last4: result.paymentMethod.last4 }
              : {}),
          };
        }

        const result = await gateway.customer.create({
          id: ownerId,
          paymentMethodNonce: nonce,
        });
        const method = result.customer?.paymentMethods?.[0];
        const token = method?.token;
        if (!result.success || !token) throw failureFrom(result, "linkPaymentMethod");
        return {
          customerId: ownerId,
          paymentMethodToken: token,
          ...(method?.cardType !== undefined ? { cardType: method.cardType } : {}),
          ...(method?.last4 !== undefined ? { last4: method.last4 } : {}),
        };
      });
    },

    async parseWebhook(rawFields): Promise<WebhookEvent> {
      const signature = rawFields.bt_signature;
      const payload = rawFields.bt_payload;
      if (!signature || !payload) {
        throw new ProviderError({
          provider: PROVIDER,
          code: "invalid_request",
          message: "Missing webhook fields",
        });
      }
      let notification;
      try {
        notification = await gateway.webhookNotification.parse(signature, payload);
      } catch {
        // Fail closed; never surface SDK detail.
        throw new ProviderError({
          provider: PROVIDER,
          code: "invalid_signature",
          message: "Webhook signature or payload invalid",
        });
      }
      // TODO(verify): notifications carry no unique id; key = kind:subjectId:timestamp.
      const tx = notification.transaction;
      // TODO(verify): SDK may expose timestamp as Date or ISO string; normalize.
      const timestamp = new Date(notification.timestamp);
      if (Number.isNaN(timestamp.getTime())) {
        throw new ProviderError({
          provider: PROVIDER,
          code: "invalid_request",
          message: "Webhook timestamp invalid",
        });
      }
      const event: WebhookEvent = {
        key: `${notification.kind}:${tx?.id ?? ""}:${timestamp.toISOString()}`,
        kind: notification.kind,
        timestampMs: timestamp.getTime(),
      };
      if (tx) {
        event.transactionId = tx.id;
        const status: PaymentStatus = mapStatus(tx.status);
        event.status = status;
      }
      return event;
    },
  };
}
