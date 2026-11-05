// Webhook event de-duplication.
//
// PayPal may deliver the same webhook more than once (at-least-once delivery),
// so the route de-dupes by `webhook_event.id` and responds 200 to a repeat
// without re-processing (design.md "Webhook flow", Requirements 7.x). This
// slice keeps the seen-id set in memory only.
//
// TODO(verify): replace this in-memory Set with a durable DB table
// (WebhookEvent) in spec-08 so dedupe survives restarts and spans instances.

/** A set of already-seen webhook event ids. */
export interface SeenEventStore {
  /** True if `eventId` was already recorded via {@link markSeen}. */
  seen(eventId: string): boolean;
  /** Record `eventId` as seen. */
  markSeen(eventId: string): void;
}

/**
 * Create an in-memory {@link SeenEventStore} backed by a `Set`.
 *
 * TODO(verify): swap for a DB-backed implementation in spec-08.
 */
export function createSeenEventStore(): SeenEventStore {
  const seenIds = new Set<string>();
  return {
    seen(eventId: string): boolean {
      return seenIds.has(eventId);
    },
    markSeen(eventId: string): void {
      seenIds.add(eventId);
    },
  };
}
