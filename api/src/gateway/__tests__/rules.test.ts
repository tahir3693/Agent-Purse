// Deterministic unit tests for the gateway rules engine (spec-05).
//
// Requirements 6.1, 6.3: each rule pass+fail, first-failure ordering, every
// boundary equality (amount == cap passes; spent+amount == budget passes;
// count == limit fails), currency exclusion from spend, velocity window
// exclusion, remainingBudgetCents present+non-negative in all results,
// validation errors naming the field without leaking values, and the
// secret-free toAuditMeta projection.
//
// All tests pass an explicit nowMs; there are no live calls, timers, or I/O.
// A single base builder produces a passing intent/policy/history; each test
// varies exactly one thing so the asserted branch is isolated.

import { describe, expect, it } from "vitest";

import type { Policy, RuleIntent, TransactionRecord } from "@agentpurse/shared";

import { toAuditMeta } from "../audit.js";
import { GatewayValidationError } from "../errors.js";
import { evaluateRules } from "../rules.js";
import { DAY_MS, HOUR_MS } from "../velocity.js";

// Fixed clock for every test. Chosen arbitrarily but large enough that
// `now - 24h` stays positive.
const NOW = 1_700_000_000_000;

/** A base intent that passes every rule given the base policy and empty history. */
function baseIntent(overrides: Partial<RuleIntent> = {}): RuleIntent {
  return {
    agentId: "agent-1",
    payee: "example.com",
    amountCents: 1_000,
    currency: "USD",
    category: "software",
    description: "a routine purchase",
    ...overrides,
  };
}

/** A base policy with generous limits so only the varied field can fail. */
function basePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    dailyBudgetCents: 100_000,
    perPurchaseCapCents: 50_000,
    allowedCategories: [],
    blockedPayees: [],
    velocityPerHour: 10,
    velocityPerDay: 20,
    ...overrides,
  };
}

/** A history record defaulting to same-currency, in-window. */
function record(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    amountCents: 500,
    currency: "USD",
    payee: "example.com",
    createdAtMs: NOW - 1_000,
    ...overrides,
  };
}

describe("evaluateRules - all pass", () => {
  it("returns passed=true with remainingBudgetCents and no matchedRule/reason", () => {
    const result = evaluateRules(baseIntent(), basePolicy(), [], NOW);
    expect(result.passed).toBe(true);
    expect(result.matchedRule).toBeUndefined();
    expect(result.reason).toBeUndefined();
    // 100_000 budget, nothing spent.
    expect(result.remainingBudgetCents).toBe(100_000);
  });

  it("subtracts same-currency in-window history from remaining budget on a pass", () => {
    const history = [record({ amountCents: 2_500 }), record({ amountCents: 1_500 })];
    const result = evaluateRules(baseIntent(), basePolicy(), history, NOW);
    expect(result.passed).toBe(true);
    expect(result.remainingBudgetCents).toBe(100_000 - 4_000);
  });
});

describe("payee_blocked", () => {
  it("fails when payee is in blockedPayees", () => {
    const result = evaluateRules(
      baseIntent({ payee: "bad.com" }),
      basePolicy({ blockedPayees: ["bad.com"] }),
      [],
      NOW,
    );
    expect(result.passed).toBe(false);
    expect(result.matchedRule).toBe("payee_blocked");
    expect(result.remainingBudgetCents).toBe(100_000);
  });

  it("passes when payee is not blocked", () => {
    const result = evaluateRules(
      baseIntent({ payee: "good.com" }),
      basePolicy({ blockedPayees: ["bad.com"] }),
      [],
      NOW,
    );
    expect(result.passed).toBe(true);
  });
});

