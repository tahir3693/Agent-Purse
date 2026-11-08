"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect } from "react";

const KEY = "ap-theme";

function stored(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * Toggles data-theme on <html>. The initial value is set by an inline script in
 * the root layout (no flash). Icons switch through CSS, so there is no
 * hydration mismatch.
 */
export function ThemeToggle() {
  useEffect(() => {
    // Follow the OS setting until the user picks a theme explicitly.
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e: MediaQueryListEvent) => {
      if (stored() === "light" || stored() === "dark") return;
      document.documentElement.dataset["theme"] = e.matches ? "light" : "dark";
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      aria-label="Toggle light and dark theme"
      onClick={() => {
        const root = document.documentElement;
        const next = root.dataset["theme"] === "light" ? "dark" : "light";
        root.dataset["theme"] = next;
        try {
          window.localStorage.setItem(KEY, next);
        } catch {
          // Storage can be blocked; the choice then lasts for this page only.
        }
      }}
    >
      <Sun size={18} aria-hidden="true" className="i-sun" />
      <Moon size={18} aria-hidden="true" className="i-moon" />
    </button>
  );
}
