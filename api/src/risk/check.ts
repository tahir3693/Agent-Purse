// pnpm demo:check. Loads the root .env (node --env-file-if-exists). Prints one line.
import { formatAiCheck, runAiCheck } from "./aiCheck.js";
import { loadAnthropicConfig } from "./config.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadAnthropicConfig(process.env);
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
