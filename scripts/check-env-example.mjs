// Fails if .env.example holds anything other than an obvious placeholder.
// Allowlist approach: a value passes only if it matches a known-safe shape.
// On failure prints variable NAMES only, never values.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] ?? join(root, ".env.example");

const SAFE_LITERALS = new Set([
  "braintree",
  "paypal",
  "sandbox",
  "claude-sonnet-5-5",
]);
const SAFE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "api-m.sandbox.paypal.com",
]);
const MAX_LEN = 80;
// Non-secret configuration: never fails the check.
const NON_SECRET = new Set([
  "AI_MODEL",
  "PORT",
  "HOST",
  "PAYMENT_PROVIDER",
  "BRAINTREE_ENV",
  "APP_BASE_URL",
  "API_BASE_URL",
  "WEB_ORIGIN",
  "NEXT_PUBLIC_API_BASE_URL",
  "PAYPAL_BASE_URL",
]);

// Key-shaped values: embedded URL credentials, common key prefixes, long opaque tokens.
function looksSecret(raw) {
  const v = raw.trim().replace(/^(["'])(.*)\1$/, "$2");
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i.test(v)) return true;
  if (/\b(sk|pk|rk)[-_][A-Za-z0-9_-]{8,}/.test(v)) return true;
  if (/\b(access_token|sandbox_)[A-Za-z0-9_$]{8,}/.test(v)) return true;
  if (/[A-Za-z0-9+/_=-]{32,}/.test(v)) return true;
  return false;
}

function isPlaceholder(raw) {
  const v = raw.trim().replace(/^(["'])(.*)\1$/, "$2");
  if (v === "") return true;
  if (v.length > MAX_LEN) return false;
  if (SAFE_LITERALS.has(v)) return true;
  // replace-with-..., your-...-key
  if (/^(replace|your)[-_a-z0-9]*$/i.test(v)) return true;
  // Generic connection string template: USER:PASSWORD@HOST
  if (
    /^[a-z][a-z0-9+.-]*:\/\/USER:PASSWORD@HOST(:\d+)?(\/[A-Za-z0-9_]*)?$/.test(
      v
    )
  )
    return true;
  // URLs on safe hosts without credentials
  try {
    const u = new URL(v);
    if (SAFE_HOSTS.has(u.hostname) && u.username === "" && u.password === "")
      return true;
  } catch {
    // not a URL
  }
  return false;
}

const bad = [];
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
  if (!m) continue;
  if (NON_SECRET.has(m[1])) {
    // Allowlisted config still fails if a credential or key was pasted into it.
    if (looksSecret(m[2])) bad.push(m[1]);
    continue;
  }
  if (!isPlaceholder(m[2])) bad.push(m[1]);
}

if (bad.length > 0) {
  console.error(".env.example contains non-placeholder values for:");
  for (const name of [...new Set(bad)]) console.error(`  - ${name}`);
  console.error("Replace them with placeholders before committing.");
  process.exit(1);
}
console.log(".env.example: all values are placeholders.");
