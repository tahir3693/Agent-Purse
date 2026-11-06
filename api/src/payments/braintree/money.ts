// Cents <-> Braintree decimal string. This is the ONLY place in the Braintree
// adapter where money becomes a decimal string. Integer math only, 2 decimals.

export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError("amountCents must be a non-negative safe integer");
  }
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

export function decimalToCents(value: string): number {
  const match = /^(\d+)\.(\d{2})$/.exec(value);
  if (!match) {
    throw new RangeError("decimal amount must match ^\\d+\\.\\d{2}$");
  }
  const cents = Number(match[1]) * 100 + Number(match[2]);
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("decimal amount out of range");
  }
  return cents;
}
