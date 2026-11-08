import type { ReactNode } from "react";
import { LogoMark } from "./ui/Logo";
import { ThemeToggle } from "./ui/ThemeToggle";

/** Centered card on a gradient glow, shared by sign-in and register. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="auth" id="main">
      <div className="auth-top">
        <ThemeToggle />
      </div>
      <div className="auth-card">
        <div className="auth-head">
          <LogoMark />
          <p className="auth-tagline">
            Give your AI an allowance, not your credit card.
          </p>
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
        </div>
        {children}
        {footer ? <p className="auth-foot">{footer}</p> : null}
      </div>
    </main>
  );
}
