// Owner bearer-JWT verification (spec-06): HS256 on node:crypto only.
// Tokens are never logged or echoed; failure bodies are constant.
// TODO(verify): owner login/JWT issuance is a later slice; tokens are verified only.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const OwnerClaimsSchema = z.object({
  sub: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type OwnerClaims = z.infer<typeof OwnerClaimsSchema>;

export type OwnerVerifyFailure = "malformed" | "bad_alg" | "bad_signature" | "expired";

export type OwnerVerifyResult =
  | { ok: true; claims: OwnerClaims }
  | { ok: false; reason: OwnerVerifyFailure };

const BEARER_RE = /^Bearer\s+(\S+)$/i;

function parseJson(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

/** nowSeconds is epoch seconds. */
export function verifyOwnerToken(
  token: string,
  secret: string,
  nowSeconds: number,
): OwnerVerifyResult {
  if (typeof token !== "string" || !secret) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) {
    return { ok: false, reason: "malformed" };
  }
  const [h, p, s] = parts as [string, string, string];

  const header = parseJson(h);
  if (typeof header !== "object" || header === null) return { ok: false, reason: "malformed" };
  const { alg, typ } = header as { alg?: unknown; typ?: unknown };
  if (alg !== "HS256" || typ !== "JWT") return { ok: false, reason: "bad_alg" };

  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  const actual = Buffer.from(s, "base64url");
  // Canonical base64url only, so non-canonical variants cannot alias a signature.
  if (
    actual.length !== expected.length ||
    actual.toString("base64url") !== s ||
    !timingSafeEqual(actual, expected)
  ) {
    return { ok: false, reason: "bad_signature" };
  }

  const claims = OwnerClaimsSchema.safeParse(parseJson(p));
  if (!claims.success) return { ok: false, reason: "malformed" };
  if (nowSeconds >= claims.data.exp) return { ok: false, reason: "expired" };
  return { ok: true, claims: claims.data };
}

/**
 * Authenticates the owner. On failure it sends a constant generic 401 and
 * returns null; otherwise returns the ownerId (the `sub` claim).
 */
export async function authenticateOwner(
  secret: string,
  req: FastifyRequest,
  reply: FastifyReply,
  now: () => Date = () => new Date(),
): Promise<string | null> {
  const header = req.headers.authorization;
  const match = typeof header === "string" ? BEARER_RE.exec(header) : null;
  const result = match?.[1]
    ? verifyOwnerToken(match[1], secret, Math.floor(now().getTime() / 1000))
    : null;
  if (!result?.ok) {
    await reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  return result.claims.sub;
}
