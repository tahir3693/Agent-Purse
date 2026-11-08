// After `next build`: fails if any server-only secret NAME appears in the
// browser bundle (web/.next/static). Prints names and file paths only.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const dir = join(root, "web", ".next", "static");
const NAMES = [
  "JWT_SECRET",
  "MANDATE_SIGNING_KEY",
  "CHANNEL3_API_KEY",
  "BRAINTREE_PRIVATE_KEY",
  "PAYPAL_CLIENT_SECRET",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "DATABASE_URL",
  "BRAINTREE_PUBLIC_KEY",
];
// API_BASE_URL is server-only too; NEXT_PUBLIC_API_BASE_URL is allowed.
const SERVER_API_BASE = /(?<!NEXT_PUBLIC_)\bAPI_BASE_URL\b/;

if (!existsSync(dir)) {
  console.error("web/.next/static not found. Run the web build first.");
  process.exit(1);
}
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs|css|html|json)$/.test(n)) files.push(p);
  }
};
walk(dir);
const hits = [];
for (const f of files) {
  const t = readFileSync(f, "utf8");
  for (const n of NAMES) {
    if (t.includes(n)) hits.push(`${relative(root, f)}: ${n}`);
  }
  if (SERVER_API_BASE.test(t)) hits.push(`${relative(root, f)}: API_BASE_URL`);
}
if (hits.length) {
  console.error("Client bundle references server-only names:");
  for (const h of hits) console.error(`  - ${h}`);
  process.exit(1);
}
console.log(
  `Client bundle clean: ${files.length} file(s), no server-only names.`
);
