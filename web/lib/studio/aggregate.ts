// Pure aggregations for the Studio widgets. Money stays integer cents.
import type { Intent } from "../types";

export interface DaySpend {
  day: string; // UTC YYYY-MM-DD
  currency: string;
  amountCents: number;
}

/** Captured spend per UTC day and currency, oldest first. */
export function spendPerDay(
  rows: Pick<Intent, "state" | "createdAt" | "currency" | "amountCents">[]
): DaySpend[] {
  const sums = new Map<string, DaySpend>();
  for (const r of rows) {
    if (r.state !== "captured" || !Number.isSafeInteger(r.amountCents))
      continue;
    const t = Date.parse(r.createdAt);
    if (Number.isNaN(t)) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    const key = `${day}|${r.currency}`;
    const cur = sums.get(key) ?? { day, currency: r.currency, amountCents: 0 };
    cur.amountCents += r.amountCents;
    sums.set(key, cur);
  }
  return [...sums.values()].sort((a, b) =>
    a.day === b.day
      ? a.currency.localeCompare(b.currency)
      : a.day.localeCompare(b.day)
  );
}

export interface DecisionCounts {
  approved: number;
  escalated: number;
  denied: number;
}

export function decisionBreakdown(
  rows: Pick<Intent, "decision">[]
): DecisionCounts {
  const c: DecisionCounts = { approved: 0, escalated: 0, denied: 0 };
  for (const r of rows) {
    if (r.decision === "approve") c.approved++;
    else if (r.decision === "escalate") c.escalated++;
    else if (r.decision === "deny") c.denied++;
  }
  return c;
}

/** Flat rows for the Studio `intents` data source (integer cents kept as is). */
export function toStudioRows(rows: Intent[]) {
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    day: r.createdAt.slice(0, 10),
    state: r.state,
    decision: r.decision ?? "none",
    amountCents: r.amountCents,
    currency: r.currency,
    payee: r.payee,
    category: r.category,
    riskScore: r.riskScore ?? 0,
    agentId: r.agentId,
  }));
}
