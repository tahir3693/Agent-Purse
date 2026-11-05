---
inclusion: always
---

# Repository Structure

Monorepo root contains the pnpm workspace. Workspaces: api, web, mobile, demo-agent, packages/*.

```
/
  api/                 Fastify API (Render). Node 20 + TS.
    src/
      channel3/        Channel3 module (spec-02): searchProducts, getProduct, priceCheck, smoke script
      paypal/          PayPal module (spec-03): OAuth, orders, vault, webhooks - behind an interface
      ...              config, server, routes, risk guard, prisma, etc. added per spec
  web/                 Next.js App Router (Vercel). Converted from the scaffold placeholder in spec-04.
  mobile/              Expo app (spec-10).
  demo-agent/          Node script, three scenarios (spec-11).
  packages/
    shared/            Shared TS types + zod schemas. Money type lives here.
  .kiro/
    specs/             One spec per slice (spec-01 scaffold done; spec-02+ to come).
    steering/          product.md, tech.md, structure.md, money-rules.md.
  render.yaml          Render Blueprint: API web service + managed Postgres only (no web static site after spec-04).
  openapi.yaml         API contract (spec-11); shared schemas derive from it.
  .env.example         Placeholder env (no real keys).
  LICENSE              MIT.
```

## Naming and conventions

- Package names are scoped: @agentpurse/api, @agentpurse/web, @agentpurse/mobile, @agentpurse/demo-agent, @agentpurse/shared.
- TypeScript strict mode; ESLint flat config at root; Prettier repo-wide; Vitest as the test runner; fast-check for property tests.
- Provider integrations (PayPal, Channel3, AI) are isolated in their own module directory and hidden behind an interface so tests can use recorded fixtures.
- Smoke scripts are pnpm scripts (e.g. channel3:smoke, paypal:smoke) and must never print secret values.

## Spec / build order

Steering files first. Then: spec-02 channel3-client, spec-03 paypal-core, spec-04 web-to-nextjs, spec-05 gateway-rules, spec-06 vault-linking, spec-07 risk-guard, spec-08 mandate-and-pay, spec-09 web-dashboard, spec-10 mobile, spec-11 demo-agent-docs. Stop and report at each checkpoint; do not start later slices until approved.