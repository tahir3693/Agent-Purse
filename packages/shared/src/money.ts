import { z } from "zod";

/** Money convention: signed integer cents + ISO 4217 currency code. */
export interface Money {
  amountCents: number; // signed integer; no fractional component
  currency: string; // ISO 4217 three-letter code, e.g. "USD"
}

export const MoneySchema = z.object({
  amountCents: z.number().int(),
  currency: z.string().length(3),
});
