// AgentPurse agent API client (Bearer agent key). Returns {status, body};
// never throws on HTTP errors, never logs the key or request bodies.

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
  /** Set when the request never got an HTTP answer. */
  networkError?: "timeout" | "unreachable";
}

export interface CreateIntentBody {
  amountCents: number;
  currency: string;
  payee: string;
  category: string;
  description: string;
  justification: string;
  paymentMethodRef: string;
  productId?: string;
}

export interface AgentApi {
  createIntent(body: CreateIntentBody): Promise<ApiResult>;
  getIntent(id: string): Promise<ApiResult>;
  getMandate(id: string): Promise<ApiResult>;
  execute(id: string, mandateToken: string): Promise<ApiResult>;
}

/** Render free instances can take close to a minute to wake. */
const TIMEOUT_MS = 70_000;

export class HttpAgentApi implements AgentApi {
  constructor(
    private readonly baseUrl: string,
    private readonly agentKey: string,
    private readonly fetchImpl: typeof fetch = (i, init) => fetch(i, init),
    private readonly timeoutMs = TIMEOUT_MS
  ) {}

  private async call(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<ApiResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.agentKey}`,
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timeout =
        err instanceof Error &&
        (err.name === "TimeoutError" || err.name === "AbortError");
      return {
        status: 0,
        body: {},
        networkError: timeout ? "timeout" : "unreachable",
      };
    }
    let parsed: unknown = {};
    try {
      parsed = await res.json();
    } catch {
      parsed = {};
    }
    const obj =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return { status: res.status, body: obj };
  }

  createIntent(body: CreateIntentBody) {
    return this.call("POST", "/intents", body);
  }
  getIntent(id: string) {
    return this.call("GET", `/intents/${encodeURIComponent(id)}`);
  }
  getMandate(id: string) {
    return this.call("POST", `/intents/${encodeURIComponent(id)}/mandate`, {});
  }
  execute(id: string, mandateToken: string) {
    return this.call("POST", `/intents/${encodeURIComponent(id)}/execute`, {
      mandateToken,
    });
  }
}
