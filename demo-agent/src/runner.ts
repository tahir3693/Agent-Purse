// Runs scenarios in order, prints PASS or FAIL for each and a summary.
import {
  SCENARIOS,
  type ScenarioContext,
  type ScenarioResult,
} from "./scenarios.js";
import { cap } from "./transcript.js";

export const BANNER =
  "Braintree sandbox, no real money; Channel3 provides real catalog data.";

export async function runScenarios(
  names: string[],
  ctx: ScenarioContext
): Promise<number> {
  const t = ctx.transcript;
  t.line(BANNER);
  t.line();
  const results: { name: string; result: ScenarioResult }[] = [];
  for (const name of names) {
    const s = SCENARIOS.find((x) => x.name === name);
    if (!s) continue;
    t.line(`== ${s.name}: ${s.summary}`);
    let result: ScenarioResult;
    try {
      result = await s.run(ctx);
    } catch (err) {
      result = {
        pass: false,
        expected: "scenario completes",
        actual: "error",
        reason: cap(err instanceof Error ? err.message : "error"),
      };
    }
    results.push({ name: s.name, result });
    t.line(
      result.pass
        ? `PASS ${s.name} (${result.actual})`
        : `FAIL ${s.name}: expected ${result.expected}, actual ${result.actual}${result.reason ? ` (${result.reason})` : ""}`
    );
    t.line();
  }
  const failed = results.filter((r) => !r.result.pass).length;
  t.line(`Summary: ${results.length - failed} passed, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}
