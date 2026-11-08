// Integer-only money display: 1234 => "$12.34". No floating-point arithmetic.

export function formatCents(cents: number, currency = "USD"): string {
  if (!Number.isSafeInteger(cents)) return "(invalid amount)";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const major = Math.trunc(abs / 100);
  const minor = String(abs % 100).padStart(2, "0");
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${sign}${symbol}${major.toLocaleString("en-US")}.${minor}`;
}
