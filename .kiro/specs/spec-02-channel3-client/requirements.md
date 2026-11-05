# Requirements Document

spec-02 Channel3 Client

## Introduction

This slice builds the Channel3 integration module inside the API (`/api/src/channel3/`). Channel3 is the real product-catalog and price-data source for AgentPurse. Two consumers depend on this module: the demo agent (searches for a product and picks the best in-stock offer) and the Risk Guard (price-sanity check on an intent). The module must be server-side only (the `CHANNEL3_API_KEY` never reaches a bundle), resilient (timeout + one retry, degrade to `unknown`), and honest about data freshness (cache product IDs only, never cache prices or offer URLs beyond a few minutes).

Scope is the Channel3 client, a smoke script, and fixture-based unit tests. No Risk Guard logic, no demo-agent code, no HTTP endpoints - those are later slices that import this module.


## Glossary

- Channel3: external universal product-catalog API supplying real catalog, price, and availability data.
- Offer: a single merchant listing for a product, carrying price, currency, domain, availability, and an affiliate buy URL.
- priceCheck: the Risk Guard-facing function that returns a price-sanity verdict (ok/high/low/unknown) for an intent amount.
- Intent: an agent's purchase request (payee, description, amount in cents, currency, justification).
- Major currency units: the human-facing amount (e.g. dollars); Channel3 prices are in major units and must be converted to integer cents.
- Smoke script: a one-command live sanity check (pnpm channel3:smoke) that never prints secrets.
- Fixture: a recorded response object used to drive deterministic tests with no live network calls.
## Requirements

### Requirement 1: Server-side Channel3 client wrapper

**User Story:** As an API developer, I want a thin typed wrapper around the Channel3 SDK, so that the rest of the API calls product search and retrieval through one module that owns auth and configuration.

#### Acceptance Criteria
1. WHEN the module is imported THEN it SHALL construct a Channel3 SDK client (`@channel3/sdk`, named import `Channel3`) configured with the `CHANNEL3_API_KEY` from the environment.
2. IF `CHANNEL3_API_KEY` is unset or blank WHEN a client operation is attempted THEN the module SHALL throw (or surface) an error that names the missing variable `CHANNEL3_API_KEY` and SHALL NOT print its value.
3. The module SHALL be usable only server-side and SHALL NOT be importable into the web or mobile bundles (enforced by living under `/api`).
4. The module SHALL expose a factory or default instance so tests can inject a stubbed SDK client (no live network calls in tests).

### Requirement 2: Product search

**User Story:** As the demo agent, I want to search the catalog by text with an optional price ceiling, so that I can find a product to buy.

#### Acceptance Criteria
1. WHEN `searchProducts({ query, maxPriceCents?, limit? })` is called THEN it SHALL call `client.products.search` with `query`, `limit` (default 5), and, IF `maxPriceCents` is provided, `filters.price.max_price` set to the major-currency-unit equivalent of `maxPriceCents`.
2. WHEN the search returns a page THEN the function SHALL return the products from `page.data` as a typed array.
3. WHEN the search returns no products THEN the function SHALL return an empty array (not throw).
4. Each returned product SHALL retain `id`, `title`, and `offers[]` (`price.price`, `price.currency`, `domain`, `availability`, `url`).

### Requirement 3: Product retrieval (fresh)

**User Story:** As a consumer that cached a product id, I want to fetch fresh price, stock and offer URLs, so that I never present stale pricing or a stale buy link.

#### Acceptance Criteria
1. WHEN `getProduct(productId)` is called THEN it SHALL call `client.products.retrieve({ product_id })` and return the full product.
2. The function SHALL treat the retrieve call as the fresh source for price, availability and offer URLs.
3. WHEN the product id is not found THEN the function SHALL surface the not-found condition rather than returning a malformed product.

### Requirement 4: Price check

**User Story:** As the Risk Guard, I want a price-sanity verdict for an intent, so that I can raise risk or escalate when an amount is clearly off-market.

#### Acceptance Criteria
1. WHEN `priceCheck({ title, amountCents, currency })` is called THEN it SHALL search the catalog for matching products and compute the median offer price (in cents) across in-stock offers in the same currency, returning `{ status, medianCents, sampleSize, bestOffer? }`.
2. The `status` SHALL be: `high` when `amountCents` is clearly above the market median; `low` when clearly below; `ok` when within a normal band of the median; and `unknown` when the sample is empty or any error occurs.
3. WHEN the Channel3 call errors, times out, or returns no comparable offers THEN `priceCheck` SHALL return `status: "unknown"` with `sampleSize: 0` and SHALL NOT throw.
4. The price comparison SHALL convert Channel3 prices (major currency units) to integer cents before comparison and SHALL compare only offers whose currency matches the requested `currency`.
5. `bestOffer`, when present, SHALL reference the lowest-priced in-stock matching offer by `{ domain, priceCents, currency }` and SHALL NOT be a cached/stale value.

### Requirement 5: Resilience and freshness

**User Story:** As the platform, I want Channel3 calls bounded and cache-disciplined, so that a slow or flaky dependency never blocks a decision and no stale price is ever served.

#### Acceptance Criteria
1. Each Channel3 operation used by `priceCheck` SHALL enforce an 8-second timeout and SHALL retry once on failure before degrading to `unknown`.
2. The module MAY cache product IDs but SHALL NOT cache prices, availability, or offer URLs for longer than 5 minutes.
3. The module SHALL NOT serve a cached offer URL; offer URLs SHALL come from a fresh retrieve/search.

### Requirement 6: Smoke script

**User Story:** As a developer, I want a one-command smoke test, so that I can confirm the key and connectivity work without writing code.

#### Acceptance Criteria
1. WHEN `pnpm channel3:smoke "27 inch monitor"` is run THEN it SHALL perform a live search and print the top 5 results as title, domain, and price.
2. The script SHALL NOT print the `CHANNEL3_API_KEY` value anywhere.
3. IF `CHANNEL3_API_KEY` is missing THEN the script SHALL stop and report the variable name only.
4. The script SHALL accept the query as a command-line argument.

### Requirement 7: Fixture-based unit tests

**User Story:** As a maintainer, I want tests that never hit the live API, so that CI is deterministic and free.

#### Acceptance Criteria
1. Unit tests SHALL use recorded fixtures / a stubbed SDK client and SHALL make no live network calls.
2. Tests SHALL cover: search mapping (including `maxPriceCents` to `max_price`), empty-result handling, `priceCheck` verdict bands (`ok`/`high`/`low`), and `unknown` on error/timeout/empty.
3. Tests SHALL assert the key is never logged by the smoke path (e.g. by asserting the logging helper redacts or omits it).
4. All tests SHALL run under the existing Vitest runner via `vitest run`.

### Requirement 8: Secrets and honesty

**User Story:** As the owner, I want the integration to respect the project secret rules, so that no key leaks and the demo stays honest.

#### Acceptance Criteria
1. No real key value SHALL appear in any source file, test, fixture, log, or script output.
2. `CHANNEL3_API_KEY` SHALL already exist in `.env.example` as a placeholder (it does); this slice SHALL NOT add real values.
3. Documentation produced by this slice SHALL describe Channel3 as the real catalog/price source and SHALL NOT imply real goods are purchased.