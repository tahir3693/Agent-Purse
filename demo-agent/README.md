# @agentpurse/demo-agent

A command-line "AI shopping agent" for the demo video. It finds a real product through Channel3, submits a purchase intent to the AgentPurse API with an agent API key, and prints a transcript with PASS or FAIL for each scenario.

Payments are Braintree sandbox transactions (a PayPal service). No real money or physical goods change hands. Channel3 supplies real product catalog and market price data.

## Setup (names only, values go in the root `.env`)

| Variable                 | Meaning                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| `DEMO_API_BASE_URL`      | API base URL, for example your Render URL. Defaults to `http://localhost:8080` |
| `DEMO_AGENT_KEY`         | Agent API key printed once by `pnpm seed:demo`                                 |
| `DEMO_PAYMENT_METHOD_ID` | Vault method id printed by `pnpm seed:demo` (used as `paymentMethodRef`)       |
| `CHANNEL3_API_KEY`       | Channel3 key for the product search                                            |

The CLI never prints these values. Mandate tokens appear only as an 8-character prefix.

One-time preparation:

```sh
pnpm install
pnpm --filter @agentpurse/shared run build
pnpm db:migrate                  # against the DATABASE_URL in .env
pnpm seed:demo                   # demo owner, agent with policy, sandbox test card
pnpm seed:demo --set-password    # optional: owner password from DEMO_OWNER_PASSWORD
pnpm demo:check                  # one real AI call: prints OK or auth|quota|model|network
```

Copy the printed agent key and vault method id into `.env` as `DEMO_AGENT_KEY` and `DEMO_PAYMENT_METHOD_ID`.

## Commands for the video

```sh
pnpm demo:run --scenario small-safe       # cheap item, auto-approved, then authorize and capture
pnpm demo:run --scenario needs-approval   # a real $70-$150 product at its real price, above the $50.00 auto-approve limit; approve or deny it in the dashboard within 3 minutes
pnpm demo:run --scenario over-cap         # $250.00, above the $200.00 per-purchase cap; denied by the rules
pnpm demo:run --scenario overpriced       # about 3x the Channel3 market price; the price check flags it
pnpm demo:run --scenario injection        # justification tries to override the policy; not approved
pnpm demo:run --scenario replay           # reuses a consumed mandate token; the API returns 409
pnpm demo:run --scenario all              # all six in order
```

Every run starts with: "Braintree sandbox, no real money; Channel3 provides real catalog data."

The exit code is 0 when every selected scenario passes and 1 otherwise. A missing or unknown scenario name, or a missing variable, exits with 2 before any network call. A mismatch prints `FAIL <name>: expected ..., actual ... (reason)`. Each API call is made once, with no silent retries. The needs-approval status poll every 2 seconds is the only loop.

## Expected outcomes and limits

The amounts match the demo seed policy (per-purchase cap $200.00, daily budget $500.00) and the API auto-approve limit of $50.00.

- small-safe needs the AI review to approve a cheap purchase. The rules and the price check allow it, but the AI decides. If the AI does not approve, the run says FAIL with its reason.
- needs-approval is deterministic: any amount above $50.00 escalates whatever the AI says. The agent searches Channel3 for a mechanical keyboard (then wireless noise cancelling headphones) with a $70.00 to $150.00 price filter, picks the in-stock USD offer closest to $100.00, and requests exactly that real price. The price is never inflated, so the only reason to escalate is the amount. If no product in that range is found, the scenario fails with a clear message before any API call.
- over-cap is deterministic (rules deny).
- overpriced asks under $50.00, so only the price check can stop it. A high price always escalates.
- injection is denied by the deterministic prompt-injection check.
- Run small-safe and replay at least a few minutes apart if you run them more than 10 times an hour, because the policy allows 10 purchases per hour.

## How the Channel3 module is shared

The agent imports the API's Channel3 module by relative path (`../../api/src/channel3/index.js`), so there is exactly one Channel3 client. The CLI runs with `tsx` and is typechecked with `tsc --noEmit`, so there is no build output.

## Tests

`pnpm test` runs the demo-agent tests with a stubbed API and a stubbed catalog. They make no network calls.
