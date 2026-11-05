# Requirements Document

## Introduction

AgentPurse lets AI agents make purchases safely ("Give your AI an allowance, not your credit card"). This document covers only the scaffold slice (spec-01) of the larger AgentPurse hackathon build. Later slices (PayPal integration, Risk Guard, dashboard, mobile features, demo agent logic) are out of scope for this spec and will be defined separately.

The scaffold slice establishes the project foundation: a pnpm workspace monorepo with five workspace skeletons, shared tooling (TypeScript, ESLint, Prettier, a test runner), a minimal Fastify API exposing a health endpoint, a Render Blueprint for deployment, environment variable templating with no committed secrets, an MIT license, and an initialized Git repository. The definition of done for this slice is: a live Render URL returns healthy.

This slice also records repo-wide conventions that later slices depend on: no secrets committed to the repository, money amounts represented as integer cents plus a currency code, a public MIT-licensed repository, and no third-party logos or trademarks in UI or assets.

## Glossary

- **Monorepo**: The single Git repository containing all AgentPurse workspaces managed with pnpm workspaces.
- **Workspace**: A package within the monorepo (one of `api`, `web`, `mobile`, `demo-agent`, `packages/shared`).
- **API_Service**: The Node 20 / TypeScript / Fastify server located in the `/api` workspace.
- **Health_Endpoint**: The `GET /healthz` route exposed by the API_Service that reports service health.
- **Shared_Package**: The `/packages/shared` workspace containing shared TypeScript types and zod schemas.
- **Web_Workspace**: The `/web` workspace containing a React + Vite + TypeScript application started from the official PayPal AG Studio starter repo.
- **Mobile_Workspace**: The `/mobile` workspace containing an Expo + TypeScript application skeleton.
- **Demo_Agent_Workspace**: The `/demo-agent` workspace containing a Node script skeleton.
- **Render_Blueprint**: The `render.yaml` file at the repository root that declares Render infrastructure.
- **Env_Template**: The `.env.example` file at the repository root containing placeholder environment variable values.
- **License_File**: The `LICENSE` file at the repository root containing the MIT license text.
- **Test_Runner**: The configured test execution tool wired into the monorepo so later slices can add and run tests.
- **Money_Convention**: The repo-wide rule that monetary amounts are represented as a signed integer number of cents (with no fractional component) together with an ISO 4217 three-letter currency code.
- **Repository_Maintainer**: A developer setting up or deploying the AgentPurse scaffold.

## Requirements

### Requirement 1: pnpm Workspace Monorepo Structure

**User Story:** As a Repository_Maintainer, I want a pnpm workspace monorepo containing five workspace skeletons, so that each part of AgentPurse has a dedicated package to build on in later slices.

#### Acceptance Criteria

1. THE Monorepo SHALL define a pnpm workspace configuration that lists exactly the `api`, `web`, `mobile`, `demo-agent`, and `packages/shared` workspaces.
2. THE Monorepo SHALL provide a root `package.json` that sets the private field to true and references the pnpm workspace configuration.
3. THE API_Service skeleton in the `/api` workspace SHALL declare a unique package name and expose only the Health_Endpoint as behavior.
4. THE Web_Workspace skeleton in the `/web` workspace SHALL declare a unique package name and expose no application behavior beyond a placeholder entry point.
5. THE Mobile_Workspace skeleton in the `/mobile` workspace SHALL declare a unique package name and expose no application behavior beyond a placeholder entry point.
6. THE Demo_Agent_Workspace skeleton in the `/demo-agent` workspace SHALL declare a unique package name and expose no application behavior beyond a placeholder entry point.
7. THE Shared_Package skeleton in the `/packages/shared` workspace SHALL declare a unique package name and expose placeholder shared types and zod schemas with no additional behavior.
8. WHEN a Repository_Maintainer installs dependencies at the repository root, THE Monorepo SHALL resolve all five workspaces and complete with a success exit status.
9. WHEN a Repository_Maintainer runs the type-check or build command for any workspace skeleton, THE Monorepo SHALL complete without type or build errors.

### Requirement 2: Shared Tooling Configuration

**User Story:** As a Repository_Maintainer, I want shared TypeScript, linting, formatting, and test tooling configured across the monorepo, so that later slices inherit consistent standards and can add tests immediately.

#### Acceptance Criteria

