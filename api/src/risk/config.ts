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
