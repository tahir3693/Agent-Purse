# Render Blueprint — Confirmed Spec Notes (for Task 10)

Research output of Task 1. These resolve every `TODO(verify)` marker in `design.md`
so `render.yaml` in Task 10 is written from confirmed facts, not guesses.

Primary source: current Render Blueprint YAML reference — https://render.com/docs/blueprint-spec
Supporting sources: Render monorepo tutorial — https://render.com/tutorials/advanced-blueprint-patterns/monorepos-and-build-filters ; Node.js corepack docs — https://nodejs.org/docs/latest-hydrogen/api/corepack.html

> Content below was rephrased/summarized from the Render docs and Node.js docs for licensing compliance.
> Fetched during Task 1; re-run `render blueprints validate` before the first deploy (Task 13) as a final check.

---

## 1. Static-site block shape (resolves TODO on `type`/`runtime`/`env` + publish-path field)

**Confirmed.** A static site is declared as a service with:

- `type: web` — the `web` type covers both web services and static sites.
- `runtime: static` — this is how a service is marked as a static site.
- `staticPublishPath:` — **Required** for static sites. The path to the directory containing
  the built static files, relative to the repo root (e.g. `./dist`, `web/dist`).

Key confirmations:

- The old `env:` field is **deprecated** — `runtime:` replaces it. Use `runtime: static`, **not** `env: static`.
- `startCommand` is **not supported / not used** for static sites (they set `staticPublishPath` instead).
- `region` and `plan` are **not applicable** to static sites (static sites are served from a global CDN and have no compute plan).
- `healthCheckPath` is **web services only** — do not put it on the static site.

**Use for the `web` static site in render.yaml:**

```yaml
  - type: web
    name: agentpurse-web
    runtime: static
    buildCommand: <pnpm filtered install + build — see §3>
    staticPublishPath: web/dist
```

(No `plan`, no `startCommand`, no `healthCheckPath` on the static site.)

---

## 2. Valid `plan` names (resolves TODO on plan names for `databases` and `web` services)

**Confirmed.** Plan values differ between services (compute) and databases (Postgres).

### Web / worker / private service compute plans (`services[].plan`)
Valid plan IDs include: `free`, `0.5c-512mb`, `1c-2g`, `2c-4g`, `2c-8g`, `2c-16g`,
`4c-8g`, `4c-16g`, `4c-32g`, `8c-16g`, `8c-32g`, `8c-64g`, `12c-24g`, `12c-48g`, `12c-96g`.

- `free` is a valid service plan ID → **use `plan: free` for the API web service.**
- If `plan` is omitted, Render defaults a new web service to `0.5c-512mb`.
- **Static sites take no `plan`** (see §1).

### Render Postgres database plans (`databases[].plan`)
Valid plan IDs include: `free`, `0.1c-256mb`, `0.5c-1g`, `1c-2g`, `1c-4g`,
`2c-4g`, `2c-8g`, `2c-16g`, `4c-16g`, `4c-32g`, `8c-32g`, `8c-64g`, and larger tiers.

- `free` is a valid database plan ID → **use `plan: free` for the managed Postgres.**
- If `plan` is omitted, Render defaults a new database to `0.1c-256mb`.
- Note the database `free` tier has a fixed/default disk size (1 GB) and is distinct from the compute-plan list above.

> Caveat carried forward to Task 13: the Render `free` tier availability can depend on the
> account/workspace. If `render blueprints validate` or the deploy rejects `free`, fall back to
> the smallest paid tier (`0.5c-512mb` for the API service, `0.1c-256mb` for the database).

---

## 3. pnpm on Render's Node runtime (resolves TODO on corepack vs `packageManager`)

**Confirmed approach: use BOTH — pin pnpm via `packageManager` in root `package.json` AND
prefix the build command with `corepack enable`.**

Rationale from the sources:

- Node.js bundles **corepack**, but corepack must be **explicitly enabled** to put the `pnpm`
  shim on PATH — it is not active by default (Node corepack docs: it "needs to be explicitly enabled").
- Corepack reads the **`packageManager`** field in the root `package.json` to pick the exact
  pnpm version, so pinning it there makes the version deterministic.
- Render's Node native runtime does not guarantee `pnpm` is already on PATH, so the build command
  must make it available. The Render monorepo tutorial uses `pnpm install && pnpm --filter ... build`
  directly but does not itself show the enable step; enabling corepack explicitly is the safe,
  portable way to guarantee `pnpm` exists before those commands run.

**Actions for Task 10 / root package.json (Task 2.1):**

1. Add to root `package.json`:
   ```json
   "packageManager": "pnpm@9.12.0"
   ```
   (Pin to the pnpm version the repo standardizes on; keep it in sync with the lockfile.)

2. Prefix every Render `buildCommand` that uses pnpm with corepack activation:
   ```
   corepack enable && corepack prepare pnpm@9.12.0 --activate && pnpm install --frozen-lockfile && pnpm --filter @agentpurse/api... run build
   ```
   `corepack enable` installs the pnpm shim on PATH; `corepack prepare ... --activate` guarantees
   the pinned version. If the pinned version already matches `packageManager`, `corepack enable`
   alone is sufficient, but including `prepare --activate` is the robust choice.

---

## 4. `DATABASE_URL` wiring via `fromDatabase` (confirms design's existing wiring)

**Confirmed.** To inject the managed Postgres connection string into the API service, reference
the database with `fromDatabase` and the property `connectionString`:

```yaml
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: agentpurse-db
          property: connectionString
```

- `connectionString` is a valid Postgres property (format `postgresql://user:password@host:port/database`).
- The `name` must exactly match the `databases[].name` (watch for typos — `render blueprints validate` catches these).
- All other secrets are declared by key with `sync: false` (no literal values in the file); the
  Dashboard prompts for them on first Blueprint create. This matches the design and Requirement 4.5 / 5 / 8.2.

---

## 5. Net changes Task 10 must apply to design.md's draft render.yaml

- Static site: keep `type: web` + `runtime: static` + `staticPublishPath: web/dist`; it was already
  correct in the draft — just **remove the `TODO(verify)` comments** (confirmed, not a guess).
- Plans: set `plan: free` on the API web service and `plan: free` on the database; **do not** set a
  plan on the static site. Remove the plan `TODO(verify)` markers. (Have the paid fallbacks from §2
  ready for Task 13 if `free` is unavailable on the account.)
- pnpm: prefix each pnpm `buildCommand` with `corepack enable && corepack prepare pnpm@<version> --activate`
  and add `"packageManager": "pnpm@<version>"` to root `package.json`. Remove the pnpm `TODO(verify)` marker.
- Leave the `fromDatabase` → `connectionString` wiring and the `sync: false` secret list as-is (confirmed).
- All three `TODO(verify)` markers in design.md's render.yaml section are now resolved.
