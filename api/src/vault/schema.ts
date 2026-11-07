// Request body schema for vault linking (spec-06). Values are never echoed.

import { z } from "zod";

export const LinkMethodBodySchema = z
  .object({
    ownerId: z.string().min(1).max(128),
    nonce: z.string().min(1).max(512),
  })
  .strict();

export type LinkMethodBody = z.infer<typeof LinkMethodBodySchema>;
