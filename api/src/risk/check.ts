// pnpm demo:check. Loads the root .env (node --env-file-if-exists). Prints one line
// for the provider selected by AI_PROVIDER (anthropic | gemini | openai | off).
import { formatAiCheck, runAiCheck } from "./aiCheck.js";
import { loadAiConfig, loadAiTimeoutMs } from "./config.js";

async function main(): Promise<void> {
  let config;
  let timeoutMs;
  try {
    config = loadAiConfig(process.env);
    timeoutMs = loadAiTimeoutMs(process.env, config.provider);
  } catch (err) {
    // Names the variable only.
    console.error(
      err instanceof Error ? err.message : "Invalid AI configuration"
    );
    process.exitCode = 1;
    return;
  }
  const result = await runAiCheck(config, undefined, timeoutMs);
  console.log(formatAiCheck(result));
  if (!result.ok) process.exitCode = 1;
}

void main();
