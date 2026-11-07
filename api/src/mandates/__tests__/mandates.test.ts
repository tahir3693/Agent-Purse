import { createHmac } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createMemoryMandateStore } from "../../db/memory.js";
import { issueMandate, signMandate, verifyMandate, type MandateClaims } from "../index.js";

const KEY = "test-only-mandate-signing-key-0123456789abcdef";
const NOW = new Date(Date.UTC(2030, 0, 1));
const iat = Math.floor(NOW.getTime() / 1000);
const CLAIMS: MandateClaims = {
  jti: "jti-1",
  intentId: "intent-1",
  authorizationId: "txn-1",
  amountCents: 1234,
  currency: "USD",
  payee: "shop.example.com",
  iat,
  exp: iat + 300,
};

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.";

describe("mandate token", () => {
  it("round-trips and expires at exp", () => {
    const t = signMandate(CLAIMS, KEY);
    const ok = verifyMandate(t, KEY, NOW);
    expect(ok).toEqual({ ok: true, claims: CLAIMS });
    expect(verifyMandate(t, KEY, CLAIMS.exp)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects wrong key, alg none, wrong alg, and ttl over 5 minutes", () => {
    const t = signMandate(CLAIMS, KEY);
    expect(verifyMandate(t, "test-only-other-key-0123456789abcdefghij", NOW)).toMatchObject({
      ok: false,
      reason: "bad_signature",
    });
    const payload = t.split(".")[1]!;
    const none = `${b64({ alg: "none", typ: "JWT" })}.${payload}.`;
    expect(verifyMandate(none, KEY, NOW).ok).toBe(false);
    const h = b64({ alg: "HS512", typ: "JWT" });
    const sig = createHmac("sha512", KEY).update(`${h}.${payload}`).digest("base64url");
    expect(verifyMandate(`${h}.${payload}.${sig}`, KEY, NOW)).toEqual({
      ok: false,
      reason: "bad_alg",
    });
    expect(() => signMandate({ ...CLAIMS, exp: iat + 301 }, KEY)).toThrow();
  });

  it("error text never contains the key or token", () => {
    const t = signMandate(CLAIMS, KEY);
    const r = JSON.stringify(verifyMandate(t + "x", KEY, NOW));
    expect(r).not.toContain(KEY);
    expect(r).not.toContain(t);
  });

  // Feature: spec-08-mandate-and-pay, Property 2: Tampered tokens never verify
  // **Validates: Requirements 3.1, 3.4**
  it("Property 2: any single-char mutation never verifies as the original claims", () => {
    const token = signMandate(CLAIMS, KEY);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: token.length - 1 }),
        fc.integer({ min: 0, max: ALPHABET.length - 1 }),
        (i, a) => {
          const orig = token[i]!;
          const repl = ALPHABET[a] === orig ? ALPHABET[(a + 1) % ALPHABET.length]! : ALPHABET[a]!;
          const mutated = token.slice(0, i) + repl + token.slice(i + 1);
          expect(mutated).not.toBe(token);
          const r = verifyMandate(mutated, KEY, NOW);
          expect(r.ok && JSON.stringify(r.claims) === JSON.stringify(CLAIMS)).toBe(false);
          expect(r.ok).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("mandate token exhaustive mutation", () => {
  it("no single-char substitution at any position verifies (incl. signature padding bits)", () => {
    const token = signMandate(CLAIMS, KEY);
    for (let i = 0; i < token.length; i++) {
      for (const c of ALPHABET) {
        if (c === token[i]) continue;
        const r = verifyMandate(token.slice(0, i) + c + token.slice(i + 1), KEY, NOW);
        expect(r.ok).toBe(false);
      }
    }
  });
});

describe("mandate store", () => {
  it("consume is atomic: 10 concurrent consumes => exactly one true", async () => {
    const store = createMemoryMandateStore();
    const { token } = await issueMandate(
      {
        intentId: "i",
        authorizationId: "a",
        amountCents: 1,
        currency: "USD",
        payee: "p.example.com",
      },
      { store, key: KEY, now: NOW },
    );
    const jti = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).jti as string;
    const results = await Promise.all(Array.from({ length: 10 }, () => store.consume(jti, NOW)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("consume fails for unknown or expired jti", async () => {
    const store = createMemoryMandateStore();
    expect(await store.consume("nope", NOW)).toBe(false);
    await store.create({ jti: "j", intentId: "i", expiresAt: new Date(NOW.getTime() + 1000) });
    expect(await store.consume("j", new Date(NOW.getTime() + 1000))).toBe(false);
    expect(await store.consume("j", NOW)).toBe(true);
  });
});
