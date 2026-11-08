"use client";
// Agent names already loaded somewhere in the client (the Agents page), shared
// with other views so they can show a name instead of an id. It never fetches.
import { useSyncExternalStore } from "react";

const names = new Map<string, string>();
const listeners = new Set<() => void>();
const EMPTY: ReadonlyMap<string, string> = new Map();
let snapshot: ReadonlyMap<string, string> = EMPTY;

export function rememberAgents(list: { id: string; name: string }[]): void {
  let changed = false;
  for (const a of list) {
    if (names.get(a.id) !== a.name) {
      names.set(a.id, a.name);
      changed = true;
    }
  }
  if (!changed) return;
  snapshot = new Map(names);
  listeners.forEach((l) => l());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useAgentNames(): ReadonlyMap<string, string> {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY
  );
}
