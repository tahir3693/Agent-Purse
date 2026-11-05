import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { loadConfig } from "./config.js";

// Feature: agentpurse-scaffold, Property 3: Host parsing falls back to the default when unset or blank
//
// Property 3: Host parsing falls back to the default when unset or blank.
// For any HOST that is unset or blank (empty/whitespace-only) -> host === "0.0.0.0";
// for any non-blank string -> that string is returned as host.
// Validates: Requirements 3.5, 3.6
describe("loadConfig HOST parsing (Property 3)", () => {
  it("falls back to 0.0.0.0 when HOST is unset or blank (empty/whitespace-only)", () => {
    // Whitespace characters that make a HOST value "blank" per loadConfig (trim() === "").
    const whitespace = fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v", "  ");
    const blankHost = fc.oneof(
      fc.constant(undefined), // HOST unset
      fc.constant(""), // empty string
      // whitespace-only strings of varying length
      fc.array(whitespace, { minLength: 1, maxLength: 10 }).map((cs) => cs.join("")),
    );

    fc.assert(
      fc.property(blankHost, (host) => {
        // Build an env where HOST is either absent (undefined) or a blank string.
        const env: NodeJS.ProcessEnv =
          host === undefined ? {} : { HOST: host };
        expect(loadConfig(env).host).toBe("0.0.0.0");
      }),
      { numRuns: 200 },
    );
  });

  it("returns the provided HOST verbatim for any non-blank string", () => {
    // A non-blank string per loadConfig: truthy and HOST.trim() !== "".
    const nonBlankHost = fc
      .string()
      .filter((s) => s.length > 0 && s.trim() !== "");

    fc.assert(
      fc.property(nonBlankHost, (host) => {
        expect(loadConfig({ HOST: host }).host).toBe(host);
      }),
      { numRuns: 200 },
    );
  });
});
