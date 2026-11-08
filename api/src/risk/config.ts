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

/**
 * Default model for AI_PROVIDER=openai against Groq. Groq lists it as supporting
 * local tool use and JSON mode, with free-tier rate limits:
 * https://console.groq.com/docs/tool-use (supported models table)
 * https://console.groq.com/docs/rate-limits (free-plan limits for openai/gpt-oss-20b)
 */
export const DEFAULT_OPENAI_MODEL = "openai/gpt-oss-20b";
export const DEFAULT_OPENAI_BASE_URL = "https://api.groq.com/openai/v1";
export const AI_PROVIDERS = ["anthropic", "gemini", "openai", "off"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const DEFAULT_ANTHROPIC_TIMEOUT_MS = 15_000;
export const DEFAULT_GEMINI_TIMEOUT_MS = 12_000;
export const DEFAULT_OPENAI_TIMEOUT_MS = 12_000;
/** Hard cap so a purchase request never hangs on the AI review. */
export const MAX_AI_TIMEOUT_MS = 25_000;

/**
 * AI review timeout in ms from optional AI_TIMEOUT_MS: a positive integer,
 * values above MAX_AI_TIMEOUT_MS are capped. Defaults per provider.
 */
export function loadAiTimeoutMs(env: NodeJS.ProcessEnv, provider: AiProvider): number {
  const raw = env.AI_TIMEOUT_MS?.trim();
  if (!raw) {
    if (provider === "gemini") return DEFAULT_GEMINI_TIMEOUT_MS;
    if (provider === "openai") return DEFAULT_OPENAI_TIMEOUT_MS;
    return DEFAULT_ANTHROPIC_TIMEOUT_MS;
  }
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

/** OpenAI-compatible chat completions (Groq, OpenRouter, ...). baseUrl has no trailing slash. */
export interface OpenAiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * AI_BASE_URL must be an absolute https URL without credentials, query or hash.
 * Trailing slashes are stripped so `${baseUrl}/chat/completions` is always well-formed.
 * Errors name the variable only, never the value.
 */
export function normalizeBaseUrl(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_OPENAI_BASE_URL;
  const invalid = () =>
    new Error("Invalid environment variable: AI_BASE_URL (must be an https URL without credentials, query or hash)");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw invalid();
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export type AiConfig =
  | ({ provider: "anthropic" } & AnthropicConfig)
  | ({ provider: "gemini" } & GeminiConfig)
  | ({ provider: "openai" } & OpenAiConfig)
  | { provider: "off" };

/**
 * Reads AI_PROVIDER (default anthropic). Only the selected provider's key is
 * required; errors name the variable only, never a value.
 */
export function loadAiConfig(env: NodeJS.ProcessEnv): AiConfig {
  const raw = env.AI_PROVIDER?.trim().toLowerCase() || "anthropic";
  if (!(AI_PROVIDERS as readonly string[]).includes(raw)) {
    throw new Error("Invalid environment variable: AI_PROVIDER (must be anthropic, gemini, openai or off)");
  }
  const provider = raw as AiProvider;
  if (provider === "off") return { provider };
  if (provider === "anthropic") return { provider, ...loadAnthropicConfig(env) };
  if (provider === "openai") {
    const key = env.AI_API_KEY?.trim();
    if (!key) throw new Error("Missing required environment variable: AI_API_KEY");
    const baseUrl = normalizeBaseUrl(env.AI_BASE_URL);
    const m = env.AI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
    if (/^claude/i.test(m)) {
      throw new Error("Invalid environment variable: AI_MODEL (a Claude model id cannot be used with AI_PROVIDER=openai)");
    }
    return { provider, apiKey: key, baseUrl, model: m };
  }

  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing required environment variable: GEMINI_API_KEY");
  const model = env.AI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  if (/^claude/i.test(model)) {
    throw new Error("Invalid environment variable: AI_MODEL (a Claude model id cannot be used with AI_PROVIDER=gemini)");
  }
  return { provider, apiKey, model };
}
