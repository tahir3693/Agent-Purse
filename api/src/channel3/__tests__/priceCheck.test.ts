// Fixture-backed unit tests for priceCheck (Requirements 4.1-4.5, 5.1, 7.1).
//
// A deterministic stub SDK client resolves from fixtures or rejects with a
// supplied error; no live network calls and no real timers. The retry-once path
// and catch->unknown path are exercised both via the stub and via injected
// searchProducts/getProduct deps that reject synchronously.

import { describe, expect, it } from "vitest";

import type { Channel3SdkLike } from "../client.js";
import { PRICE_BANDS, priceCheck } from "../priceCheck.js";
import type { Channel3Product } from "../types.js";
import {
  medianProduct10000,
  mixedCurrencyProduct,
  singleOffer10000,
} from "./fixtures/products.js";
import { makeStubClient } from "./fixtures/stubClient.js";

// Median of the fixture in-stock USD offers is 10000 cents.
const MEDIAN = 10_000;

describe("priceCheck verdict bands", () => {
  // The constant is the single source of truth for Risk Guard tuning.
  it("exposes the documented band thresholds", () => {
    expect(PRICE_BANDS).toEqual({ high: 1.3, low: 0.7 });
  });

  async function check(amountCents: number) {
    const client = makeStubClient({ searchData: [medianProduct10000] });
    return priceCheck({ client }, { title: "monitor", amountCents, currency: "USD" });
  }

  it("returns ok at the market median (r = 1.0)", async () => {
    const result = await check(MEDIAN);
    expect(result.status).toBe("ok");
    expect(result.medianCents).toBe(MEDIAN);
    expect(result.sampleSize).toBe(3);
  });

  it("returns high clearly above market (r = 2.0)", async () => {
    expect((await check(MEDIAN * 2)).status).toBe("high");
  });

  it("returns low clearly below market (r = 0.5)", async () => {
    expect((await check(MEDIAN / 2)).status).toBe("low");
  });

  describe("boundary ratios around high = 1.30", () => {
    it("r = 1.31 is high (strictly above threshold)", async () => {
      expect((await check(13_100)).status).toBe("high");
    });

    it("r = 1.30 is ok (threshold itself is not high)", async () => {
      expect((await check(13_000)).status).toBe("ok");
    });
  });

  describe("boundary ratios around low = 0.70", () => {
    it("r = 0.69 is low (strictly below threshold)", async () => {
      expect((await check(6_900)).status).toBe("low");
    });

    it("r = 0.70 is ok (threshold itself is not low)", async () => {
      expect((await check(7_000)).status).toBe("ok");
    });
  });
});

describe("priceCheck currency and availability filtering", () => {
  it("samples only same-currency in-stock offers", async () => {
    const client = makeStubClient({ searchData: [mixedCurrencyProduct] });

    const result = await priceCheck(
      { client },
      { title: "mouse", amountCents: 11_000, currency: "USD" },
    );

    // Only the two USD in-stock offers (100, 120) count -> median 11000.
    expect(result.sampleSize).toBe(2);
    expect(result.medianCents).toBe(11_000);
    expect(result.status).toBe("ok");
  });

  it("reports the lowest matching offer as bestOffer", async () => {
    const client = makeStubClient({ searchData: [mixedCurrencyProduct] });

    const result = await priceCheck(
      { client },
      { title: "mouse", amountCents: 11_000, currency: "USD" },
    );

    expect(result.bestOffer).toEqual({
      domain: "example.com",
      priceCents: 10_000,
      currency: "USD",
    });
  });

  it("returns unknown with sampleSize 0 when no offer matches the currency", async () => {
    const client = makeStubClient({ searchData: [mixedCurrencyProduct] });

    const result = await priceCheck(
      { client },
      { title: "mouse", amountCents: 9_000, currency: "GBP" },
    );

    expect(result).toEqual({ status: "unknown", medianCents: null, sampleSize: 0 });
  });
});

describe("priceCheck productId path", () => {
  it("uses getProduct (retrieve) and does NOT search when productId is given", async () => {
    const client = makeStubClient({
      retrieveData: singleOffer10000,
      searchData: [medianProduct10000],
    });

    const result = await priceCheck(
      { client },
      { title: "keyboard", amountCents: 10_000, currency: "USD", productId: "p-single" },
    );

    expect(client.retrieveCalls).toEqual([{ product_id: "p-single" }]);
    expect(client.searchCalls).toHaveLength(0);
    expect(result.status).toBe("ok");
    expect(result.sampleSize).toBe(1);
  });

  it("falls back to search when productId is absent", async () => {
    const client = makeStubClient({ searchData: [medianProduct10000] });

    await priceCheck({ client }, { title: "monitor", amountCents: 10_000, currency: "USD" });

    expect(client.searchCalls).toHaveLength(1);
    expect(client.retrieveCalls).toHaveLength(0);
  });
});

describe("priceCheck resilience (error -> unknown, retry once)", () => {
  it("degrades to unknown and retries exactly once when search always rejects", async () => {
    let calls = 0;
    const failingSearch = async (): Promise<Channel3Product[]> => {
      calls += 1;
      throw new Error("transport failure");
    };
    const client = makeStubClient();

    const result = await priceCheck(
      { client, searchProducts: failingSearch },
      { title: "monitor", amountCents: 10_000, currency: "USD" },
    );

    // retries: 1 => 2 attempts total.
    expect(calls).toBe(2);
    expect(result).toEqual({ status: "unknown", medianCents: null, sampleSize: 0 });
  });

  it("degrades to unknown and retries once when getProduct (productId path) rejects", async () => {
    let calls = 0;
    const failingGetProduct = async (): Promise<Channel3Product> => {
      calls += 1;
      throw new Error("retrieve failure");
    };
    const client = makeStubClient();

    const result = await priceCheck(
      { client, getProduct: failingGetProduct },
      { title: "x", amountCents: 10_000, currency: "USD", productId: "boom" },
    );

    expect(calls).toBe(2);
    expect(result).toEqual({ status: "unknown", medianCents: null, sampleSize: 0 });
  });

  it("succeeds on the first attempt without a retry when search resolves", async () => {
    let calls = 0;
    const okThenCount = async (
      client: Channel3SdkLike,
      input: { query: string; limit?: number },
    ): Promise<Channel3Product[]> => {
      calls += 1;
      void client;
      void input;
      return [medianProduct10000];
    };

    const result = await priceCheck(
      { client: makeStubClient(), searchProducts: okThenCount },
      { title: "monitor", amountCents: 10_000, currency: "USD" },
    );

    expect(calls).toBe(1);
    expect(result.status).toBe("ok");
  });

  it("never throws even when the underlying call rejects", async () => {
    const client = makeStubClient({ searchError: new Error("boom") });

    await expect(
      priceCheck({ client }, { title: "x", amountCents: 1, currency: "USD" }),
    ).resolves.toEqual({ status: "unknown", medianCents: null, sampleSize: 0 });
  });
});
