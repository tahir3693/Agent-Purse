// pnpm demo:check. Loads the root .env (node --env-file-if-exists). Prints one line
// for the provider selected by AI_PROVIDER (anthropic | gemini | off).
import { formatAiCheck, runAiCheck } from "./aiCheck.js";
import { loadAiConfig } from "./config.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadAiConfig(process.env);
  } catch (err) {
    // Names the variable only.
    console.error(
      err instanceof Error ? err.message : "Invalid AI configuration"
    );
    process.exitCode = 1;
    return;
  }
  const result = await runAiCheck(config);
  console.log(formatAiCheck(result));
  if (!result.ok) process.exitCode = 1;
}

void main();
