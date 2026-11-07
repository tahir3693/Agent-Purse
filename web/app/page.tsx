import Link from "next/link";

import { formatMoney } from "../lib/money";

export default function HomePage() {
  const example = formatMoney({ amountCents: 5000, currency: "USD" });
  return (
    <main>
      <h1>AgentPurse</h1>
      <p>
        <strong>Give your AI an allowance, not your credit card.</strong>
      </p>
      <p>
        Agents ask before they spend. Deterministic rules and an AI risk review
        decide each purchase, risky ones wait for your approval, and every
        approved payment uses a single-use, short-lived mandate. For example,
        you can cap an agent at {example} a day.
      </p>
      <section aria-labelledby="honesty" className="notice">
        <h2 id="honesty">What is real here</h2>
        <p>
          Payments are Braintree sandbox transactions (a PayPal service). No
          real money or physical goods change hands. Channel3 supplies real
          product catalog and market price data.
        </p>
      </section>
      <nav aria-label="Main">
        <ul>
          <li>
            <Link href="/login">Sign in</Link>
          </li>
          <li>
            <Link href="/dashboard">Dashboard</Link>
          </li>
        </ul>
      </nav>
    </main>
  );
}
