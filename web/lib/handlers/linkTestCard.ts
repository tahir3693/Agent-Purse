// POST /api/vault/link-test-card (BFF). Links the Braintree sandbox test card.
// The nonce is fixed server-side; ownerId comes from the session JWT's `sub`
// (decoded, not verified here; the API verifies the token).
import { envErrorMessage } from "../env";
import {
  fetchWithTimeout,
  isSameOrigin,
  isTimeout,
  json,
  type Deps,
} from "../http";
import { clearSessionCookie, readSession } from "../session";

export const SANDBOX_TEST_NONCE = "fake-valid-nonce";

export function subjectOf(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(part, "base64url").toString("utf8")
    ) as { sub?: unknown };
    return typeof claims.sub === "string" &&
      claims.sub.length > 0 &&
      claims.sub.length <= 128
      ? claims.sub
      : null;
  } catch {
    return null;
  }
}

export async function handleLinkTestCard(
  req: Request,
  deps: Deps
): Promise<Response> {
  const token = readSession(req);
  if (!token) return json({ error: "unauthorized" }, 401);
  if (!isSameOrigin(req)) return json({ error: "forbidden" }, 403);
  const ownerId = subjectOf(token);
  if (!ownerId)
    return json({ error: "unauthorized" }, 401, {
      "set-cookie": clearSessionCookie(),
    });
  const env = deps.env();
  if (!env.ok)
    return json({ error: envErrorMessage(env.missing, env.invalid) }, 500);

  let res: Response;
  try {
    res = await fetchWithTimeout(
      deps.fetch,
      `${env.apiBaseUrl}/vault/link`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ ownerId, nonce: SANDBOX_TEST_NONCE }),
      },
      deps.timeoutMs
    );
  } catch (err) {
    return json(
      { error: isTimeout(err) ? "upstream_timeout" : "upstream_unavailable" },
      502
    );
  }
  const data = (await res.json().catch(() => ({}))) as {
    method?: unknown;
    error?: unknown;
    message?: unknown;
  };
  if (res.ok) return json({ method: data.method ?? null }, res.status);
  const headers =
    res.status === 401 ? { "set-cookie": clearSessionCookie() } : undefined;
  return json(
    {
      error: typeof data.error === "string" ? data.error : "link_failed",
      message:
        typeof data.message === "string"
          ? data.message.slice(0, 200)
          : "Could not link the test card",
    },
    res.status >= 400 && res.status < 600 ? res.status : 502,
    headers
  );
}
