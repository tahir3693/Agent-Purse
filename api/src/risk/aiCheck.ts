// One real call to the selected AI provider (AI_PROVIDER) to confirm its key and
// AI_MODEL work. Reports only OK or a sanitized diagnostic (kind, status,
// redacted and truncated provider message); never the key, headers, prompt or
// full body. AI_PROVIDER=off makes no call.
import type { AiConfig } from "./config.js";
import { diagnose, errorFromResponse, formatDiagnostic, type AiDiagnostic } from "./diagnostics.js";
import { geminiUrl, supportsThinkingLevel, THINKING_LEVEL } from "./gemini.js";
import { chatCompletionsUrl } from "./openai.js";

export type AiCheckResult =
  | { ok: true; provider: "anthropic" | "gemini" | "openai"; model: string; elapsedMs: number }
  | { ok: true; provider: "off" }
  | { ok: false; diagnostic: AiDiagnostic; elapsedMs: number };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export async function runAiCheck(
  config: AiConfig,
  fetchImpl: typeof fetch = (i, init) => fetch(i, init),
  timeoutMs = 20_000 // callers pass the configured AI_TIMEOUT_MS
): Promise<AiCheckResult> {
  if (config.provider === "off") return { ok: true, provider: "off" };

  const started = Date.now();
  const elapsed = () => Math.max(0, Date.now() - started);
  const secrets = [config.apiKey];
  const { provider, model } = config;
  try {
    const res =
      config.provider === "openai"
        ? await fetchImpl(chatCompletionsUrl(config.baseUrl), {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
            body: JSON.stringify({
              model,
              max_tokens: 256,
              messages: [{ role: "user", content: "Reply with OK." }],
            }),
            signal: AbortSignal.timeout(timeoutMs),
          })
        : provider === "gemini"
        ? await fetchImpl(geminiUrl(model), {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }],
              generationConfig: {
                maxOutputTokens: 1024,
                ...(supportsThinkingLevel(model) ? { thinkingConfig: { thinkingLevel: THINKING_LEVEL } } : {}),
              },
            }),
            signal: AbortSignal.timeout(timeoutMs),
          })
        : await fetchImpl(ANTHROPIC_URL, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": config.apiKey,
              "anthropic-version": ANTHROPIC_VERSION,
            },
            body: JSON.stringify({
              model,
              max_tokens: 5,
              messages: [{ role: "user", content: "Reply with OK." }],
            }),
            signal: AbortSignal.timeout(timeoutMs),
          });
    if (!res.ok) {
      return {
        ok: false,
        diagnostic: diagnose(await errorFromResponse(res, provider), model, secrets, provider),
        elapsedMs: elapsed(),
      };
    }
    // Drain without reading into output.
    await res.body?.cancel().catch(() => undefined);
    return { ok: true, provider, model, elapsedMs: elapsed() };
  } catch (error) {
    return { ok: false, diagnostic: diagnose(error, model, secrets, provider), elapsedMs: elapsed() };
  }
}

export function formatAiCheck(r: AiCheckResult): string {
  if (!r.ok) return `AI check: FAILED (${formatDiagnostic(r.diagnostic)}) elapsed=${r.elapsedMs}ms`;
  if (r.provider === "off") return "AI check: AI_PROVIDER=off (AI review disabled; no call made)";
  // The OpenAI-compatible line mirrors the failure fields (provider, kind, status, message).
  if (r.provider === "openai") {
    return `AI check: OK (provider=openai kind=ok status=200 message=ok model=${r.model}) elapsed=${r.elapsedMs}ms`;
  }
  return `AI check: OK (provider ${r.provider}, model ${r.model}) elapsed=${r.elapsedMs}ms`;
}
