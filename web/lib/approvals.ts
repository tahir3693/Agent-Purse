// Optimistic approve/deny for the approvals queue: remove first, restore the
// item in its original position on any error (including 409).
import type { ApiResult } from "./client/api";
import type { Intent } from "./types";

export interface QueueItem {
  intent: Intent;
}

export async function applyDecision(
  queue: QueueItem[],
  id: string,
  action: "approve" | "deny",
  setQueue: (fn: (q: QueueItem[]) => QueueItem[]) => void,
  post: (path: string) => Promise<ApiResult<unknown>>
): Promise<{ ok: true } | { ok: false; message: string }> {
  const index = queue.findIndex((q) => q.intent.id === id);
  if (index === -1)
    return { ok: false, message: "Intent is no longer in the queue" };
  const item = queue[index]!;
  setQueue((q) => q.filter((x) => x.intent.id !== id));
  const r = await post(`intents/${encodeURIComponent(id)}/${action}`);
  if (r.ok) return { ok: true };
  setQueue((q) => {
    if (q.some((x) => x.intent.id === id)) return q;
    const next = [...q];
    next.splice(Math.min(index, next.length), 0, item);
    return next;
  });
  return {
    ok: false,
    message:
      r.status === 409
        ? "This intent is no longer awaiting approval."
        : r.message,
  };
}
