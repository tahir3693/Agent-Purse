"use client";

import { useLive } from "../live/LiveProvider";

const LABEL: Record<string, string> = {
  "intent.created": "Intent created",
  "intent.decided": "Risk Guard decided",
  "intent.authorized": "Hold authorized",
  "intent.captured": "Payment captured",
  "intent.denied": "Intent denied",
};

export function LiveMonitor() {
  const { status, events } = useLive();
  return (
    <div className="stack">
      <h1>Live monitor</h1>
      <p className="muted">
        Stream status: <strong>{status}</strong>. Events stream directly from
        the API with a short-lived token. If the stream keeps failing, the
        dashboard polls every 2 seconds.
      </p>
      <ol className="list" aria-label="Recent events" aria-live="polite">
        {events.length === 0 ? (
          <li className="muted">Waiting for events.</li>
        ) : null}
        {events.map((e, i) => (
          <li className="card" key={`${e.intentId}-${e.type}-${e.at}-${i}`}>
            <div className="row">
              <strong>{LABEL[e.type] ?? e.type}</strong>
              {e.state ? (
                <span className={`badge badge-${e.state}`}>{e.state}</span>
              ) : null}
              {e.decision ? <span className="badge">{e.decision}</span> : null}
              <span className="muted">
                {new Date(e.at).toLocaleTimeString()}
              </span>
            </div>
            <p className="muted plain">
              Intent {e.intentId}, agent {e.agentId}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
