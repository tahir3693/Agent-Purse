"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { DashboardNav, NAV_LINKS } from "./DashboardNav";
import { LiveStatusPill } from "./live/LiveProvider";
import { Logo } from "./ui/Logo";
import { ThemeToggle } from "./ui/ThemeToggle";
import { UserMenu } from "./UserMenu";

/** Sidebar + slim top bar. Below 768px the sidebar becomes a drawer. */
export function AppShell({
  children,
  banner,
}: {
  children: ReactNode;
  banner?: ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const title = NAV_LINKS.find((l) => l.href === path)?.label ?? "Dashboard";

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar" id="sidebar" data-open={open}>
        <div className="row row-between">
          <Logo href="/dashboard" />
          <button
            type="button"
            className="icon-btn menu-btn"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <DashboardNav />
        <p className="side-foot">
          Braintree sandbox (a PayPal service). No real money moves.
        </p>
      </aside>
      <button
        type="button"
        className="scrim"
        data-open={open}
        aria-label="Close menu"
        tabIndex={-1}
        onClick={() => setOpen(false)}
      />
      <div className="main-col">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn menu-btn"
            aria-label="Open menu"
            aria-expanded={open}
            aria-controls="sidebar"
            onClick={() => setOpen(true)}
          >
            <Menu size={18} aria-hidden="true" />
          </button>
          <p className="topbar-title">
            AgentPurse / <strong>{title}</strong>
          </p>
          <div className="topbar-actions">
            <LiveStatusPill />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main
          className="dash"
          id="main"
          data-page={path === "/dashboard/studio" ? "studio" : undefined}
        >
          {banner}
          {children}
        </main>
      </div>
    </div>
  );
}
