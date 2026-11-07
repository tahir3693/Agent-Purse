// Mandate token: HS256 JWT built on node:crypto only.
// Errors never include the token or the key.

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const MAX_MANDATE_TTL_SECONDS = 300;

export const MandateClaimsSchema = z
  .object({
    jti: z.string().min(1),
    intentId: z.string().min(1),
    authorizationId: z.string().min(1),
    amountCents: z.number().int(),
    currency: z.string().regex(/^[A-Za-z]{3}$/),
    payee: z.string().min(1),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict();

export type MandateClaims = z.infer<typeof MandateClaimsSchema>;

export type VerifyFailureReason = "malformed" | "bad_signature" | "bad_alg" | "expired";

export type VerifyResult =
  | { ok: true; claims: MandateClaims }
  | { ok: false; reason: VerifyFailureReason };

const HEADER = { alg: "HS256", typ: "JWT" } as const;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function hmac(data: string, key: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** now is epoch seconds when a number; claims.iat/exp are epoch seconds. */
function nowSeconds(now: Date | number): number {
  return typeof now === "number" ? Math.floor(now) : Math.floor(now.getTime() / 1000);
}

export function signMandate(
  claims: MandateClaims,
  key: string,
  _now: Date | number = new Date(),
): string {
  void _now; // accepted for call-site symmetry; claims carry iat/exp
  if (!key) throw new Error("mandate signing key is required");
  const parsed = MandateClaimsSchema.parse(claims);
  const ttl = parsed.exp - parsed.iat;
  if (ttl <= 0 || ttl > MAX_MANDATE_TTL_SECONDS) {
    throw new Error(`mandate ttl must be within 1..${MAX_MANDATE_TTL_SECONDS} seconds`);
  }
  const signingInput = `${b64url(JSON.stringify(HEADER))}.${b64url(JSON.stringify(parsed))}`;
  return `${signingInput}.${b64url(hmac(signingInput, key))}`;
}

function parseJson(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

export function verifyMandate(token: string, key: string, now: Date | number): VerifyResult {
  if (typeof token !== "string" || !key) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) {
    return { ok: false, reason: "malformed" };
  }
  const [h, p, s] = parts as [string, string, string];

  const header = parseJson(h);
  if (typeof header !== "object" || header === null) return { ok: false, reason: "malformed" };
  const { alg, typ } = header as { alg?: unknown; typ?: unknown };
  if (alg !== HEADER.alg || typ !== HEADER.typ) return { ok: false, reason: "bad_alg" };

  const expected = hmac(`${h}.${p}`, key);
  const actual = Buffer.from(s, "base64url");
  // Canonical encoding required: the final base64url char carries unused bits,
  // so non-canonical variants would otherwise decode to the same signature.
  if (
    actual.length !== expected.length ||
    actual.toString("base64url") !== s ||
    !timingSafeEqual(actual, expected)
  ) {
    return { ok: false, reason: "bad_signature" };
  }

  const claims = MandateClaimsSchema.safeParse(parseJson(p));
  if (!claims.success) return { ok: false, reason: "malformed" };

  if (nowSeconds(now) >= claims.data.exp) return { ok: false, reason: "expired" };
  return { ok: true, claims: claims.data };
}
