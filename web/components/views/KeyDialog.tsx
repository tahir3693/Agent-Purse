"use client";

import { Copy, KeyRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";

/**
 * Shows a new agent API key exactly once. The key lives only in the parent's
 * state until this dialog closes; it is never stored or fetched again.
 */
export function KeyDialog({
  agentName,
  apiKey,
  onClose,
}: {
  agentName: string;
  apiKey: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="key-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <h2 id="key-title" className="row">
        <KeyRound size={20} aria-hidden="true" />
        API key for {agentName}
      </h2>
      <p>
        This is the only time the key is shown. Copy it now and store it as
        DEMO_AGENT_KEY or in your agent&apos;s secret store. Only a hash is kept
        on the server.
      </p>
      <p className="secret" aria-label="Agent API key">
        {apiKey}
      </p>
      <div className="row">
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(apiKey);
              setCopied("Copied to the clipboard.");
            } catch {
              setCopied("Copy failed; select the key and copy it manually.");
            }
          }}
        >
          <Copy size={16} aria-hidden="true" />
          Copy key
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            ref.current?.close();
            onClose();
          }}
        >
          I have stored the key
        </Button>
        <span role="status" aria-live="polite">
          {copied}
        </span>
      </div>
    </dialog>
  );
}
