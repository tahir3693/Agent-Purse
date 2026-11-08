"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/dashboard", "Overview"],
  ["/dashboard/agents", "Agents"],
  ["/dashboard/intents", "Intents"],
  ["/dashboard/approvals", "Approvals"],
  ["/dashboard/live", "Live monitor"],
  ["/dashboard/vault", "Vault"],
  ["/dashboard/studio", "Studio"],
] as const;

export function DashboardNav() {
  const path = usePathname();
  return (
    <nav aria-label="Dashboard">
      <ul>
        {LINKS.map(([href, label]) => (
          <li key={href}>
            <Link href={href} aria-current={path === href ? "page" : undefined}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
