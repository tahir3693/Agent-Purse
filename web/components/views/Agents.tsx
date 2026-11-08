"use client";

import type { Policy } from "@agentpurse/shared";
import { Bot, Pencil, Power, PowerOff } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { owner } from "../../lib/client/api";
import { useOwnerData } from "../../lib/client/useOwnerData";
import { policySummary } from "../../lib/policyForm";
import type { Agent } from "../../lib/types";
import { StatusPill } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import { SkeletonList } from "../ui/Skeleton";
import { Toast } from "../ui/Toast";
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
    <Card as="li" className="agent-card">
      <div
        className="row"
        style={{ flexWrap: "nowrap", alignItems: "flex-start" }}
      >
        <span className="agent-avatar">
          <Bot size={20} aria-hidden="true" />
        </span>
        <div className="stack" style={{ gap: "0.35rem", flex: 1 }}>
          <div className="row">
            <strong className="agent-name">{agent.name}</strong>
            <StatusPill
              status={agent.killed ? "killed" : "active"}
              label={agent.killed ? "Killed" : "Active"}
            />
          </div>
          <span className="muted">
            {policy === undefined ? "Loading policy" : policySummary(policy)}
          </span>
          <p className="muted plain">Agent id {agent.id}</p>
        </div>
      </div>
      <div className="row">
        <Button
          variant={agent.killed ? "secondary" : "danger"}
          size="sm"
          onClick={toggle}
          disabled={busy}
          aria-describedby={error ? errId : undefined}
        >
          {agent.killed ? (
            <Power size={16} aria-hidden="true" />
          ) : (
            <PowerOff size={16} aria-hidden="true" />
          )}
          {agent.killed ? "Restore" : "Kill switch"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={editing}
          onClick={() => setEditing((v) => !v)}
        >
          <Pencil size={16} aria-hidden="true" />
          {editing ? "Close policy" : "Edit policy"}
        </Button>
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
    </Card>
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
      <PageHeader
        title="Agents"
        description="Create agents, set their spending policy, and stop one instantly with the kill switch."
      />
      <Card as="section">
        <form
          onSubmit={create}
          noValidate
          aria-label="Create agent"
          style={{ maxWidth: "28rem" }}
        >
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
          <p className="hint">
            New agents start with a $200.00 per-purchase cap and a $500.00 daily
            budget. Edit it below.
          </p>
          <div>
            <Button type="submit" variant="primary" disabled={creating}>
              {creating ? "Creating" : "Create agent"}
            </Button>
          </div>
          {createError ? (
            <p id="create-err" role="alert" className="error-text">
              {createError}
            </p>
          ) : null}
        </form>
      </Card>
      {newKey ? (
        <KeyDialog
          agentName={newKey.name}
          apiKey={newKey.key}
          onClose={() => setNewKey(null)}
        />
      ) : null}
      <Toast message={error ? `Could not load agents: ${error}` : null} />
      {!data && !error ? <SkeletonList label="Loading agents" /> : null}
      {data?.agents.length === 0 ? (
        <EmptyState icon={Bot} title="No agents yet">
          Create your first agent above to get an API key and a spending policy.
        </EmptyState>
      ) : null}
      <ul className="list" aria-label="Agents">
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
