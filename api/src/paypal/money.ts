// PayPal money boundary.
//
// This module is the ONLY place in the system where AgentPurse's canonical
// integer-cents convention meets PayPal's decimal amount strings (e.g. "12.34").
// Keeping the conversion confined here means no decimal money strings leak into
// the rest of the API (.kiro/steering/money-rules.md, Requirement 4.1).
//
// All conversion uses integer math so there is no floating-point drift: the
// decimal string is assembled from the whole and fractional parts, and parsing
// recombines the two integer halves. The round-trip is therefore exact for any
// non-negative integer cent amount (Requirement 4.2, 4.3).
//
// Scope: 2-decimal (minor-unit = 1/100) currencies only, which is the default
// and covers USD/EUR/GBP etc. Zero-decimal or 3-decimal currencies (e.g. JPY,
// BHD) are out of scope for this slice.
// TODO(verify): add minor-unit lookup if a non-2-decimal currency is needed.

const DECIMALS = 2;
const UNITS_PER_MAJOR = 100; // 10 ** DECIMALS

/**
 * Convert integer cents to a PayPal decimal amount string.
 *
 * Examples: centsToDecimal(1234) => "12.34", centsToDecimal(5) => "0.05",
 * centsToDecimal(100) => "1.00".
 *
 * @param amountCents non-negative integer number of cents
 * @param currency ISO 4217 code; currently assumed to be a 2-decimal currency
 */
export function centsToDecimal(amountCents: number, currency?: string): string {
  void currency; // 2-decimal assumption; reserved for future minor-unit lookup
  if (!Number.isInteger(amountCents)) {
    throw new Error("centsToDecimal expects an integer cent amount");
  }
  if (amountCents < 0) {
    throw new Error("centsToDecimal expects a non-negative cent amount");
  }

  const major = Math.trunc(amountCents / UNITS_PER_MAJOR);
  const minor = amountCents % UNITS_PER_MAJOR;
  return `${major}.${String(minor).padStart(DECIMALS, "0")}`;
}

/**
 * Convert a PayPal decimal amount string back to integer cents.
 *
 * Examples: decimalToCents("12.34") => 1234, decimalToCents("0.05") => 5,
 * decimalToCents("1.00") => 100.
 *
 * @param value a decimal string with at most 2 fractional digits
 * @param currency ISO 4217 code; currently assumed to be a 2-decimal currency
 */
export function decimalToCents(value: string, currency?: string): number {
  void currency; // 2-decimal assumption; reserved for future minor-unit lookup
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error(`Invalid decimal amount: ${trimmed}`);
  }

  const [majorPart, minorPart = ""] = trimmed.split(".");
  const minor = minorPart.padEnd(DECIMALS, "0");
  return Number(majorPart) * UNITS_PER_MAJOR + Number(minor);
}
