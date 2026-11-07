// The .env.example checker: placeholders pass; pasted passwords, keys and
// credentialed URLs fail, and only variable NAMES are printed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "envex-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function check(content: string) {
  const file = join(dir, `e${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(file, content);
  const r = spawnSync(process.execPath, ["scripts/check-env-example.mjs", file], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("scripts/check-env-example.mjs", () => {
  it("accepts the committed .env.example", () => {
    const r = spawnSync(process.execPath, ["scripts/check-env-example.mjs"], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("accepts placeholders and a real DEMO_API_BASE_URL", () => {
    const r = check(
      [
        'DEMO_OWNER_PASSWORD="replace-with-your-value"',
        'DEMO_AGENT_KEY="replace-with-your-value"',
        'DEMO_PAYMENT_METHOD_ID="replace-with-your-value"',
        'DEMO_API_BASE_URL="https://agentpurse-api.example.com"',
      ].join("\n"),
    );
    expect(r.code).toBe(0);
  });

  it.each([
    ["DEMO_OWNER_PASSWORD", "test-only-Passw0rd-xyz"],
    ["DEMO_OWNER_PASSWORD", "your-password-123"],
    ["DEMO_OWNER_PASSWORD", "correcthorsebatterystaple"],
    ["DEMO_AGENT_KEY", "agk_testonlyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    ["DEMO_PAYMENT_METHOD_ID", "3f2b9c1e-test-only-uuid-0000"],
    // Built from parts so no credentialed URL literal sits in source.
    ["DEMO_API_BASE_URL", ["https://", "user", ":", "test-only-pw", "@example.com"].join("")],
  ])("fails for a pasted %s and prints only the name", (name, value) => {
    const r = check(`${name}="${value}"`);
    expect(r.code).toBe(1);
    expect(r.out).toContain(name);
    expect(r.out).not.toContain(value);
  });
});