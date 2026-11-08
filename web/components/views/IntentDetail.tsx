"use client";

import { MousePointerClick } from "lucide-react";
import { useOwnerData } from "../../lib/client/useOwnerData";
import { plural } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { decisionInfo, type IntentDetail as Detail } from "../../lib/types";
import { RiskMeter, StatusPill } from "../ui/Badge";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton } from "../ui/Skeleton";
import { ShortId } from "../ui/ShortId";
import { Toast } from "../ui/Toast";

/** Plain-text decision summary. Every value renders as a React text node, never HTML. */
export function DecisionSummary({ detail }: { detail: Detail }) {
  const d = decisionInfo(detail.events);
  const median =
    d.priceMedianCents === null
      ? "no market data"
      : formatMoney({
          amountCents: d.priceMedianCents,
          currency: detail.intent.currency,
        });
  return (
    <dl className="kv">
      <dt>Risk Guard reason</dt>
      <dd className="plain">{d.reason ?? "-"}</dd>
      <dt>Risk score</dt>
      <dd>
        <RiskMeter score={detail.intent.riskScore} />
      </dd>
      <dt>Price check</dt>
      <dd>
        <StatusPill status={d.priceStatus} />{" "}
        <span className="num">
          market median {median}
          {d.priceSampleSize > 0
            ? ` (${plural(d.priceSampleSize, "offer")})`
            : ""}
        </span>
      </dd>
    </dl>
  );
}

export function IntentDetailEmpty() {
  return (
    <EmptyState icon={MousePointerClick}>
      Select a row to see its details and audit events.
    </EmptyState>
  );
}

export function IntentDetailPanel({
  id,
  version,
}: {
  id: string;
  version: number;
}) {
  const { data, error, loading } = useOwnerData<Detail>(
    `owner/intents/${encodeURIComponent(id)}`,
    version
  );
  if (error) return <Toast message={`Could not load the intent: ${error}`} />;
  if (!data)
    return (
      <Card role="status">
        <span className="sr-only">{loading ? "Loading" : ""}</span>
        <div className="stack" aria-hidden="true">
          <Skeleton width="50%" height="1.25rem" />
          <Skeleton />
          <Skeleton width="80%" />
        </div>
      </Card>
    );
  const i = data.intent;
  return (
    <Card as="section" aria-labelledby="detail-h">
      <h2
        id="detail-h"
        className="card-title plain"
        style={{ marginBottom: "1rem" }}
      >
        Intent <ShortId id={i.id} label="intent id" />
      </h2>
      <dl className="kv">
        <dt>State</dt>
        <dd>
          <StatusPill status={i.state} />
        </dd>
        <dt>Amount</dt>
        <dd className="num">
          {formatMoney({ amountCents: i.amountCents, currency: i.currency })}
        </dd>
        <dt>Payee</dt>
        <dd className="plain">{i.payee}</dd>
        <dt>Category</dt>
        <dd className="plain">{i.category}</dd>
        <dt>Description</dt>
        <dd className="plain">{i.description}</dd>
        <dt>Justification</dt>
        <dd className="plain">{i.justification}</dd>
        <dt>Payment method</dt>
        <dd>{i.paymentMethodId}</dd>
      </dl>
      <hr
        style={{
          border: 0,
          borderTop: "1px solid var(--border)",
          margin: "1.1rem 0",
        }}
      />
      <DecisionSummary detail={data} />
      <h3 style={{ margin: "1.25rem 0 0.75rem" }}>Audit events</h3>
      <ol className="list">
        {data.events.map((e, n) => (
          <li key={`${e.event}-${n}`}>
            <strong>{e.event}</strong>{" "}
            <span className="muted num">
              {new Date(e.createdAt).toLocaleString()}
            </span>
            <pre
              className="plain muted"
              style={{
                margin: "0.25rem 0 0",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-12)",
              }}
            >
              {JSON.stringify(e.meta)}
            </pre>
          </li>
        ))}
      </ol>
    </Card>
  );
}
