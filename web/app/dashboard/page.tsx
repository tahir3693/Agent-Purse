import Link from "next/link";

import { EnvNotice } from "../../components/EnvNotice";
import { LogoutButton } from "../../components/LogoutButton";
import { missingPublicEnv } from "../../lib/env";

export const metadata = { title: "Dashboard | AgentPurse" };

// AG Studio widgets arrive in spec-09; they load with next/dynamic and ssr: false.
export default function DashboardPage() {
  return (
    <main>
      <h1>Dashboard</h1>
      <EnvNotice names={missingPublicEnv()} />
      <p className="muted">
        Placeholder. Agents, approvals, the live monitor and spend stats arrive
        in the next web release.
      </p>
      <p>
        <Link href="/">Home</Link>
      </p>
      <LogoutButton />
    </main>
  );
}
