// Framework-free store feeding the Studio widgets from the owner endpoints
// (through the BFF). Widgets subscribe with useSyncExternalStore.
import type { ApiResult } from "../client/api";
import type { Intent, Stats } from "../types";

export interface StudioSnapshot {
  stats: Stats | null;
  intents: Intent[];
  /** Escalated intents not currently being decided. */
  escalated: Intent[];
  error: string | null;
  /** Per-intent decision errors (approve/deny failures). */
  decisionErrors: Record<string, string>;
  loaded: boolean;
}

export type OwnerCall = <T>(
  path: string,
  init?: { method?: string; body?: unknown }
) => Promise<ApiResult<T>>;

export interface OwnerStore {
  getSnapshot(): StudioSnapshot;
  subscribe(fn: () => void): () => void;
  refresh(): Promise<void>;
  decide(id: string, action: "approve" | "deny"): Promise<boolean>;
}

export function createOwnerStore(call: OwnerCall): OwnerStore {
  let intents: Intent[] = [];
  let stats: Stats | null = null;
  let error: string | null = null;
  let loaded = false;
  const pending = new Set<string>();
  const decisionErrors: Record<string, string> = {};
  const listeners = new Set<() => void>();
  let snapshot: StudioSnapshot = build();

  function build(): StudioSnapshot {
    return {
      stats,
      intents,
      escalated: intents.filter(
        (i) => i.state === "escalated" && !pending.has(i.id)
      ),
      error,
      decisionErrors: { ...decisionErrors },
      loaded,
    };
  }
  function emit() {
    snapshot = build();
    for (const l of listeners) l();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async refresh() {
      const [s, i] = await Promise.all([
        call<Stats>("owner/stats"),
        call<{ intents: Intent[] }>("owner/intents?limit=200"),
      ]);
      loaded = true;
      error = !s.ok ? s.message : !i.ok ? i.message : null;
      if (s.ok) stats = s.data;
      if (i.ok) intents = i.data.intents;
      emit();
    },
    async decide(id, action) {
      if (pending.has(id)) return false;
      pending.add(id); // optimistic: hide it from the queue now
      delete decisionErrors[id];
      emit();
      const r = await call(`intents/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        body: {},
      });
      pending.delete(id);
      if (r.ok) {
        intents = intents.map((x) =>
          x.id === id
            ? { ...x, state: action === "approve" ? "authorized" : "denied" }
            : x
        );
        emit();
        return true;
      }
      decisionErrors[id] =
        r.status === 409
          ? "This intent is no longer awaiting approval."
          : r.message;
      emit(); // restored to the queue with the error
      return false;
    },
  };
}
