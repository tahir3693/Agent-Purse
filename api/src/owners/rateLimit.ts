// In-memory sliding-window limiter. Single instance only (TODO(verify): shared
// store if the API is scaled horizontally). Keys must not contain secrets.

export interface RateLimiter {
  /** Records a hit; returns false when the key is over the limit. */
  hit(key: string): boolean;
}

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}): RateLimiter {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 10_000;
  const hits = new Map<string, number[]>();
  return {
    hit(key) {
      const t = now();
      const cutoff = t - opts.windowMs;
      if (hits.size > maxKeys) {
        for (const [k, v] of hits) if ((v[v.length - 1] ?? 0) <= cutoff) hits.delete(k);
      }
      const list = (hits.get(key) ?? []).filter((x) => x > cutoff);
      if (list.length >= opts.limit) {
        hits.set(key, list);
        return false;
      }
      list.push(t);
      hits.set(key, list);
      return true;
    },
  };
}