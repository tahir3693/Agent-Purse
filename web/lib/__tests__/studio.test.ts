// spec-09b Studio logic: aggregates, layout persistence, owner store. Offline.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { ApiResult } from "../client/api";
import {
  decisionBreakdown,
  spendPerDay,
  toStudioRows,
} from "../studio/aggregate";
import {
  DEFAULT_STATE,
  LAYOUT_KEY,
  loadSavedState,
  resetSavedState,
  saveState,
  type StorageLike,
} from "../studio/layout";
import { createOwnerStore } from "../studio/ownerStore";
import type { Intent } from "../types";

const base: Intent = {
  id: "i1",
  agentId: "a1",
  amountCents: 1000,
  currency: "USD",
  payee: "shop.test",
  category: "office",
  description: "<script>x</script>",
  justification: "j",
  paymentMethodId: "vm1",
  state: "captured",
  decision: "approve",
  riskScore: 10,
  createdAt: "2030-01-02T10:00:00.000Z",
};

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("aggregates", () => {
  it("spendPerDay sums captured integer cents per UTC day and currency", () => {
    const rows: Intent[] = [
      base,
      {
        ...base,
        id: "i2",
        amountCents: 250,
        createdAt: "2030-01-02T23:59:59.000Z",
      },
      {
        ...base,
        id: "i3",
        amountCents: 999,
        createdAt: "2030-01-03T00:00:00.000Z",
      },
      { ...base, id: "i4", amountCents: 5000, state: "escalated" },
      { ...base, id: "i5", amountCents: 300, currency: "EUR" },
    ];
    expect(spendPerDay(rows)).toEqual([
      { day: "2030-01-02", currency: "EUR", amountCents: 300 },
      { day: "2030-01-02", currency: "USD", amountCents: 1250 },
      { day: "2030-01-03", currency: "USD", amountCents: 999 },
    ]);
  });

  it("decisionBreakdown counts approved, escalated and denied, 0 when missing", () => {
    expect(decisionBreakdown([])).toEqual({
      approved: 0,
      escalated: 0,
      denied: 0,
    });
    expect(
      decisionBreakdown([
        base,
        { ...base, decision: "escalate" },
        { ...base, decision: "deny" },
        { ...base, decision: null },
      ])
    ).toEqual({
      approved: 1,
      escalated: 1,
      denied: 1,
    });
  });

  it("toStudioRows keeps integer cents and plain strings", () => {
    expect(toStudioRows([base])[0]).toMatchObject({
      amountCents: 1000,
      day: "2030-01-02",
      decision: "approve",
    });
  });

  // Feature: spec-09b-ag-studio, Property 3: spend per day conserves totals
  it("Property 3: per currency, the bars sum to the total of captured amounts", () => {
    const rowArb = fc.record({
      state: fc.constantFrom<Intent["state"]>(
        "captured",
        "authorized",
        "denied",
        "escalated"
      ),
      currency: fc.constantFrom("USD", "EUR"),
      amountCents: fc.integer({ min: 0, max: 10_000_000 }),
      createdAt: fc
        .date({ min: new Date("2029-01-01"), max: new Date("2031-01-01") })
        .map((d) => d.toISOString()),
    });
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 60 }), (rows) => {
        const bars = spendPerDay(rows);
        for (const cur of ["USD", "EUR"]) {
          const total = rows
            .filter((r) => r.state === "captured" && r.currency === cur)
            .reduce((s, r) => s + r.amountCents, 0);
          expect(
            bars
              .filter((b) => b.currency === cur)
              .reduce((s, b) => s + b.amountCents, 0)
          ).toBe(total);
        }
        expect(bars.every((b) => Number.isSafeInteger(b.amountCents))).toBe(
          true
        );
      }),
      { numRuns: 200 }
    );
  });
});

describe("layout persistence", () => {
  it("default layout holds the three custom widgets plus the intents grid", () => {
    const types = Object.values(DEFAULT_STATE.pages[0].widgets).map(
      (w) => w.type
    );
    expect(types).toEqual([
      "ap-spend-per-day",
      "ap-decisions",
      "ap-escalation-queue",
      "grid",
    ]);
  });

  it("loads saved state when valid, falls back to default when missing or corrupt", () => {
    const s = memoryStorage();
    expect(loadSavedState(s)).toBe(DEFAULT_STATE);
    expect(loadSavedState(null)).toBe(DEFAULT_STATE);
    saveState(s, { pages: [{ id: "mine" }], selectedPageId: "mine" });
    expect(loadSavedState(s)).toEqual({
      pages: [{ id: "mine" }],
      selectedPageId: "mine",
    });
    for (const bad of [
      "{not json",
      "[]",
      '{"pages":[]}',
      '{"pages":[{"x":1}]}',
      "null",
    ]) {
      s.map.set(LAYOUT_KEY, bad);
      expect(loadSavedState(s)).toBe(DEFAULT_STATE);
    }
    resetSavedState(s);
    expect(s.map.has(LAYOUT_KEY)).toBe(false);
  });

  it("storage failures never throw", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadSavedState(broken)).toBe(DEFAULT_STATE);
    expect(() => saveState(broken, {})).not.toThrow();
    expect(() => resetSavedState(broken)).not.toThrow();
  });
});

describe("owner store", () => {
  const ok = <T>(data: T): ApiResult<T> => ({ ok: true, status: 200, data });
  const escalated = {
    ...base,
    id: "e1",
    state: "escalated" as const,
    decision: "escalate",
  };

  function store(decide: (path: string) => ApiResult<unknown>) {
    const calls: string[] = [];
    let release: (() => void) | null = null;
    const s = createOwnerStore(async <T>(path: string) => {
      calls.push(path);
      if (path === "owner/stats")
        return ok({
          since: "",
          spentToday: [],
          countsByDecision: {},
          countsByState: {},
        }) as ApiResult<T>;
      if (path.startsWith("owner/intents"))
        return ok({ intents: [base, escalated] }) as ApiResult<T>;
      await new Promise<void>((r) => (release = r));
      return decide(path) as ApiResult<T>;
    });
    return { s, calls, release: () => release?.() };
  }

  it("removes an escalated intent optimistically and keeps it out on success", async () => {
    const t = store(() => ok({ intentId: "e1", state: "authorized" }));
    await t.s.refresh();
    expect(t.s.getSnapshot().escalated.map((i) => i.id)).toEqual(["e1"]);
    const p = t.s.decide("e1", "approve");
    await Promise.resolve();
    expect(t.s.getSnapshot().escalated).toEqual([]);
    t.release();
    expect(await p).toBe(true);
    expect(t.s.getSnapshot().escalated).toEqual([]);
    expect(t.calls).toContain("intents/e1/approve");
  });

  it("restores the item with a clear error on 409", async () => {
    const t = store(() => ({
      ok: false,
      status: 409,
      error: "conflict",
      message: "x",
    }));
    await t.s.refresh();
    const p = t.s.decide("e1", "deny");
    await Promise.resolve();
    t.release();
    expect(await p).toBe(false);
    const snap = t.s.getSnapshot();
    expect(snap.escalated.map((i) => i.id)).toEqual(["e1"]);
    expect(snap.decisionErrors["e1"]).toBe(
      "This intent is no longer awaiting approval."
    );
  });

  it("surfaces load errors", async () => {
    const s = createOwnerStore(async () => ({
      ok: false,
      status: 502,
      error: "bad_gateway",
      message: "Upstream error",
    }));
    await s.refresh();
    expect(s.getSnapshot()).toMatchObject({
      error: "Upstream error",
      loaded: true,
    });
  });
});
