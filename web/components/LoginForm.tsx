"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "./ui/Button";

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false); // styling only

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setFailed(false);
    setMessage("Signing in. The API may take up to a minute to wake up.");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setMessage("Signed in.");
        router.push("/dashboard");
        return;
      }
      setFailed(true);
      setMessage(data.error ?? "Sign-in failed.");
    } catch {
      setFailed(true);
      setMessage("Network error. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@example.com"
          required
          aria-invalid={failed ? true : undefined}
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={failed ? true : undefined}
        />
      </label>
      <Button
        type="submit"
        variant="primary"
        size="lg"
        block
        disabled={pending}
      >
        {pending ? "Signing in" : "Sign in"}
      </Button>
      <p
        role="status"
        aria-live="polite"
        className={failed ? "error-text" : "form-status"}
      >
        {message}
      </p>
    </form>
  );
}
