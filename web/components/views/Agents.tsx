"use client";

import type { Policy } from "@agentpurse/shared";
import { Bot, Pencil, Power, PowerOff, RefreshCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { rememberAgents } from "../../lib/client/agentNames";
import { owner } from "../../lib/client/api";
import { useOwnerData } from "../../lib/client/useOwnerData";
import { policySummary } from "../../lib/policyForm";
import type { Agent } from "../../lib/types";
import { StatusPill } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import { ShortId } from "../ui/ShortId";
import { SkeletonList } from "../ui/Skeleton";
import { Toast } from "../ui/Toast";
import { KeyDialog } from "./KeyDialog";
import { DEFAULT_POLICY_FORM, PolicyEditor } from "./PolicyEditor";
import { validatePolicyForm } from "../../lib/policyForm";

/**
 * A policy is "loading" only while its request is in flight. The request has a
 * timeout, so a stuck connection ends in an error state with a Retry button
 * instead of an endless "Loading policy".
 */
type PolicyState =
  | { status: "loading" }
  | { status: "ok"; policy: Policy | null }
  | { status: "error"; message: string };
type Policies = Record<string, PolicyState>;

export const POLICY_TIMEOUT_MS = 15_000;

async function fetchPolicy(agentId: string): Promise<PolicyState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PolicyState>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          status: "error",
          message: "The policy request timed out.",
        }),
      POLICY_TIMEOUT_MS
    );
  });
  const call = owner<{ policy: Policy | null }>(
    `agents/${agentId}/policy`
  ).then((r): PolicyState =>
    r.ok
      ? { status: "ok", policy: r.data.policy }
      : { status: "error", message: r.message }
  );
  try {
    return await Promise.race([call, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function AgentRow({
  agent,
  policyState,
  onRetry,
  onChange,
}: {
  agent: Agent;
  policyState: PolicyState | undefined;
  onRetry: () => void;
  onChange: (a: Agent, p?: Policy) => void;
}) {
  const policy = policyState?.status === "ok" ? policyState.policy : undefined;
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
        <div className="stack" style={{ gap: "0.35rem", flex: 1, minWidth: 0 }}>
          <div className="row">
            <strong className="agent-name" title={agent.name}>
              {agent.name}
            </strong>
            <StatusPill
              status={agent.killed ? "killed" : "active"}
              label={agent.killed ? "Killed" : "Active"}
            />
          </div>
          {policyState?.status === "error" ? (
            <span className="row" role="alert">
              <span className="error-text">
                Could not load the policy: {policyState.message}
              </span>
              <Button variant="secondary" size="sm" onClick={onRetry}>
                <RefreshCw size={14} aria-hidden="true" />
                Retry
              </Button>
            </span>
          ) : (
            <span className="muted">
              {policyState === undefined || policyState.status === "loading"
                ? "Loading policy"
                : policySummary(policyState.policy)}
            </span>
          )}
          <p className="muted row" style={{ gap: "0.35rem" }}>
            Agent id <ShortId id={agent.id} label="agent id" />
          </p>
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

  const loadPolicy = useCallback((id: string) => {
    requested.current.add(id);
    setPolicies((p) => ({ ...p, [id]: { status: "loading" } }));
    void fetchPolicy(id).then((state) =>
      setPolicies((p) => ({ ...p, [id]: state }))
    );
  }, []);

  useEffect(() => {
    rememberAgents(data?.agents ?? []);
    for (const a of data?.agents ?? []) {
      if (!requested.current.has(a.id)) loadPolicy(a.id);
    }
  }, [data, loadPolicy]);

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
      [r.data.agent.id]: {
        status: "ok",
        policy: policy.ok ? policy.policy : null,
      },
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
            policyState={policies[a.id]}
            onRetry={() => loadPolicy(a.id)}
            onChange={(next, policy) => {
              setData((prev) => ({
                agents: (prev?.agents ?? []).map((x) =>
                  x.id === next.id ? next : x
                ),
              }));
              if (policy)
                setPolicies((p) => ({
                  ...p,
                  [next.id]: { status: "ok", policy },
                }));
            }}
          />
        ))}
      </ul>
    </div>
  );
}
