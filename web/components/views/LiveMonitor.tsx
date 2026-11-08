"use client";

import { Radio } from "lucide-react";
import { useLive } from "../live/LiveProvider";
import { StatusPill } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";

export const EVENT_LABEL: Record<string, string> = {
  "intent.created": "Intent created",
  "intent.decided": "Risk Guard decided",
  "intent.authorized": "Hold authorized",
  "intent.captured": "Payment captured",
  "intent.denied": "Intent denied",
};

const EVENT_TONE: Record<string, string> = {
  "intent.created": "tone-info",
  "intent.decided": "tone-brand",
  "intent.authorized": "tone-info",
  "intent.captured": "tone-success",
  "intent.denied": "tone-danger",
};

const STATUS_WORD = {
  connecting: "Connecting",
  live: "Connected",
  reconnecting: "Reconnecting",
  offline: "Offline",
} as const;

export function LiveMonitor() {
  const { status, events } = useLive();
  return (
    <div className="stack">
      <PageHeader
        title="Live monitor"
        description={
          <>
            Stream status: <strong>{STATUS_WORD[status]}</strong> ({status}).
            Events stream directly from the API with a short-lived token. If the
            stream keeps failing, the dashboard polls every 2 seconds.
          </>
        }
      />
      {events.length === 0 ? (
        <EmptyState icon={Radio} title="Waiting for events">
          New purchase requests, decisions and payments show up here the moment
          they happen.
        </EmptyState>
      ) : null}
      <ol className="timeline" aria-label="Recent events" aria-live="polite">
        {events.map((e, i) => (
          <li
            className={`tl-item ${EVENT_TONE[e.type] ?? "tone-neutral"}`}
            key={`${e.intentId}-${e.type}-${e.at}-${i}`}
          >
            <span className="tl-dot" aria-hidden="true" />
            <div className="tl-body">
              <div className="row">
                <strong>{EVENT_LABEL[e.type] ?? e.type}</strong>
                {e.state ? <StatusPill status={e.state} /> : null}
                {e.decision ? <StatusPill status={e.decision} /> : null}
                <span className="muted num">
                  {new Date(e.at).toLocaleTimeString()}
                </span>
              </div>
              <p className="muted plain">
                Intent {e.intentId}, agent {e.agentId}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
