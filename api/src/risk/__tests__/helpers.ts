// Shared fakes and builders for risk guard tests. No live calls, no real keys.

import type { Policy, RuleIntent } from "@agentpurse/shared";

import type { PriceCheckInput, PriceCheckResult } from "../../channel3/index.js";
import type { RiskGuardDeps } from "../guard.js";
import type { ReviewRequest, RiskReviewer } from "../reviewer.js";
import type { RiskGuardConfig, RiskInput } from "../types.js";

export const NOW = 1_700_000_000_000;

export const CONFIG: RiskGuardConfig = {
  autoApproveBelowCents: 5_000,
  maxAutoApproveRisk: 40,
  aiTimeoutMs: 50,
};

export function intent(overrides: Partial<RuleIntent> = {}): RuleIntent {
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

export function policy(overrides: Partial<Policy> = {}): Policy {
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

export function riskInput(
  intentOverrides: Partial<RuleIntent> = {},
  extra: Partial<RiskInput> = {},
): RiskInput {
  return {
    intent: intent(intentOverrides),
    justification: "needed for the project",
    policy: policy(),
    history: [],
    ...extra,
  };
}

export const OK_REVIEW = {
  approved: true,
  riskScore: 10,
  reason: "looks fine",
  flagPromptInjection: false,
};

export function price(status: PriceCheckResult["status"]): PriceCheckResult {
  return { status, medianCents: status === "unknown" ? null : 1_000, sampleSize: 3 };
}

export interface Spy<A extends unknown[], R> {
  (...args: A): R;
  calls: A[];
}

export function fakePrice(
  result: PriceCheckResult | Error,
): RiskGuardDeps["priceCheck"] & { calls: PriceCheckInput[] } {
  const calls: PriceCheckInput[] = [];
  const fn = async (input: PriceCheckInput): Promise<PriceCheckResult> => {
    calls.push(input);
    if (result instanceof Error) throw result;
    return result;
  };
  return Object.assign(fn, { calls });
}

export type ReviewerBehavior =
  | { kind: "value"; value: unknown }
  | { kind: "throw"; error?: Error }
  | { kind: "hang" };

export class FakeReviewer implements RiskReviewer {
  readonly requests: ReviewRequest[] = [];
  constructor(private readonly behavior: ReviewerBehavior) {}

  async review(req: ReviewRequest): Promise<unknown> {
    this.requests.push(req);
    switch (this.behavior.kind) {
      case "value":
        return this.behavior.value;
      case "throw":
        throw this.behavior.error ?? new Error("boom");
      case "hang":
        return new Promise<never>(() => undefined); // ignores the signal on purpose
    }
  }
}

export function deps(
  reviewer: RiskReviewer,
  priceResult: PriceCheckResult | Error = price("ok"),
  config: RiskGuardConfig = CONFIG,
): RiskGuardDeps & { priceCheck: ReturnType<typeof fakePrice> } {
  return {
    priceCheck: fakePrice(priceResult),
    reviewer,
    config,
    now: () => NOW,
  };
}
