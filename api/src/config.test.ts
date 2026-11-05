import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

// Unit tests for loadConfig env/port/host parsing (Requirements 3.5, 3.6, 3.7).
// loadConfig accepts an env object, so these tests are pure and do not touch
// the real process environment.
describe("loadConfig", () => {
  describe("defaults when env is unset", () => {
    it("falls back to host 0.0.0.0 and port 3000 for an empty env", () => {
      expect(loadConfig({})).toEqual({ host: "0.0.0.0", port: 3000 });
    });

    it("falls back to host 0.0.0.0 when HOST is undefined", () => {
      expect(loadConfig({ PORT: "8080" }).host).toBe("0.0.0.0");
    });

    it("falls back to port 3000 when PORT is undefined", () => {
      expect(loadConfig({ HOST: "127.0.0.1" }).port).toBe(3000);
    });
  });

  describe("valid set values are returned as-is", () => {
    it("returns the provided HOST and PORT", () => {
      expect(loadConfig({ HOST: "127.0.0.1", PORT: "8080" })).toEqual({
        host: "127.0.0.1",
        port: 8080,
      });
    });

    it("accepts the boundary port 0", () => {
      expect(loadConfig({ PORT: "0" }).port).toBe(0);
    });

    it("accepts the boundary port 65535", () => {
      expect(loadConfig({ PORT: "65535" }).port).toBe(65535);
    });
  });

  describe("blank HOST falls back to the default", () => {
    it("treats an empty string as unset", () => {
      expect(loadConfig({ HOST: "" }).host).toBe("0.0.0.0");
    });

    it("treats whitespace-only as unset", () => {
      expect(loadConfig({ HOST: "   " }).host).toBe("0.0.0.0");
    });
  });

  describe("invalid PORT falls back to the default", () => {
    it("rejects non-numeric values", () => {
      expect(loadConfig({ PORT: "abc" }).port).toBe(3000);
    });

    it("rejects negative values", () => {
      expect(loadConfig({ PORT: "-1" }).port).toBe(3000);
    });

    it("rejects fractional values", () => {
      expect(loadConfig({ PORT: "80.5" }).port).toBe(3000);
    });

    it("rejects out-of-range values", () => {
      expect(loadConfig({ PORT: "70000" }).port).toBe(3000);
    });

    it("rejects an empty string", () => {
      expect(loadConfig({ PORT: "" }).port).toBe(3000);
    });
  });
});
