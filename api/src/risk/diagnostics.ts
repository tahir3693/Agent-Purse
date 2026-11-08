// Sanitized diagnostics for Anthropic call failures. Never carries the API key,
// request headers, the prompt or a full response. Everything that can reach a
// log line goes through redactSecrets and is truncated to MAX_DIAG_TEXT.

export type AiFailureKind =
  | "auth"
  | "model_not_found"
  | "bad_request"
  | "rate_limited"
  | "timeout"
  | "network"
  | "parse"
  | "unknown";

export interface AiDiagnostic {
  /** AI provider the call was made to. */
  provider: string;
  kind: AiFailureKind;
  httpStatus?: number;
  /** Provider error type (e.g. invalid_request_error) or the JS error name. */
  errorType: string;
  /** Redacted, truncated to 200 chars. */
  message: string;
  model: string;
}

export interface DiagLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export const MAX_DIAG_TEXT = 200;
const MAX_BODY_READ = 4_000;

/** Redacts sk-ant-... and AIza... (Google) key shapes and any explicitly supplied secrets. */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text.replace(/sk-ant-[A-Za-z0-9_-]*/g, "[redacted]").replace(/AIza[A-Za-z0-9_-]{16,}/g, "[redacted]");
  for (const s of secrets) {
    if (s.length >= 8) out = out.split(s).join("[redacted]");
  }
  return out;
}

export function sanitizeText(text: string, secrets: readonly string[] = []): string {
  return redactSecrets(text, secrets).slice(0, MAX_DIAG_TEXT);
}

/** A failure from an AI provider call with its already-classified kind. */
export class AiCallError extends Error {
  constructor(
    message: string,
    readonly kind: AiFailureKind,
    readonly httpStatus?: number,
    readonly providerType?: string,
    readonly providerMessage?: string,
    readonly provider: string = "anthropic",
  ) {
    super(message);
    this.name = "AiCallError";
  }
}

export function kindFromHttp(status: number, providerType?: string, providerMessage?: string): AiFailureKind {
  // Gemini reports a bad key as 400 INVALID_ARGUMENT with "API key not valid".
  if (status === 400 && providerMessage !== undefined && /api key/i.test(providerMessage)) return "auth";
  if (status === 401 || status === 403) return "auth";
  if (status === 404 || providerType === "not_found_error" || providerType === "NOT_FOUND") return "model_not_found";
  if (status === 400 || status === 413 || status === 422) return "bad_request";
  // 529 (Anthropic) and 503 (Gemini) mean overloaded; 429 is quota/rate limit.
  if (status === 429 || status === 529 || status === 503) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  return "unknown";
}

/**
 * Build an error from a non-2xx response, reading only the provider error
 * type/message. Anthropic: {error:{type,message}}. Gemini: {error:{status,message}}.
 */
export async function errorFromResponse(res: Response, provider = "anthropic"): Promise<AiCallError> {
  let providerType: string | undefined;
  let providerMessage: string | undefined;
  try {
    const text = (await res.text()).slice(0, MAX_BODY_READ);
    const parsed = JSON.parse(text) as { error?: { type?: unknown; status?: unknown; message?: unknown } };
    if (typeof parsed.error?.type === "string") providerType = parsed.error.type;
    else if (typeof parsed.error?.status === "string") providerType = parsed.error.status;
    if (typeof parsed.error?.message === "string") providerMessage = parsed.error.message;
  } catch {
    // Body is not the documented error shape; status alone is reported.
  }
  return new AiCallError(
    `${provider} request failed with status ${res.status}`,
    kindFromHttp(res.status, providerType, providerMessage),
    res.status,
    providerType,
    providerMessage,
    provider,
  );
}

export function diagnose(
  err: unknown,
  model: string,
  secrets: readonly string[] = [],
  provider = "anthropic",
): AiDiagnostic {
  if (err instanceof AiCallError) {
    return {
      provider: err.provider,
      kind: err.kind,
      ...(err.httpStatus !== undefined ? { httpStatus: err.httpStatus } : {}),
      errorType: sanitizeText(err.providerType ?? err.name, secrets),
      message: sanitizeText(err.providerMessage ?? err.message, secrets),
      model,
    };
  }
  if (err instanceof Error) {
    const timeout = err.name === "TimeoutError" || err.name === "AbortError";
    const network = !timeout && err instanceof TypeError;
    return {
      provider,
      kind: timeout ? "timeout" : network ? "network" : "unknown",
      errorType: sanitizeText(err.name, secrets),
      message: sanitizeText(err.message, secrets),
      model,
    };
  }
  return { provider, kind: "unknown", errorType: "non_error", message: "non-Error value thrown", model };
}

/** One structured, sanitized log line. */
export function logAiFailure(logger: DiagLogger, diag: AiDiagnostic): void {
  logger.warn({ event: "ai_review_failed", ...diag }, `AI review failed (${diag.kind})`);
}

export function formatDiagnostic(d: AiDiagnostic): string {
  const status = d.httpStatus !== undefined ? ` status=${d.httpStatus}` : "";
  return `provider=${d.provider} kind=${d.kind}${status} type=${d.errorType} model=${d.model} message=${d.message}`;
}
