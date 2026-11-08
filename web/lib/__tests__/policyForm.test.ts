import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  centsToDollarString,
  parseDollarsToCents,
  policyToForm,
  validatePolicyForm,
  type PolicyFormValues,
} from "../policyForm";

const VALID: PolicyFormValues = {
  dailyBudget: "500.00",
  perPurchaseCap: "200",
  allowedCategories: "office, electronics, ,books",
  blockedPayees: "",
  allowedPayees: "",
  velocityPerHour: "10",
  velocityPerDay: "30",
};

describe("parseDollarsToCents", () => {
  it("parses whole and decimal dollars into integer cents", () => {
    expect(parseDollarsToCents("12.34")).toBe(1234);
    expect(parseDollarsToCents("12.3")).toBe(1230);
    expect(parseDollarsToCents("$7")).toBe(700);
    expect(parseDollarsToCents("0")).toBe(0);
    expect(parseDollarsToCents("0.10")).toBe(10);
  });
  it.each(["-1", "1.234", "abc", "", "1,000", "1e3", "12.", ".5"])(
    "rejects %j",
    (s) => {
      expect(parseDollarsToCents(s)).toBeNull();
    }
  );

  // Feature: spec-09a-dashboard, Property 2: dollars and cents round trip
  it("Property 2: parse(format(c)) === c for 0..10^11", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000_000 }), (c) => {
        expect(parseDollarsToCents(centsToDollarString(c))).toBe(c);
      }),
      { numRuns: 500 }
    );
  });
});

describe("validatePolicyForm", () => {
  it("builds a PolicySchema-valid policy; lists trimmed, empty allowedPayees omitted", () => {
    const r = validatePolicyForm(VALID);
    expect(r).toEqual({
      ok: true,
      policy: {
        dailyBudgetCents: 50_000,
        perPurchaseCapCents: 20_000,
        allowedCategories: ["office", "electronics", "books"],
        blockedPayees: [],
        velocityPerHour: 10,
        velocityPerDay: 30,
      },
    });
    if (r.ok) expect(validatePolicyForm(policyToForm(r.policy))).toEqual(r);
  });

  it("returns inline errors per field and no policy when invalid", () => {
    const r = validatePolicyForm({
      ...VALID,
      dailyBudget: "-5",
      perPurchaseCap: "1.999",
      velocityPerHour: "2.5",
      velocityPerDay: "-1",
    });
    expect(r.ok).toBe(false);
    expect(r.ok ? {} : Object.keys(r.errors).sort()).toEqual([
      "dailyBudget",
      "perPurchaseCap",
      "velocityPerDay",
      "velocityPerHour",
    ]);
  });
});
