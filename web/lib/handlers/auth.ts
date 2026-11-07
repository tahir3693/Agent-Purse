// POST /api/auth/login and /api/auth/logout (BFF). The owner JWT is stored in
// the httpOnly session cookie and never appears in a response body.
import { envErrorMessage } from "../env";
import {
  fetchWithTimeout,
  isJsonRequest,
  isSameOrigin,
  json,
  type Deps,
} from "../http";
import { clearSessionCookie, isTokenShaped, sessionCookie } from "../session";

const GENERIC: Record<number, string> = {
  400: "Invalid request",
  401: "Invalid email or password",
  429: "Too many attempts, try again later",
};

export async function handleLogin(req: Request, deps: Deps): Promise<Response> {
  if (!isSameOrigin(req)) return json({ ok: false, error: "forbidden" }, 403);
  if (!isJsonRequest(req))
    return json({ ok: false, error: "unsupported_media_type" }, 415);
  const env = deps.env();
  if (!env.ok)
    return json(
      { ok: false, error: envErrorMessage(env.missing, env.invalid) },
      500
    );

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: GENERIC[400] }, 400);
  }
  const { email, password } = (body ?? {}) as {
    email?: unknown;
    password?: unknown;
  };
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length === 0 ||
    email.length > 254 ||
    password.length === 0 ||
    password.length > 256
  ) {
    return json({ ok: false, error: GENERIC[400] }, 400);
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(
      deps.fetch,
      `${env.apiBaseUrl}/auth/login`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ email, password }),
      },
      deps.timeoutMs
    );
  } catch {
    return json({ ok: false, error: "Sign-in service unavailable" }, 502);
  }

  if (!res.ok) {
    const status =
      res.status === 400 || res.status === 401 || res.status === 429
        ? res.status
        : 502;
    // 400 from the API only means the body shape was rejected; keep it generic.
    return json(
      { ok: false, error: GENERIC[status] ?? "Sign-in service unavailable" },
      status
    );
  }

  let data: { ownerId?: unknown; accessToken?: unknown; expiresAt?: unknown };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return json({ ok: false, error: "Sign-in service unavailable" }, 502);
  }
  const expiresAt =
    typeof data.expiresAt === "string" ? new Date(data.expiresAt) : null;
  if (
    !isTokenShaped(data.accessToken) ||
    typeof data.ownerId !== "string" ||
    !expiresAt ||
    Number.isNaN(expiresAt.getTime())
  ) {
    return json({ ok: false, error: "Sign-in service unavailable" }, 502);
  }

  return json(
    { ok: true, ownerId: data.ownerId, expiresAt: expiresAt.toISOString() },
    200,
    { "set-cookie": sessionCookie(data.accessToken, expiresAt) }
  );
}

export function handleLogout(req: Request): Response {
  if (!isSameOrigin(req)) return json({ ok: false, error: "forbidden" }, 403);
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
}
