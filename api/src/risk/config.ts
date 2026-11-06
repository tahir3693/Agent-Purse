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
