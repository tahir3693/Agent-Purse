// Small display helpers shared by the dashboard views. Pure, no side effects.

/** "1 offer", "2 offers". */
export function plural(
  n: number,
  singular: string,
  pluralForm = `${singular}s`
): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** First 8 characters of an id, for display. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** "Nov 8, 10:51 PM" (viewer's locale settings for the clock, English month names). */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
