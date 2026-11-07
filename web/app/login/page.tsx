import { LoginForm } from "../../components/LoginForm";

export const metadata = { title: "Sign in | AgentPurse" };

export default function LoginPage() {
  return (
    <main>
      <h1>Sign in</h1>
      <p className="muted">
        Owner sign-in. The full dashboard arrives in a later release.
      </p>
      <LoginForm />
    </main>
  );
}
