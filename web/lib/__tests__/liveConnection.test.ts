// LiveConnection reconnect logic with fake timers and a fake EventSource. Offline.
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LiveConnection,
  backoffDelay,
  parseLiveEvent,
  type EventSourceLike,
  type LiveStatus,
} from "../live/connection";

class FakeSource implements EventSourceLike {
  onopen: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  closed = false;
  listeners = new Map<string, (ev: { data: string }) => void>();
  constructor(readonly url: string) {}
  addEventListener(type: string, fn: (ev: { data: string }) => void) {
    this.listeners.set(type, fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) });
  }
}

function setup(
  opts: { baseUrl?: string | null; tokens?: Array<string | null> } = {}
) {
  const sources: FakeSource[] = [];
  const statuses: LiveStatus[] = [];
  const events: string[] = [];
  let polls = 0;
  let n = 0;
  const tokens: string[] = [];
  const conn = new LiveConnection({
    baseUrl:
      opts.baseUrl === undefined ? "https://api.test.invalid" : opts.baseUrl,
    getToken: async () => {
      const t = opts.tokens ? (opts.tokens[n] ?? null) : `tok-${n + 1}`;
      n++;
      if (t) tokens.push(t);
      return t;
    },
    createSource: (url) => {
      const s = new FakeSource(url);
      sources.push(s);
      return s;
    },
    timers: { setTimeout, clearTimeout, setInterval, clearInterval },
    onStatus: (s) => statuses.push(s),
    onEvent: (e) => events.push(`${e.type}:${e.intentId}`),
    onPoll: () => polls++,
  });
  return {
    conn,
    sources,
    statuses,
    events,
    tokens,
    polls: () => polls,
    tokenCalls: () => n,
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("LiveConnection", () => {
  it("connects with a stream token in the URL, goes live on open and delivers events", async () => {
    const t = setup();
    t.conn.start();
    await flush();
    expect(t.sources[0]?.url).toBe(
      "https://api.test.invalid/events?stream_token=tok-1"
    );
    t.sources[0]!.onopen?.();
    expect(t.statuses).toEqual(["connecting", "live"]);
    t.sources[0]!.emit("intent.created", {
      intentId: "i1",
      agentId: "a1",
      state: "pending",
      at: "x",
    });
    t.sources[0]!.emit("intent.bogus", { intentId: "i2", agentId: "a1" });
    expect(t.events).toEqual(["intent.created:i1"]);
  });

  it("backs off 1, 2, 4, 8, 16, 30, 30 seconds with a new token for every attempt", async () => {
    const t = setup();
    t.conn.start();
    await flush();
    const expected = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    for (const [i, delay] of expected.entries()) {
      t.sources[i]!.onerror?.();
      expect(t.sources[i]!.closed).toBe(true);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(t.sources).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.sources).toHaveLength(i + 2);
    }
    expect(new Set(t.tokens).size).toBe(t.tokens.length);
    expect(t.sources.map((s) => s.url.split("=")[1])).toEqual(t.tokens);
  });

  it("polls every 2s after 3 consecutive failures, reports offline, and stops polling once live", async () => {
    const t = setup({ tokens: [null, null, null, "tok-ok"] });
    t.conn.start();
    await flush();
    expect(t.statuses.at(-1)).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.statuses.at(-1)).toBe("offline");
    const before = t.polls();
    await vi.advanceTimersByTimeAsync(4000);
    expect(t.polls() - before).toBe(2);
    expect(t.sources).toHaveLength(1);
    t.sources[0]!.onopen?.();
    expect(t.statuses.at(-1)).toBe("live");
    const after = t.polls();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.polls()).toBe(after);
  });

  it("without NEXT_PUBLIC_API_BASE_URL it is offline and polls, never asking for a token", async () => {
    const t = setup({ baseUrl: null });
    t.conn.start();
    await vi.advanceTimersByTimeAsync(6000);
    expect(t.statuses).toEqual(["offline"]);
    expect(t.polls()).toBe(3);
    expect(t.tokenCalls()).toBe(0);
  });

  it("stop() closes the source and clears every timer", async () => {
    const t = setup({ tokens: [null, null, null, null] });
    t.conn.start();
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    t.conn.stop();
    const polls = t.polls();
    const calls = t.tokenCalls();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.polls()).toBe(polls);
    expect(t.tokenCalls()).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores malformed event data", () => {
    expect(parseLiveEvent("intent.created", "not json")).toBeNull();
    expect(
      parseLiveEvent("intent.created", JSON.stringify({ intentId: 1 }))
    ).toBeNull();
  });

  // Feature: spec-09a-dashboard, Property 1: backoff and fresh token
  it("Property 1: attempt n waits min(1000*2^(n-1), 30000) ms and uses a fresh token", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 9 }), async (failures) => {
        vi.clearAllTimers();
        const t = setup();
        t.conn.start();
        await flush();
        for (let i = 1; i <= failures; i++) {
          t.sources[i - 1]!.onerror?.();
          const d = backoffDelay(i);
          expect(d).toBe(Math.min(1000 * 2 ** (i - 1), 30000));
          await vi.advanceTimersByTimeAsync(d);
        }
        expect(t.sources).toHaveLength(failures + 1);
        expect(new Set(t.tokens).size).toBe(failures + 1);
        t.conn.stop();
      }),
      { numRuns: 30 }
    );
  });
});
