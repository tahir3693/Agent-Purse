# Requirements Document

## Introduction

spec-09b AG Studio: adds an AG Studio page at `/dashboard/studio` in /web with three custom widgets, dark theming, a persisted default layout, and a read-only Studio Agent Framework assistant. The assistant runs through a new owner-authenticated API endpoint `POST /assistant` that holds the LLM key. The spec-09a dashboard stays unchanged.

Findings from the official AG Studio 3.1.0 docs (ai-quickstart, ai-direct-llm-runner, ai-builtin-harness, ai-custom-agents, custom-widgets, theming): AG Studio bundles no LLM connection and the app supplies an adapter implementing `executeTurn`. The docs point at an AG Grid-run demo endpoint but describe no production hosted model, so this slice uses the API with ANTHROPIC_API_KEY. Whether the license key includes AI is only confirmed by the browser console at runtime (a licence error means it does not).

## Glossary

- **Web_App**: the Next.js application in /web.
- **BFF**: the Web_App route handlers that call the API with the Session_Cookie JWT as a Bearer token.
- **API**: the Fastify service on Render.
- **Session_Cookie**: the httpOnly cookie `ap_session` holding the owner JWT.
- **Studio_Page**: the client page at `/dashboard/studio` hosting AgStudioProvider.
- **Widget**: a custom AG Studio widget registered through `createWidgets`.
- **Default_Layout**: the saved initial AG Studio state, persisted in localStorage.
- **Assistant_Adapter**: the `AgLlmAdapter` whose `executeTurn` calls the BFF assistant route.
- **Assistant_Endpoint**: `POST /assistant` on the API.
- **Read_Tool**: a server-defined assistant tool that only reads data scoped to the JWT owner.
- **Untrusted_Data**: tool results, intent justification, descriptions and any client-supplied text.
- **Money_Display**: a string formatted from integer cents and an ISO 4217 currency code.

## Requirements

### Requirement 1: Studio setup

**User Story:** As an owner, I want an AG Studio page, so that I can build a custom view of my data.

#### Acceptance Criteria

1. THE Web_App SHALL depend on `ag-studio` and `ag-studio-react` at the exact version 3.1.0.
2. THE Web_App SHALL load the Studio_Page with `next/dynamic` and `ssr: false`, passing NEXT_PUBLIC_AG_GRID_LICENSE_KEY as the AgStudioProvider `licenseKey`.
3. IF NEXT_PUBLIC_AG_GRID_LICENSE_KEY is missing, THEN THE Studio_Page SHALL show a message naming the variable and render no Studio.
4. WHEN a visitor requests `/dashboard/studio` without a Session_Cookie, THE Web_App SHALL redirect to `/login`.
5. THE Web_App SHALL keep every spec-09a dashboard page and its tests working unchanged.

### Requirement 2: Widgets

**User Story:** As an owner, I want widgets for spend, decisions and approvals, so that I see key data in Studio.

#### Acceptance Criteria

1. THE Studio_Page SHALL register a spend-per-day Widget that renders integer cents as Money_Display from `GET /owner/stats` through the BFF.
2. THE Studio_Page SHALL register a decisions-breakdown Widget that renders approved, escalated and denied counts, showing 0 for a missing decision.
3. THE Studio_Page SHALL register an escalation-queue Widget that lists escalated intents with payee, Money_Display and Approve and Deny actions.
4. WHEN Approve or Deny is selected in the escalation-queue Widget, THE BFF SHALL call the existing `POST /intents/:id/approve` or `/deny` proxy and THE Widget SHALL remove the item, or restore it and show the error if the call fails.
5. IF a Widget data fetch fails, THEN THE Widget SHALL show an error message in place of its data.
6. THE Widget SHALL render intent text as plain text, never as HTML.

### Requirement 3: Theme and layout

**User Story:** As an owner, I want a matching dark theme and a saved layout, so that Studio feels part of the app.

#### Acceptance Criteria

1. THE Studio_Page SHALL apply a dark theme built with `studioTheme.withParams` using the Web_App colour palette.
2. WHEN the Studio_Page loads with no saved state, THE Studio_Page SHALL start from the Default_Layout containing the three Widgets.
3. WHEN the Studio state changes, THE Studio_Page SHALL persist the state to localStorage.
4. WHEN the owner selects Reset layout, THE Studio_Page SHALL restore the Default_Layout and overwrite the saved state.
5. IF the saved state cannot be parsed, THEN THE Studio_Page SHALL load the Default_Layout.

