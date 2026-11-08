// Browser-visible config (spec-04, split out in spec-09a so client code never
// imports the server-only env module). Names only in messages, never values.

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
