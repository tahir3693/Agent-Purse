// Live feed client (spec-09a). Pure, dependency-injected so it is testable
// with fake timers. Opens the SSE stream directly on the Render API with a
// short-lived stream token from the BFF; a NEW token is fetched for every
// attempt. Backoff 1s doubling, capped at 30s; after 3 consecutive failures
// it also polls every 2s until a stream opens again.

export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline";

export const LIVE_EVENT_TYPES = [
  "intent.created",
  "intent.decided",
  "intent.authorized",
  "intent.captured",
  "intent.denied",
] as const;
export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

export interface LiveEvent {
  type: LiveEventType;
  intentId: string;
  agentId: string;
  state?: string;
  decision?: string;
  at: string;
}

export interface EventSourceLike {
  onopen: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  addEventListener(
    type: string,
    listener: (ev: { data: string }) => void
  ): void;
  close(): void;
}

type TimerId = ReturnType<typeof setTimeout>;

export interface LiveDeps {
  getToken(): Promise<string | null>;
  createSource(url: string): EventSourceLike;
  baseUrl: string | null;
  timers: {
    setTimeout(fn: () => void, ms: number): TimerId;
    clearTimeout(id: TimerId): void;
    setInterval(fn: () => void, ms: number): TimerId;
    clearInterval(id: TimerId): void;
  };
  onStatus(s: LiveStatus): void;
  onEvent(e: LiveEvent): void;
  onPoll(): void;
}

export const BASE_DELAY_MS = 1_000;
export const MAX_DELAY_MS = 30_000;
export const POLL_MS = 2_000;
export const POLL_AFTER_FAILURES = 3;

/** Delay before reconnect attempt n (n >= 1). */
export function backoffDelay(n: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** Math.max(0, n - 1), MAX_DELAY_MS);
}

export function parseLiveEvent(type: string, data: string): LiveEvent | null {
  if (!(LIVE_EVENT_TYPES as readonly string[]).includes(type)) return null;
  try {
    const v = JSON.parse(data) as Partial<LiveEvent>;
    if (typeof v.intentId !== "string" || typeof v.agentId !== "string")
      return null;
    return {
      type: type as LiveEventType,
      intentId: v.intentId.slice(0, 128),
      agentId: v.agentId.slice(0, 128),
      ...(typeof v.state === "string" ? { state: v.state.slice(0, 32) } : {}),
      ...(typeof v.decision === "string"
        ? { decision: v.decision.slice(0, 32) }
        : {}),
      at:
        typeof v.at === "string"
          ? v.at.slice(0, 40)
          : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export class LiveConnection {
  private source: EventSourceLike | null = null;
  private failures = 0;
  private retryTimer: TimerId | null = null;
  private pollTimer: TimerId | null = null;
  private stopped = true;
  private status: LiveStatus | null = null;

  constructor(private readonly deps: LiveDeps) {}

  get currentStatus(): LiveStatus | null {
    return this.status;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.failures = 0;
    if (!this.deps.baseUrl) {
      this.setStatus("offline");
      this.startPolling();
      return;
    }
    this.setStatus("connecting");
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.closeSource();
    if (this.retryTimer !== null)
      this.deps.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.stopPolling();
  }

  private setStatus(s: LiveStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.deps.onStatus(s);
  }

  private closeSource(): void {
    const s = this.source;
    this.source = null;
    if (s) {
      s.onopen = null;
      s.onerror = null;
      s.close();
    }
  }

  private async connect(): Promise<void> {
    let token: string | null = null;
    try {
      token = await this.deps.getToken();
    } catch {
      token = null;
    }
    if (this.stopped) return;
    if (!token) return this.fail();

    const url = `${this.deps.baseUrl!.replace(/\/+$/, "")}/events?stream_token=${encodeURIComponent(token)}`;
    let src: EventSourceLike;
    try {
      src = this.deps.createSource(url);
    } catch {
      return this.fail();
    }
    this.source = src;
    src.onopen = () => {
      if (this.source !== src || this.stopped) return;
      this.failures = 0;
      this.stopPolling();
      this.setStatus("live");
    };
    src.onerror = () => {
      if (this.source !== src || this.stopped) return;
      // The token is single-connection and short-lived: never let the browser
      // retry with it. Close and reconnect with a fresh token.
      this.closeSource();
      this.fail();
    };
    for (const type of LIVE_EVENT_TYPES) {
      src.addEventListener(type, (ev) => {
        if (this.source !== src || this.stopped) return;
        const e = parseLiveEvent(type, ev.data);
        if (e) this.deps.onEvent(e);
      });
    }
  }

  private fail(): void {
    if (this.stopped) return;
    this.failures++;
    if (this.failures >= POLL_AFTER_FAILURES) {
      this.startPolling();
      this.setStatus("offline");
    } else {
      this.setStatus("reconnecting");
    }
    const delay = backoffDelay(this.failures);
    this.retryTimer = this.deps.timers.setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = this.deps.timers.setInterval(
      () => this.deps.onPoll(),
      POLL_MS
    );
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) this.deps.timers.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
}
