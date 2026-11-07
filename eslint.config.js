// ESLint v9 flat config for the AgentPurse monorepo.
// Uses typescript-eslint for TypeScript source files so that `eslint .`
// exits non-zero and reports file/line on violations (Requirements 2.2, 2.6, 2.7).
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Ignore build artifacts and dependencies so lint focuses on source.
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**", "web/next-env.d.ts"],
  },
  // Base recommended JS rules.
  eslint.configs.recommended,
  // TypeScript recommended rules, scoped to .ts files.
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
  // Node helper scripts (plain ESM).
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
    },
  }
);
