"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="secondary"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" }).catch(
          () => undefined
        );
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
