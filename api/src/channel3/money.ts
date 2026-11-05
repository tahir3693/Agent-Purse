// Channel3 money boundary.
//
// This module is the ONLY place where Channel3's major-currency-unit decimals
// (e.g. dollars) meet AgentPurse's canonical integer-cents convention
// (see .kiro/steering/money-rules.md). Keep conversion confined here so no
// decimal money numbers leak into the rest of the API.

/** Convert a major-unit amount (e.g. 12.34 dollars) to integer cents (1234). */
export function majorToCents(major: number): number {
  return Math.round(major * 100);
}

/** Convert integer cents (1234) back to a major-unit amount (12.34). */
export function centsToMajor(cents: number): number {
  return cents / 100;
}