describe("payee_not_allowed", () => {
  it("fails when allowedPayees is set and payee is not listed", () => {
    const result = evaluateRules(
      baseIntent({ payee: "other.com" }),
      basePolicy({ allowedPayees: ["example.com"] }),
      [],
      NOW,
    );
    expect(result.passed).toBe(false);
    expect(result.matchedRule).toBe("payee_not_allowed");
  });

  it("passes when allowedPayees is set and payee is listed", () => {
    const result = evaluateRules(
      baseIntent({ payee: "example.com" }),
      basePolicy({ allowedPayees: ["example.com", "other.com"] }),
      [],
      NOW,
    );
    expect(result.passed).toBe(true);
  });

  it("treats an empty allowedPayees array as unrestricted (passes)", () => {
    const result = evaluateRules(
      baseIntent({ payee: "anything.com" }),
      basePolicy({ allowedPayees: [] }),
      [],
      NOW,
    );
    expect(result.passed).toBe(true);
  });
});

describe("category_not_allowed", () => {
  it("fails when allowedCategories is set and category is missing", () => {
    const result = evaluateRules(
      baseIntent({ category: undefined }),
      basePolicy({ allowedCategories: ["software"] }),
      [],
      NOW,
    );
    expect(result.passed).toBe(false);
    expect(result.matchedRule).toBe("category_not_allowed");
  });

  it("fails when allowedCategories is set and category is not listed", () => {
    const result = evaluateRules(
      baseIntent({ category: "hardware" }),
      basePolicy({ allowedCategories: ["software"] }),
      [],
      NOW,
    );
    expect(result.passed).toBe(false);
    expect(result.matchedRule).toBe("category_not_allowed");
  });

  it("passes when allowedCategories is set and category is listed", () => {
    const result = evaluateRules(
      baseIntent({ category: "software" }),
      basePolicy({ allowedCategories: ["software", "hardware"] }),
      [],
      NOW,
    );
    expect(result.passed).toBe(true);
  });

  it("treats an empty allowedCategories array as unrestricted (passes)", () => {
    const result = evaluateRules(
      baseIntent({ category: undefined }),
      basePolicy({ allowedCategories: [] }),
      [],
      NOW,
    );
    expect(result.passed).toBe(true);
  });
});

describe("per_purchase_cap boundaries", () => {
  it("fails when amount > cap", () => {
    const result = evaluateRules(
      baseIntent({ amountCents: 50_001 }),
      basePolicy({ perPurchaseCapCents: 50_000 }),
      [],
      NOW,
    );
    expect(result.passed).toBe(false);
    expect(result.matchedRule).toBe("per_purchase_cap");
  });

  it("passes when amount == cap (inclusive boundary)", () => {
    const result = evaluateRules(
      baseIntent({ amountCents: 50_000 }),
      basePolicy({ perPurchaseCapCents: 50_000 }),
      [],
      NOW,
    );
    expect(result.passed).toBe(true);
  });

  it("passes when amount < cap", () => {
    const result = evaluateRules(
      baseIntent({ amountCents: 49_999 }),
      basePolicy({ perPurchaseCapCents: 50_000 }),
      [],
      NOW,
    );
    expect(result.passed).toBe(true);
  });
});

describe("daily_budget boundaries", () => {
  it("fails when spent + amount > budget", () => {
    const history = [record({ amountCents: 9_001 })];
    const result = evaluateRules(
      baseIntent({ amountCents: 1_000 }),
      basePolicy({ dailyBudgetCents: 10_000 }),
      history,
      NOW,
    );
    expect(result.passed).toBe(false);
    expect(result.matchedRule).toBe("daily_budget");
    // spent 9_001 -> remaining 999.
    expect(result.remainingBudgetCents).toBe(999);
  });

  it("passes when spent + amount == budget (inclusive boundary)", () => {
    const history = [record({ amountCents: 9_000 })];
    const result = evaluateRules(
      baseIntent({ amountCents: 1_000 }),
      basePolicy({ dailyBudgetCents: 10_000 }),
      history,
      NOW,
    );
    expect(result.passed).toBe(true);
    expect(result.remainingBudgetCents).toBe(1_000);
  });

  it("excludes currency-mismatched history from spend (huge other-currency record does not fail)", () => {
    const history = [record({ amountCents: 9_999_999, currency: "EUR" })];
    const result = evaluateRules(
      baseIntent({ amountCents: 1_000, currency: "USD" }),
      basePolicy({ dailyBudgetCents: 10_000 }),
      history,
      NOW,
    );
    expect(result.passed).toBe(true);
    // The EUR record contributes nothing to USD spend.
    expect(result.remainingBudgetCents).toBe(10_000);
  });
});

