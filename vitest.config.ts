import { defineConfig } from "vitest/config";

// Root Vitest configuration (workspace-aware). Vitest is the Test_Runner
// wired into the monorepo so later slices can add and run tests.
// Always invoked via `vitest run` (single, non-watch execution) in scripts/CI.
export default defineConfig({
  test: {
    // Discover test files across the root `test/` dir and every workspace.
    include: ["test/**/*.{test,spec}.ts", "**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**"],
    environment: "node",
  },
});
