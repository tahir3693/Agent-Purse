"use client";

import { ChevronDown, CircleUser } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LogoutButton } from "./LogoutButton";

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="user-menu"
        onClick={() => setOpen((v) => !v)}
      >
        <CircleUser size={16} aria-hidden="true" />
        <span>Account</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="menu-pop" id="user-menu">
          <LogoutButton className="menu-item" />
        </div>
      ) : null}
    </div>
  );
}
