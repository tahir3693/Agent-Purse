"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { request } from "../lib/client/api";

export function RegisterForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    };
    setPending(true);
    setFields({});
    setMessage(
      "Creating your account. The API may take up to a minute to wake up."
    );
    try {
      const reg = await request<{ ok: boolean }>("/api/auth/register", {
        method: "POST",
        body,
      });
      if (!reg.ok) {
        setFields(reg.fields ?? {});
        setMessage(reg.message);
        return;
      }
      const login = await request<{ ok: boolean }>("/api/auth/login", {
        method: "POST",
        body,
      });
      if (!login.ok) {
        setMessage("Account created. Sign in to continue.");
        router.push("/login");
        return;
      }
      setMessage("Account created.");
      router.push("/dashboard");
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
          required
          aria-invalid={fields["email"] ? true : undefined}
          aria-describedby={fields["email"] ? "reg-email-err" : undefined}
        />
        {fields["email"] ? (
          <span id="reg-email-err" className="error-text">
            {fields["email"]}
          </span>
        ) : null}
      </label>
      <label>
        Password (12 characters or more)
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          aria-invalid={fields["password"] ? true : undefined}
          aria-describedby={fields["password"] ? "reg-password-err" : undefined}
        />
        {fields["password"] ? (
          <span id="reg-password-err" className="error-text">
            {fields["password"]}
          </span>
        ) : null}
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Creating account" : "Create account"}
      </button>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <p className="muted">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}
