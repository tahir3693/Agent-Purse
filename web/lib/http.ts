// Small Web-standard helpers shared by the BFF handlers.

/** Render cold starts can take close to a minute; route maxDuration is 60s. */
export const UPSTREAM_TIMEOUT_MS = 55_000;

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs = UPSTREAM_TIMEOUT_MS
): Promise<Response> {
  return fetchImpl(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export function isTimeout(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  );
}

export function isJsonRequest(req: Request): boolean {
  return (req.headers.get("content-type") ?? "")
    .toLowerCase()
    .startsWith("application/json");
}

/** CSRF defense on top of SameSite=Lax: a present Origin must match the host. */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    new URL(req.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export interface Deps {
  fetch: typeof fetch;
  env: () => import("./env").ServerEnv;
  timeoutMs?: number;
}
