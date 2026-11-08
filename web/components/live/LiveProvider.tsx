"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { owner } from "../../lib/client/api";
import { getPublicEnv } from "../../lib/publicEnv";
import {
  LiveConnection,
  type EventSourceLike,
  type LiveEvent,
  type LiveStatus,
} from "../../lib/live/connection";

interface LiveState {
  status: LiveStatus;
  events: LiveEvent[];
  /** Bumped on every event and every fallback poll tick; pages refetch on change. */
  version: number;
}

const LiveContext = createContext<LiveState>({
  status: "connecting",
  events: [],
  version: 0,
});
const MAX_EVENTS = 100;

export function LiveProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const conn = new LiveConnection({
      baseUrl: getPublicEnv().apiBaseUrl,
      getToken: async () => {
        const r = await owner<{ streamToken?: string }>("events/token", {
          method: "POST",
          body: {},
        });
        return r.ok && typeof r.data.streamToken === "string"
          ? r.data.streamToken
          : null;
      },
      // No credentials: the stream token in the URL is the only auth.
      // EventSource matches EventSourceLike at runtime; DOM listener types are just wider.
      createSource: (url) => new EventSource(url) as unknown as EventSourceLike,
      timers: {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id),
        setInterval: (fn, ms) => setInterval(fn, ms),
        clearInterval: (id) => clearInterval(id),
      },
      onStatus: setStatus,
      onEvent: (e) => {
        setEvents((prev) => [e, ...prev].slice(0, MAX_EVENTS));
        setVersion((v) => v + 1);
      },
      onPoll: () => setVersion((v) => v + 1),
    });
    conn.start();
    return () => conn.stop();
  }, []);

  const value = useMemo(
    () => ({ status, events, version }),
    [status, events, version]
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveState {
  return useContext(LiveContext);
}

const LABELS: Record<LiveStatus, string> = {
  connecting: "Connecting",
  live: "Connected",
  reconnecting: "Reconnecting",
  offline: "Offline",
};

const TONES: Record<LiveStatus, string> = {
  connecting: "tone-warning",
  live: "tone-success",
  reconnecting: "tone-warning",
  offline: "tone-danger",
};

export function LiveStatusPill() {
  const { status } = useLive();
  return (
    <p
      className={`live-pill pill-${status} ${TONES[status]}`}
      role="status"
      aria-live="polite"
    >
      <span className="dot" aria-hidden="true" />
      {LABELS[status]}
      {status === "offline" ? (
        <span className="live-pill-label-long"> (polling every 2s)</span>
      ) : null}
    </p>
  );
}
