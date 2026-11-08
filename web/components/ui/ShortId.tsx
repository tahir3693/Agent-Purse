"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { shortId } from "../../lib/format";

/** First 8 characters of an id in monospace, with a button that copies the full id. */
export function ShortId({
  id,
  label = "id",
}: {
  id: string;
  /** Noun used in the button's accessible name, e.g. "agent id". */
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="short-id">
      <code title={id}>{shortId(id)}</code>
      <button
        type="button"
        className="copy-btn"
        aria-label={`Copy ${label}`}
        title="Copy the full id"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(id);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard can be blocked; the full id is in the tooltip.
          }
        }}
      >
        {copied ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <Copy size={14} aria-hidden="true" />
        )}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </span>
  );
}
