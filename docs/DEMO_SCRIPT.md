# Demo video script

A checklist for recording the 3-minute demo. Everything below matches the real code and scenarios. Payments are Braintree sandbox transactions (a PayPal service); say so on camera.

## Before recording

- [ ] Wake the API: open `https://demo-yhzi.onrender.com/healthz` until it returns `{"status":"ok"}` (the free tier can take up to a minute).
- [ ] `.env` has `DEMO_API_BASE_URL=https://demo-yhzi.onrender.com`, `DEMO_AGENT_KEY`, `DEMO_PAYMENT_METHOD_ID` and `CHANNEL3_API_KEY`. (Create the agent and link the sandbox card in the dashboard, or run `pnpm seed:demo`.)
- [ ] `pnpm demo:check` prints an OK line for the AI provider you will record with.
- [ ] Sign in to the web app in a second window. Keep the **Approvals** page one click away.
- [ ] Fewer than 10 `small-safe` and `replay` runs in the last hour (the policy allows 10 purchases per hour).
- [ ] Terminal font large, `.env` not on screen, no key or token visible.

## Screen order

1. **Landing page** (`/`): read the tagline "Give your AI an allowance, not your credit card." State the problem in one sentence. Scroll to "How it works" (agent asks, Risk Guard decides, Braintree sandbox pays).
2. **Sign in**, then **Overview**: point at the sandbox banner, the stat tiles and the empty recent-activity list.
3. **Agents**: show the agent, its policy ($200.00 per purchase, $500.00 per day, 10 per hour) and the **Kill switch**.
4. **Vault**: the sandbox test card (tagged "Sandbox").
5. **Live monitor** in one window, terminal in the other, then run the scenarios below. The pill should read "Connected".
6. **Intents** (AG Grid) and one **intent detail** with its audit events.
7. **Studio**: custom widgets, then ask the assistant "Why escalated?" (a prompt starter). Mention it is read-only.
8. Close on the honesty line: sandbox only, Channel3 provides real catalog and price data.

## Scenarios (terminal)

Each run starts with "Braintree sandbox, no real money; Channel3 provides real catalog data." The exit code is 0 only if every selected scenario passes.

| # | Command | What to say | Expected output |
| --- | --- | --- | --- |
| 1 | `pnpm demo:run --scenario small-safe` | A cheap purchase inside the auto-approve band | `approve`, mandate prefix shown, state `captured`, then PASS. If the AI declines, it prints FAIL with the reason; rerun or switch provider before recording |
| 2 | `pnpm demo:run --scenario needs-approval` | A real $70 to $150 product at its real price; above $50.00, so a human decides | `escalate`; the terminal waits. **Switch to Approvals, show the risk meter, price check and reason, click Approve.** The agent then prints the mandate and `captured`, then PASS. You have 3 minutes |
| 3 | `pnpm demo:run --scenario over-cap` | $250.00 is above the $200.00 cap | `deny` from the deterministic rules, no mandate, PASS |
| 4 | `pnpm demo:run --scenario overpriced` | Asks about 3x the market price | Not approved (price check flagged it), no mandate, PASS |
| 5 | `pnpm demo:run --scenario injection` | The justification tries to override the policy | Not approved, no mandate, PASS |
| 6 | `pnpm demo:run --scenario replay` | Reusing a consumed mandate | Second execute returns 409, state stays `captured`, PASS |

`pnpm demo:run --scenario all` runs all six in order (needs-approval still waits for you).

## Talking points

- The agent never holds a card; it only asks. The owner holds the policy.
- Order of defense: deterministic rules first, price check next, AI last. The AI can only make a decision stricter and any AI error escalates.
- The mandate is single-use, expires in 5 minutes and is bound to amount, currency, payee and the authorization.
- Everything is in the audit log and streams to the dashboard live.

## After recording

- [ ] Kill and restore the demo agent once to show the kill switch works (optional).
- [ ] Rotate or delete any agent key that appeared on screen.
