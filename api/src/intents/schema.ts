// Request body schemas for intents (spec-08). Money is integer cents + currency.

import { z } from "zod";

export const CreateIntentBodySchema = z
  .object({
    amountCents: z.number().int().positive().max(100_000_000_000),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, "currency must be 3 uppercase letters"),
    payee: z.string().trim().min(1).max(253),
    category: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(1000),
    justification: z.string().trim().min(1).max(2000),
    paymentMethodRef: z.string().trim().min(1).max(200),
    /** Optional Channel3 product id for the price check. Request-only, never stored. */
    productId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type CreateIntentBody = z.infer<typeof CreateIntentBodySchema>;

export const ExecuteIntentBodySchema = z
  .object({
    mandateToken: z.string().min(1).max(4096),
  })
  .strict();

export type ExecuteIntentBody = z.infer<typeof ExecuteIntentBodySchema>;
