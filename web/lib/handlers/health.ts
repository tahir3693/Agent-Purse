// GET /api/health: calls the Render API GET /healthz (cold start tolerant).
import { envErrorMessage } from "../env";
import { fetchWithTimeout, isTimeout, json, type Deps } from "../http";

export const BODY_SUMMARY_MAX = 200;

export async function handleHealth(
  _req: Request,
  deps: Deps
): Promise<Response> {
  const env = deps.env();
  if (!env.ok)
    return json(
      { ok: false, error: envErrorMessage(env.missing, env.invalid) },
      500
    );

  let res: Response;
  try {
    res = await fetchWithTimeout(
      deps.fetch,
      `${env.apiBaseUrl}/healthz`,
      { method: "GET" },
      deps.timeoutMs
    );
  } catch (err) {
    return json(
      { ok: false, reason: isTimeout(err) ? "timeout" : "unreachable" },
      502
    );
  }
  if (!res.ok)
    return json(
      { ok: false, reason: "upstream_error", upstreamStatus: res.status },
      502
    );

  let text = "";
  try {
    text = await res.text();
  } catch {
    // body unreadable; status alone is enough
  }
  return json(
    {
      ok: true,
      upstreamStatus: res.status,
      body: text.slice(0, BODY_SUMMARY_MAX),
    },
    200
  );
}
