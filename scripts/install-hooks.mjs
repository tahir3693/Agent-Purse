// Installs the tracked pre-commit hook into .git/hooks. Runs via the root "prepare" script.
import { copyFileSync, existsSync, chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(join(root, ".git"))) process.exit(0); // not a git checkout (CI tarball, Docker)
const hooks = join(root, ".git", "hooks");
mkdirSync(hooks, { recursive: true });
const dest = join(hooks, "pre-commit");
copyFileSync(join(root, "scripts", "pre-commit.sh"), dest);
try {
  chmodSync(dest, 0o755);
} catch {
  /* windows */
}
console.log("pre-commit hook installed");
