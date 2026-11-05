// Gateway error types.
//
// Pure, secret-free. GatewayValidationError is thrown ONLY for
// schema-invalid input to the rules engine (malformed intent/policy/history),
// never for rule failures. The message names the offending field only and
// never includes a field value or any secret (see money-rules.md).

/** Options for constructing a GatewayValidationError. */
export interface GatewayValidationErrorOptions {
  /** Name/path of the first offending field (e.g. "policy.dailyBudgetCents"). */
  field: string;
  /** Optional override message. Must not contain values or secrets. */
  message?: string;
}

/**
 * Thrown when input to the gateway rules engine fails schema validation.
 * Carries the name of the first offending field. The message references the
 * field by name only, never a value or secret.
 */
export class GatewayValidationError extends Error {
  readonly field: string;

  constructor({ field, message }: GatewayValidationErrorOptions) {
    super(message ?? `invalid gateway input: field "${field}"`);
    this.name = "GatewayValidationError";
    this.field = field;
    // Restore prototype chain for instanceof across transpilation targets.
    Object.setPrototypeOf(this, GatewayValidationError.prototype);
  }
}
