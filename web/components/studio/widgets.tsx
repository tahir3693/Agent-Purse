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
import { useSyncExternalStore, type ReactNode } from "react";
import { formatMoney } from "../../lib/money";
import {
  decisionBreakdown,
  spendPerDay,
  type DaySpend,
} from "../../lib/studio/aggregate";
import type { OwnerStore, StudioSnapshot } from "../../lib/studio/ownerStore";
import { RiskMeter, StatusPill } from "../ui/Badge";
import { Button } from "../ui/Button";
import { SpendChart } from "./SpendChart";

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

function Shell({
  subtitle,
  children,
}: {
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="ap-widget">
      {subtitle ? <p className="ap-subtitle">{subtitle}</p> : null}
      {children}
    </div>
  );
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

function Empty({ children }: { children: ReactNode }) {
  return <p className="ap-empty">{children}</p>;
}

/** Days for the currency with the largest total, so one chart never mixes currencies. */
function chartDays(all: DaySpend[]): { days: DaySpend[]; currency: string } {
  const totals = new Map<string, number>();
  for (const d of all)
    totals.set(d.currency, (totals.get(d.currency) ?? 0) + d.amountCents);
  const currency =
    [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  return {
    currency,
    days: all.filter((d) => d.currency === currency).slice(-14),
  };
}

export function SpendPerDayWidget(params: Params) {
  const snap = useStore(params);
  const { days, currency } = chartDays(spendPerDay(snap.intents));
  const empty = snap.loaded && !snap.error && days.length === 0;
  return (
    <Shell subtitle={`Captured spend per day, ${currency}, last 14 days`}>
      <Status snap={snap} />
      {empty ? <Empty>No captured spend yet.</Empty> : null}
      {days.length > 0 ? (
        <>
          <SpendChart days={days} currency={currency} />
          <ul className="sr-only" aria-label="Captured spend per day">
            {days.map((d) => (
              <li key={`${d.day}-${d.currency}`}>
                {d.day}: {formatMoney(d)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Shell>
  );
}

export function DecisionsWidget(params: Params) {
  const snap = useStore(params);
  const c = decisionBreakdown(snap.intents);
  const total = c.approved + c.escalated + c.denied;
  const rows: [string, number, string, string][] = [
    ["Approved", c.approved, "approved", "tone-success"],
    ["Escalated", c.escalated, "escalated", "tone-warning"],
    ["Denied", c.denied, "denied", "tone-danger"],
  ];
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n * 100) / total));
  return (
    <Shell subtitle="Risk Guard outcomes, latest 200 intents">
      <Status snap={snap} />
      <dl
        className="ap-decisions"
        aria-label="Decisions in the latest 200 intents"
      >
        {rows.map(([label, n, status]) => (
          <div key={label} className="ap-decision">
            <dt>
              <StatusPill status={status} label={label} />
            </dt>
            <dd>
              <span className="ap-count num">{n}</span>
              <span className="muted num">{pct(n)}%</span>
            </dd>
          </div>
        ))}
      </dl>
      {total === 0 && snap.loaded && !snap.error ? (
        <Empty>No decisions yet.</Empty>
      ) : (
        <div className="ap-split" aria-hidden="true">
          {rows.map(([label, n, , tone]) =>
            n > 0 ? (
              <span
                key={label}
                className={`ap-split-seg ${tone}`}
                style={{ flexGrow: n }}
              />
            ) : null
          )}
        </div>
      )}
    </Shell>
  );
}

export function EscalationQueueWidget(params: Params) {
  const snap = useStore(params);
  const store = params.context?.store;
  return (
    <Shell subtitle="Purchases waiting for your decision">
      <Status snap={snap} />
      {snap.loaded && !snap.error && snap.escalated.length === 0 ? (
        <Empty>Nothing waiting for you.</Empty>
      ) : null}
      <ul className="ap-queue" aria-label="Escalated intents">
        {snap.escalated.map((i) => {
          const err = snap.decisionErrors[i.id];
          return (
            <li key={i.id} className="ap-queue-item">
              <div className="ap-queue-top">
                <strong className="ap-queue-amount num">
                  {formatMoney({
                    amountCents: i.amountCents,
                    currency: i.currency,
                  })}
                </strong>
                <span className="ap-queue-payee plain" title={i.payee}>
                  {i.payee}
                </span>
              </div>
              <p className="ap-clamp muted" title={i.description}>
                {i.description}
              </p>
              <RiskMeter score={i.riskScore} compact />
              <div className="ap-queue-actions">
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

// Compose-panel icons: our own constant SVG strings (the option parses a string as HTML).
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%" aria-hidden="true">${body}</svg>`;
const ICON_CHART = svg(
  '<path d="M3 3v18h18"/><path d="M8 17v-6"/><path d="M13 17V7"/><path d="M18 17v-9"/>'
);
const ICON_DECISIONS = svg(
  '<path d="M12 3v18"/><path d="M5 8l-2 5a3 3 0 0 0 4 0z"/><path d="M19 8l-2 5a3 3 0 0 0 4 0z"/><path d="M5 8h14"/>'
);
const ICON_QUEUE = svg(
  '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 8v5"/><path d="M12 16h.01"/>'
);

export const AP_WIDGETS = [
  {
    id: "ap-spend-per-day",
    label: "Spend per day",
    icon: ICON_CHART,
    form: titleOnlyForm,
    comp: SpendPerDayWidget,
    defaultSize: { width: 480, height: 300 },
    minSize: { width: 280, height: 200 },
  },
  {
    id: "ap-decisions",
    label: "Decisions",
    icon: ICON_DECISIONS,
    form: titleOnlyForm,
    comp: DecisionsWidget,
    defaultSize: { width: 320, height: 240 },
    minSize: { width: 220, height: 160 },
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
