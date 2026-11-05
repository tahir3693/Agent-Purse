// Fixture-backed unit tests for searchProducts (Requirements 2.1, 2.2, 2.3, 7.1).
// The stub SDK client records call args and resolves from fixtures - no live calls.

import { describe, expect, it } from "vitest";

import { searchProducts } from "../search.js";
import { medianProduct10000 } from "./fixtures/products.js";
import { makeStubClient } from "./fixtures/stubClient.js";

describe("searchProducts", () => {
  describe("maxPriceCents -> filters.price.max_price (major units)", () => {
    it("maps maxPriceCents to max_price = cents / 100", async () => {
      const client = makeStubClient({ searchData: [] });

      await searchProducts(client, { query: "monitor", maxPriceCents: 12_345 });

      expect(client.searchCalls).toHaveLength(1);
      expect(client.searchCalls[0]!.filters?.price?.max_price).toBe(123.45);
    });

    it("omits filters entirely when maxPriceCents is not provided", async () => {
      const client = makeStubClient({ searchData: [] });

      await searchProducts(client, { query: "monitor" });

      expect(client.searchCalls[0]!.filters).toBeUndefined();
    });
  });

  describe("limit handling", () => {
    it("defaults limit to 5 when unspecified", async () => {
      const client = makeStubClient({ searchData: [] });

      await searchProducts(client, { query: "monitor" });

      expect(client.searchCalls[0]!.limit).toBe(5);
    });

    it("passes a valid in-range limit through unchanged", async () => {
      const client = makeStubClient({ searchData: [] });

      await searchProducts(client, { query: "monitor", limit: 12 });

      expect(client.searchCalls[0]!.limit).toBe(12);
    });

    it("clamps a limit below 1 up to 1", async () => {
      const client = makeStubClient({ searchData: [] });

      await searchProducts(client, { query: "monitor", limit: 0 });

      expect(client.searchCalls[0]!.limit).toBe(1);
    });

    it("clamps a limit above 30 down to 30", async () => {
      const client = makeStubClient({ searchData: [] });

      await searchProducts(client, { query: "monitor", limit: 99 });

      expect(client.searchCalls[0]!.limit).toBe(30);
    });
  });

  describe("result mapping", () => {
    it("returns the products from page.data", async () => {
      const client = makeStubClient({ searchData: [medianProduct10000] });

      const result = await searchProducts(client, { query: "monitor" });

      expect(result).toEqual([medianProduct10000]);
    });

    it("returns an empty array for an empty page (does not throw)", async () => {
      const client = makeStubClient({ searchData: [] });

      const result = await searchProducts(client, { query: "nothing here" });

      expect(result).toEqual([]);
    });

    it("passes the query through to the SDK", async () => {
      const client = makeStubClient({ searchData: [] });

      await searchProducts(client, { query: "27 inch monitor" });

      expect(client.searchCalls[0]!.query).toBe("27 inch monitor");
    });
  });
});
