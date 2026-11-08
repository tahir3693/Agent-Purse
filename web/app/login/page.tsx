import Link from "next/link";
import { AuthShell } from "../../components/AuthShell";
import { LoginForm } from "../../components/LoginForm";

export const metadata = { title: "Sign in | AgentPurse" };

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      subtitle="Owner sign-in for the AgentPurse dashboard."
      footer={
        <>
          New here? <Link href="/register">Create an account</Link>
        </>
      }
    >
      <LoginForm />
    </AuthShell>
  );
}