describe("velocity_hour boundaries and window", () => {
  function recentRecords(count: number): TransactionRecord[] {
    // All within the last hour (createdAtMs > now - 1h).
    return Array.from({ length: count }, (_unused, i) =>
      record({ createdAtMs: NOW - (i + 1) * 1_000 }),
    );
  }

  it("fails when in-hour count == velocityPerHour (inclusive ceiling)", () => {
    const result = evaluateRules(
      baseIntent(),
      basePolicy({ velocityPerHour: 3, velocityPerDay: 100 }),
      recentRecords(3),
      NOW,
    );
    expect(result.passed).toBe(false);
    expect(result.matchedRule).toBe("velocity_hour");
  });

  it("passes when in-hour count == limit - 1", () => {
    const result = evaluateRules(
      baseIntent(),
      basePolicy({ velocityPerHour: 3, velocityPerDay: 100 }),
      recentRecords(2),
      NOW,
    );
    expect(result.passed).toBe(true);
  });

  it("excludes records older than 1h from the hourly count", () => {
    // Two records older than one hour (createdAtMs <= now - 1h): excluded.
    const history = [
      record({ createdAtMs: NOW - HOUR_MS }), // exactly 1h old -> excluded (strict lower bound)
      record({ createdAtMs: NOW - HOUR_MS - 1_000 }), // older -> excluded
    ];
    const result = evaluateRules(
      baseIntent(),
      basePolicy({ velocityPerHour: 1, velocityPerDay: 100 }),
      history,
      NOW,
    );
    expect(result.passed).toBe(true);
  });
});

describe("velocity_day boundaries and window", () => {
  function dayRecords(count: number): TransactionRecord[] {
    // Spread across the last day but outside the last hour, so only the
    // daily limit is exercised. Each is >1h old and <24h old.
    return Array.from({ length: count }, (_unused, i) =>
      record({ createdAtMs: NOW - HOUR_MS - (i + 1) * 1_000 }),
    );
  }

  it("fails when in-day count == velocityPerDay (inclusive ceiling)", () => {
    const result = evaluateRules(
      baseIntent(),
      basePolicy({ velocityPerHour: 100, velocityPerDay: 4 }),
      dayRecords(4),
      NOW,
    );
    expect(result.passed).toBe(false);
    expect(result.matchedRule).toBe("velocity_day");
  });

  it("passes when in-day count == limit - 1", () => {
    const result = evaluateRules(
      baseIntent(),
      basePolicy({ velocityPerHour: 100, velocityPerDay: 4 }),
      dayRecords(3),
      NOW,
    );
    expect(result.passed).toBe(true);
  });

  it("excludes records older than 24h from the daily count", () => {
    const history = [
      record({ createdAtMs: NOW - DAY_MS }), // exactly 24h old -> excluded
      record({ createdAtMs: NOW - DAY_MS - 1_000 }), // older -> excluded
    ];
    const result = evaluateRules(
      baseIntent(),
      basePolicy({ velocityPerHour: 100, velocityPerDay: 1 }),
      history,
      NOW,
    );
    expect(result.passed).toBe(true);
  });
});

describe("rule ordering - first failure wins", () => {
  it("reports payee_blocked before per_purchase_cap when both are violated", () => {
    const result = evaluateRules(
      baseIntent({ payee: "bad.com", amountCents: 999_999 }),
      basePolicy({ blockedPayees: ["bad.com"], perPurchaseCapCents: 100 }),
      [],
      NOW,
    );
    expect(result.passed).toBe(false);
    // payee_blocked is earlier in the fixed order than per_purchase_cap.
    expect(result.matchedRule).toBe("payee_blocked");
  });

  it("reports per_purchase_cap before daily_budget when both are violated", () => {
    const history = [record({ amountCents: 999_999 })];
    const result = evaluateRules(
      baseIntent({ amountCents: 999_999 }),
      basePolicy({ perPurchaseCapCents: 100, dailyBudgetCents: 100 }),
      history,
      NOW,
    );
    expect(result.passed).toBe(false);
    expect(result.matchedRule).toBe("per_purchase_cap");
  });
});

