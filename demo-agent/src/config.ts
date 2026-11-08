// Demo agent config. Reads exactly four names; messages name variables, never values.

export const DEFAULT_API_BASE_URL = "http://localhost:8080";
const REQUIRED = [
  "DEMO_AGENT_KEY",
  "DEMO_PAYMENT_METHOD_ID",
  "CHANNEL3_API_KEY",
] as const;

export interface DemoConfig {
  apiBaseUrl: string;
  agentKey: string;
  paymentMethodId: string;
  channel3ApiKey: string;
}

export type ConfigResult =
  { ok: true; config: DemoConfig } | { ok: false; message: string };

export function loadConfig(
  env: Record<string, string | undefined>
): ConfigResult {
  for (const name of REQUIRED) {
    if (!env[name]?.trim()) {
      return {
        ok: false,
        message: `Missing required environment variable: ${name}`,
      };
    }
  }
  const rawBase = env["DEMO_API_BASE_URL"]?.trim() || DEFAULT_API_BASE_URL;
  try {
    const u = new URL(rawBase);
    if (u.protocol !== "http:" && u.protocol !== "https:")
      throw new Error("protocol");
    if (u.username || u.password) throw new Error("credentials");
  } catch {
    return {
      ok: false,
      message: "Invalid environment variable: DEMO_API_BASE_URL",
    };
  }
  return {
    ok: true,
    config: {
      apiBaseUrl: rawBase.replace(/\/+$/, ""),
      agentKey: env["DEMO_AGENT_KEY"]!.trim(),
      paymentMethodId: env["DEMO_PAYMENT_METHOD_ID"]!.trim(),
      channel3ApiKey: env["CHANNEL3_API_KEY"]!.trim(),
    },
  };
}
