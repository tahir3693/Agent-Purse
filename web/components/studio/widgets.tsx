"use client";

// AgentPurse custom AG Studio widgets (spec-09b). They read the owner store
// passed through the Studio `context` property; all text renders as React
// text nodes, never HTML. Amounts are integer cents formatted for display.
import type {
  AgWidgetData,
  AgWidgetDataFormat,
  AgWidgetFormParams,
  AgWidgetParams,
} from "ag-studio";
import type { AgWidgetDefinition } from "ag-studio-react";
import { useSyncExternalStore } from "react";

import { formatMoney } from "../../lib/money";
import { decisionBreakdown, spendPerDay } from "../../lib/studio/aggregate";
import type { OwnerStore, StudioSnapshot } from "../../lib/studio/ownerStore";

export interface StudioContext {
  store: OwnerStore;
}

type NoMapping = AgWidgetData<
  Record<string, never>,
  AgWidgetDataFormat<Record<string, never>>
>;
type Params = AgWidgetParams<NoMapping, unknown, StudioContext>;

const EMPTY: StudioSnapshot = {
  stats: null,
  intents: [],
  escalated: [],
  error: null,
  decisionErrors: {},
  loaded: false,
};
const noop = () => () => undefined;

function useStore(params: Params): StudioSnapshot {
  const store = params.context?.store;
  return useSyncExternalStore(
    store?.subscribe ?? noop,
    store?.getSnapshot ?? (() => EMPTY),
    () => EMPTY
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="ap-widget">{children}</div>;
}

function Status({ snap }: { snap: StudioSnapshot }) {
  if (snap.error)
    return (
      <p role="alert" className="error-text">
        Could not load data: {snap.error}
      </p>
    );
  if (!snap.loaded) return <p className="muted">Loading</p>;
  return null;
}

export function SpendPerDayWidget(params: Params) {
  const snap = useStore(params);
  const days = spendPerDay(snap.intents).slice(-14);
  const max = Math.max(1, ...days.map((d) => d.amountCents));
  return (
    <Shell>
      <Status snap={snap} />
      {snap.loaded && !snap.error && days.length === 0 ? (
        <p className="muted">No captured spend yet.</p>
      ) : null}
      <ul className="ap-bars" aria-label="Captured spend per day">
        {days.map((d) => (
          <li key={`${d.day}-${d.currency}`}>
            <span className="ap-bar-label">{d.day}</span>
            <span className="ap-bar-track" aria-hidden="true">
              <span
                className="ap-bar"
                style={{
                  width: `${Math.max(2, Math.round((d.amountCents * 100) / max))}%`,
                }}
              />
            </span>
            <span className="ap-bar-value">{formatMoney(d)}</span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

export function DecisionsWidget(params: Params) {
  const snap = useStore(params);
  const c = decisionBreakdown(snap.intents);
  const rows: [string, number, string][] = [
    ["Approved", c.approved, "badge-ok"],
    ["Escalated", c.escalated, "badge-escalated"],
    ["Denied", c.denied, "badge-denied"],
  ];
  return (
    <Shell>
      <Status snap={snap} />
      <dl
        className="ap-decisions"
        aria-label="Decisions in the latest 200 intents"
      >
        {rows.map(([label, n, cls]) => (
          <div key={label}>
            <dt>
              <span className={`badge ${cls}`}>{label}</span>
            </dt>
            <dd>{n}</dd>
          </div>
        ))}
      </dl>
    </Shell>
  );
}

export function EscalationQueueWidget(params: Params) {
  const snap = useStore(params);
  const store = params.context?.store;
  return (
    <Shell>
      <Status snap={snap} />
      {snap.loaded && !snap.error && snap.escalated.length === 0 ? (
        <p className="muted">Nothing waiting for approval.</p>
      ) : null}
      <ul className="list" aria-label="Escalated intents">
        {snap.escalated.map((i) => {
          const err = snap.decisionErrors[i.id];
          return (
            <li key={i.id} className="ap-queue-item">
              <div className="row">
                <strong>
                  {formatMoney({
                    amountCents: i.amountCents,
                    currency: i.currency,
                  })}
                </strong>
                <span className="plain">to {i.payee}</span>
                <span className="muted plain">
                  {i.description.slice(0, 120)}
                </span>
              </div>
              <div className="row">
                <button
                  type="button"
                  onClick={() => void store?.decide(i.id, "approve")}
                  aria-describedby={err ? `q-err-${i.id}` : undefined}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => void store?.decide(i.id, "deny")}
                >
                  Deny
                </button>
              </div>
              {err ? (
                <p id={`q-err-${i.id}`} role="alert" className="error-text">
                  {err}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}

const titleOnlyForm = (p: AgWidgetFormParams<NoMapping>) =>
  ({
    type: "tab-group",
    key: "root",
    items: [
      {
        type: "tab",
        key: "format",
        label: "Format",
        items: [p.createTitleSection()],
      },
    ],
  }) as ReturnType<AgWidgetDefinition<string, NoMapping>["form"]>;

export type SpendDef = AgWidgetDefinition<"ap-spend-per-day", NoMapping>;
export type DecisionsDef = AgWidgetDefinition<"ap-decisions", NoMapping>;
export type QueueDef = AgWidgetDefinition<"ap-escalation-queue", NoMapping>;

export const AP_WIDGETS = [
  {
    id: "ap-spend-per-day",
    label: "Spend per day",
    form: titleOnlyForm,
    comp: SpendPerDayWidget,
    defaultSize: { width: 480, height: 280 },
    minSize: { width: 240, height: 160 },
  },
  {
    id: "ap-decisions",
    label: "Decisions",
    form: titleOnlyForm,
    comp: DecisionsWidget,
    defaultSize: { width: 320, height: 240 },
    minSize: { width: 200, height: 140 },
  },
  {
    id: "ap-escalation-queue",
    label: "Escalation queue",
    form: titleOnlyForm,
    comp: EscalationQueueWidget,
    defaultSize: { width: 640, height: 320 },
    minSize: { width: 280, height: 160 },
  },
] as const;