1. THE Monorepo SHALL provide a shared TypeScript configuration at the repository root that workspaces extend.
2. THE Monorepo SHALL provide an ESLint configuration applicable to TypeScript source files.
3. THE Monorepo SHALL provide a Prettier configuration applicable to the repository.
4. THE Monorepo SHALL provide a configured Test_Runner wired into the monorepo so later slices can add and run tests.
5. WHEN a Repository_Maintainer runs the type-check command at the repository root, THE Monorepo SHALL complete with a success exit status when no type errors exist.
6. WHEN a Repository_Maintainer runs the lint command at the repository root, THE Monorepo SHALL execute ESLint across the TypeScript source files and complete with a success exit status when no violations exist.
7. IF the lint command detects a violation, THEN THE Monorepo SHALL complete with a non-zero exit status and report the file and line of each violation.
8. WHEN a Repository_Maintainer runs the format command at the repository root, THE Monorepo SHALL execute Prettier across the repository's `.ts`, `.json`, and `.md` files.
9. WHEN a Repository_Maintainer runs the test command at the repository root, THE Test_Runner SHALL execute and complete with a success exit status when a placeholder test passes or when no tests are present.
10. IF a test fails when the test command is run, THEN THE Test_Runner SHALL complete with a non-zero exit status and report the identity of each failed test.

### Requirement 3: Minimal Fastify API with Health Endpoint

**User Story:** As a Repository_Maintainer, I want a minimal Fastify server exposing a health endpoint, so that a deployed instance can report that it is running.

#### Acceptance Criteria

1. THE API_Service SHALL be implemented in TypeScript targeting Node 20 using Fastify.
2. THE API_Service SHALL expose a `GET /healthz` route as the Health_Endpoint.
3. WHEN a client sends a `GET /healthz` request, THE API_Service SHALL respond with HTTP status 200 within 1000 milliseconds.
4. WHEN a client sends a `GET /healthz` request, THE API_Service SHALL respond with a JSON body containing a status field whose value indicates the service is healthy.
5. WHEN the API_Service starts, THE API_Service SHALL bind to the host and port specified by environment configuration.
6. IF the host environment variable is not set, THEN THE API_Service SHALL bind to the default host `0.0.0.0`.
7. IF the port environment variable is not set, THEN THE API_Service SHALL bind to the default port `3000`.
8. IF the API_Service cannot bind to the configured host and port, THEN THE API_Service SHALL terminate with a non-zero exit code and emit an error message indicating the bind failure.
9. THE API_Service SHALL provide a start script that launches the Fastify server.

### Requirement 4: Render Blueprint for Deployment

**User Story:** As a Repository_Maintainer, I want a Render Blueprint defining the deployment infrastructure, so that the API, web static site, and database can be provisioned from the repository.

#### Acceptance Criteria

1. THE Render_Blueprint SHALL define exactly one web service for the API_Service.
2. THE Render_Blueprint SHALL define exactly one static site for the Web_Workspace.
3. THE Render_Blueprint SHALL define exactly one managed PostgreSQL instance.
4. THE Render_Blueprint SHALL configure the API_Service web service to use the Health_Endpoint path for health checks.
5. THE Render_Blueprint SHALL reference every environment variable by name without embedding literal secret values in the Blueprint file.
6. WHERE the Render_Blueprint provisions the managed PostgreSQL instance, THE Render_Blueprint SHALL supply the resulting connection string to the API_Service web service through the `DATABASE_URL` environment variable.
7. IF a required component (the API web service, the web static site, or the managed PostgreSQL instance) is absent from the Render_Blueprint, THEN the deployment SHALL be rejected with an indication of the missing component.

### Requirement 5: Environment Variable Template Without Secrets

**User Story:** As a Repository_Maintainer, I want an environment variable template with placeholder values, so that required configuration is documented without committing secrets.

#### Acceptance Criteria

1. THE Env_Template SHALL contain a placeholder value for every key, WHERE each placeholder value is a non-empty descriptive token that does not match any real credential, connection string, or API key.
2. THE Env_Template SHALL include exactly the keys `DATABASE_URL`, `JWT_SECRET`, `MANDATE_SIGNING_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_BASE_URL`, `ANTHROPIC_API_KEY`, `AI_MODEL`, `CHANNEL3_API_KEY`, `AG_GRID_LICENSE_KEY`, and `APP_BASE_URL`, with each key appearing exactly once.
3. THE Monorepo SHALL configure Git ignore rules that exclude any file named `.env` and any file matching the `.env.*` pattern, except the `.env.example` template, from version control.
4. WHEN a tracked file in the Monorepo is scanned for version control inclusion, IF the file is `.env` or matches the `.env.*` pattern other than `.env.example`, THEN THE Monorepo SHALL exclude that file from version control.
5. THE Env_Template SHALL be tracked in version control under the filename `.env.example`.

