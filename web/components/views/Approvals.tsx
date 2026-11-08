"use client";

import { Bot, Check, CircleCheck, Store, X } from "lucide-react";
import { useEffect, useState } from "react";
import { owner } from "../../lib/client/api";
import { useOwnerData } from "../../lib/client/useOwnerData";
import { plural } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { applyDecision, type QueueItem } from "../../lib/approvals";
import { decisionInfo, type Intent, type IntentDetail } from "../../lib/types";
import { useLive } from "../live/LiveProvider";
import { RiskMeter, StatusPill } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import { SkeletonList } from "../ui/Skeleton";
import { Toast } from "../ui/Toast";
import { AgentRef } from "./AgentRef";

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
      <PageHeader
        title="Approvals"
        description="Escalated purchases wait here for your decision. Reasons and justifications are shown as plain text."
      />
      <p
        role="status"
        aria-live="polite"
        className={message ? "alert tone-success" : "sr-only"}
      >
        {message ? (
          <>
            <CircleCheck size={18} aria-hidden="true" />
            <span className="alert-body">{message}</span>
          </>
        ) : null}
      </p>
      <Toast message={error ? `Could not load the queue: ${error}` : null} />
      {!data && !error ? <SkeletonList label="Loading approvals" /> : null}
      {data && queue.length === 0 ? (
        <EmptyState icon={CircleCheck} title="All clear">
          Nothing waiting for approval.
        </EmptyState>
      ) : null}
      <ul className="list" aria-label="Escalated intents">
        {queue.map(({ intent }) => {
          const err = errors[intent.id];
          const detail = details[intent.id];
          const info = detail ? decisionInfo(detail.events) : null;
          const median =
            info && info.priceMedianCents !== null
              ? formatMoney({
                  amountCents: info.priceMedianCents,
                  currency: intent.currency,
                })
              : "no market data";
          return (
            <Card as="li" key={intent.id} className="approval">
              <div className="approval-top">
                <div className="stack" style={{ gap: "0.5rem" }}>
                  <div className="row">
                    <StatusPill status="escalated" />
                    <span className="muted row" style={{ gap: "0.35rem" }}>
                      <Bot size={14} aria-hidden="true" />
                      Agent <AgentRef id={intent.agentId} />
                    </span>
                  </div>
                  <p
                    className="approval-merchant row"
                    style={{ gap: "0.4rem" }}
                  >
                    <Store size={16} aria-hidden="true" />
                    <span className="plain">{intent.payee}</span>
                  </p>
                  <p className="muted plain">{intent.description}</p>
                </div>
                <div className="approval-amount">
                  {formatMoney({
                    amountCents: intent.amountCents,
                    currency: intent.currency,
                  })}
                </div>
              </div>

              <div className="approval-facts">
                <div>
                  <span className="fact-label">Risk score</span>
                  <RiskMeter score={intent.riskScore} />
                </div>
                <div>
                  <span className="fact-label">Price check</span>
                  {info ? (
                    <div className="stack" style={{ gap: "0.4rem" }}>
                      <div>
                        <StatusPill status={info.priceStatus} />
                      </div>
                      <span className="muted num">
                        Market median {median}
                        {info.priceSampleSize > 0
                          ? ` (${plural(info.priceSampleSize, "offer")})`
                          : ""}
                      </span>
                    </div>
                  ) : (
                    <span className="muted">Loading</span>
                  )}
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <span className="fact-label">Risk Guard reason</span>
                  <p className="plain">
                    {info ? (info.reason ?? "-") : "Loading Risk Guard details"}
                  </p>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <span className="fact-label">Agent justification</span>
                  <p className="plain">{intent.justification}</p>
                </div>
              </div>

              <div className="approval-actions">
                <Button
                  variant="success"
                  size="lg"
                  onClick={() => decide(intent.id, "approve")}
                  aria-describedby={err ? `err-${intent.id}` : undefined}
                >
                  <Check size={18} aria-hidden="true" />
                  Approve
                </Button>
                <Button
                  variant="danger"
                  size="lg"
                  onClick={() => decide(intent.id, "deny")}
                >
                  <X size={18} aria-hidden="true" />
                  Deny
                </Button>
              </div>
              {err ? (
                <p id={`err-${intent.id}`} role="alert" className="error-text">
                  {err}
                </p>
              ) : null}
            </Card>
          );
        })}
      </ul>
    </div>
  );
}
