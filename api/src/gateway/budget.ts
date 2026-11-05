// Gateway budget helpers.
//
// Pure, dependency-light functions for the deterministic rules engine
// (spec-05). No I/O, no logging, no secrets. The clock is injected as an
// explicit `nowMs` (epoch milliseconds) for determinism. All money is
// integer cents (see .kiro/steering/money-rules.md).
//
// Window convention (shared with velocity.ts): a record is "within" the
// rolling window ending at nowMs when
//   createdAtMs > nowMs - windowMs   (strict lower bound)
//   AND createdAtMs <= nowMs         (inclusive upper bound)
// i.e. strict-lower / inclusive-upper. A record exactly windowMs old is
// excluded; a record created exactly at nowMs is included.

import type { TransactionRecord } from "@agentpurse/shared";

/** Length of the rolling spend window: 24 hours in milliseconds. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Sum of amountCents for records matching `currency` whose `createdAtMs`
 * falls in the rolling 24h window ending at `nowMs`
 * (createdAtMs > nowMs - 24h AND createdAtMs <= nowMs). Records in other
 * currencies or outside the window are excluded. Returns an integer.
 */
export function spentTodayCents(
  history: TransactionRecord[],
  currency: string,
  nowMs: number,
): number {
  const lowerBound = nowMs - WINDOW_MS;
  let total = 0;
  for (const record of history) {
    if (record.currency !== currency) continue;
    if (record.createdAtMs > lowerBound && record.createdAtMs <= nowMs) {
      total += record.amountCents;
    }
  }
  return total;
}

/**
 * Remaining daily budget in integer cents. Never negative: returns
 * Math.max(0, dailyBudgetCents - spentCents).
 */
export function remainingBudget(dailyBudgetCents: number, spentCents: number): number {
  return Math.max(0, dailyBudgetCents - spentCents);
}
