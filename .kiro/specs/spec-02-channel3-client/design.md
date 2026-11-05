# Design Document

spec-02 Channel3 Client

## Overview

This slice adds a server-side Channel3 integration module at `/api/src/channel3/` that wraps the official `@channel3/sdk` (SDK 4.x). It exposes three functions the rest of AgentPurse needs - `searchProducts`, `getProduct`, `priceCheck` - plus a `channel3:smoke` script and fixture-based unit tests. The module owns Channel3 auth (`CHANNEL3_API_KEY`, server-side only), bounds latency (8s timeout, one retry for `priceCheck`), and enforces freshness discipline (cache product IDs only; never cache prices or offer URLs beyond 5 minutes).

All facts about the SDK shape below are taken from the installed Channel3 skill (`.agents/skills/channel3-api/SKILL.md` and `references/api-reference.md`), not guessed. Where the SDK surface is still uncertain at implementation time (e.g. exact per-request timeout option name), the code will isolate it behind our own wrapper and leave a `TODO(verify)` rather than hard-code an unverified option.

### Key facts carried from the skill (verified)

- Named import: `import { Channel3 } from '@channel3/sdk'`; construct with `new Channel3({ apiKey })`.
- Search: `client.products.search({ query, filters, limit })` returns a `Page`; products are in `page.data`. `limit` default 20, max 30.
- Price filter shape: `filters.price = { min_price?, max_price? }`, expressed in the request currency's **major units** (e.g. dollars), not cents.
- Retrieve (free, fresh): `client.products.retrieve({ product_id })` returns a `Product`.
- `Product.offers[]: ProductOffer` where `price: { price: number, currency: string, compare_at_price? }`, `domain: string`, `availability: "InStock" | "OutOfStock"`, `url: string` (affiliate, short-lived).
- `ProductOffer.price.price` is a **number in major currency units, post-discount** - must be converted to integer cents for our Money convention.
- Default search `filters.availability` is `["InStock"]`, so in-stock bias is the default; we still filter explicitly in `priceCheck`.
- Freshness: cache IDs only; refetch with `retrieve` at display time; never serve a cached offer URL.

## Architecture

```
/api/src/channel3/
  client.ts        # buildChannel3Client(env): constructs the SDK client; validates CHANNEL3_API_KEY
  types.ts         # local typed views: Channel3Product, Channel3Offer, PriceCheckResult, etc.
  money.ts         # major-units <-> cents helpers (toCents, fromCents) scoped to Channel3
  search.ts        # searchProducts({ query, maxPriceCents?, limit? })
  product.ts       # getProduct(productId)
  priceCheck.ts    # priceCheck({ title, amountCents, currency }) -> PriceCheckResult
  withResilience.ts# timeout(ms) + retry(1) helper used by priceCheck
  index.ts         # public surface: createChannel3Module(deps) + re-exports
  smoke.ts         # CLI entry for pnpm channel3:smoke
  __tests__/
    fixtures/      # recorded SDK response objects (no secrets)
    *.test.ts
```

### Dependency injection for testability

The public surface is a factory:

```ts
export interface Channel3SdkLike {
  products: {
    search(args: SearchArgs): Promise<{ data: Channel3Product[] }>;
    retrieve(args: { product_id: string }): Promise<Channel3Product>;
  };
}

export function createChannel3Module(deps: { client: Channel3SdkLike; now?: () => number }): Channel3Module;
```

Production wiring calls `buildChannel3Client(process.env)` and passes the real SDK. Tests pass a stub implementing `Channel3SdkLike` backed by fixtures - no live calls, satisfying Requirement 7.

## Components and Interfaces

### client.ts

```ts
export function buildChannel3Client(env: NodeJS.ProcessEnv): Channel3 {
  const apiKey = env.CHANNEL3_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing required environment variable: CHANNEL3_API_KEY");
  }
  return new Channel3({ apiKey });
}
```

The error names the variable (Requirement 1.2, 8) and never includes its value.

### search.ts

