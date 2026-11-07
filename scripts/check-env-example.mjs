// Fails if .env.example holds anything other than an obvious placeholder.
// Allowlist approach: a value passes only if it matches a known-safe shape.
// On failure prints variable NAMES only, never values.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] ?? join(root, ".env.example");

const SAFE_LITERALS = new Set(["braintree", "paypal", "sandbox", "claude-sonnet-5-5"]);
const SAFE_HOSTS = new Set(["localhost", "127.0.0.1", "api-m.sandbox.paypal.com"]);
const MAX_LEN = 80;

function isPlaceholder(raw) {
  const v = raw.trim().replace(/^(["'])(.*)\1$/, "$2");
  if (v === "") return true;
  if (v.length > MAX_LEN) return false;
  if (SAFE_LITERALS.has(v)) return true;
  // replace-with-..., your-...-key
  if (/^(replace|your)[-_a-z0-9]*$/i.test(v)) return true;
  // Generic connection string template: USER:PASSWORD@HOST
  if (/^[a-z][a-z0-9+.-]*:\/\/USER:PASSWORD@HOST(:\d+)?(\/[A-Za-z0-9_]*)?$/.test(v)) return true;
  // URLs on safe hosts without credentials
  try {
    const u = new URL(v);
    if (SAFE_HOSTS.has(u.hostname) && u.username === "" && u.password === "") return true;
  } catch {
    // not a URL
  }
  return false;
}

const bad = [];
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
  if (!m) continue;
  if (!isPlaceholder(m[2])) bad.push(m[1]);
}

if (bad.length > 0) {
  console.error(".env.example contains non-placeholder values for:");
  for (const name of [...new Set(bad)]) console.error(`  - ${name}`);
  console.error("Replace them with placeholders before committing.");
  process.exit(1);
}
console.log(".env.example: all values are placeholders.");
