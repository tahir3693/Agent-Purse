"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" }).catch(
          () => undefined
        );
        router.push("/login");
      }}
    >
      Sign out
    </button>
  );
}