### Requirement 4: Assistant transport

**User Story:** As an owner, I want an assistant in Studio, so that I can ask questions about my spending.

#### Acceptance Criteria

1. THE Studio_Page SHALL register the AgStudioAiModule and an agent created with `createAiHarness` and `directLlmRunner` using the Assistant_Adapter.
2. WHEN `executeTurn` is called, THE Assistant_Adapter SHALL post the conversation to the BFF route `app/api/assistant/route.ts` and yield the streamed reply as `AgAiEvent` values.
3. WHEN the BFF assistant route receives a request, THE BFF SHALL forward it to `POST /assistant` with the Session_Cookie JWT as a Bearer token, or return 401 if the cookie is missing.
4. WHEN the `signal` passed to `executeTurn` aborts, THE Assistant_Adapter SHALL cancel the request.
5. THE Web_App SHALL contain no LLM provider call and no LLM key in the browser or BFF code.

### Requirement 5: Assistant endpoint

**User Story:** As an owner, I want the assistant to answer from my data only, so that my data stays private.

#### Acceptance Criteria

1. IF a request to the Assistant_Endpoint has no valid owner JWT, THEN THE API SHALL return 401.
2. THE API SHALL read ANTHROPIC_API_KEY and AI_MODEL from the server environment, and IF ANTHROPIC_API_KEY is missing, THEN THE API SHALL name the variable in the error and return 503.
3. THE Assistant_Endpoint SHALL limit each owner to a configured number of requests per minute and return 429 above the limit.
4. THE API SHALL accept only user and assistant text messages and SHALL ignore client-supplied tools, instructions and system messages.
5. THE Assistant_Endpoint SHALL stream the reply to the caller.
6. IF the LLM call fails or exceeds the configured timeout, THEN THE Assistant_Endpoint SHALL return a short fixed failure message and SHALL NOT expose the provider error.

### Requirement 6: Read-only tools

**User Story:** As an owner, I want the assistant unable to change anything, so that a prompt cannot move money.

#### Acceptance Criteria

1. THE API SHALL define exactly these Read_Tools: list intents, get stats, list agents and policies, and explain why an intent was escalated or denied.
2. WHEN a Read_Tool runs, THE API SHALL execute the tool on the server and scope every query to the JWT owner.
3. IF the model requests a tool outside the Read_Tool set, THEN THE API SHALL return a tool error and SHALL NOT execute any action.
4. THE API SHALL provide no tool that approves, denies, creates, kills, restores or modifies any record.
5. IF a Read_Tool is called with an id belonging to another owner, THEN THE API SHALL return a not-found result.
6. THE API SHALL pass Untrusted_Data to the model as data and SHALL NOT let Untrusted_Data change the tool set or instructions.

### Requirement 7: Documentation

**User Story:** As an evaluator, I want to know the license terms, so that I can run the Studio page.

#### Acceptance Criteria

1. THE README SHALL state that the AG Studio key is a trial license that expires on 20 December 2026 and that a watermark or banner is expected after that date.
2. THE README SHALL state that the trial key is for evaluation only and SHALL contain no key value.
3. THE README SHALL record that AG Grid offers no production hosted model endpoint and that AI licence inclusion is confirmed by the console.

### Requirement 8: Tests and quality gates

**User Story:** As a maintainer, I want offline tests, so that regressions are caught.

#### Acceptance Criteria

1. THE Web_App SHALL include vitest tests for the Assistant_Adapter using a stubbed BFF response, covering streamed events, abort and error mapping.
2. THE API SHALL include tests for the Assistant_Endpoint covering 401 without a JWT, 429 over the limit, ignored client tools and system messages, and fail-closed on LLM error and timeout.
3. THE API SHALL include tests showing the tool set holds only Read_Tools and that cross-owner ids return not-found.
4. THE API SHALL include prompt-injection tests where intent text instructs the assistant to approve, deny or kill, and the tests SHALL show that no state changes.
5. WHEN typecheck, lint, `next build` and the full test suite run with no network access, THE repository SHALL complete each with exit code 0 and all pre-existing tests passing.
