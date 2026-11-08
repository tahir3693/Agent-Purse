// Anthropic config loader. Errors name the variable only, never a value.

export const DEFAULT_AI_MODEL = "claude-sonnet-5-5";

export interface AnthropicConfig {
  apiKey: string;
  model: string;
}

export function loadAnthropicConfig(env: NodeJS.ProcessEnv): AnthropicConfig {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing required environment variable: ANTHROPIC_API_KEY");
  }
  const model = env.AI_MODEL?.trim() || DEFAULT_AI_MODEL;
  return { apiKey, model };
}

// --- Switchable AI provider -------------------------------------------------

/** Free-tier Flash model id from the Gemini API models and pricing docs. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export const AI_PROVIDERS = ["anthropic", "gemini", "off"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const DEFAULT_ANTHROPIC_TIMEOUT_MS = 15_000;
export const DEFAULT_GEMINI_TIMEOUT_MS = 12_000;
/** Hard cap so a purchase request never hangs on the AI review. */
export const MAX_AI_TIMEOUT_MS = 25_000;

/**
 * AI review timeout in ms from optional AI_TIMEOUT_MS: a positive integer,
 * values above MAX_AI_TIMEOUT_MS are capped. Defaults per provider.
 */
export function loadAiTimeoutMs(env: NodeJS.ProcessEnv, provider: AiProvider): number {
  const raw = env.AI_TIMEOUT_MS?.trim();
  if (!raw) return provider === "gemini" ? DEFAULT_GEMINI_TIMEOUT_MS : DEFAULT_ANTHROPIC_TIMEOUT_MS;
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error("Invalid environment variable: AI_TIMEOUT_MS (must be a positive integer, in milliseconds)");
  }
  return Math.min(n, MAX_AI_TIMEOUT_MS);
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
}

export type AiConfig =
  | ({ provider: "anthropic" } & AnthropicConfig)
  | ({ provider: "gemini" } & GeminiConfig)
  | { provider: "off" };

/**
 * Reads AI_PROVIDER (default anthropic). Only the selected provider's key is
 * required; errors name the variable only, never a value.
 */
export function loadAiConfig(env: NodeJS.ProcessEnv): AiConfig {
  const raw = env.AI_PROVIDER?.trim().toLowerCase() || "anthropic";
  if (!(AI_PROVIDERS as readonly string[]).includes(raw)) {
    throw new Error("Invalid environment variable: AI_PROVIDER (must be anthropic, gemini or off)");
  }
  const provider = raw as AiProvider;
  if (provider === "off") return { provider };
  if (provider === "anthropic") return { provider, ...loadAnthropicConfig(env) };

  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing required environment variable: GEMINI_API_KEY");
  const model = env.AI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  if (/^claude/i.test(model)) {
    throw new Error("Invalid environment variable: AI_MODEL (a Claude model id cannot be used with AI_PROVIDER=gemini)");
  }
  return { provider, apiKey, model };
}
