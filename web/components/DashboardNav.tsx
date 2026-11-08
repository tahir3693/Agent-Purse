"use client";

import {
  Activity,
  Bot,
  ChartColumn,
  LayoutDashboard,
  ReceiptText,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV_LINKS: readonly {
  href: string;
  label: string;
  icon: LucideIcon;
}[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/agents", label: "Agents", icon: Bot },
  { href: "/dashboard/intents", label: "Intents", icon: ReceiptText },
  { href: "/dashboard/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/dashboard/live", label: "Live monitor", icon: Activity },
  { href: "/dashboard/vault", label: "Vault", icon: Wallet },
  { href: "/dashboard/studio", label: "Studio", icon: ChartColumn },
];

export function DashboardNav() {
  const path = usePathname();
  return (
    <nav aria-label="Dashboard" className="side-nav">
      <ul>
        {NAV_LINKS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="nav-link"
              aria-current={path === href ? "page" : undefined}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
