// Owner session cookie (spec-04). The JWT lives only in this httpOnly cookie
// on the Vercel domain; it is never returned to browser JavaScript.

export const SESSION_COOKIE = "ap_session";
const TOKEN_RE = /^[A-Za-z0-9._-]{1,4096}$/;
const ATTRS = "Path=/; HttpOnly; Secure; SameSite=Lax";

export function isTokenShaped(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export function sessionCookie(token: string, expiresAt: Date): string {
  if (!isTokenShaped(token)) throw new Error("invalid session token");
  return `${SESSION_COOKIE}=${token}; ${ATTRS}; Expires=${expiresAt.toUTCString()}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${ATTRS}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function readSession(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(i + 1).trim();
    return isTokenShaped(value) ? value : null;
  }
  return null;
}
