// Test helpers: a recording fake BraintreeGatewayLike. No live calls.

import { Readable } from "node:stream";

import type {
  BraintreeGatewayLike,
  BtCustomerResult,
  BtPaymentMethodResult,
  BtResult,
  BtTransaction,
} from "../braintree/gateway.js";

export interface FakeGatewayOptions {
  existing?: BtTransaction[];
  saleResult?: BtResult;
  submitResult?: BtResult;
  voidResult?: BtResult;
  findResult?: BtTransaction;
  findError?: Error;
  customerFindError?: Error;
  customerCreateResult?: BtCustomerResult;
  paymentMethodResult?: BtPaymentMethodResult;
  /** Make every call throw this. */
  throwAll?: Error;
}

export function notFoundError(): Error {
  const e = new Error("not found");
  e.name = "notFoundError";
  return e;
}

export function createFakeGateway(opts: FakeGatewayOptions = {}) {
  const calls = {
    sale: [] as unknown[],
    submit: [] as unknown[][],
    void: [] as string[],
    find: [] as string[],
    search: [] as string[],
    customerFind: [] as string[],
    customerCreate: [] as unknown[],
    paymentMethodCreate: [] as unknown[],
  };
  const maybeThrow = () => {
    if (opts.throwAll) throw opts.throwAll;
  };

  const gateway: BraintreeGatewayLike = {
    transaction: {
      async sale(req) {
        maybeThrow();
        calls.sale.push(req);
        return (
          opts.saleResult ?? {
            success: true,
            transaction: { id: "tx_new", status: "authorized" },
          }
        );
      },
      async submitForSettlement(id, amount) {
        maybeThrow();
        calls.submit.push([id, amount]);
        return (
          opts.submitResult ?? {
            success: true,
            transaction: { id, status: "submitted_for_settlement" },
          }
        );
      },
      async void(id) {
        maybeThrow();
        calls.void.push(id);
        return opts.voidResult ?? { success: true, transaction: { id, status: "voided" } };
      },
      async find(id) {
        maybeThrow();
        calls.find.push(id);
        if (opts.findError) throw opts.findError;
        return opts.findResult ?? { id, status: "settled" };
      },
      search(fn) {
        let term = "";
        fn({
          orderId: () => ({
            is: (v: string) => {
              term = v;
              calls.search.push(v);
              return undefined;
            },
          }),
        });
        void term;
        return Readable.from(opts.existing ?? [], { objectMode: true });
      },
    },
    customer: {
      async find(id) {
        maybeThrow();
        calls.customerFind.push(id);
        if (opts.customerFindError) throw opts.customerFindError;
        return { id };
      },
      async create(req) {
        calls.customerCreate.push(req);
        return (
          opts.customerCreateResult ?? {
            success: true,
            customer: { id: req.id, paymentMethods: [{ token: "pm_token_new" }] },
          }
        );
      },
    },
    paymentMethod: {
      async create(req) {
        calls.paymentMethodCreate.push(req);
        return (
          opts.paymentMethodResult ?? {
            success: true,
            paymentMethod: { token: "pm_token_existing" },
          }
        );
      },
    },
    webhookNotification: {
      async parse() {
        throw new Error("not used in fake");
      },
    },
  };
  return { gateway, calls };
}
