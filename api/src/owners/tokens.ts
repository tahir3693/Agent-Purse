// Owner JWT issuance (HS256, JWT_SECRET). Verified by vault/auth.ts.
// Access tokens: no `scp`. Stream tokens: scp "sse", 60 seconds.

import { createHmac, randomUUID } from "node:crypto";

export const ACCESS_TTL_SECONDS = 3600;
export const STREAM_TTL_SECONDS = 60;
export const STREAM_SCOPE = "sse";

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");

function sign(claims: Record<string, unknown>, secret: string): string {
  if (!secret) throw new Error("JWT secret is required");
  const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

function issue(
  ownerId: string,
  secret: string,
  now: Date,
  ttl: number,
  extra: Record<string, unknown> = {},
): IssuedToken {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ttl;
  return { token: sign({ sub: ownerId, iat, exp, jti: randomUUID(), ...extra }, secret), expiresAt: new Date(exp * 1000) };
}

export function signOwnerToken(ownerId: string, secret: string, now: Date): IssuedToken {
  return issue(ownerId, secret, now, ACCESS_TTL_SECONDS);
}

export function signStreamToken(ownerId: string, secret: string, now: Date): IssuedToken {
  return issue(ownerId, secret, now, STREAM_TTL_SECONDS, { scp: STREAM_SCOPE });
}