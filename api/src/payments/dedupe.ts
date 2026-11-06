// In-memory seen-key store for webhook dedupe.
// TODO(spec-08): move to a database table so dedupe survives restarts and
// multiple instances.

export interface SeenKeyStore {
  seen(key: string): boolean;
  markSeen(key: string): void;
}

export function createSeenKeyStore(): SeenKeyStore {
  const keys = new Set<string>();
  return {
    seen: (key) => keys.has(key),
    markSeen: (key) => {
      keys.add(key);
    },
  };
}
