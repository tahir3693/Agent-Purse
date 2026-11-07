// Web env (spec-04). Only three names are read: API_BASE_URL (server only),
// NEXT_PUBLIC_API_BASE_URL and NEXT_PUBLIC_AG_GRID_LICENSE_KEY. No server
// secrets live here. Messages name variables, never values.

export type ServerEnv =
  | { ok: true; apiBaseUrl: string }
  | { ok: false; missing: "API_BASE_URL"; invalid?: boolean };

export function envErrorMessage(name: string, invalid = false): string {
  return invalid
    ? `Invalid environment variable: ${name}`
    : `Missing required environment variable: ${name}`;
}

/** Server-side only. Trailing slashes are removed. */
export function getServerEnv(
  env: Record<string, string | undefined> = process.env
): ServerEnv {
  const raw = env["API_BASE_URL"]?.trim();
  if (!raw) return { ok: false, missing: "API_BASE_URL" };
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:")
      throw new Error("protocol");
  } catch {
    return { ok: false, missing: "API_BASE_URL", invalid: true };
  }
  return { ok: true, apiBaseUrl: raw.replace(/\/+$/, "") };
}

export interface PublicEnv {
  apiBaseUrl: string | null;
  agGridLicenseKey: string | null;
}

/**
 * Browser-visible config. Each NEXT_PUBLIC_ name is read as a literal process.env member so
 * Next inlines them at build time (set them in Vercel before building).
 */
export function getPublicEnv(): PublicEnv {
  return {
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || null,
    agGridLicenseKey:
      process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY?.trim() || null,
  };
}

export function missingPublicEnv(env: PublicEnv = getPublicEnv()): string[] {
  const missing: string[] = [];
  if (!env.apiBaseUrl) missing.push("NEXT_PUBLIC_API_BASE_URL");
  if (!env.agGridLicenseKey) missing.push("NEXT_PUBLIC_AG_GRID_LICENSE_KEY");
  return missing;
}
