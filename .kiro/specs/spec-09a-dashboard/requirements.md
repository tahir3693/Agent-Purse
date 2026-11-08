# Requirements Document

## Introduction

spec-09a Dashboard: the owner dashboard in /web. It adds login and register, route protection, overview stats, agent management, an intents grid (ag-grid-react), an approvals queue, a live monitor over SSE with polling fallback, and a vault view. It also requires two small API changes: persisting Risk Guard reason and price check data, and tightening SSE CORS. The AG Studio assistant is out of scope and arrives in a later slice.

## Glossary

- **Web_App**: the Next.js application in /web.
- **BFF**: the Web_App route handlers that call the API with the Session_Cookie JWT as a Bearer token.
- **API**: the Fastify service on Render.
- **Session_Cookie**: the httpOnly cookie `ap_session` holding the owner JWT.
- **Intents_Grid**: the ag-grid-react table of intents.
- **Live_Monitor**: the Web_App component that consumes the API SSE stream.
- **Stream_Token**: the 60-second token from `POST /events/token` used to open `GET /events`.
- **Decision_Audit**: the audit event meta written when Risk Guard decides an intent.
- **Money_Display**: a string formatted from integer cents and an ISO 4217 currency code.

## Requirements

### Requirement 1: Login, register and route protection

**User Story:** As an owner, I want to register and sign in, so that I can reach my dashboard.

#### Acceptance Criteria

1. WHEN a register form is submitted, THE BFF SHALL call `POST /auth/register`, and IF the API returns 409 `email_taken` or 400 field errors, THEN THE Web_App SHALL show a distinct message for each and stay on the register page.
2. WHEN a login form is submitted and the API returns 200, THE BFF SHALL set the Session_Cookie and THE Web_App SHALL redirect to `/dashboard`.
3. IF a login request returns 401 or 429, THEN THE Web_App SHALL show a generic failure message for 401 and a rate-limit message for 429, set no Session_Cookie, and stay on the login page.
4. WHEN a visitor requests any `/dashboard` path without a Session_Cookie, THE Web_App SHALL redirect to `/login`.
5. WHEN the owner selects sign out, or IF the Proxy_Route receives a 401 from the API, THEN THE Web_App SHALL clear the Session_Cookie and redirect to `/login`.

### Requirement 2: Overview

**User Story:** As an owner, I want a summary of spend and decisions, so that I see activity at a glance.

#### Acceptance Criteria

1. WHEN the overview loads, THE Web_App SHALL fetch `GET /owner/stats` and render one card per currency showing spent today as Money_Display.
2. WHEN the overview loads, THE Web_App SHALL render the counts of approve, deny, escalate and none decisions from `countsByDecision`, showing 0 for any decision with no entry.
3. THE Web_App SHALL render text stating that payments are Braintree sandbox transactions (a PayPal service) with no real money.
4. IF the `GET /owner/stats` call fails, THEN THE Web_App SHALL show an error message in place of the cards and counts and SHALL keep the sandbox statement visible.

### Requirement 3: Agents

**User Story:** As an owner, I want to manage agents, so that I control who can spend.

#### Acceptance Criteria

1. WHEN the agents page loads, THE Web_App SHALL list every agent with name, status and policy summary.
2. WHEN an agent is created, THE Web_App SHALL show the returned `apiKey` once in a dialog with a copy button and SHALL NOT store or re-render the key after the dialog closes.
3. WHEN kill or restore is selected for an agent, THE BFF SHALL call `POST /agents/:id/kill` or `/restore` and THE Web_App SHALL update the agent status to the value returned by the API.
4. IF an API call to create, kill or restore fails, THEN THE Web_App SHALL show an error message next to the control and keep the prior state.

### Requirement 4: Policy editor

**User Story:** As an owner, I want to edit an agent policy, so that I set its allowance.

#### Acceptance Criteria

1. THE Web_App SHALL provide fields for dailyBudgetCents, perPurchaseCapCents, allowedCategories, blockedPayees, optional allowedPayees, velocityPerHour and velocityPerDay.
2. WHEN a currency amount is entered, THE Web_App SHALL convert it to integer cents and SHALL reject values that are negative or have more than 2 decimal places.
3. IF velocityPerHour or velocityPerDay is not a non-negative integer, THEN THE Web_App SHALL reject the value.
4. IF a field is invalid, THEN THE Web_App SHALL show an inline error linked to the field and SHALL NOT call the API.
5. WHEN the form is valid and submitted, THE BFF SHALL call `PUT /agents/:id/policy` and THE Web_App SHALL show the saved policy, or the API error while keeping the entered values.

### Requirement 5: Intents grid

**User Story:** As an owner, I want a sortable intents table, so that I can review purchases.

#### Acceptance Criteria

1. THE Web_App SHALL load the Intents_Grid with `next/dynamic` and `ssr: false`, using the license from NEXT_PUBLIC_AG_GRID_LICENSE_KEY.
2. THE Intents_Grid SHALL support column sorting and a filter by intent state, passed to `GET /owner/intents` as `state`.
3. THE Intents_Grid SHALL render amounts as Money_Display from integer cents and currency.
4. WHEN a row is selected, THE Web_App SHALL fetch `GET /owner/intents/:id` and show the intent with its audit events in a detail panel, or an error message if the fetch fails.
5. IF NEXT_PUBLIC_AG_GRID_LICENSE_KEY is missing, THEN THE Web_App SHALL show a message naming the variable and still render the grid.

