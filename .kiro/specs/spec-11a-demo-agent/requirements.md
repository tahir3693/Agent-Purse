# Requirements Document

## Introduction

spec-11a Demo Agent: a Node CLI in /demo-agent that acts as an AI agent. It searches Channel3 for a product, picks the cheapest in-stock offer within a budget, and submits purchase intents to the AgentPurse API using an agent API key. It runs six scenarios (small-safe, needs-approval, over-cap, overpriced, injection, replay), prints a readable transcript and reports PASS or FAIL per scenario. The API gains one small change: POST /intents accepts an optional `productId` so the Risk Guard price check can use it. Payments are Braintree sandbox only.

## Glossary

- **Demo_Agent**: the CLI in /demo-agent (`@agentpurse/demo-agent`).
- **API**: the Fastify service reached at DEMO_API_BASE_URL.
- **Channel3_Module**: the existing Channel3 module (`createChannel3Module`, `buildChannel3Client`), reused by the Demo_Agent and not duplicated.
- **Scenario**: a named run (small-safe, needs-approval, over-cap, overpriced, injection, replay) with one expected outcome.
- **Mandate_Token**: the single-use signed token returned by the API for an authorized intent.
- **Transcript**: the human-readable console output of a run.
- **Redacted_Prefix**: at most the first 8 characters of a secret-bearing value followed by "...".

## Requirements

### Requirement 1: Configuration from environment

**User Story:** As a presenter, I want the demo configured by env names only, so that no secret is ever exposed.

#### Acceptance Criteria

1. THE Demo_Agent SHALL read only DEMO_API_BASE_URL (default `http://localhost:8080`), DEMO_AGENT_KEY, DEMO_PAYMENT_METHOD_ID and CHANNEL3_API_KEY from the environment.
2. IF DEMO_AGENT_KEY, DEMO_PAYMENT_METHOD_ID or CHANNEL3_API_KEY is missing or empty, THEN THE Demo_Agent SHALL print a message naming the variable, make no network call, and exit with a non-zero code.
3. THE Demo_Agent SHALL print no environment variable value in any output, including error output.
4. THE repository SHALL list the four variable names with placeholder values in `.env.example` and in the secrets-checker allowlist where needed.

### Requirement 2: Product selection through Channel3

**User Story:** As a presenter, I want the agent to pick a real product, so that the demo uses real catalog data.

#### Acceptance Criteria

1. THE Demo_Agent SHALL search products through the Channel3_Module and SHALL NOT contain a second Channel3 client implementation.
2. WHEN search results are returned, THE Demo_Agent SHALL select the in-stock offer with the lowest price in integer cents that is at or below the scenario budget, breaking ties by first position in the results.
3. IF no in-stock offer is within the budget, THEN THE Demo_Agent SHALL report the scenario as FAIL with the reason "no offer within budget" and submit no purchase intent.
4. WHEN an offer is selected, THE Demo_Agent SHALL submit a purchase intent with `productId`, `payee` equal to the offer merchant domain, `amountCents`, `currency`, `paymentMethodRef` from DEMO_PAYMENT_METHOD_ID and a justification.

### Requirement 3: API accepts a product id

**User Story:** As an owner, I want the price check to use the product the agent names, so that overpriced requests are caught.

#### Acceptance Criteria

1. THE API SHALL accept an optional `productId` string of 1 to 200 characters in the POST /intents body.
2. WHEN `productId` is present, THE API SHALL pass it to the Risk Guard price check without persisting it.
3. IF `productId` is empty or exceeds 200 characters, THEN THE API SHALL reject the request with a validation error and create no intent.
4. WHEN `productId` is absent, THE API SHALL behave as it did before this change.

### Requirement 4: Scenario runner

**User Story:** As a presenter, I want to run one or all scenarios by command, so that I can record the demo.

#### Acceptance Criteria

1. WHEN `pnpm demo:run --scenario <name>` runs with a valid name, THE Demo_Agent SHALL run only that Scenario.
2. WHEN `pnpm demo:run --scenario all` runs, THE Demo_Agent SHALL run all six Scenarios in sequence.
3. IF the scenario name is missing or unknown, THEN THE Demo_Agent SHALL print the list of valid names, run no Scenario, and exit with a non-zero code.
4. WHEN a Scenario ends, THE Demo_Agent SHALL print PASS if the observed outcome equals the expected outcome, otherwise FAIL.
5. IF any Scenario reports FAIL, THEN THE Demo_Agent SHALL exit with a non-zero code after all selected Scenarios have finished, and otherwise SHALL exit with code 0.

