// Offline test helpers: a recording fake fetch and fixed env. No live calls.
import type { ServerEnv } from "../env";
import type { Deps } from "../http";

export const API = "https://api.test.invalid";
export const TOKEN = "test-only-header.test-only-payload.test-only-signature";

export interface Call {
  url: string;
  init: RequestInit;
}

export function fakeFetch(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>
) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return respond(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

export function deps(
  fetchFn: typeof fetch,
  env: ServerEnv = { ok: true, apiBaseUrl: API }
): Deps {
  return { fetch: fetchFn, env: () => env, timeoutMs: 1000 };
}

export const MISSING: ServerEnv = { ok: false, missing: "API_BASE_URL" };

export function req(
  path: string,
  init: RequestInit & { cookie?: string | null } = {}
): Request {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(`https://web.test.invalid${path}`, { ...init, headers });
}

export const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
