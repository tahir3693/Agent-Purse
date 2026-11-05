// Typed PayPal error.
//
// Every non-success PayPal HTTP response maps to a single PayPalError carrying
// the HTTP status plus PayPal's own `name`, `debug_id`, and `details`. Only the
// status and debug_id are safe to log; secrets and tokens are NEVER included in
// the message or fields (Requirements 6.1, 6.2). `fromResponse` is resilient to
// a missing or non-JSON body.

/** Fields used to construct a {@link PayPalError}. */
export interface PayPalErrorInit {
  status: number;
  /** PayPal's error `name`, e.g. "UNPROCESSABLE_ENTITY". */
  name?: string;
  /** PayPal's per-request correlation id (`debug_id`); safe to log. */
  debugId?: string;
  /** PayPal's `details` array/object, passed through untouched. */
  details?: unknown;
  /** Optional override message; otherwise a safe message is derived. */
  message?: string;
}

export class PayPalError extends Error {
  readonly status: number;
  /** PayPal's error `name` (stored separately from `Error.name`). */
  readonly paypalName?: string;
  readonly debugId?: string;
  readonly details?: unknown;

  constructor(init: PayPalErrorInit) {
    super(init.message ?? buildMessage(init));
    this.name = "PayPalError";
    this.status = init.status;
    this.paypalName = init.name;
    this.debugId = init.debugId;
    this.details = init.details;
  }

  /**
   * Build a PayPalError from a non-success `Response`.
   *
   * Reads the JSON body if present and extracts `name`, `debug_id`, and
   * `details`. Resilient to an empty or non-JSON body (those fields are simply
   * left undefined). The message carries only the status and PayPal name/debug
   * id - never a token or secret.
   */
  static async fromResponse(res: Response): Promise<PayPalError> {
    let name: string | undefined;
    let debugId: string | undefined;
    let details: unknown;

    try {
      const text = await res.text();
      if (text.trim() !== "") {
        const body = JSON.parse(text) as Record<string, unknown>;
        if (typeof body.name === "string") name = body.name;
        if (typeof body.debug_id === "string") debugId = body.debug_id;
        if ("details" in body) details = body.details;
      }
    } catch {
      // Non-JSON or unreadable body: keep the fields undefined. The HTTP status
      // alone is still a useful, secret-free signal.
    }

    return new PayPalError({ status: res.status, name, debugId, details });
  }
}

/** Compose a secret-free message from the status and PayPal correlation fields. */
function buildMessage(init: PayPalErrorInit): string {
  const parts = [`PayPal request failed with status ${init.status}`];
  if (init.name) parts.push(`name=${init.name}`);
  if (init.debugId) parts.push(`debug_id=${init.debugId}`);
  return parts.join(" ");
}
