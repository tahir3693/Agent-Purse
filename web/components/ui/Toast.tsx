"use client";

import { TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Dismissible error toast. It shows whenever `message` changes to a new
 * non-empty value, and stays until dismissed or the message clears.
 */
export function Toast({ message }: { message: string | null | undefined }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    if (!message) setDismissed(null);
  }, [message]);
  if (!message || dismissed === message) return null;
  return (
    <div className="toast-region">
      <div className="toast" role="alert">
        <TriangleAlert size={18} aria-hidden="true" />
        <p className="toast-body">{message}</p>
        <button
          type="button"
          className="icon-btn"
          aria-label="Dismiss message"
          onClick={() => setDismissed(message)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
