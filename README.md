# AgentPurse

Give your AI an allowance, not your credit card. AgentPurse lets AI agents make purchases safely.

This repository is a pnpm workspace monorepo with five workspaces: `api`, `web`, `mobile`, `demo-agent`, and `packages/shared`.

## CONVENTIONS

These repo-wide conventions apply to every workspace. Later slices depend on them, so follow them consistently.

### Money

Monetary amounts are represented as a **signed integer number of cents** (no fractional component) together with an **ISO 4217 three-letter currency code**. Never store money as a floating-point dollar amount.

The shared `Money` type and `MoneySchema` (zod) in `packages/shared` encode this convention:

```ts
interface Money {
  amountCents: number; // signed integer; no fractional component
  currency: string; // ISO 4217 three-letter code, e.g. "USD"
}
```

Worked example:

```
$12.34 USD  →  { amountCents: 1234, currency: "USD" }
```

So $12.34 is stored as `1234` cents with currency `"USD"`. A $5.00 refund would be `{ amountCents: -500, currency: "USD" }`.

### Secrets

Secrets are supplied **exclusively through environment variables** and are **never committed to the repository in any form**. There are no secret values in source files, configuration files, or the Render Blueprint.

- Local development: copy `.env.example` to `.env` and fill in real values. `.env` is git-ignored.
- Deployment (Render): secret values are set in the Render Dashboard with `sync: false`; they never appear in `render.yaml`.

The `.gitignore` excludes any file named `.env` and any file matching `.env.*`, with the sole exception of the tracked `.env.example` template. The `.env.example` file documents every required key with a placeholder (non-credential) value.

### Required environment variables

The following environment variables are required. They are documented in `.env.example` with placeholder values. Their **real values are excluded from version control** — only the `.env.example` template (with placeholders) is tracked.

| Variable               | Purpose                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`         | PostgreSQL connection string (provided by Render's managed database in deployment) |
| `JWT_SECRET`           | Secret used to sign and verify JWTs                                                |
| `MANDATE_SIGNING_KEY`  | Key used to sign agent spend mandates                                              |
| `PAYPAL_CLIENT_ID`     | PayPal API client identifier                                                       |
| `PAYPAL_CLIENT_SECRET` | PayPal API client secret                                                           |
| `PAYPAL_WEBHOOK_ID`    | PayPal webhook identifier for verifying webhook events                             |
| `PAYPAL_BASE_URL`      | PayPal API base URL (sandbox or live)                                              |
| `ANTHROPIC_API_KEY`    | API key for Anthropic model access                                                 |
| `AI_MODEL`             | Identifier of the AI model to use                                                  |
| `CHANNEL3_API_KEY`     | API key for Channel3 integration                                                   |
| `AG_GRID_LICENSE_KEY`  | AG Grid enterprise license key                                                     |
| `APP_BASE_URL`         | Base URL of the deployed application                                               |

### License

This repository is **public** and licensed under the **MIT license**. The full MIT license text is present in the [`LICENSE`](./LICENSE) file at the repository root.

### Branding and assets

The UI and assets contain **no third-party logos or trademarks**. Only **first-party assets** or assets that have been **explicitly license-cleared** are permitted anywhere in the repository.
