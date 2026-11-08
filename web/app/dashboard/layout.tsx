import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "../../components/AppShell";
import { EnvNotice } from "../../components/EnvNotice";
import { LiveProvider } from "../../components/live/LiveProvider";
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
      <AppShell banner={<EnvNotice names={missingPublicEnv()} />}>
        {children}
      </AppShell>
    </LiveProvider>
  );
}
