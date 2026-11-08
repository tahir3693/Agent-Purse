// Browser-side fetch helpers. Every call goes to this app's BFF (/api/...);
// the browser never holds the owner JWT or any API secret.

export type ApiOk<T> = { ok: true; status: number; data: T };
export type ApiErr = {
  ok: false;
  status: number;
  error: string;
  message: string;
  fields?: Record<string, string>;
};
export type ApiResult<T> = ApiOk<T> | ApiErr;

let onUnauthorized: () => void = () => {
  if (typeof window !== "undefined") window.location.assign("/login");
};

/** Test hook. */
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export function errorMessage(status: number, body: unknown): string {
  const b = (body ?? {}) as { message?: unknown; error?: unknown };
  if (typeof b.message === "string" && b.message)
    return b.message.slice(0, 200);
  if (typeof b.error === "string" && b.error) return b.error.slice(0, 200);
  if (status === 0)
    return "Network error. Check your connection and try again.";
  return `Request failed (${status})`;
}

export async function request<T>(
  url: string,
  init: { method?: string; body?: unknown } = {},
  fetchImpl: typeof fetch = (i, o) => fetch(i, o)
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: init.method ?? "GET",
      headers:
        init.body !== undefined
          ? { "content-type": "application/json" }
          : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: "network",
      message: errorMessage(0, null),
    };
  }
  const data = (await res.json().catch(() => ({}))) as unknown;
  if (res.ok) return { ok: true, status: res.status, data: data as T };
  if (res.status === 401 && url.startsWith("/api/owner/")) onUnauthorized();
  const d = (data ?? {}) as { error?: unknown; fields?: unknown };
  return {
    ok: false,
    status: res.status,
    error: typeof d.error === "string" ? d.error : "error",
    message: errorMessage(res.status, data),
    ...(d.fields && typeof d.fields === "object" && !Array.isArray(d.fields)
      ? { fields: d.fields as Record<string, string> }
      : {}),
  };
}

/** Owner API call through the allowlisted proxy, e.g. owner("owner/stats"). */
export function owner<T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
) {
  return request<T>(`/api/owner/${path}`, init);
}
