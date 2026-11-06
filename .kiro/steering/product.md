---
inclusion: always
---

# Product: AgentPurse

Tagline: "Give your AI an allowance, not your credit card."

AgentPurse lets AI agents make purchases safely, using Braintree sandbox (a PayPal service) for payments and Channel3 for real catalog and price data. It is a hackathon build for "Build What's Next with PayPal and AI" (Devpost). Hard deadline: Nov 12, 2026, 12:00 pm PST.

## Actors

- Owner: a human who links PayPal once, creates agents, sets spending policies, and approves risky purchases.
- Agent: software that calls the AgentPurse API with an API key.

## Core flow

1. Agent submits a purchase intent: payee (merchant domain), item description, amount, currency, justification, optional Channel3 product id.
2. Risk Guard decides: deterministic hard rules first, then an AI review. Result is approve, deny, or escalate, with a reason and a risk score (0-100).
3. On approve: authorize the payment (hold, no settlement) and issue a mandate token (signed, single-use, short-lived, bound to one authorizationId, amount, currency, and payee).
4. On escalate: the owner is notified (mobile and web) and approves or denies. Approval continues at step 3.
5. The agent presents the mandate token. The server verifies and consumes it atomically, then captures (submits for settlement). If the token expires or execution fails, the authorization is voided.
6. Provider webhooks update payment status. Every step is written to an audit log shown live in the dashboard.

## Honesty requirements (README, UI, video)

- Payments are Braintree sandbox transactions (a PayPal service). No real money or physical goods are exchanged.
- Channel3 supplies real product catalog and market price data.
- No third-party logos or trademarks in UI, docs images, or demo assets. Plain-text "PayPal" for factual description is fine.

## Scope discipline (7 days)

MUST: Braintree sandbox via a provider-neutral PaymentProvider (authorize, capture, void, vaulted payment method, signed webhooks), with PayPal REST kept as an optional second provider; Risk Guard with Channel3 price check; single-use mandate token; Next.js dashboard with AG Studio (custom widgets, theming, Studio Agent Framework assistant); Expo mobile app (approvals, kill switch, spend); demo agent with three scenarios; deployed (API + DB on Render, web on Vercel); README, OpenAPI, Postman collection, license.

SHOULD (only if time remains): push notifications (else poll), CSV export of audit log.

CUT: PayPal Payouts, Render Workflows, multi-user teams, billing, non-PayPal providers, any real-money flow.

Never cut: vaulted payment method (Braintree customer/payment-method token), Risk Guard, mandate token, Live Monitor.
If behind, cut in this order: push notifications, CSV export, mobile spend screen, assistant extras.