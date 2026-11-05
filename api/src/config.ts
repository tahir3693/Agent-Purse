export interface ServerConfig {
  host: string; // HOST env or "0.0.0.0"
  port: number; // PORT env (Render-provided) or 3000
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = env.HOST && env.HOST.trim() !== "" ? env.HOST : "0.0.0.0";
  const port = parsePort(env.PORT);
  return { host, port };
}

// Parse PORT, falling back to 3000 for any value that is not a canonical
// integer in [0, 65535]. We compare against the trimmed string rather than
// using Number(), because Number(" ") === 0 and Number("3.0") === 3 would
// otherwise accept whitespace-only and fractional strings as valid ports.
function parsePort(raw: string | undefined): number {
  const DEFAULT_PORT = 3000;
  if (raw === undefined) return DEFAULT_PORT;
  const trimmed = raw.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) return DEFAULT_PORT;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535
    ? parsed
    : DEFAULT_PORT;
}