### Requirement 6: Approvals

**User Story:** As an owner, I want to approve or deny escalated intents, so that risky purchases need my decision.

#### Acceptance Criteria

1. THE Web_App SHALL list intents in the escalated state with payee, Money_Display, justification, Risk Guard reason, risk score and Channel3 price check result.
2. WHEN Approve or Deny is selected, THE Web_App SHALL remove the item optimistically and THE BFF SHALL call `POST /intents/:id/approve` or `/deny`.
3. IF the API returns an error including 409, THEN THE Web_App SHALL restore the item and show the error message.
4. THE Web_App SHALL render the reason and justification as plain text, never as HTML.

### Requirement 7: Persist reason and price check

**User Story:** As an owner, I want to see why Risk Guard decided, so that I can judge escalations.

#### Acceptance Criteria

1. WHEN Risk Guard decides an intent, THE API SHALL store the decision reason in the Decision_Audit, capped at 280 characters.
2. WHEN a Channel3 price check ran, THE API SHALL store priceStatus, medianCents and sampleSize in the Decision_Audit.
3. IF no price check ran, THEN THE API SHALL store priceStatus as `unknown`.
4. THE API SHALL return the Decision_Audit meta in `GET /owner/intents/:id` events.

### Requirement 8: Live monitor

**User Story:** As an owner, I want live updates, so that I see intents as they happen.

#### Acceptance Criteria

1. WHEN the Live_Monitor starts, THE BFF SHALL call `POST /events/token` and THE browser SHALL open `GET /events?stream_token=` directly on NEXT_PUBLIC_API_BASE_URL.
2. IF the stream closes or errors, THEN THE Live_Monitor SHALL fetch a new Stream_Token and reconnect with exponential backoff starting at 1 second, doubling per attempt, capped at 30 seconds.
3. WHILE the Live_Monitor is running, THE Live_Monitor SHALL show exactly one status of connecting, live, reconnecting or offline, and SHALL announce each status change through an aria-live region.
4. WHEN an event arrives, THE Web_App SHALL add the event to the event list and refresh the stats and Intents_Grid within 1 second.
5. IF 3 consecutive reconnect attempts fail, THEN THE Live_Monitor SHALL poll the stats and intents every 2 seconds until the stream reconnects.

### Requirement 9: Vault

**User Story:** As an owner, I want to link a sandbox card, so that agents can pay.

#### Acceptance Criteria

1. WHEN the vault page loads, THE Web_App SHALL list methods from `GET /vault/methods` showing cardType, last4 and createdAt.
2. WHEN "Link sandbox test card" is selected, THE BFF SHALL call `POST /vault/link` with nonce `fake-valid-nonce` and THE Web_App SHALL show the new method in the list.
3. IF linking fails, THEN THE Web_App SHALL show the API error message and keep the existing method list unchanged.
4. THE Web_App SHALL state on the vault page that the linked card is a Braintree sandbox test card.

### Requirement 10: Layout, accessibility and environment

**User Story:** As an owner, I want a readable, accessible dashboard, so that I can use it on laptop or phone.

#### Acceptance Criteria

1. THE Web_App SHALL use the dark theme of the landing page, no emojis and no third-party logos.
2. THE Web_App SHALL give every form control a visible label, a visible focus style and keyboard operation.
3. WHILE the viewport width is 360 pixels or more, THE Web_App SHALL render dashboard pages without horizontal page scroll.
4. IF API_BASE_URL, NEXT_PUBLIC_API_BASE_URL or NEXT_PUBLIC_AG_GRID_LICENSE_KEY is missing, THEN THE Web_App SHALL show a message naming only the missing variable and no variable value.
5. THE Web_App SHALL read no environment variable other than API_BASE_URL, NEXT_PUBLIC_API_BASE_URL and NEXT_PUBLIC_AG_GRID_LICENSE_KEY.

### Requirement 11: SSE CORS and tests

**User Story:** As a maintainer, I want strict CORS and offline tests, so that regressions are caught.

#### Acceptance Criteria

1. WHEN a cross-origin request to `GET /events` has an Origin listed in WEB_ORIGIN, THE API SHALL allow that origin without credentials, and IF the Origin is not listed, THEN THE API SHALL send no allow-origin header; no origin SHALL be hard-coded.
2. THE API SHALL send no CORS headers on any route other than `GET /events`.
3. THE Web_App SHALL include vitest tests for BFF handlers covering a missing session returning 401, the agent API key absent from list responses, and API errors mapped to status and message.
4. THE Web_App SHALL include vitest tests for the SSE reconnect logic using fake timers, covering backoff growth, the 30-second cap, a new token per attempt and the polling fallback every 2 seconds.
5. WHEN typecheck, lint, `next build` and the full test suite run with no network access, THE repository SHALL complete each with exit code 0 and all pre-existing tests passing.
