// Per-owner in-process event bus for the SSE live feed. Payloads carry ids and
// states only: never intent text, tokens or keys. Single instance only
// (TODO(verify): use Postgres LISTEN/NOTIFY or Redis if scaled horizontally).

export type OwnerEventType =
  | "intent.created"
  | "intent.decided"
  | "intent.authorized"
  | "intent.captured"
  | "intent.denied";

export interface OwnerEvent {
  type: OwnerEventType;
  intentId: string;
  agentId: string;
  state?: string;
  decision?: string;
  at: string;
}

export interface EventPublisher {
  publish(ownerId: string, event: Omit<OwnerEvent, "at">): void;
}

export interface EventBus extends EventPublisher {
  subscribe(ownerId: string, listener: (e: OwnerEvent) => void): () => void;
  listenerCount(ownerId: string): number;
}

export function createEventBus(now: () => Date = () => new Date()): EventBus {
  const subs = new Map<string, Set<(e: OwnerEvent) => void>>();
  return {
    publish(ownerId, event) {
      const set = subs.get(ownerId);
      if (!set) return;
      const full: OwnerEvent = { ...event, at: now().toISOString() };
      for (const l of set) {
        try {
          l(full);
        } catch {
          // a broken listener must not affect the payment flow
        }
      }
    },
    subscribe(ownerId, listener) {
      let set = subs.get(ownerId);
      if (!set) subs.set(ownerId, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) subs.delete(ownerId);
      };
    },
    listenerCount(ownerId) {
      return subs.get(ownerId)?.size ?? 0;
    },
  };
}