```ts
export interface SearchProductsInput { query: string; maxPriceCents?: number; limit?: number; }

async function searchProducts(input): Promise<Channel3Product[]> {
  const limit = clamp(input.limit ?? 5, 1, 30);
  const filters = input.maxPriceCents != null
    ? { price: { max_price: centsToMajor(input.maxPriceCents) } }
    : undefined;
  const page = await client.products.search({ query: input.query, filters, limit });
  return page.data ?? [];
}
```

Maps `maxPriceCents` to `filters.price.max_price` in major units (Requirement 2.1); empty page -> `[]` (Requirement 2.3).

### product.ts

```ts
async function getProduct(productId: string): Promise<Channel3Product> {
  return client.products.retrieve({ product_id: productId });
}
```

Fresh source for price/stock/url (Requirement 3). A `404`/not-found from the SDK propagates as a typed error (Requirement 3.3).

### priceCheck.ts

```ts
export interface PriceCheckResult {
  status: "ok" | "high" | "low" | "unknown";
  medianCents: number | null;
  sampleSize: number;
  bestOffer?: { domain: string; priceCents: number; currency: string };
}

async function priceCheck({ title, amountCents, currency }): Promise<PriceCheckResult> {
  try {
    const products = await withResilience(
      () => searchProducts({ query: title, limit: 10 }),
      { timeoutMs: 8000, retries: 1 },
    );
    const offers = products
      .flatMap(p => p.offers ?? [])
      .filter(o => o.availability === "InStock" && o.price.currency === currency)
      .map(o => ({ domain: o.domain, priceCents: majorToCents(o.price.price), currency: o.price.currency }));

    if (offers.length === 0) return { status: "unknown", medianCents: null, sampleSize: 0 };

    const medianCents = median(offers.map(o => o.priceCents));
    const bestOffer = offers.reduce((a, b) => (b.priceCents < a.priceCents ? b : a));
    const status = classify(amountCents, medianCents); // bands below
    return { status, medianCents, sampleSize: offers.length, bestOffer };
  } catch {
    return { status: "unknown", medianCents: null, sampleSize: 0 };
  }
}
```

**Verdict bands (`classify`)** - ratio `r = amountCents / medianCents`:
- `r > 1.30` -> `high` (clearly above market)
- `r < 0.70` -> `low` (clearly below market - possible mis-price/scam bait)
- otherwise -> `ok`

The 1.30 / 0.70 thresholds are a deliberate, documented default (not from Channel3); they live in one named constant so Risk Guard tuning in spec-07 is a one-line change. Only same-currency in-stock offers are compared (Requirement 4.4); prices converted to cents first (Requirement 4.4); any error/empty -> `unknown` (Requirement 4.3, 5.1).

### withResilience.ts

```ts
export async function withResilience<T>(fn: () => Promise<T>, opts: { timeoutMs: number; retries: number }): Promise<T>;
```

Wraps a call in `Promise.race` against a timeout and retries once on rejection/timeout. Used only by `priceCheck` so search/retrieve used directly by the demo agent keep the SDK's own defaults (Requirement 5.1). TODO(verify): if the SDK exposes a native per-request timeout/maxRetries we prefer that; until confirmed we wrap at our boundary.

### smoke.ts and the pnpm script

`api/package.json` gains `"channel3:smoke": "tsx src/channel3/smoke.ts"`. The root may add a pass-through `channel3:smoke` that delegates to the api workspace so `pnpm channel3:smoke "..."` works from root. The script:
1. Reads `process.argv[2]` as the query (defaults to a safe example if absent, but prints usage).
2. Calls `buildChannel3Client(process.env)` - if `CHANNEL3_API_KEY` missing, prints `Missing required environment variable: CHANNEL3_API_KEY` and exits non-zero (Requirement 6.3), never the value.
3. Prints the top 5 results as `title | domain | price currency`.
4. Uses a small `redact`-aware logger; never logs the key (Requirement 6.2, 7.3).

## Data Models

Local typed views mirror only the fields we use (kept narrow so SDK churn has a small blast radius):

```ts
export interface Channel3Price { price: number; currency: string; compare_at_price?: number | null; }
export interface Channel3Offer { url: string; domain: string; price: Channel3Price; availability: "InStock" | "OutOfStock"; }
export interface Channel3Product { id: string; title: string; offers?: Channel3Offer[]; }
```

