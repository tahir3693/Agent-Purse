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
import { StatusPill } from "../ui/Badge";
import { Button } from "../ui/Button";
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
  return <div className="apw">{children}</div>;
}

function Status({ snap }: { snap: StudioSnapshot }) {
  if (snap.error)
    return (
      <p role="alert" className="error-text">
        Could not load data: {snap.error}
      </p>
    );
  if (!snap.loaded)
    return (
      <p className="muted" role="status">
        Loading
      </p>
    );
  return null;
}

/** Round the axis maximum up to a tidy value (integer cents, 4 intervals). */
export function niceAxis(maxCents: number): { step: number; top: number } {
  const raw = Math.max(1, Math.ceil(maxCents / 4));
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const whole = Math.max(1, Math.ceil(step));
  return { step: whole, top: whole * 4 };
}

export function SpendPerDayWidget(params: Params) {
  const snap = useStore(params);
  const all = spendPerDay(snap.intents);
  // One axis needs one currency: chart the currency with the most captured spend.
  const totals = new Map<string, number>();
  for (const d of all)
    totals.set(d.currency, (totals.get(d.currency) ?? 0) + d.amountCents);
  const currency = [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const days = all.filter((d) => d.currency === currency).slice(-14);
  const { step, top } = niceAxis(
    Math.max(0, ...days.map((d) => d.amountCents))
  );
  const ticks = [4, 3, 2, 1, 0].map((i) => i * step);
  return (
    <Shell>
      <Status snap={snap} />
      {snap.loaded && !snap.error && days.length === 0 ? (
        <p className="muted">No captured spend yet.</p>
      ) : null}
      {days.length > 0 && currency ? (
        <figure className="apw-chart" aria-label="Captured spend per day">
          <figcaption className="apw-axis-title">
            Captured spend ({currency})
          </figcaption>
          <div className="apw-plot">
            <div className="apw-yaxis" aria-hidden="true">
              {ticks.map((t) => (
                <span key={t}>
                  {formatMoney({ amountCents: t, currency }).replace(
                    /\.00$/,
                    ""
                  )}
                </span>
              ))}
            </div>
            <div className="apw-area">
              <div className="apw-grid" aria-hidden="true">
                {ticks.map((t) => (
                  <span key={t} />
                ))}
              </div>
              <ul className="apw-cols">
                {days.map((d) => {
                  const text = formatMoney(d);
                  return (
                    <li
                      key={`${d.day}-${d.currency}`}
                      tabIndex={0}
                      aria-label={`${d.day}: ${text}`}
                    >
                      <span
                        className="apw-col"
                        aria-hidden="true"
                        style={{
                          height: `${Math.max(2, Math.round((d.amountCents * 100) / top))}%`,
                        }}
                      />
                      <span className="apw-tip" role="tooltip">
                        <strong>{text}</strong>
                        <span>{d.day}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <div className="apw-xaxis" aria-hidden="true">
            <span />
            <ul>
              {days.map((d) => (
                <li key={`${d.day}-${d.currency}`}>{d.day.slice(5)}</li>
              ))}
            </ul>
          </div>
          <p className="apw-axis-title apw-xtitle">Day (UTC, MM-DD)</p>
        </figure>
      ) : null}
    </Shell>
  );
}

export function DecisionsWidget(params: Params) {
  const snap = useStore(params);
  const c = decisionBreakdown(snap.intents);
  const total = c.approved + c.escalated + c.denied;
  const rows: [string, number, string][] = [
    ["Approved", c.approved, "approved"],
    ["Escalated", c.escalated, "escalated"],
    ["Denied", c.denied, "denied"],
  ];
  return (
    <Shell>
      <Status snap={snap} />
      <ul className="apw-dec" aria-label="Decisions in the latest 200 intents">
        {rows.map(([label, n, status]) => {
          const pct = total === 0 ? 0 : Math.round((n * 100) / total);
          return (
            <li key={label} data-status={status}>
              <StatusPill status={status} label={label} />
              <span className="apw-dec-count">{n}</span>
              <span className="apw-dec-track" aria-hidden="true">
                <span style={{ width: `${pct}%` }} />
              </span>
              <span className="apw-dec-pct">{pct}%</span>
            </li>
          );
        })}
      </ul>
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
      <ul className="apw-queue" aria-label="Escalated intents">
        {snap.escalated.map((i) => {
          const err = snap.decisionErrors[i.id];
          return (
            <li key={i.id} className="apw-card">
              <div className="apw-card-top">
                <strong className="apw-amount">
                  {formatMoney({
                    amountCents: i.amountCents,
                    currency: i.currency,
                  })}
                </strong>
                <span className="apw-payee">to {i.payee}</span>
              </div>
              <p className="apw-desc" title={i.description}>
                {i.description.slice(0, 160)}
              </p>
              <div className="apw-actions">
                <Button
                  variant="success"
                  size="sm"
                  onClick={() => void store?.decide(i.id, "approve")}
                  aria-describedby={err ? `q-err-${i.id}` : undefined}
                >
                  Approve
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void store?.decide(i.id, "deny")}
                >
                  Deny
                </Button>
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

// Static, trusted SVG strings for the Compose panel's widget list (AgCustomIcon).
const icon = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON_SPEND = icon(
  '<path d="M4 20h16"/><rect x="5" y="11" width="3.5" height="9"/><rect x="10.25" y="5" width="3.5" height="15"/><rect x="15.5" y="14" width="3.5" height="6"/>'
);
const ICON_DECISIONS = icon(
  '<path d="M4 7h10"/><path d="M4 12h16"/><path d="M4 17h7"/>'
);
const ICON_QUEUE = icon(
  '<rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/>'
);
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
    icon: ICON_SPEND,
    form: titleOnlyForm,
    comp: SpendPerDayWidget,
    defaultSize: { width: 480, height: 280 },
    minSize: { width: 240, height: 160 },
  },
  {
    id: "ap-decisions",
    label: "Decisions",
    icon: ICON_DECISIONS,
    form: titleOnlyForm,
    comp: DecisionsWidget,
    defaultSize: { width: 320, height: 240 },
    minSize: { width: 200, height: 140 },
  },
  {
    id: "ap-escalation-queue",
    label: "Escalation queue",
    icon: ICON_QUEUE,
    form: titleOnlyForm,
    comp: EscalationQueueWidget,
    defaultSize: { width: 640, height: 320 },
    minSize: { width: 280, height: 160 },
  },
] as const;
