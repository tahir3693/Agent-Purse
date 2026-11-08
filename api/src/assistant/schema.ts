// POST /assistant body (spec-09b). Strict: only user/assistant text messages.
// Client-supplied tools, instructions or system messages are rejected outright.
import { z } from "zod";

export const MAX_MESSAGES = 20;
export const MAX_TEXT = 4000;

export const AssistantMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    text: z.string().min(1).max(MAX_TEXT),
  })
  .strict();

export const AssistantRequestSchema = z
  .object({
    messages: z
      .array(AssistantMessageSchema)
      .min(1)
      .max(MAX_MESSAGES)
      .refine((m) => m[m.length - 1]?.role === "user", {
        message: "last message must be from the user",
      }),
  })
  .strict();

export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;

/** NDJSON events streamed to the browser. Text only; never tool calls. */
export type AssistantEvent =
  | { type: "text"; delta: string }
  | { type: "note"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

export const FAIL_CLOSED_MESSAGE =
  "The assistant is unavailable right now. No action was taken.";
