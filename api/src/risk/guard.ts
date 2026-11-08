// evaluateRisk: the Risk Guard pipeline (spec-07).
//
// rules -> price check -> injection heuristic -> AI review -> combine.
// Never throws for rule, price or AI failures; they become a RiskDecision.
// Only malformed rule input (GatewayValidationError from evaluateRules) throws.
// Fails closed: any AI problem escalates, nothing here can loosen a decision.

import { evaluateRules as defaultEvaluateRules } from "../gateway/index.js";
import type { PriceCheckInput, PriceCheckResult } from "../channel3/index.js";
import { combine } from "./combine.js";
import { detectInjection } from "./injection.js";
import type { ReviewRequest, RiskReviewer } from "./reviewer.js";
import { parseAiReview } from "./schema.js";
import type { AiResult, RiskDecision, RiskGuardConfig, RiskInput } from "./types.js";

export interface RiskGuardDeps {
  /** Deterministic rules engine; defaults to the gateway implementation. */
  evaluateRules?: typeof defaultEvaluateRules;
  /** Channel3 price check. Errors are mapped to `unknown`. */
  priceCheck: (input: PriceCheckInput) => Promise<PriceCheckResult>;
  /** null when AI_PROVIDER=off: no AI call is made. */
  reviewer: RiskReviewer | null;
  config: RiskGuardConfig;
  /** Clock in epoch ms; defaults to Date.now. */
  now?: () => number;
}

const UNKNOWN_PRICE: PriceCheckResult = { status: "unknown", medianCents: null, sampleSize: 0 };

class AiTimeoutError extends Error {
  constructor() {
    super("AI review timed out");
    this.name = "AiTimeoutError";
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

/** Call the reviewer with a hard timeout and map every failure to an AiResult. */
async function runReview(
  reviewer: RiskReviewer | null,
  req: ReviewRequest,
  timeoutMs: number,
): Promise<AiResult> {
  if (reviewer === null) return { outcome: "disabled" };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new AiTimeoutError());
      controller.abort();
    }, timeoutMs);
  });

  let raw: unknown;
  try {
    // Race so a reviewer that ignores the signal still cannot hang the guard.
    const call = reviewer.review(req, { signal: controller.signal });
    call.catch(() => undefined); // avoid unhandled rejection if the timeout wins
    raw = await Promise.race([call, timeout]);
  } catch (err) {
    if (err instanceof AiTimeoutError || isAbortError(err)) return { outcome: "ai_timeout" };
    return { outcome: "ai_error" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  const parsed = parseAiReview(raw);
  return parsed.ok ? { outcome: "ok", review: parsed.review } : { outcome: "ai_parse" };
}

export async function evaluateRisk(deps: RiskGuardDeps, input: RiskInput): Promise<RiskDecision> {
  const { priceCheck, reviewer, config } = deps;
  const rulesFn = deps.evaluateRules ?? defaultEvaluateRules;
  const nowMs = (deps.now ?? Date.now)();
  const { intent } = input;

  // 1. Deterministic rules first. On failure, nothing else runs.
  const rules = rulesFn(intent, input.policy, input.history, nowMs);
  if (!rules.passed) {
    return combine(
      {
        rules,
        price: UNKNOWN_PRICE,
        injectionHit: false,
        ai: { outcome: "ai_error" },
        amountCents: intent.amountCents,
      },
      config,
    );
  }

  // 2. Price check (total by contract, but guard anyway).
  const title = input.title ?? intent.description ?? "";
  const priceInput: PriceCheckInput = {
    title,
    amountCents: intent.amountCents,
    currency: intent.currency,
    ...(input.productId !== undefined ? { productId: input.productId } : {}),
  };
  let price: PriceCheckResult;
  try {
    price = await priceCheck(priceInput);
  } catch {
    price = UNKNOWN_PRICE;
  }

  // 3. Deterministic injection heuristic over all untrusted text.
  const injection = detectInjection([
    intent.description,
    input.justification,
    intent.payee,
    intent.category,
    input.title,
  ]);

  // 4. AI review with timeout.
  const req: ReviewRequest = {
    payee: intent.payee,
    description: intent.description ?? "",
    justification: input.justification,
    amountCents: intent.amountCents,
    currency: intent.currency,
    priceStatus: price.status,
    ...(intent.category !== undefined ? { category: intent.category } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.productId !== undefined ? { productId: input.productId } : {}),
  };
  const ai = await runReview(reviewer, req, config.aiTimeoutMs);

  // 5. Combine (can only keep or tighten).
  return combine(
    { rules, price, injectionHit: injection.hit, ai, amountCents: intent.amountCents },
    config,
  );
}
