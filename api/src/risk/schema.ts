// Strict validation of the RiskReviewer's raw output (Requirement 3.1).
//
// Extra keys and wrong types are rejected. Parsing never throws; callers map a
// failed parse to the `ai_parse` outcome (fail closed).

import { z } from "zod";

import type { AiReview } from "./types.js";

export const AiReviewSchema = z
  .object({
    approved: z.boolean(),
    riskScore: z.number().int().min(0).max(100),
    reason: z.string(),
    flagPromptInjection: z.boolean(),
  })
  .strict();

export type ParseAiReviewResult = { ok: true; review: AiReview } | { ok: false };

/** Strip an optional ```json fence some models wrap around JSON output. */
function stripFence(text: string): string {
  const match = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return match ? match[1]! : text;
}

/**
 * Parse raw reviewer output (a JSON string or an already-decoded value) into
 * an AiReview. Total: returns `{ ok: false }` on any failure and never throws.
 */
export function parseAiReview(raw: unknown): ParseAiReviewResult {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(stripFence(raw));
    } catch {
      return { ok: false };
    }
  }
  const parsed = AiReviewSchema.safeParse(value);
  return parsed.success ? { ok: true, review: parsed.data } : { ok: false };
}
