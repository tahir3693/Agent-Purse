import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { DashboardNav } from "../../components/DashboardNav";
import { EnvNotice } from "../../components/EnvNotice";
import {
  LiveProvider,
  LiveStatusPill,
} from "../../components/live/LiveProvider";
import { LogoutButton } from "../../components/LogoutButton";
import { missingPublicEnv } from "../../lib/publicEnv";
import { SESSION_COOKIE } from "../../lib/session";

// Every /dashboard path is per-owner and must never be prerendered or cached.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const store = await cookies();
  if (!store.get(SESSION_COOKIE)?.value) redirect("/login");
  return (
    <LiveProvider>
      <div className="shell">
        <header className="topbar">
          <Link href="/dashboard" className="brand">
            AgentPurse
          </Link>
          <DashboardNav />
          <div className="topbar-actions">
            <LiveStatusPill />
            <LogoutButton />
          </div>
        </header>
        <main className="dash" id="main">
          <EnvNotice names={missingPublicEnv()} />
          {children}
        </main>
      </div>
    </LiveProvider>
  );
}
