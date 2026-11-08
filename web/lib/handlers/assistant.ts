// POST /api/assistant (BFF, spec-09b). Forwards the conversation to the API's
// POST /assistant with the session JWT and streams the NDJSON reply back.
// No LLM key or provider call exists in the web app.
import { envErrorMessage } from "../env";
import {
  isJsonRequest,
  isSameOrigin,
  isTimeout,
  json,
  type Deps,
} from "../http";
import { clearSessionCookie, readSession } from "../session";

const MAX_BODY_BYTES = 64 * 1024;
const TIMEOUT_MS = 58_000;

export async function handleAssistant(
  req: Request,
  deps: Deps
): Promise<Response> {
  const token = readSession(req);
  if (!token) return json({ error: "unauthorized" }, 401);
  if (!isSameOrigin(req)) return json({ error: "forbidden" }, 403);
  if (!isJsonRequest(req))
    return json({ error: "unsupported_media_type" }, 415);
  const env = deps.env();
  if (!env.ok)
    return json({ error: envErrorMessage(env.missing, env.invalid) }, 500);

  const body = await req.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES)
    return json({ error: "payload_too_large" }, 413);

  let res: Response;
  try {
    res = await deps.fetch(`${env.apiBaseUrl}/assistant`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/x-ndjson",
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (err) {
    return json(
      { error: isTimeout(err) ? "upstream_timeout" : "upstream_unavailable" },
      502
    );
  }
  const headers: Record<string, string> = {
    "content-type":
      res.headers.get("content-type") ?? "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  };
  if (res.status === 401) headers["set-cookie"] = clearSessionCookie();
  // Stream the upstream body through unchanged.
  return new Response(res.body, { status: res.status, headers });
}
