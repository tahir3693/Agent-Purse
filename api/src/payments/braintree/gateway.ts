// Minimal structural view of the Braintree gateway. Braintree SDK types never
// leave this directory; tests inject fakes implementing BraintreeGatewayLike.
// TODO(verify): @types/braintree 3.4.5 lags the braintree 3.41 package, so we
// cast the real gateway to this structural type at the boundary below.

import braintree from "braintree";
import type { Readable } from "node:stream";
import type { BraintreeConfig } from "../config.js";

export interface BtTransaction {
  id: string;
  status: string;
  processorResponseCode?: string;
  gatewayRejectionReason?: string;
}

export interface BtResult {
  success: boolean;
  message?: string;
  transaction?: BtTransaction;
  errors?: unknown;
}

export interface BtCustomerResult extends BtResult {
  // TODO(verify): cardType/last4 are Braintree CreditCard fields; absent for non-card methods.
  customer?: {
    id: string;
    paymentMethods?: Array<{ token: string; cardType?: string; last4?: string }>;
  };
}

export interface BtPaymentMethodResult extends BtResult {
  paymentMethod?: { token: string; cardType?: string; last4?: string };
}

export interface BtSearchTerm {
  is(value: string): unknown;
}

export interface BtTransactionSearch {
  orderId(): BtSearchTerm;
}

export interface BtWebhookNotification {
  kind: string;
  timestamp: Date;
  /** Present for transaction notifications. */
  transaction?: BtTransaction;
  [key: string]: unknown;
}

export interface BraintreeGatewayLike {
  transaction: {
    sale(req: {
      amount: string;
      paymentMethodToken: string;
      orderId: string;
      options: { submitForSettlement: boolean };
    }): Promise<BtResult>;
    submitForSettlement(transactionId: string, amount?: string): Promise<BtResult>;
    void(transactionId: string): Promise<BtResult>;
    find(transactionId: string): Promise<BtTransaction>;
    search(fn: (search: BtTransactionSearch) => void): Readable;
  };
  customer: {
    create(req: { id: string; paymentMethodNonce: string }): Promise<BtCustomerResult>;
    find(customerId: string): Promise<{ id: string }>;
  };
  paymentMethod: {
    create(req: {
      customerId: string;
      paymentMethodNonce: string;
    }): Promise<BtPaymentMethodResult>;
  };
  webhookNotification: {
    parse(btSignature: string, btPayload: string): Promise<BtWebhookNotification>;
  };
}

export function buildBraintreeGateway(config: BraintreeConfig): BraintreeGatewayLike {
  // braintree is CJS; the default import is module.exports under tsx and tsc.
  const gateway = new braintree.BraintreeGateway({
    environment: braintree.Environment.Sandbox,
    merchantId: config.merchantId,
    publicKey: config.publicKey,
    privateKey: config.privateKey,
  });
  return gateway as unknown as BraintreeGatewayLike;
}
