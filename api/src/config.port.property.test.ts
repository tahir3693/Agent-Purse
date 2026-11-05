import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { loadConfig } from "./config.js";

// Feature: agentpurse-scaffold, Property 2: Port parsing falls back to the default for any invalid input
//
// For any string value of PORT that is NOT an integer in [0, 65535]
// (empty/unset, non-numeric, negative, fractional, out-of-range) -> port === 3000.
// For any integer string in [0, 65535] -> that integer is returned as port.
//
// Validates: Requirements 3.5, 3.7
describe("Property 2: Port parsing falls back to the default for any invalid input", () => {
  const DEFAULT_PORT = 3000;

  it("returns the given integer for any integer string in [0, 65535]", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 65535 }), (n) => {
        const { port } = loadConfig({ PORT: String(n) });
        expect(port).toBe(n);
      }),
      { numRuns: 200 },
    );
  });

  it("falls back to 3000 when PORT is unset", () => {
    // Represents the empty/unset case across many runs (deterministic input).
    fc.assert(
      fc.property(fc.constant(undefined), () => {
        const { port } = loadConfig({});
        expect(port).toBe(DEFAULT_PORT);
      }),
      { numRuns: 100 },
    );
  });

  it("falls back to 3000 for any empty or whitespace-only PORT string", () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 8 }),
        (blank) => {
          const { port } = loadConfig({ PORT: blank });
          expect(port).toBe(DEFAULT_PORT);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("falls back to 3000 for any non-numeric PORT string", () => {
    fc.assert(
      fc.property(
        // Arbitrary strings whose numeric coercion is NaN (not a parseable number).
        fc.string().filter((s) => Number.isNaN(Number(s)) && s.trim() !== ""),
        (nonNumeric) => {
          const { port } = loadConfig({ PORT: nonNumeric });
          expect(port).toBe(DEFAULT_PORT);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("falls back to 3000 for any negative integer PORT string", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000_000 }), (n) => {
        const { port } = loadConfig({ PORT: String(-n) });
        expect(port).toBe(DEFAULT_PORT);
      }),
      { numRuns: 200 },
    );
  });

  it("falls back to 3000 for any fractional PORT string", () => {
    fc.assert(
      fc.property(
        // A non-integer floating value in a wide range (including inside [0,65535]).
        fc
          .double({ min: 0, max: 65535, noNaN: true, noDefaultInfinity: true })
          .filter((d) => !Number.isInteger(d)),
        (frac) => {
          const { port } = loadConfig({ PORT: String(frac) });
          expect(port).toBe(DEFAULT_PORT);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("falls back to 3000 for any integer PORT string above 65535", () => {
    fc.assert(
      fc.property(fc.integer({ min: 65536, max: 10_000_000 }), (n) => {
        const { port } = loadConfig({ PORT: String(n) });
        expect(port).toBe(DEFAULT_PORT);
      }),
      { numRuns: 200 },
    );
  });
});
