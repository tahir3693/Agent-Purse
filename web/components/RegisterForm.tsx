"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { request } from "../lib/client/api";
import { Button } from "./ui/Button";

export function RegisterForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false); // styling only
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
    setFailed(false);
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
        setFailed(true);
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
          placeholder="you@example.com"
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
      <Button
        type="submit"
        variant="primary"
        size="lg"
        block
        disabled={pending}
      >
        {pending ? "Creating account" : "Create account"}
      </Button>
      <p
        role="status"
        aria-live="polite"
        className={failed ? "error-text" : "form-status"}
      >
        {message}
      </p>
      <p className="auth-foot">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}