### Requirement 6: MIT License at Repository Root

**User Story:** As a Repository_Maintainer, I want an MIT license file at the repository root, so that the public repository satisfies the open-source licensing requirement.

#### Acceptance Criteria

1. THE License_File SHALL exist at the repository root with the filename `LICENSE` and no file extension.
2. THE License_File SHALL contain the complete MIT license text, including the permission notice paragraph and the warranty disclaimer paragraph.
3. THE License_File SHALL include a copyright line containing the four-digit year and the copyright holder name.
4. IF the License_File is absent from the repository root or its filename is not `LICENSE`, THEN THE Repository_Maintainer SHALL treat the scaffold as failing validation and identify the missing or misnamed license file.
5. IF the License_File content omits either the permission notice paragraph or the warranty disclaimer paragraph, THEN THE Repository_Maintainer SHALL treat the scaffold as failing validation and indicate the license text is incomplete.

### Requirement 7: Git Repository Initialization and Initial Commit

**User Story:** As a Repository_Maintainer, I want the Git repository initialized with an initial commit of the scaffold, so that the slice is version-controlled from the start.

#### Acceptance Criteria

1. THE Monorepo SHALL be initialized as a Git repository with its working tree rooted at the Monorepo root directory.
2. WHEN the scaffold slice is complete, THE Repository_Maintainer SHALL record all scaffold files that are not matched by the Git ignore rules in a single initial Git commit on the default branch.
3. IF the initial Git commit is attempted while no scaffold files are staged, THEN THE Repository_Maintainer SHALL abort the commit and produce an error indication that there are no changes to commit, leaving the repository with no commits.
4. THE Monorepo SHALL provide Git ignore rules that exclude build artifact directories and dependency directories from version control.
5. WHEN the initial Git commit is created, THE Monorepo SHALL exclude every file and directory matched by the Git ignore rules from the committed content.

### Requirement 8: Repo-Wide Conventions Documented

**User Story:** As a Repository_Maintainer, I want repo-wide conventions documented in the scaffold, so that later slices follow consistent rules for money handling, secrets, licensing, and branding.

#### Acceptance Criteria

1. THE Monorepo SHALL document the Money_Convention that monetary amounts are represented as a signed integer number of cents with no fractional component, together with an ISO 4217 three-letter currency code.
2. THE Monorepo SHALL document that secrets are supplied exclusively through environment variables and are never committed to the repository in any form.
3. WHEN the Money_Convention is documented, THE Monorepo SHALL include a worked example showing an amount expressed as integer cents plus a currency code.
4. THE Monorepo SHALL document the required environment variable names alongside the rule that their values are excluded from version control.
5. THE Monorepo SHALL document that the repository is public and licensed under the MIT license, with the full MIT license text present in the License_File.
6. THE Monorepo SHALL document that UI and assets contain no third-party logos or trademarks and that only first-party or license-cleared assets are permitted.

### Requirement 9: Live Deployment Reports Healthy (Definition of Done)

**User Story:** As a Repository_Maintainer, I want a deployed Render URL that reports healthy, so that the scaffold slice meets its definition of done.

#### Acceptance Criteria

1. WHEN the API_Service is deployed to Render using the Render_Blueprint, THE API_Service SHALL serve the Health_Endpoint at a publicly reachable HTTPS URL.
2. WHEN a client sends a `GET /healthz` request to the live Render URL, THE API_Service SHALL respond with HTTP status 200 within 2000 milliseconds.
3. WHEN a client sends a `GET /healthz` request to the live Render URL, THE API_Service SHALL respond with a JSON body containing a status field whose value indicates a healthy state.
4. IF the `GET /healthz` response from the live Render URL is not HTTP status 200 or its body does not indicate a healthy state, THEN THE Repository_Maintainer SHALL treat the scaffold slice as not meeting its definition of done.
5. IF the live Render URL cannot be reached within a 10-second connection timeout, THEN THE Repository_Maintainer SHALL treat the scaffold slice as not meeting its definition of done.
