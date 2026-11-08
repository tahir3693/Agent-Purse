/** Joins class names, skipping falsy values. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export type Tone =
  "success" | "warning" | "danger" | "info" | "brand" | "neutral";
