"use client";

import { useOwnerData } from "../../lib/client/useOwnerData";
import { formatMoney } from "../../lib/money";
import { decisionInfo, type IntentDetail as Detail } from "../../lib/types";

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
      <dd>{detail.intent.riskScore ?? "-"}</dd>
      <dt>Price check</dt>
      <dd>
        <span className={`badge badge-${d.priceStatus}`}>{d.priceStatus}</span>{" "}
        market median {median}
        {d.priceSampleSize > 0 ? ` (${d.priceSampleSize} offers)` : ""}
      </dd>
    </dl>
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
  if (error)
    return (
      <p role="alert" className="notice error">
        Could not load the intent: {error}
      </p>
    );
  if (!data) return <p className="muted">{loading ? "Loading" : ""}</p>;
  const i = data.intent;
  return (
    <section className="card" aria-labelledby="detail-h">
      <h2 id="detail-h">Intent {i.id}</h2>
      <dl className="kv">
        <dt>State</dt>
        <dd>
          <span className={`badge badge-${i.state}`}>{i.state}</span>
        </dd>
        <dt>Amount</dt>
        <dd>
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
      <DecisionSummary detail={data} />
      <h3>Audit events</h3>
      <ol className="list">
        {data.events.map((e, n) => (
          <li key={`${e.event}-${n}`}>
            <strong>{e.event}</strong>{" "}
            <span className="muted">
              {new Date(e.createdAt).toLocaleString()}
            </span>
            <pre className="plain muted">{JSON.stringify(e.meta)}</pre>
          </li>
        ))}
      </ol>
    </section>
  );
}
