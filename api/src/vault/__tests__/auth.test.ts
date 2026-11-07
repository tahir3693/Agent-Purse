import { describe, expect, it } from "vitest";

import { verifyOwnerToken } from "../auth.js";
import { NOW_S, OWNER_SECRET, WRONG_SECRET, b64, ownerToken, signOwner } from "./helpers.js";

describe("verifyOwnerToken", () => {
  it("round trip returns the claims", () => {
    const r = verifyOwnerToken(ownerToken("owner_1"), OWNER_SECRET, NOW_S);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.claims.sub).toBe("owner_1");
  });

  it("rejects an expired token (exp boundary inclusive)", () => {
    const t = ownerToken("o", { exp: NOW_S });
    expect(verifyOwnerToken(t, OWNER_SECRET, NOW_S)).toEqual({ ok: false, reason: "expired" });
    expect(verifyOwnerToken(t, OWNER_SECRET, NOW_S - 1).ok).toBe(true);
  });

  it("rejects a token signed with the wrong key", () => {
    const t = signOwner({ sub: "o", iat: NOW_S, exp: NOW_S + 60 }, WRONG_SECRET);
    expect(verifyOwnerToken(t, OWNER_SECRET, NOW_S)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects alg none", () => {
    const t = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "o", iat: 1, exp: NOW_S + 60 })}.`;
    expect(verifyOwnerToken(t, OWNER_SECRET, NOW_S).ok).toBe(false);
    const t2 = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "o", iat: 1, exp: NOW_S + 60 })}.AAAA`;
    expect(verifyOwnerToken(t2, OWNER_SECRET, NOW_S)).toEqual({ ok: false, reason: "bad_alg" });
  });

  it("rejects HS512", () => {
    const t = signOwner(
      { sub: "o", iat: NOW_S, exp: NOW_S + 60 },
      OWNER_SECRET,
      { alg: "HS512", typ: "JWT" },
      "sha512",
    );
    expect(verifyOwnerToken(t, OWNER_SECRET, NOW_S)).toEqual({ ok: false, reason: "bad_alg" });
  });

  it.each(["", "abc", "a.b", "a.b.c.d", "a..c", "!!!.@@@.###"])("rejects malformed %j", (t) => {
    expect(verifyOwnerToken(t, OWNER_SECRET, NOW_S).ok).toBe(false);
  });

  it("rejects an empty secret", () => {
    expect(verifyOwnerToken(ownerToken("o"), "", NOW_S).ok).toBe(false);
  });

  it("rejects claims missing sub even when correctly signed", () => {
    const t = signOwner({ iat: NOW_S, exp: NOW_S + 60 });
    expect(verifyOwnerToken(t, OWNER_SECRET, NOW_S)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects every single-character mutation of the signature (incl. non-canonical last char)", () => {
    const token = ownerToken("owner_1");
    const dot = token.lastIndexOf(".");
    const prefix = token.slice(0, dot + 1);
    const sig = token.slice(dot + 1);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let tried = 0;
    for (let i = 0; i < sig.length; i++) {
      for (const c of alphabet) {
        if (c === sig[i]) continue;
        const mutated = prefix + sig.slice(0, i) + c + sig.slice(i + 1);
        tried++;
        expect(verifyOwnerToken(mutated, OWNER_SECRET, NOW_S).ok, `pos ${i} char ${c}`).toBe(
          false,
        );
      }
    }
    expect(tried).toBe(sig.length * (alphabet.length - 1));
  });
});
