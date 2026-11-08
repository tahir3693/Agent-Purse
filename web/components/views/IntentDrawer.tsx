"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { IntentDetailPanel } from "./IntentDetail";

/**
 * Right-hand panel with one intent's details. It opens over the page, takes no
 * permanent space, closes on the close button or Escape, and returns focus to
 * where it was.
 */
export function IntentDrawer({
  id,
  version,
  onClose,
}: {
  id: string;
  version: number;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="drawer" aria-label="Intent details">
      <div className="drawer-head">
        <span className="drawer-title">Details</span>
        <button
          ref={closeRef}
          type="button"
          className="icon-btn"
          aria-label="Close details"
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="drawer-body">
        <IntentDetailPanel id={id} version={version} />
      </div>
    </aside>
  );
}
