// Scans ADDED lines of the staged diff for credential-shaped content.
// Prints file paths and pattern names only, never the matched values.
// Test fixtures must use the explicit "test-only-" prefix to pass the assigned_secret check.
import { execFileSync } from "node:child_process";

const PATTERNS = [
  ["private_key_block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["url_with_password", /[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"`]+:[^\s/@'"`]{6,}@(?!HOST\b)[^\s/'"`]+/i],
  ["sk_or_pk_key", /\b(sk|pk|rk)_(live|test)?_?[A-Za-z0-9]{16,}/],
  ["anthropic_key", /\bsk-ant-[A-Za-z0-9_-]{16,}/],
  ["aws_access_key", /\bAKIA[0-9A-Z]{16}\b/],
  ["github_token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["braintree_token", /\baccess_token\$(sandbox|production)\$[A-Za-z0-9$]{10,}/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["assigned_secret", /\b[A-Z0-9_]*(SECRET|PRIVATE_KEY|API_KEY|PASSWORD)\s*=\s*["']?(?!replace-with|your-|test-only-|\$|process\.env|<)[A-Za-z0-9+/_=$.-]{16,}/],
];
const FORBIDDEN_PATHS = [/^\.env$/, /^\.env\.(?!example$)/, /(^|\/)\.vercel\//, /(^|\/)node_modules\//, /(^|\/)\.next\//, /(^|\/)dist\//, /(^|\/)coverage\//, /\.(log|pem|key|dump)$/];

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const files = git("diff", "--cached", "--name-only", "--diff-filter=ACMR").split("\n").filter(Boolean);
const findings = [];
for (const f of files) {
  if (FORBIDDEN_PATHS.some((re) => re.test(f))) findings.push(`${f}: forbidden path`);
}
let current = "";
for (const line of git("diff", "--cached", "-U0", "--diff-filter=ACMR").split("\n")) {
  if (line.startsWith("+++ b/")) current = line.slice(6);
  else if (line.startsWith("+") && !line.startsWith("+++")) {
    for (const [name, re] of PATTERNS) if (re.test(line)) findings.push(`${current}: ${name}`);
  }
}
if (findings.length) {
  console.error("Secret scan: possible credentials in staged changes (values not shown):");
  for (const x of [...new Set(findings)]) console.error(`  - ${x}`);
  process.exit(1);
}
console.log(`Secret scan: ${files.length} staged file(s) clean.`);