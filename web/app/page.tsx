import {
  Bot,
  ClipboardCheck,
  Gauge,
  KeyRound,
  Radio,
  ScrollText,
  ShieldCheck,
  Tags,
  UserCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { formatMoney } from "../lib/money";
import { ButtonLink } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Logo } from "../components/ui/Logo";
import { ThemeToggle } from "../components/ui/ThemeToggle";

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Bot,
    title: "Agent asks",
    body: "Your agent submits a purchase intent: merchant, item, amount and why. It never touches a card number.",
  },
  {
    icon: ShieldCheck,
    title: "Risk Guard decides",
    body: "Deterministic rules run first, then an AI review. The result is approve, deny or escalate to you, with a reason and risk score.",
  },
  {
    icon: Wallet,
    title: "Braintree sandbox pays",
    body: "Approved purchases are authorized, then captured with a single-use mandate. If anything fails, the hold is voided.",
  },
];

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Gauge,
    title: "Spend limits",
    body: "Per-purchase caps, daily budgets and velocity limits for every agent.",
  },
  {
    icon: UserCheck,
    title: "Human approval",
    body: "Risky purchases wait for you. Approve or deny from the dashboard or your phone.",
  },
  {
    icon: Tags,
    title: "Price check",
    body: "Channel3 market data flags offers that are priced well above the market.",
  },
  {
    icon: KeyRound,
    title: "Single-use mandates",
    body: "Short-lived signed tokens bound to one amount and payee. Replays and tampering are rejected.",
  },
  {
    icon: ScrollText,
    title: "Audit trail",
    body: "Every step of every purchase is recorded, so you can always see what happened and why.",
  },
  {
    icon: Radio,
    title: "Live monitor",
    body: "Watch intents, decisions and payments stream in as they happen.",
  },
];

export default function HomePage() {
  const example = formatMoney({ amountCents: 5000, currency: "USD" });
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="land-header">
        <div className="land-bar">
          <Logo />
          <nav aria-label="Main" className="land-nav">
            <ButtonLink
              href="#how"
              variant="ghost"
              size="sm"
              className="hide-sm"
            >
              How it works
            </ButtonLink>
            <ButtonLink
              href="/dashboard"
              variant="ghost"
              size="sm"
              className="hide-sm"
            >
              Dashboard
            </ButtonLink>
            <ButtonLink href="/login" variant="secondary" size="sm">
              Sign in
            </ButtonLink>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-h">
          <div className="land-wrap hero-inner">
            <span className="eyebrow">
              <ClipboardCheck size={14} aria-hidden="true" />
              Braintree sandbox, no real money
            </span>
            <h1 id="hero-h">
              Give your AI an <span className="grad-text">allowance</span>, not
              your credit card.
            </h1>
            <p className="hero-sub">
              Agents ask before they spend. Rules and an AI risk review decide
              each purchase, risky ones wait for your approval, and every
              payment uses a single-use mandate. For example, cap an agent at{" "}
              <span className="num">{example}</span> a day.
            </p>
            <div className="hero-cta">
              <ButtonLink href="/login" variant="primary" size="lg">
                Sign in
              </ButtonLink>
              <ButtonLink href="#how" variant="secondary" size="lg">
                How it works
              </ButtonLink>
            </div>
          </div>
        </section>

        <section className="section" id="how" aria-labelledby="how-h">
          <div className="land-wrap">
            <div className="section-head">
              <h2 id="how-h">How it works</h2>
              <p>
                Three steps between an agent&apos;s idea and a safe payment.
              </p>
            </div>
            <ol className="steps">
              {STEPS.map(({ icon: Icon, title, body }) => (
                <Card as="li" className="step" key={title}>
                  <span className="feature-icon">
                    <Icon size={22} aria-hidden="true" />
                  </span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </Card>
              ))}
            </ol>
          </div>
        </section>

        <section className="section" aria-labelledby="features-h">
          <div className="land-wrap">
            <div className="section-head">
              <h2 id="features-h">Control without the babysitting</h2>
              <p>
                Set the rules once. AgentPurse enforces them on every purchase.
              </p>
            </div>
            <ul className="features">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <Card as="li" className="feature" key={title} interactive>
                  <span className="feature-icon">
                    <Icon size={22} aria-hidden="true" />
                  </span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </Card>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="land-footer">
        <div className="land-wrap">
          <Logo />
          <p>
            Payments are Braintree sandbox transactions (a PayPal service).
            Product catalog and market price data come from Channel3. No real
            money or physical goods change hands.
          </p>
        </div>
      </footer>
    </>
  );
}
