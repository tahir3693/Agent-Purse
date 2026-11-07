# Requirements Document

## Introduction

spec-04 Web to Next.js: replace the /web placeholder with a Next.js App Router app (TypeScript) that Vercel builds with Root Directory `web`. The app hosts a landing page, login and dashboard placeholders, a health route, and a thin BFF (login, logout, allowlisted proxy) that keeps the owner JWT in an httpOnly cookie. The Render API is never built or deployed by Vercel. The dashboard, AG Studio and live SSE arrive in spec-09.

## Glossary

- **Web_App**: the Next.js application in /web.
- **API**: the Fastify service deployed on Render, reached at API_BASE_URL.
- **BFF**: the Web_App route handlers that call the API on behalf of the browser.
- **Session_Cookie**: the httpOnly, secure, sameSite cookie on the Vercel domain holding the owner JWT.
- **Proxy_Route**: the BFF route handler that forwards owner calls to the API with a Bearer token.


## Requirements

### Requirement 1: Next.js app replaces the placeholder

**User Story:** As a maintainer, I want /web to be a real Next.js app, so that Vercel detects the framework and deploys it.

#### Acceptance Criteria

1. THE Web_App SHALL be a Next.js App Router project in TypeScript whose `package.json` declares `next` as a dependency and a `build` script equal to `next build`.
2. THE Web_App SHALL contain no `web/src/index.ts` and no Node server entrypoint, and SHALL declare no dependency on fastify, prisma or any other API-only package.
3. WHEN the command `pnpm --filter @agentpurse/shared run build && pnpm run build` runs with Root Directory `web`, THE Web_App SHALL build with exit code 0 and no TypeScript errors.

### Requirement 2: Shared package import

**User Story:** As a developer, I want the web app to reuse @agentpurse/shared, so that types and schemas match the API.

#### Acceptance Criteria

1. THE Web_App SHALL resolve @agentpurse/shared through its built `dist` output or the Next.js `transpilePackages` setting, so that `next build` completes without module-resolution errors.
2. THE Web_App SHALL import at least one schema or type (for example MoneySchema) from @agentpurse/shared.
3. THE Web_App SHALL import in files marked "use client" only exports of @agentpurse/shared that have no Node-only dependencies.

### Requirement 3: Environment variables

**User Story:** As an operator, I want clear env handling, so that a missing variable is easy to fix.

#### Acceptance Criteria

1. THE Web_App SHALL read only API_BASE_URL (server-side code only), NEXT_PUBLIC_API_BASE_URL and NEXT_PUBLIC_AG_GRID_LICENSE_KEY from the environment.
2. IF API_BASE_URL is missing when a server-side route handler runs, THEN THE Web_App SHALL return an error response whose body names API_BASE_URL, SHALL NOT include any variable value, and SHALL keep serving subsequent requests.
3. IF NEXT_PUBLIC_API_BASE_URL or NEXT_PUBLIC_AG_GRID_LICENSE_KEY is missing when a page renders, THEN THE Web_App SHALL render a message naming the variable and SHALL NOT crash the page.
4. THE Web_App client bundle SHALL contain no reference to server-only secrets (JWT_SECRET, MANDATE_SIGNING_KEY, CHANNEL3_API_KEY, BRAINTREE_PRIVATE_KEY, PAYPAL_CLIENT_SECRET, ANTHROPIC_API_KEY), verifiable by searching the build output for those names.

### Requirement 4: Landing, login and dashboard pages

**User Story:** As a visitor, I want a clear landing page, so that I understand what AgentPurse does and its sandbox limits.

#### Acceptance Criteria

1. WHEN a visitor requests `/`, THE Web_App SHALL render the text "AgentPurse" and the text "Give your AI an allowance, not your credit card".
2. WHEN a visitor requests `/`, THE Web_App SHALL render text stating that payments are Braintree sandbox transactions (a PayPal service) with no real money, and that Channel3 supplies real catalog and price data.
3. WHEN a visitor requests `/login` or `/dashboard`, THE Web_App SHALL render a placeholder page without error, to be completed in spec-09.
4. THE Web_App SHALL contain no third-party logo or trademark image; plain-text "PayPal" and "Braintree" are permitted.