### Requirement 5: Approval and execution scenarios

**User Story:** As a presenter, I want to show the happy path and the human approval path, so that viewers see authorize then capture.

#### Acceptance Criteria

1. WHEN the small-safe Scenario receives a 201 response with a Mandate_Token, THE Demo_Agent SHALL call POST /intents/:id/execute with that token and expect state "captured".
2. WHEN the needs-approval Scenario receives decision "escalate", THE Demo_Agent SHALL poll GET /intents/:id every 2 seconds until the state is final (authorized, captured, denied, voided or failed) or 180 seconds have elapsed.
3. WHEN the owner approves within 180 seconds, THE Demo_Agent SHALL call POST /intents/:id/mandate and then POST /intents/:id/execute and expect state "captured".
4. IF the polled state is denied, voided or failed, or 180 seconds elapse without a final state, THEN THE Demo_Agent SHALL report the needs-approval Scenario as FAIL with the reason (denied, voided, failed or timed out).

### Requirement 6: Rejection scenarios

**User Story:** As a presenter, I want to show the guardrails refuse unsafe requests, so that the safety story is visible.

#### Acceptance Criteria

1. WHEN the over-cap Scenario submits an amount above the per-purchase or daily cap, THE Demo_Agent SHALL expect decision "deny", state "denied" and no Mandate_Token.
2. WHEN the overpriced Scenario submits an amount at least 3 times the Channel3 median price, THE Demo_Agent SHALL expect decision "deny" or "escalate", no Mandate_Token, and a reason or risk score reflecting the high price.
3. WHEN the injection Scenario submits a justification that tries to override the rules, THE Demo_Agent SHALL expect a decision other than "approve" and no Mandate_Token.
4. WHEN the replay Scenario re-executes an already consumed Mandate_Token, THE Demo_Agent SHALL expect HTTP 409 and the original intent state to remain "captured".

### Requirement 7: Transcript and redaction

**User Story:** As a viewer, I want a clean transcript, so that the demo is easy to follow and honest.

#### Acceptance Criteria

1. WHEN a run starts, THE Demo_Agent SHALL print the line "Braintree sandbox, no real money; Channel3 provides real catalog data." before any Scenario output.
2. THE Demo_Agent SHALL print each amount in dollars with exactly two decimal places, derived from integer cents using integer arithmetic only.
3. WHEN the Demo_Agent receives an API response, THE Demo_Agent SHALL print the decision, risk score, reason, intent id and state from that response, using a placeholder for any omitted field.
4. THE Demo_Agent SHALL print no occurrence of the DEMO_AGENT_KEY value, and SHALL print any Mandate_Token only as a Redacted_Prefix.

### Requirement 8: Tests

**User Story:** As a maintainer, I want offline tests, so that regressions are caught without live calls.

#### Acceptance Criteria

1. THE Demo_Agent SHALL include vitest tests that use a stubbed API and a stubbed Channel3 client, with no live network calls.
2. THE tests SHALL cover offer selection (cheapest in-stock within budget, none within budget), each of the six Scenarios (PASS and FAIL paths), missing-env handling and transcript redaction.
3. THE tests SHALL cover the API `productId` rule from Requirement 3.
4. WHEN typecheck, lint, build and the full test suite run, THE repository SHALL complete each with exit code 0 and all pre-existing tests passing.

### Requirement 9: Script and README

**User Story:** As a presenter, I want exact commands, so that I can record the video without guessing.

#### Acceptance Criteria

1. THE root `package.json` SHALL define a `demo:run` script that runs the Demo_Agent.
2. THE `demo-agent/README.md` SHALL give the exact command for each of the six Scenarios and for `--scenario all`, listing environment variable names only and no values.
3. THE `demo-agent/README.md` SHALL state that payments are Braintree sandbox transactions with no real money and that Channel3 supplies real catalog data.
4. THE design document SHALL state how the Channel3_Module is shared with the demo-agent workspace.
