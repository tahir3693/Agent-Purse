// Display helper over the shared Money type (integer cents + ISO 4217 code).
import { MoneySchema, type Money } from "@agentpurse/shared";

export function formatMoney(m: Money, locale = "en-US"): string {
  const parsed = MoneySchema.safeParse(m);
  if (!parsed.success) return "Invalid amount";
  const { amountCents, currency } = parsed.data;
  // Integer cents -> major units only for display; never used for arithmetic.
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    amountCents / 100
  );
}
