// pnpm demo:run --scenario <name|all>. Loads the root .env via node --env-file-if-exists.
import { HttpAgentApi } from "./api.js";
import { createChannel3Catalog } from "./catalog.js";
import { loadConfig } from "./config.js";
import { runScenarios } from "./runner.js";
import { SCENARIO_NAMES } from "./scenarios.js";
import { Transcript } from "./transcript.js";

export type ParsedArgs =
  { ok: true; names: string[] } | { ok: false; message: string };

export function parseArgs(argv: string[]): ParsedArgs {
  let value: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--scenario") value = argv[i + 1];
    else if (a.startsWith("--scenario=")) value = a.slice("--scenario=".length);
  }
  const usage = `Usage: pnpm demo:run --scenario <${[...SCENARIO_NAMES, "all"].join("|")}>`;
  if (!value) return { ok: false, message: `Missing --scenario.\n${usage}` };
  if (value === "all") return { ok: true, names: [...SCENARIO_NAMES] };
  if (!SCENARIO_NAMES.includes(value))
    return { ok: false, message: `Unknown scenario.\n${usage}` };
  return { ok: true, names: [value] };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(args.message);
    process.exitCode = 2;
    return;
  }
  const cfg = loadConfig(process.env);
  if (!cfg.ok) {
    console.error(cfg.message);
    process.exitCode = 2;
    return;
  }
  const { config } = cfg;
  const transcript = new Transcript();
  transcript.protect(config.agentKey, "hide");
  transcript.protect(config.channel3ApiKey, "hide");
  let catalog;
  try {
    catalog = createChannel3Catalog(process.env);
  } catch (err) {
    console.error(
      err instanceof Error ? err.message : "Channel3 configuration error"
    );
    process.exitCode = 2;
    return;
  }
  process.exitCode = await runScenarios(args.names, {
    api: new HttpAgentApi(config.apiBaseUrl, config.agentKey),
    catalog,
    transcript,
    paymentMethodId: config.paymentMethodId,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
}

// Run only as the entry point, so tests can import parseArgs.
if (process.argv[1] && /cli\.ts$/.test(process.argv[1])) void main();