Money conversion uses the shared convention (integer cents + ISO 4217). Channel3 major-unit numbers convert via `Math.round(major * 100)`; cents to major via `cents / 100`. These helpers live in `channel3/money.ts` and are the only place Channel3 decimal numbers meet our cents (mirrors the money-rules boundary discipline).

## Error Handling

- Missing `CHANNEL3_API_KEY`: throw a named error at client build; smoke script catches, prints the variable name, exits 1.
- Search/retrieve transport errors: `priceCheck` swallows into `unknown`; `searchProducts`/`getProduct` (used by the demo agent) propagate typed errors so callers can react, except `searchProducts` returns `[]` for an empty (successful) result.
- Timeout: `withResilience` rejects after 8s; one retry; then `unknown` for `priceCheck`.
- Not-found product in `getProduct`: surface as error (Requirement 3.3).
- No secret value ever appears in an error message or log.

## Testing Strategy

Fixture-driven, no live calls (Requirement 7). Vitest.

- **Unit - search mapping:** stub client asserts `max_price` equals `maxPriceCents/100`; `limit` default 5; empty `data` -> `[]`.
- **Unit - priceCheck bands:** fixtures producing a known median; assert `ok`/`high`/`low` at representative ratios and boundary values around 0.70 and 1.30.
- **Unit - priceCheck resilience:** stub that throws / never resolves -> `unknown`, `sampleSize 0`, and the retry happens exactly once.
- **Unit - currency filter:** offers in a different currency are excluded from the sample.
- **Unit - secret safety:** capture smoke logger output for a run and assert the key string never appears (using a fake key via injected env in the test, not a real one).

### Property-based tests (fast-check)

- **Property 1: priceCheck never throws and always returns a valid status.** For arbitrary `amountCents >= 0`, arbitrary currency, and arbitrary stubbed offer sets (including empty, mixed-currency, out-of-stock), `priceCheck` resolves to a result whose `status` is one of the four literals and whose `sampleSize` equals the count of same-currency in-stock offers. >= 100 iterations. Tag: `// Feature: spec-02-channel3-client, Property 1: priceCheck total and well-typed`.
- **Property 2: cents/major round-trip.** For arbitrary integer `cents >= 0`, `majorToCents(centsToMajor(cents)) === cents`. >= 100 iterations. Tag: `// Feature: spec-02-channel3-client, Property 2: money conversion round-trips`.

## Correctness Properties

These invariants are verified by property-based tests (fast-check, >= 100 iterations each).

### Property 1: priceCheck is total and well-typed

For any `amountCents >= 0`, any currency code, and any stubbed offer set (including empty, mixed-currency, and out-of-stock offers), `priceCheck` resolves without throwing to a result whose `status` is exactly one of `ok | high | low | unknown`, and whose `sampleSize` equals the number of same-currency in-stock offers in the input.

**Validates: Requirements 4.1, 4.3, 4.4, 5.1**

### Property 2: money conversion round-trips

For any integer `cents >= 0`, `majorToCents(centsToMajor(cents)) === cents`. This guarantees the Channel3 major-units boundary never loses or distorts a cent value.

**Validates: Requirements 4.4**

## Refinements (approved)

- `priceCheck` accepts an optional `productId`. When present, it compares against that exact product's offers via `getProduct` (free retrieve); only when `productId` is absent does it fall back to a `title` search. The demo agent always has a product id, so this avoids accessory noise distorting the median.
- Verdict thresholds live in one named constant `PRICE_BANDS = { high: 1.30, low: 0.70 }`.
- Smoke script auto-loads the root `.env` (via `node --env-file=../.env` on the pnpm script, with a dotenv fallback) so it does not report a missing variable when the file exists.
## Open questions / TODO(verify)

- Exact `@channel3/sdk` per-request option names (timeout/retries). Isolated in `withResilience`; confirm against the installed SDK version at implementation time.
- Whether the root `pnpm channel3:smoke` should delegate to the `api` workspace script or be defined only in `api`. Default: define in `api`, optionally mirror at root.
- `priceCheck` currently matches by free-text `title` via search; a future slice may pass a Channel3 `productId` directly for a tighter match (noted, out of scope here).