### Requirement 5: Health route

**User Story:** As an operator, I want a health route that tolerates Render cold starts, so that I can verify the API link.

#### Acceptance Criteria

1. THE Web_App SHALL provide a health route at `app/api/health/route.ts` with `maxDuration` of 60 seconds.
2. WHEN the health route is requested, THE health route SHALL call the API `GET /healthz` at API_BASE_URL and wait up to 55 seconds for a response.
3. WHEN the API answers with a 2xx status, THE health route SHALL return HTTP 200 with the upstream status code and a body summary truncated to 200 characters.
4. IF the API is unreachable, does not answer within 55 seconds, or answers with a non-2xx status, THEN THE health route SHALL return HTTP 502 with the failure reason and the upstream status code when one exists.
5. IF API_BASE_URL is missing, THEN THE health route SHALL return HTTP 500 with an error naming API_BASE_URL and SHALL NOT call the API.

### Requirement 6: Auth plumbing

**User Story:** As an owner, I want to sign in through the web app, so that my JWT never reaches browser JavaScript.

#### Acceptance Criteria

1. WHEN a login request with credentials is received, THE BFF SHALL call API `POST /auth/login` and store the returned `accessToken` in the Session_Cookie as httpOnly, secure and sameSite, with an expiry equal to the returned `expiresAt`.
2. THE BFF SHALL NOT include the JWT in any response body or in any response header other than the httpOnly Set-Cookie header.
3. IF the API rejects the login credentials or is unreachable, THEN THE BFF SHALL return an error response, SHALL NOT set the Session_Cookie, and SHALL NOT disclose whether the email or the password was wrong.
4. WHEN a logout request is received, THE BFF SHALL clear the Session_Cookie by expiring it.
5. WHEN a request matches an allowlisted path and the Session_Cookie is present, THE Proxy_Route SHALL forward it to the API with the Session_Cookie JWT as a Bearer token.
6. IF a request path is not allowlisted, THEN THE Proxy_Route SHALL return 404 without calling the API.
7. IF the Session_Cookie is absent, THEN THE Proxy_Route SHALL return 401 without calling the API.

### Requirement 7: Deployment safety and docs

**User Story:** As a maintainer, I want Vercel to treat /web only as a Next.js app, so that deploys stop failing.

#### Acceptance Criteria

1. THE Web_App directory SHALL contain no file that Vercel detects as a standalone backend entrypoint (for example `server.js`, `index.js`, `app.js` or a Fastify or Express server).
2. THE `web/README.md` SHALL state the Vercel settings (Root Directory `web`, Framework Preset Next.js), the variable names API_BASE_URL, NEXT_PUBLIC_API_BASE_URL and NEXT_PUBLIC_AG_GRID_LICENSE_KEY (names only), and that the Render API may take up to 60 seconds to respond on a cold start.
3. THE design document SHALL state that AG Studio is loaded in spec-09 with `next/dynamic` and `ssr: false`.

### Requirement 8: Tests and quality gates

**User Story:** As a maintainer, I want offline tests, so that regressions are caught without live calls.

#### Acceptance Criteria

1. THE Web_App SHALL include vitest tests for the health route (success and upstream failure) and for missing-env handling (the error names the missing variable and prints no values), with `fetch` mocked and no live network calls.
2. THE Web_App SHALL include vitest tests asserting that login sets an httpOnly, secure, sameSite cookie, that the Proxy_Route forwards only allowlisted paths, and that a request without the cookie is rejected with 401.
3. WHEN typecheck, lint, `next build` and the full test suite run, THE repository SHALL complete each with exit code 0 and all pre-existing tests passing.
