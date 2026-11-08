"use client";

import { CreditCard, Plus } from "lucide-react";
import { useState } from "react";
import { request } from "../../lib/client/api";
import { useOwnerData } from "../../lib/client/useOwnerData";
import type { VaultMethod } from "../../lib/types";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import { Skeleton } from "../ui/Skeleton";
import { ShortId } from "../ui/ShortId";
import { Toast } from "../ui/Toast";

export function Vault() {
  const { data, error, setData } = useOwnerData<{ methods: VaultMethod[] }>(
    "vault/methods"
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  // "Demo card 1", "Demo card 2" ... in the order the cards were linked.
  const cardLabel = new Map(
    [...(data?.methods ?? [])]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((m, i) => [m.id, `Demo card ${i + 1}`] as const)
  );

  async function link() {
    setBusy(true);
    setLinkError(null);
    setMessage("Linking the sandbox test card");
    const r = await request<{ method: VaultMethod | null }>(
      "/api/vault/link-test-card",
      { method: "POST", body: {} }
    );
    setBusy(false);
    if (!r.ok) {
      setMessage("");
      setLinkError(r.message);
      return;
    }
    const m = r.data.method;
    if (m) {
      setData((prev) => {
        const list = prev?.methods ?? [];
        return {
          methods: list.some((x) => x.id === m.id) ? list : [m, ...list],
        };
      });
    }
    setMessage("Sandbox test card linked.");
  }

  return (
    <div className="stack">
      <PageHeader
        title="Vault"
        description="Payment methods your agents can spend from. Agents never see card details."
        actions={
          <Button
            variant="primary"
            onClick={link}
            disabled={busy}
            aria-describedby={linkError ? "link-err" : undefined}
          >
            <Plus size={16} aria-hidden="true" />
            {busy ? "Linking" : "Link sandbox test card"}
          </Button>
        }
      />
      <Alert tone="info">
        The linked card is a Braintree sandbox test card (nonce
        fake-valid-nonce). No real card or money is involved. Use a method id
        below as an agent&apos;s paymentMethodRef.
      </Alert>
      <span role="status" aria-live="polite" className="form-status">
        {message}
      </span>
      {linkError ? (
        <p id="link-err" role="alert" className="error-text">
          Could not link the card: {linkError}
        </p>
      ) : null}
      <Toast message={error ? `Could not load methods: ${error}` : null} />
      {!data && !error ? (
        <div className="pm-grid" role="status">
          <span className="sr-only">Loading payment methods</span>
          <Skeleton width="100%" height="11.5rem" />
        </div>
      ) : null}
      {data?.methods.length === 0 ? (
        <EmptyState icon={CreditCard} title="No linked methods yet">
          Link the sandbox test card so agents have something to spend from.
        </EmptyState>
      ) : null}
      <ul className="pm-grid" aria-label="Linked payment methods">
        {data?.methods.map((m) => (
          <li className="pm-item" key={m.id}>
            <div className="pm-card">
              <div className="pm-top">
                <span>{m.cardType ?? "Card"}</span>
                <span className="tag">Sandbox</span>
              </div>
              <p
                className="pm-number num"
                aria-label={`Card ending ${m.last4 ?? "unknown"}`}
              >
                <span aria-hidden="true">
                  •••• •••• •••• {m.last4 ?? "----"}
                </span>
              </p>
              <div className="pm-foot">
                <div>
                  <span className="pm-status">Linked</span>
                  <p className="num">
                    {new Date(m.createdAt).toLocaleString()}
                  </p>
                </div>
                <div style={{ textAlign: "right", minWidth: 0 }}>
                  <p className="pm-id">
                    Method id <ShortId id={m.id} label="method id" />
                  </p>
                  <p>
                    Token <span className="num">{m.tokenRef}</span>
                  </p>
                </div>
              </div>
            </div>
            <p className="pm-label">{cardLabel.get(m.id)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
