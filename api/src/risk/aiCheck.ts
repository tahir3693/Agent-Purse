// One real Anthropic Messages call to confirm ANTHROPIC_API_KEY and AI_MODEL
// work. Reports only OK or a sanitized diagnostic (kind, status, redacted and
// truncated provider message); never the key, headers, prompt or full body.
import type { AnthropicConfig } from "./config.js";
import { diagnose, errorFromResponse, formatDiagnostic, type AiDiagnostic } from "./diagnostics.js";

export type AiCheckResult = { ok: true; model: string } | { ok: false; diagnostic: AiDiagnostic };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export async function runAiCheck(
  config: AnthropicConfig,
  fetchImpl: typeof fetch = (i, init) => fetch(i, init),
  timeoutMs = 20_000
): Promise<AiCheckResult> {
  const secrets = [config.apiKey];
  try {
    const res = await fetchImpl(ANTHROPIC_URL, {
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
    if (!res.ok) {
      return { ok: false, diagnostic: diagnose(await errorFromResponse(res), config.model, secrets) };
    }
    // Drain without reading into output.
    await res.body?.cancel().catch(() => undefined);
    return { ok: true, model: config.model };
  } catch (error) {
    return { ok: false, diagnostic: diagnose(error, config.model, secrets) };
  }
}

export function formatAiCheck(r: AiCheckResult): string {
  return r.ok ? `AI check: OK (model ${r.model})` : `AI check: FAILED (${formatDiagnostic(r.diagnostic)})`;
}
