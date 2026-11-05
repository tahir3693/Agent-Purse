// Unit tests for createHttpPayPalClient (fixtures, no live calls).
//
// A fake fetch matched by (method, URL) returns recorded PayPal JSON. These
// assert the request shape (amount mapping + PayPal-Request-Id derived from
// requestId(intentId, op)) and the parsed results, plus the non-2xx ->
// PayPalError mapping. A fake TokenProvider supplies a dummy bearer token so no
// OAuth call is made (Requirements 9.1, 9.2, 9.3; 3.x, 4.1, 5.1, 5.2, 6.1).

import { describe, expect, it } from "vitest";

import { createHttpPayPalClient } from "../client.js";
import { PayPalError } from "../errors.js";
import { requestId } from "../idempotency.js";
import { makeFakeFetch } from "./fixtures/fakeFetch.js";
import { FAKE_CONFIG, makeFakeToken } from "./fixtures/fakes.js";
import {
  approvalUrl,
  authorizeResponse,
  captureResponse,
  errorResponseBody,
  getOrderResponse,
  orderCreateResponse,
} from "./fixtures/responses.js";

const INTENT_ID = "intent-42";

function createOrderInput() {
  return {
    amountCents: 1234,
    currency: "USD",
    referenceId: "ref-1",
    returnUrl: "https://app.example/return",
    cancelUrl: "https://app.example/cancel",
    intentId: INTENT_ID,
  };
}

describe("createOrder", () => {
  it("maps amountCents 1234 USD to amount.value '12.34' in the POST body", async () => {
    const fetch = makeFakeFetch([
      { method: "POST", urlEndsWith: "/v2/checkout/orders", body: orderCreateResponse },
    ]);
    const client = createHttpPayPalClient({
      config: FAKE_CONFIG,
      token: makeFakeToken(),
      fetch,
    });

    await client.createOrder(createOrderInput());

    const sent = fetch.calls[0].json as {
      purchase_units: Array<{ amount: { currency_code: string; value: string } }>;
    };
    expect(sent.purchase_units[0].amount.value).toBe("12.34");
    expect(sent.purchase_units[0].amount.currency_code).toBe("USD");
  });

  it("sets PayPal-Request-Id to requestId(intentId, 'create')", async () => {
    const fetch = makeFakeFetch([
      { method: "POST", urlEndsWith: "/v2/checkout/orders", body: orderCreateResponse },
    ]);
    const client = createHttpPayPalClient({
      config: FAKE_CONFIG,
      token: makeFakeToken(),
      fetch,
    });

    await client.createOrder(createOrderInput());

    const header = fetch.calls[0].headers["paypal-request-id"];
    expect(header).toBe(requestId(INTENT_ID, "create"));
  });

  it("returns id, status and the payer-action approvalUrl", async () => {
    const fetch = makeFakeFetch([
      { method: "POST", urlEndsWith: "/v2/checkout/orders", body: orderCreateResponse },
    ]);
    const client = createHttpPayPalClient({
      config: FAKE_CONFIG,
      token: makeFakeToken(),
      fetch,
    });

    const result = await client.createOrder(createOrderInput());

    expect(result).toEqual({
      id: "ORDER-1",
      status: "CREATED",
      approvalUrl,
    });
  });
});

describe("authorizeOrder", () => {
  it("parses AUTH-1/CREATED and sets PayPal-Request-Id for 'authorize'", async () => {
    const fetch = makeFakeFetch([
      {
        method: "POST",
        urlEndsWith: "/v2/checkout/orders/ORDER-1/authorize",
        body: authorizeResponse,
      },
    ]);
    const client = createHttpPayPalClient({
      config: FAKE_CONFIG,
      token: makeFakeToken(),
      fetch,
    });

    const result = await client.authorizeOrder("ORDER-1", INTENT_ID);

    expect(result).toEqual({ id: "AUTH-1", status: "CREATED" });
    expect(fetch.calls[0].headers["paypal-request-id"]).toBe(
      requestId(INTENT_ID, "authorize"),
    );
  });
});

describe("captureAuthorization", () => {
  it("parses CAP-1/COMPLETED and sets PayPal-Request-Id for 'capture'", async () => {
    const fetch = makeFakeFetch([
      {
        method: "POST",
        urlEndsWith: "/v2/payments/authorizations/AUTH-1/capture",
        body: captureResponse,
      },
    ]);
    const client = createHttpPayPalClient({
      config: FAKE_CONFIG,
      token: makeFakeToken(),
      fetch,
    });

    const result = await client.captureAuthorization("AUTH-1", INTENT_ID);

    expect(result).toEqual({ id: "CAP-1", status: "COMPLETED" });
    expect(fetch.calls[0].headers["paypal-request-id"]).toBe(
      requestId(INTENT_ID, "capture"),
    );
  });
});

describe("getOrder", () => {
  it("parses ORDER-1/APPROVED and sends no PayPal-Request-Id on the GET", async () => {
    const fetch = makeFakeFetch([
      { method: "GET", urlEndsWith: "/v2/checkout/orders/ORDER-1", body: getOrderResponse },
    ]);
    const client = createHttpPayPalClient({
      config: FAKE_CONFIG,
      token: makeFakeToken(),
      fetch,
    });

    const result = await client.getOrder("ORDER-1");

    expect(result).toEqual({ id: "ORDER-1", status: "APPROVED" });
    expect(fetch.calls[0].method).toBe("GET");
    expect(fetch.calls[0].headers["paypal-request-id"]).toBeUndefined();
  });
});

describe("error mapping", () => {
  it("maps a 422 response to a PayPalError with status/name/debugId/details", async () => {
    const fetch = makeFakeFetch([
      {
        method: "POST",
        urlEndsWith: "/v2/checkout/orders",
        status: 422,
        body: errorResponseBody,
      },
    ]);
    const client = createHttpPayPalClient({
      config: FAKE_CONFIG,
      token: makeFakeToken(),
      fetch,
    });

    const err = await client.createOrder(createOrderInput()).then(
      () => {
        throw new Error("expected createOrder to reject");
      },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(PayPalError);
    const ppErr = err as PayPalError;
    expect(ppErr.status).toBe(422);
    expect(ppErr.paypalName).toBe("UNPROCESSABLE_ENTITY");
    expect(ppErr.debugId).toBe("debug-123");
    expect(ppErr.details).toBeDefined();
  });

  it("error message carries debug_id but never the bearer token", async () => {
    const fetch = makeFakeFetch([
      {
        method: "POST",
        urlEndsWith: "/v2/checkout/orders",
        status: 422,
        body: errorResponseBody,
      },
    ]);
    const client = createHttpPayPalClient({
      config: FAKE_CONFIG,
      token: makeFakeToken("fake-token-xyz"),
      fetch,
    });

    const err = (await client
      .createOrder(createOrderInput())
      .catch((e: unknown) => e)) as PayPalError;

    expect(err.message).toContain("debug-123");
    expect(err.message).not.toContain("fake-token-xyz");
  });
});
