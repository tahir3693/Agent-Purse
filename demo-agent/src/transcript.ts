// Human-readable transcript. Secrets are scrubbed before anything is written:
// the agent key never appears, mandate tokens only as an 8-character prefix.

export const REASON_CAP = 200;

export function redact(token: string): string {
  return `${token.slice(0, 8)}...`;
}

/** Plain text, single line, capped. Untrusted API text is never interpreted. */
export function cap(text: unknown, max = REASON_CAP): string {
  const s =
    typeof text === "string"
      ? text
      : text === undefined || text === null
        ? ""
        : String(text);
  // Strip control characters (incl. ANSI escapes) so API text cannot restyle the terminal.
  // eslint-disable-next-line no-control-regex
  const clean = s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

export class Transcript {
  readonly lines: string[] = [];
  private readonly secrets = new Set<string>();

  constructor(
    private readonly write: (line: string) => void = (l) => console.log(l)
  ) {}

  /** Register a value that must never be printed in full (agent key, tokens). */
  protect(
    secret: string | undefined | null,
    mode: "hide" | "prefix" = "prefix"
  ): void {
    if (!secret || secret.length < 8) return;
    this.secrets.add(mode === "hide" ? `hide:${secret}` : `prefix:${secret}`);
  }

  line(text = ""): void {
    let out = text;
    for (const entry of this.secrets) {
      const [mode, value] = [
        entry.slice(0, entry.indexOf(":")),
        entry.slice(entry.indexOf(":") + 1),
      ];
      out = out
        .split(value)
        .join(mode === "hide" ? "[redacted]" : redact(value));
    }
    this.lines.push(out);
    this.write(out);
  }

  text(): string {
    return this.lines.join("\n");
  }
}
