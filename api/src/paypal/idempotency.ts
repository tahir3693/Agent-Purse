// PayPal idempotency key derivation.
//
// Every PayPal write call carries a `PayPal-Request-Id` header so retries reuse
// the same key and never double-charge (money-rules.md, Requirements 5.1, 5.2).
// The key is derived deterministically from the intent id and the operation:
// the same (intentId, op) always yields the same key, and different operations
// for the same intent yield different keys.

// PayPal documents a 10000-character limit on PayPal-Request-Id; we clamp to it.
const MAX_LENGTH = 10000;

/**
 * Build a deterministic, stable PayPal-Request-Id for an operation on an intent.
 *
 * The result is `${intentId}:${op}` (both trimmed), clamped to at most 10000
 * characters. Deterministic: identical inputs always produce identical output;
 * a different `op` for the same intent produces a different output.
 */
export function requestId(intentId: string, op: string): string {
  const key = `${intentId.trim()}:${op.trim()}`;
  return key.length > MAX_LENGTH ? key.slice(0, MAX_LENGTH) : key;
}
