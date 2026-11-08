"use client";

import Link from "next/link";

import { useOwnerData } from "../../lib/client/useOwnerData";
import { formatMoney } from "../../lib/money";
import type { Stats } from "../../lib/types";
import { useLive } from "../live/LiveProvider";

const DECISIONS = [
  ["approve", "Approved"],
  ["escalate", "Escalated"],
  ["deny", "Denied"],
  ["none", "Undecided"],
] as const;

export function SandboxNote() {
  return (
    <p className="notice">
      Payments are Braintree sandbox transactions (a PayPal service). No real
      money or physical goods change hands. Channel3 supplies real catalog and
      market price data.
    </p>
  );
}

export function Overview() {
  const { version } = useLive();
  const { data, error, loading } = useOwnerData<Stats>("owner/stats", version);

  return (
    <div className="stack">
      <h1>Overview</h1>
      <SandboxNote />
      {error ? (
        <p role="alert" className="notice error">
          Could not load stats: {error}
        </p>
      ) : (
        <>
          <section aria-labelledby="spent-h">
            <h2 id="spent-h">Spent today</h2>
            <div className="grid-cards">
              {data && data.spentToday.length === 0 ? (
                <div className="card">
                  <h3>All currencies</h3>
                  <p className="value">
                    {formatMoney({ amountCents: 0, currency: "USD" })}
                  </p>
                </div>
              ) : null}
              {data?.spentToday.map((s) => (
                <div className="card" key={s.currency}>
                  <h3>{s.currency}</h3>
                  <p className="value">{formatMoney(s)}</p>
                </div>
              ))}
              {!data && loading ? <p className="muted">Loading</p> : null}
            </div>
          </section>
          <section aria-labelledby="dec-h">
            <h2 id="dec-h">Decisions today</h2>
            <div className="grid-cards">
              {DECISIONS.map(([key, label]) => (
                <div className="card" key={key}>
                  <h3>{label}</h3>
                  <p className="value">
                    {data ? (data.countsByDecision[key] ?? 0) : "-"}
                  </p>
                </div>
              ))}
            </div>
            <p>
              <Link href="/dashboard/approvals">
                Review escalated purchases
              </Link>
            </p>
          </section>
        </>
      )}
    </div>
  );
}
