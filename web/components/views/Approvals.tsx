"use client";

import { useEffect, useState } from "react";

import { owner } from "../../lib/client/api";
import { useOwnerData } from "../../lib/client/useOwnerData";
import { formatMoney } from "../../lib/money";
import { applyDecision, type QueueItem } from "../../lib/approvals";
import type { Intent, IntentDetail } from "../../lib/types";
import { useLive } from "../live/LiveProvider";
import { DecisionSummary } from "./IntentDetail";

export function Approvals() {
  const { version } = useLive();
  const { data, error } = useOwnerData<{ intents: Intent[] }>(
    "owner/intents?state=escalated&limit=50",
    version
  );
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<Record<string, IntentDetail>>({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (data) setQueue(data.intents.map((intent) => ({ intent })));
  }, [data]);

  useEffect(() => {
    for (const { intent } of queue) {
      if (details[intent.id]) continue;
      void owner<IntentDetail>(`owner/intents/${intent.id}`).then((r) => {
        if (r.ok) setDetails((d) => ({ ...d, [intent.id]: r.data }));
      });
    }
  }, [queue, details]);

  async function decide(id: string, action: "approve" | "deny") {
    setErrors((e) => ({ ...e, [id]: "" }));
    const outcome = await applyDecision(queue, id, action, setQueue, (path) =>
      owner(path, { method: "POST", body: {} })
    );
    if (outcome.ok) {
      setMessage(
        action === "approve"
          ? "Approved. The hold is authorized and the agent can fetch its mandate."
          : "Denied."
      );
    } else {
      setErrors((e) => ({ ...e, [id]: outcome.message }));
      setMessage("");
    }
  }

  return (
    <div className="stack">
      <h1>Approvals</h1>
      <p className="muted">
        Escalated purchases wait here for your decision. Reasons and
        justifications are shown as plain text.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {error ? (
        <p role="alert" className="notice error">
          Could not load the queue: {error}
        </p>
      ) : null}
      <ul className="list" aria-label="Escalated intents">
        {data && queue.length === 0 ? (
          <li className="muted">Nothing waiting for approval.</li>
        ) : null}
        {queue.map(({ intent }) => {
          const err = errors[intent.id];
          const detail = details[intent.id];
          return (
            <li className="card" key={intent.id}>
              <div className="row">
                <strong>
                  {formatMoney({
                    amountCents: intent.amountCents,
                    currency: intent.currency,
                  })}
                </strong>
                <span className="plain">to {intent.payee}</span>
                <span className="badge badge-escalated">escalated</span>
              </div>
              <dl className="kv">
                <dt>Item</dt>
                <dd className="plain">{intent.description}</dd>
                <dt>Justification</dt>
                <dd className="plain">{intent.justification}</dd>
              </dl>
              {detail ? (
                <DecisionSummary detail={detail} />
              ) : (
                <p className="muted">Loading Risk Guard details</p>
              )}
              <div className="row">
                <button
                  type="button"
                  onClick={() => decide(intent.id, "approve")}
                  aria-describedby={err ? `err-${intent.id}` : undefined}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => decide(intent.id, "deny")}
                >
                  Deny
                </button>
              </div>
              {err ? (
                <p id={`err-${intent.id}`} role="alert" className="error-text">
                  {err}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
