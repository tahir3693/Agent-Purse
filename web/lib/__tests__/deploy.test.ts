// Deployment safety: /web must look like a Next.js app only, never a backend.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB = fileURLToPath(new URL("../../", import.meta.url));
const SERVER_SECRETS = [
  "JWT_SECRET",
  "MANDATE_SIGNING_KEY",
  "CHANNEL3_API_KEY",
  "BRAINTREE_PRIVATE_KEY",
  "PAYPAL_CLIENT_SECRET",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "__tests__")
      continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("web deployment safety", () => {
  it("has no backend entrypoints or root-level api/ directory", () => {
    for (const f of [
      "server.js",
      "server.ts",
      "index.js",
      "index.ts",
      "app.js",
      "app.ts",
      "src/index.ts",
      "vercel.json",
    ]) {
      expect(existsSync(join(WEB, f)), f).toBe(false);
    }
    expect(existsSync(join(WEB, "api"))).toBe(false);
  });

  it("is a Next.js app with no API-only dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(WEB, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.scripts["build"]).toBe("next build");
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps["next"]).toBeDefined();
    for (const banned of [
      "fastify",
      "prisma",
      "@prisma/client",
      "express",
      "braintree",
      "@channel3/sdk",
      "@agentpurse/api",
    ]) {
      expect(deps[banned], banned).toBeUndefined();
    }
  });

  it("source never references server-only secret names or reads other env vars", () => {
    const allowed = new Set([
      "API_BASE_URL",
      "NEXT_PUBLIC_API_BASE_URL",
      "NEXT_PUBLIC_AG_GRID_LICENSE_KEY",
    ]);
    for (const file of walk(WEB).filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))) {
      const text = readFileSync(file, "utf8");
      for (const s of SERVER_SECRETS)
        expect(text.includes(s), `${relative(WEB, file)} mentions ${s}`).toBe(
          false
        );
      for (const m of text.matchAll(
        /process\.env(?:\.([A-Z0-9_]+)|\[["']([A-Z0-9_]+)["']\])/g
      )) {
        const name = m[1] ?? m[2] ?? "";
        expect(allowed.has(name), `${relative(WEB, file)} reads ${name}`).toBe(
          true
        );
      }
    }
  });
});
