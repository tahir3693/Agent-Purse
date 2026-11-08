"use client";

import type { Policy } from "@agentpurse/shared";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { owner } from "../../lib/client/api";
import { useOwnerData } from "../../lib/client/useOwnerData";
import { policySummary } from "../../lib/policyForm";
import type { Agent } from "../../lib/types";
import { KeyDialog } from "./KeyDialog";
import { DEFAULT_POLICY_FORM, PolicyEditor } from "./PolicyEditor";
import { validatePolicyForm } from "../../lib/policyForm";

type Policies = Record<string, Policy | null>;

function AgentRow({
  agent,
  policy,
  onChange,
}: {
  agent: Agent;
  policy: Policy | null | undefined;
  onChange: (a: Agent, p?: Policy) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const errId = `agent-${agent.id}-err`;

  async function toggle() {
    setBusy(true);
    setError(null);
    const r = await owner<{ id: string; killed: boolean }>(
      `agents/${agent.id}/${agent.killed ? "restore" : "kill"}`,
      {
        method: "POST",
        body: {},
      }
    );
    setBusy(false);
    if (!r.ok) return setError(r.message); // prior state kept
    onChange({ ...agent, killed: r.data.killed });
  }

  return (
    <li className="card">
      <div className="row">
        <strong>{agent.name}</strong>
        <span
          className={`badge ${agent.killed ? "badge-killed" : "badge-live"}`}
        >
          {agent.killed ? "Killed" : "Active"}
        </span>
        <span className="muted">
          {policy === undefined ? "Loading policy" : policySummary(policy)}
        </span>
      </div>
      <p className="muted plain">Agent id {agent.id}</p>
      <div className="row">
        <button
          type="button"
          className={agent.killed ? "secondary" : "danger"}
          onClick={toggle}
          disabled={busy}
          aria-describedby={error ? errId : undefined}
        >
          {agent.killed ? "Restore" : "Kill switch"}
        </button>
        <button
          type="button"
          className="secondary"
          aria-expanded={editing}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Close policy" : "Edit policy"}
        </button>
      </div>
      {error ? (
        <p id={errId} role="alert" className="error-text">
          {error}
        </p>
      ) : null}
      {editing && policy !== undefined ? (
        <PolicyEditor
          initial={policy}
          submitLabel="Save policy"
          onSubmit={async (p) => {
            const r = await owner<{ policy: Policy }>(
              `agents/${agent.id}/policy`,
              { method: "PUT", body: p }
            );
            if (!r.ok) return r.message;
            onChange(agent, r.data.policy);
            return null;
          }}
        />
      ) : null}
    </li>
  );
}

export function Agents() {
  const { data, error, setData } = useOwnerData<{ agents: Agent[] }>("agents");
  const [policies, setPolicies] = useState<Policies>({});
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(
    null
  );

  const requested = useRef(new Set<string>());
  useEffect(() => {
    for (const a of data?.agents ?? []) {
      if (requested.current.has(a.id)) continue;
      requested.current.add(a.id);
      void owner<{ policy: Policy | null }>(`agents/${a.id}/policy`).then((r) =>
        setPolicies((p) =>
          a.id in p ? p : { ...p, [a.id]: r.ok ? r.data.policy : null }
        )
      );
    }
  }, [data]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setCreateError("Enter a name");
    const policy = validatePolicyForm(DEFAULT_POLICY_FORM);
    setCreating(true);
    setCreateError(null);
    const r = await owner<{ agent: Agent; apiKey: string }>("agents", {
      method: "POST",
      body: {
        name: name.trim(),
        ...(policy.ok ? { policy: policy.policy } : {}),
      },
    });
    setCreating(false);
    if (!r.ok) return setCreateError(r.message);
    setData((prev) => ({ agents: [r.data.agent, ...(prev?.agents ?? [])] }));
    requested.current.add(r.data.agent.id);
    setPolicies((p) => ({
      ...p,
      [r.data.agent.id]: policy.ok ? policy.policy : null,
    }));
    setNewKey({ name: r.data.agent.name, key: r.data.apiKey });
    setName("");
  }

  return (
    <div className="stack">
      <h1>Agents</h1>
      <form onSubmit={create} noValidate aria-label="Create agent">
        <label htmlFor="agent-name">
          New agent name
          <input
            id="agent-name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={createError ? true : undefined}
            aria-describedby={createError ? "create-err" : undefined}
          />
        </label>
        <p className="muted">
          New agents start with a $200.00 per-purchase cap and a $500.00 daily
          budget. Edit it below.
        </p>
        <button type="submit" disabled={creating}>
          {creating ? "Creating" : "Create agent"}
        </button>
        {createError ? (
          <p id="create-err" role="alert" className="error-text">
            {createError}
          </p>
        ) : null}
      </form>
      {newKey ? (
        <KeyDialog
          agentName={newKey.name}
          apiKey={newKey.key}
          onClose={() => setNewKey(null)}
        />
      ) : null}
      {error ? (
        <p role="alert" className="notice error">
          Could not load agents: {error}
        </p>
      ) : null}
      <ul className="list" aria-label="Agents">
        {data?.agents.length === 0 ? (
          <li className="muted">No agents yet.</li>
        ) : null}
        {data?.agents.map((a) => (
          <AgentRow
            key={a.id}
            agent={a}
            policy={policies[a.id]}
            onChange={(next, policy) => {
              setData((prev) => ({
                agents: (prev?.agents ?? []).map((x) =>
                  x.id === next.id ? next : x
                ),
              }));
              if (policy) setPolicies((p) => ({ ...p, [next.id]: policy }));
            }}
          />
        ))}
      </ul>
    </div>
  );
}
