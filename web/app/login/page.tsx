import Link from "next/link";

import { LoginForm } from "../../components/LoginForm";

export const metadata = { title: "Sign in | AgentPurse" };

export default function LoginPage() {
  return (
    <main>
      <h1>Sign in</h1>
      <p className="muted">Owner sign-in for the AgentPurse dashboard.</p>
      <LoginForm />
      <p className="muted">
        New here? <Link href="/register">Create an account</Link>
      </p>
    </main>
  );
}
