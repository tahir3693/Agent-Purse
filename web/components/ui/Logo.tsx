import { Wallet } from "lucide-react";
import Link from "next/link";

export function LogoMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Wallet size={18} />
    </span>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="AgentPurse home">
      <LogoMark />
      <span>AgentPurse</span>
    </Link>
  );
}
