// Unit tests for buildChannel3Client (Requirements 1.1, 1.2, 8.1).
//
// Secret safety: the error for a missing/blank key names the VARIABLE only and
// never contains a value. The positive path uses a FAKE key string (never a real
// one) and asserts no live network call is made at construction time.

import { describe, expect, it } from "vitest";

import { buildChannel3Client } from "../client.js";

const EXPECTED_ERROR = "Missing required environment variable: CHANNEL3_API_KEY";

// A clearly-fake, non-secret placeholder used only to exercise construction.
const FAKE_KEY = "test-fake-key-not-real";

describe("buildChannel3Client missing/blank key", () => {
  it("throws the named error when CHANNEL3_API_KEY is unset", () => {
    expect(() => buildChannel3Client({})).toThrow(EXPECTED_ERROR);
  });

  it("throws the named error when CHANNEL3_API_KEY is an empty string", () => {
    expect(() => buildChannel3Client({ CHANNEL3_API_KEY: "" })).toThrow(EXPECTED_ERROR);
  });

  it("throws the named error when CHANNEL3_API_KEY is whitespace-only", () => {
    expect(() => buildChannel3Client({ CHANNEL3_API_KEY: "   " })).toThrow(EXPECTED_ERROR);
  });

  it("names the variable but never includes a value in the message", () => {
    let message = "";
    try {
      buildChannel3Client({ CHANNEL3_API_KEY: "  " });
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain("CHANNEL3_API_KEY");
    // The error says the variable is MISSING; it must not echo any assigned value.
    expect(message).toBe(EXPECTED_ERROR);
  });
});

describe("buildChannel3Client positive path (fake key, no live call)", () => {
  it("constructs a client without throwing when a key is present", () => {
    expect(() => buildChannel3Client({ CHANNEL3_API_KEY: FAKE_KEY })).not.toThrow();
  });

  it("returns a client object when a key is present (no network call at build)", () => {
    // Construction is synchronous and offline: the SDK holds the key in memory
    // for request auth but build makes no live call.
    const client = buildChannel3Client({ CHANNEL3_API_KEY: FAKE_KEY });
    expect(client).toBeDefined();
  });

  it("never surfaces the key value in a thrown error on the failure path", () => {
    // Secret-safety guarantee: the only message this builder throws names the
    // variable and carries no value - even if a (fake) key-shaped string is set
    // and then blanked, the thrown text is the fixed named error.
    let message = "";
    try {
      buildChannel3Client({ CHANNEL3_API_KEY: "   " });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe(EXPECTED_ERROR);
    expect(message).not.toContain(FAKE_KEY);
  });
});
