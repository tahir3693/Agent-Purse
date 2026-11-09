"use client";

import {
  Activity,
  BadgeCheck,
  Ban,
  Hourglass,
  Info,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useOwnerData } from "../../lib/client/useOwnerData";
import { formatMoney } from "../../lib/money";
import type { Stats } from "../../lib/types";
import { useLive } from "../live/LiveProvider";
import { ButtonLink } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import { Skeleton } from "../ui/Skeleton";
import { StatTile } from "../ui/StatTile";
import { StatusPill } from "../ui/Badge";
import { Toast } from "../ui/Toast";
import { EVENT_LABEL } from "./LiveMonitor";

const DISMISS_KEY = "ap-sandbox-note-dismissed";

/** Slim, dismissible honesty banner. The choice is remembered when storage works. */
export function SandboxNote() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") setHidden(true);
    } catch {
      // Storage blocked: the banner simply shows every visit.
    }
  }, []);
  if (hidden) return null;
  return (
    <div className="banner" role="note" aria-label="Sandbox notice">
      <Info size={18} aria-hidden="true" />
      <p>
        Payments are Braintree sandbox transactions (a PayPal service). No real
        money or physical goods change hands. Channel3 supplies real catalog and
        market price data.
      </p>
      <button
        type="button"
        className="icon-btn"
        aria-label="Dismiss sandbox notice"
        onClick={() => {
          setHidden(true);
          try {
            window.localStorage.setItem(DISMISS_KEY, "1");
          } catch {
            // Ignore: dismissal then lasts for this page view only.
          }
        }}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export function Overview() {
  const { version, events } = useLive();
  const { data, error, loading } = useOwnerData<Stats>("owner/stats", version);

  const counts = data?.countsByDecision ?? {};
  const waiting = data?.countsByState["escalated"] ?? 0;
  const [first, ...others] = data?.spentToday ?? [];
  const spent = first ?? { amountCents: 0, currency: "USD" };
  const num = (n: number | undefined) => (data ? (n ?? 0) : "-");

  return (
    <div className="stack">
      <PageHeader
        title="Overview"
        description="Today at a glance: what your agents spent and what Risk Guard decided."
      />
      <SandboxNote />
      <Toast message={error ? `Could not load stats: ${error}` : null} />

      {waiting > 0 ? (
        <section className="attention" aria-label="Needs your attention">
          <div className="attention-main">
            <Hourglass size={22} aria-hidden="true" />
            <div>
              <h2 className="card-title">Needs your attention</h2>
              <p className="muted">
                {waiting} {waiting === 1 ? "purchase is" : "purchases are"}{" "}
                waiting for your approval.
              </p>
            </div>
          </div>
          <ButtonLink href="/dashboard/approvals" variant="primary">
            Review escalated purchases
          </ButtonLink>
        </section>
      ) : null}

      <section aria-labelledby="today-h" className="stack">
        <h2 id="today-h" className="sr-only">
          Today
        </h2>
        {!data && loading && !error ? (
          <div className="stat-grid" role="status">
            <span className="sr-only">Loading stats</span>
            {[0, 1, 2, 3].map((i) => (
              <div className="stat" key={i} aria-hidden="true">
                <Skeleton width="50%" />
                <Skeleton width="70%" height="2rem" />
              </div>
            ))}
          </div>
        ) : (
          <div className="stat-grid">
            <StatTile
              brand
              icon={Wallet}
              label="Spent today"
              value={formatMoney(spent)}
              delta={
                others.length > 0
                  ? `Also ${others.map((s) => formatMoney(s)).join(", ")}`
                  : data
                    ? spent.currency
                    : undefined
              }
            />
            <StatTile
              tone="success"
              icon={BadgeCheck}
              label="Approved"
              value={num(counts.approve)}
            />
            <StatTile
              tone="warning"
              icon={Hourglass}
              label="Escalated"
              value={num(counts.escalate)}
            />
            <StatTile
              tone="danger"
              icon={Ban}
              label="Denied"
              value={num(counts.deny)}
            />
          </div>
        )}
        {data && (counts.none ?? 0) > 0 ? (
          <p className="muted">{counts.none} undecided today.</p>
        ) : null}
      </section>

      <Card as="section" aria-labelledby="recent-h">
        <CardHeader title="Recent activity" titleId="recent-h" />
        {events.length === 0 ? (
          <EmptyState icon={Activity}>
            Activity appears here as your agents make purchase requests.
          </EmptyState>
        ) : (
          <ul className="activity" aria-label="Recent activity">
            {events.slice(0, 6).map((e, i) => (
              <li key={`${e.intentId}-${e.type}-${e.at}-${i}`}>
                <strong>{EVENT_LABEL[e.type] ?? e.type}</strong>
                {e.state ? <StatusPill status={e.state} /> : null}
                {e.decision ? <StatusPill status={e.decision} /> : null}
                <span className="activity-time num">
                  {new Date(e.at).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p style={{ marginTop: "0.9rem" }}>
          <Link href="/dashboard/live">Open the live monitor</Link>
        </p>
      </Card>
    </div>
  );
}
