// One real Anthropic Messages call to confirm ANTHROPIC_API_KEY and AI_MODEL
// work. Reports only OK or an error category; never the key or a response body.
import type { AnthropicConfig } from "./config.js";

export type AiCheckCategory =
  "auth" | "quota" | "model" | "network" | "unknown";
export type AiCheckResult =
  { ok: true; model: string } | { ok: false; category: AiCheckCategory };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/** Pure mapping from an HTTP status or thrown error to a category. */
export function classifyAnthropicError(
  input: { status: number } | { error: unknown }
): AiCheckCategory {
  if ("status" in input) {
    const s = input.status;
    if (s === 401 || s === 403) return "auth";
    if (s === 402 || s === 429 || s === 529) return "quota";
    if (s === 400 || s === 404) return "model";
    return "unknown";
  }
  const e = input.error;
  if (
    e instanceof Error &&
    (e.name === "TimeoutError" ||
      e.name === "AbortError" ||
      e instanceof TypeError)
  ) {
    return "network";
  }
  return "unknown";
}

export async function runAiCheck(
  config: AnthropicConfig,
  fetchImpl: typeof fetch = (i, init) => fetch(i, init),
  timeoutMs = 20_000
): Promise<AiCheckResult> {
  let res: Response;
  try {
    res = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 5,
        messages: [{ role: "user", content: "Reply with OK." }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, category: classifyAnthropicError({ error }) };
  }
  // Drain without reading into output: the body may echo request details.
  await res.body?.cancel().catch(() => undefined);
  if (!res.ok)
    return {
      ok: false,
      category: classifyAnthropicError({ status: res.status }),
    };
  return { ok: true, model: config.model };
}

export function formatAiCheck(r: AiCheckResult): string {
  return r.ok
    ? `AI check: OK (model ${r.model})`
    : `AI check: FAILED (${r.category})`;
}
