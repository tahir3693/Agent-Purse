import { AuthShell } from "../../components/AuthShell";
import { RegisterForm } from "../../components/RegisterForm";

export const metadata = { title: "Create account | AgentPurse" };

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create an owner account"
      subtitle="Payments are Braintree sandbox transactions (a PayPal service). No real money is used."
    >
      <RegisterForm />
    </AuthShell>
  );
}