describe("remainingBudgetCents invariants", () => {
  it("is present on a passing result", () => {
    const result = evaluateRules(baseIntent(), basePolicy(), [], NOW);
    expect(typeof result.remainingBudgetCents).toBe("number");
  });

  it("is present on a failing result", () => {
    const result = evaluateRules(
      baseIntent({ payee: "bad.com" }),
      basePolicy({ blockedPayees: ["bad.com"] }),
      [],
      NOW,
    );
    expect(typeof result.remainingBudgetCents).toBe("number");
  });

  it("never goes negative when spent exceeds the budget", () => {
    const history = [record({ amountCents: 20_000 })];
    const result = evaluateRules(
      baseIntent({ amountCents: 1 }),
      basePolicy({ dailyBudgetCents: 5_000 }),
      history,
      NOW,
    );
    // spent 20_000 > budget 5_000, so remaining clamps to 0, and the intent
    // also fails on daily_budget.
    expect(result.remainingBudgetCents).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.matchedRule).toBe("daily_budget");
  });
});

describe("input validation throws GatewayValidationError naming the field", () => {
  it("rejects a non-integer amountCents and names intent.amountCents", () => {
    let caught: unknown;
    try {
      evaluateRules(baseIntent({ amountCents: 10.5 }), basePolicy(), [], NOW);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GatewayValidationError);
    const err = caught as GatewayValidationError;
    expect(err.field).toBe("intent.amountCents");
    // Message names the field only, never the offending value.
    expect(err.message).toContain("intent.amountCents");
    expect(err.message).not.toContain("10.5");
  });

  it("rejects a missing agentId and names intent.agentId", () => {
    const bad = { ...baseIntent(), agentId: "" };
    let caught: unknown;
    try {
      evaluateRules(bad, basePolicy(), [], NOW);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GatewayValidationError);
    expect((caught as GatewayValidationError).field).toBe("intent.agentId");
  });

  it("rejects a currency whose length is not 3 and names intent.currency", () => {
    const bad = { ...baseIntent(), currency: "US" };
    let caught: unknown;
    try {
      evaluateRules(bad, basePolicy(), [], NOW);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GatewayValidationError);
    expect((caught as GatewayValidationError).field).toBe("intent.currency");
  });

  it("rejects a malformed policy field and names the policy path", () => {
    const badPolicy = { ...basePolicy(), dailyBudgetCents: -1 };
    let caught: unknown;
    try {
      evaluateRules(baseIntent(), badPolicy, [], NOW);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GatewayValidationError);
    expect((caught as GatewayValidationError).field).toBe("policy.dailyBudgetCents");
  });
});

describe("toAuditMeta", () => {
  it("projects a passing result into structured, secret-free fields", () => {
    const intent = baseIntent();
    const result = evaluateRules(intent, basePolicy(), [], NOW);
    const meta = toAuditMeta(result, intent);
    expect(meta).toEqual({
      agentId: intent.agentId,
      payee: intent.payee,
      amountCents: intent.amountCents,
      currency: intent.currency,
      decision: "pass",
      remainingBudgetCents: result.remainingBudgetCents,
    });
    expect(meta.matchedRule).toBeUndefined();
  });

  it("includes decision=fail and matchedRule on a failing result", () => {
    const intent = baseIntent({ payee: "bad.com" });
    const result = evaluateRules(intent, basePolicy({ blockedPayees: ["bad.com"] }), [], NOW);
    const meta = toAuditMeta(result, intent);
    expect(meta.decision).toBe("fail");
    expect(meta.matchedRule).toBe("payee_blocked");
  });

  it("does NOT include the free-text description", () => {
    const intent = baseIntent({ description: "secretish free text that must not leak" });
    const result = evaluateRules(intent, basePolicy(), [], NOW);
    const meta = toAuditMeta(result, intent);
    expect(meta).not.toHaveProperty("description");
    expect(JSON.stringify(meta)).not.toContain("secretish");
  });
});
