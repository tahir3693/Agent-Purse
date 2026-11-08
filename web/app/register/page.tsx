import { RegisterForm } from "../../components/RegisterForm";

export const metadata = { title: "Create account | AgentPurse" };

export default function RegisterPage() {
  return (
    <main>
      <h1>Create an owner account</h1>
      <p className="muted">
        Payments are Braintree sandbox transactions (a PayPal service). No real
        money is used.
      </p>
      <RegisterForm />
    </main>
  );
}
