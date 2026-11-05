// A fixture-backed fake `fetch` for PayPal client/webhook tests.
//
// No live network: each request is matched by (method, URL suffix) against a
// list of routes and answered with a real `Response` built from fixture JSON.
// Every call is recorded so a test can assert the request body and headers
// (e.g. amount.value === "12.34", PayPal-Request-Id). Unmatched requests throw
// so a test can never silently pass against a wrong URL/method.

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** The request body as a string (empty when none was sent). */
  body: string;
  /** The parsed JSON body, or undefined when the body was empty/non-JSON. */
  json: unknown;
}

export interface FakeRoute {
  method: "GET" | "POST";
  /** Matched with String.prototype.endsWith against the request URL. */
  urlEndsWith: string;
  status?: number;
  /** JSON body to return; omit (with no `text`) for an empty body (e.g. 204). */
  body?: unknown;
  /** Raw text body (overrides `body`); use for empty/non-JSON responses. */
  text?: string;
  headers?: Record<string, string>;
}

export interface FakeFetch {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /** All requests seen, in order. */
  readonly calls: RecordedRequest[];
}

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url;
}

function headersToObject(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init?.headers;
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
  } else if (Array.isArray(h)) {
    for (const [key, value] of h) out[key.toLowerCase()] = value;
  } else {
    for (const [key, value] of Object.entries(h)) {
      out[key.toLowerCase()] = String(value);
    }
  }
  return out;
}

/**
 * Build a fake fetch that answers from `routes` by (method, url-suffix).
 *
 * The returned function carries a `.calls` array recording every request
 * (method, url, lowercased headers, raw body string, parsed JSON). An
 * unmatched request rejects, so a test cannot pass against a wrong endpoint.
 */
export function makeFakeFetch(routes: FakeRoute[]): FakeFetch {
  const calls: RecordedRequest[] = [];

  const fn = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = toUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = headersToObject(init);
    const body = typeof init?.body === "string" ? init.body : "";

    let json: unknown;
    if (body.trim() !== "") {
      try {
        json = JSON.parse(body);
      } catch {
        json = undefined;
      }
    }

    calls.push({ method, url, headers, body, json });

    const route = routes.find(
      (r) => r.method === method && url.endsWith(r.urlEndsWith),
    );
    if (!route) {
      throw new Error(`fakeFetch: no route for ${method} ${url}`);
    }

    const status = route.status ?? 200;
    const payload =
      route.text !== undefined
        ? route.text
        : route.body === undefined
          ? ""
          : JSON.stringify(route.body);

    return new Response(payload, {
      status,
      headers: route.headers ?? { "content-type": "application/json" },
    });
  }) as FakeFetch;

  Object.defineProperty(fn, "calls", { get: () => calls });
  return fn;
}
