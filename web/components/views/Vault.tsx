"use client";

import { useState } from "react";

import { request } from "../../lib/client/api";
import { useOwnerData } from "../../lib/client/useOwnerData";
import type { VaultMethod } from "../../lib/types";

export function Vault() {
  const { data, error, setData } = useOwnerData<{ methods: VaultMethod[] }>(
    "vault/methods"
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

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
      <h1>Vault</h1>
      <p className="notice">
        The linked card is a Braintree sandbox test card (nonce
        fake-valid-nonce). No real card or money is involved. Use a method id
        below as an agent&apos;s paymentMethodRef.
      </p>
      <div className="row">
        <button
          type="button"
          onClick={link}
          disabled={busy}
          aria-describedby={linkError ? "link-err" : undefined}
        >
          {busy ? "Linking" : "Link sandbox test card"}
        </button>
        <span role="status" aria-live="polite">
          {message}
        </span>
      </div>
      {linkError ? (
        <p id="link-err" role="alert" className="error-text">
          Could not link the card: {linkError}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="notice error">
          Could not load methods: {error}
        </p>
      ) : null}
      <ul className="list" aria-label="Linked payment methods">
        {data?.methods.length === 0 ? (
          <li className="muted">No linked methods yet.</li>
        ) : null}
        {data?.methods.map((m) => (
          <li className="card" key={m.id}>
            <dl className="kv">
              <dt>Card</dt>
              <dd>
                {m.cardType ?? "Card"} ending {m.last4 ?? "----"}
              </dd>
              <dt>Token</dt>
              <dd>{m.tokenRef}</dd>
              <dt>Method id</dt>
              <dd>
                <code>{m.id}</code>
              </dd>
              <dt>Linked</dt>
              <dd>{new Date(m.createdAt).toLocaleString()}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
