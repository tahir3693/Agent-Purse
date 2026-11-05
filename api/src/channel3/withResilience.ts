// Latency/flakiness bound for Channel3 calls.
//
// Wraps an async call in a timeout race and retries a bounded number of times on
// rejection or timeout. Used only by priceCheck so that search/retrieve used
// directly by the demo agent keep the SDK's own defaults (Requirement 5.1).
//
// TODO(verify): if @channel3/sdk exposes a native per-request timeout/maxRetries
// we prefer that; until confirmed we bound latency at our own boundary here.

export interface ResilienceOptions {
  /** Reject an attempt if it has not settled within this many milliseconds. */
  timeoutMs: number;
  /** Number of additional attempts after the first (retries:1 => 2 attempts max). */
  retries: number;
}

class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Race `fn()` against a timeout; on rejection or timeout, retry up to
 * `opts.retries` more times (so `retries: 1` means at most two attempts total).
 * The timer is always cleared so no handle leaks between attempts.
 *
 * The last error is thrown once all attempts are exhausted; callers that must
 * never throw (priceCheck) wrap this in their own try/catch.
 */
export async function withResilience<T>(
  fn: () => Promise<T>,
  opts: ResilienceOptions,
): Promise<T> {
  const maxAttempts = opts.retries + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await raceWithTimeout(fn, opts.timeoutMs);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

function raceWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(timeoutMs)), timeoutMs);
  });

  return Promise.race([fn(), timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}
