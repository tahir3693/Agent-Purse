// PayPal config loader.
//
// Reads PayPal's server-side configuration from the environment. The client
// secret is a server-side secret and is NEVER logged, printed, copied, or
// included in an error message. On a missing/blank variable we throw an error
// that names the variable only - never its value (.kiro/steering/money-rules.md,
// Requirements 1.1, 1.2, 1.3).

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

// Variables are checked in this order; the FIRST missing/blank one is reported.
const REQUIRED_VARS = [
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_BASE_URL",
] as const;

/**
 * Load PayPal config from the environment.
 *
 * Reads and trims PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_BASE_URL.
 * If any is missing or blank, throws `Error("Missing required environment
 * variable: <NAME>")` for the first offender, naming the variable only and
 * never exposing a value (Requirements 1.2, 1.3).
 */
export function loadPayPalConfig(env: NodeJS.ProcessEnv): PayPalConfig {
  const values: Record<(typeof REQUIRED_VARS)[number], string> = {
    PAYPAL_CLIENT_ID: "",
    PAYPAL_CLIENT_SECRET: "",
    PAYPAL_BASE_URL: "",
  };

  for (const name of REQUIRED_VARS) {
    const trimmed = env[name]?.trim();
    if (!trimmed) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    values[name] = trimmed;
  }

  return {
    clientId: values.PAYPAL_CLIENT_ID,
    clientSecret: values.PAYPAL_CLIENT_SECRET,
    baseUrl: values.PAYPAL_BASE_URL,
  };
}
