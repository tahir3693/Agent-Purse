// Gateway velocity helpers.
//
// Pure, dependency-light functions for the deterministic rules engine
// (spec-05). No I/O, no logging, no secrets. The clock is injected as an
// explicit `nowMs` (epoch milliseconds) for determinism.
//
// Window convention (shared with budget.ts): a record is "within" the
// rolling window ending at nowMs when
//   createdAtMs > nowMs - windowMs   (strict lower bound)
//   AND createdAtMs <= nowMs         (inclusive upper bound)
// i.e. strict-lower / inclusive-upper. A record exactly windowMs old is
// excluded; a record created exactly at nowMs is included.

import type { TransactionRecord } from "@agentpurse/shared";

/** One hour in milliseconds. */
export const HOUR_MS = 60 * 60 * 1000;

/** One day (24 hours) in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Count of records whose `createdAtMs` falls in the rolling window of length
 * `windowMs` ending at `nowMs`
 * (createdAtMs > nowMs - windowMs AND createdAtMs <= nowMs).
 */
export function countWithin(
  history: TransactionRecord[],
  windowMs: number,
  nowMs: number,
): number {
  const lowerBound = nowMs - windowMs;
  let count = 0;
  for (const record of history) {
    if (record.createdAtMs > lowerBound && record.createdAtMs <= nowMs) {
      count += 1;
    }
  }
  return count;
}
