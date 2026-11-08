// Builds the RiskReviewer for the selected AI_PROVIDER. `null` means AI review
// is disabled (AI_PROVIDER=off): the guard then makes no AI call at all.

import { AnthropicRiskReviewer } from "./anthropic.js";
import type { AiConfig } from "./config.js";
import type { DiagLogger } from "./diagnostics.js";
import { GeminiRiskReviewer } from "./gemini.js";
import type { RiskReviewer } from "./reviewer.js";

export function createRiskReviewer(
  config: AiConfig,
  opts: { timeoutMs?: number; logger?: DiagLogger; fetch?: (u: string, i: RequestInit) => Promise<Response> } = {},
): RiskReviewer | null {
  const common = {
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  };
  switch (config.provider) {
    case "off":
      return null;
    case "gemini":
      return new GeminiRiskReviewer({ config: { apiKey: config.apiKey, model: config.model }, ...common });
    case "anthropic":
      return new AnthropicRiskReviewer({ config: { apiKey: config.apiKey, model: config.model }, ...common });
  }
}
