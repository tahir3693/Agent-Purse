// Fixture-backed unit tests for getProduct (Requirements 3.1, 3.3, 7.1).

import { describe, expect, it } from "vitest";

import { getProduct } from "../product.js";
import { singleOffer10000 } from "./fixtures/products.js";
import { makeStubClient } from "./fixtures/stubClient.js";

describe("getProduct", () => {
  it("retrieves the product by id and returns it", async () => {
    const client = makeStubClient({ retrieveData: singleOffer10000 });

    const result = await getProduct(client, "p-single");

    expect(result).toEqual(singleOffer10000);
    expect(client.retrieveCalls).toEqual([{ product_id: "p-single" }]);
  });

  it("propagates a not-found error from the SDK (does not swallow it)", async () => {
    const notFound = new Error("Product not found");
    const client = makeStubClient({ retrieveError: notFound });

    await expect(getProduct(client, "missing")).rejects.toThrow("Product not found");
    expect(client.retrieveCalls).toEqual([{ product_id: "missing" }]);
  });
});
