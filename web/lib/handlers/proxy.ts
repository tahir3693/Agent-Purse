// /api/owner/[...path]: forwards allowlisted owner calls to the Render API
// with the session JWT as a Bearer token. Unknown paths never reach the API.
import { envErrorMessage } from "../env";
import {
  fetchWithTimeout,
  isJsonRequest,
  isSameOrigin,
  isTimeout,
  json,
  type Deps,
} from "../http";
import { clearSessionCookie, readSession } from "../session";

const SEG = "[A-Za-z0-9_-]+";
const r = (p: string) => new RegExp(`^${p.replaceAll(":id", SEG)}$`);

export const ALLOWLIST: Record<string, RegExp[]> = {
  GET: [
    "agents",
    "agents/:id/policy",
    "owner/intents",
    "owner/intents/:id",
    "owner/stats",
    "vault/methods",
  ].map(r),
  POST: [
    "agents",
    "agents/:id/kill",
    "agents/:id/restore",
    "intents/:id/approve",
    "intents/:id/deny",
    "events/token",
    "vault/link",
  ].map(r),
  PUT: ["agents/:id/policy"].map(r),
};

const SEGMENT_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_BODY_BYTES = 64 * 1024;

export function isAllowed(method: string, segments: string[]): boolean {
  if (segments.length === 0 || segments.length > 4) return false;
  if (!segments.every((s) => SEGMENT_RE.test(s))) return false;
  const path = segments.join("/");
  return (ALLOWLIST[method.toUpperCase()] ?? []).some((re) => re.test(path));
}

export async function handleProxy(
  req: Request,
  segments: string[],
  deps: Deps
): Promise<Response> {
  const method = req.method.toUpperCase();
  const token = readSession(req);
  if (!token) return json({ error: "unauthorized" }, 401);
  if (!isAllowed(method, segments)) return json({ error: "not_found" }, 404);

  const mutating = method !== "GET";
  if (mutating && !isSameOrigin(req)) return json({ error: "forbidden" }, 403);
  if (mutating && !isJsonRequest(req))
    return json({ error: "unsupported_media_type" }, 415);

  const env = deps.env();
  if (!env.ok)
    return json({ error: envErrorMessage(env.missing, env.invalid) }, 500);

  const path = segments.join("/");
  const query = path === "owner/intents" ? new URL(req.url).search : "";
  let body: string | undefined;
  if (mutating) {
    body = await req.text();
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES)
      return json({ error: "payload_too_large" }, 413);
    if (body.length === 0) body = "{}";
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(
      deps.fetch,
      `${env.apiBaseUrl}/${path}${query}`,
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(mutating ? { "content-type": "application/json" } : {}),
        },
        body,
      },
      deps.timeoutMs
    );
  } catch (err) {
    return json(
      { error: isTimeout(err) ? "upstream_timeout" : "upstream_unavailable" },
      502
    );
  }

  const text = await res.text().catch(() => "");
  const headers: Record<string, string> = {
    "content-type":
      res.headers.get("content-type") ?? "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  // Expired or revoked session: drop the cookie so the UI can send the owner to /login.
  if (res.status === 401) headers["set-cookie"] = clearSessionCookie();
  return new Response(text, { status: res.status, headers });
}
