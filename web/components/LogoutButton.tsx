"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={className ?? "btn btn-secondary"}
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" }).catch(
          () => undefined
        );
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut size={16} aria-hidden="true" />
      Sign out
    </button>
  );
}
