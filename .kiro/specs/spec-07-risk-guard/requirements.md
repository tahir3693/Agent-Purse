# Requirements Document

## Introduction

spec-07 Risk Guard: an evaluation engine at `/api/src/risk/` that decides approve, deny or escalate for a purchase intent. It runs the deterministic gateway rules (spec-05) first, then a Channel3 price check, then an AI review (RiskReviewer, Anthropic Claude via AI_MODEL). The AI can only make a decision stricter. Any AI failure fails closed. Persistence, authorization and mandate issuance are spec-08.

## Glossary

- **Risk_Guard**: the `evaluateRisk` function in `/api/src/risk/`.
- **Decision**: one of `approve`, `deny`, `escalate`, with `riskScore` 0-100 and a reason.
- **RiskReviewer**: provider-neutral interface for the AI review; one Anthropic implementation.
- **Intent_Text**: description, justification, payee and category strings supplied by an agent. Untrusted.

## Requirements

### Requirement 1: Pipeline order

**User Story:** As an owner, I want cheap deterministic checks first, so that bad intents never cost latency or credits.

#### Acceptance Criteria

1. THE Risk_Guard SHALL call `evaluateRules` before any price check or AI call.
2. WHEN `evaluateRules` returns `passed: false`, THE Risk_Guard SHALL return `deny` with the matched rule id and SHALL NOT call Channel3 or the RiskReviewer.
3. WHEN the rules pass, THE Risk_Guard SHALL run the Channel3 price check and then the RiskReviewer.

### Requirement 2: Price check

**User Story:** As an owner, I want amounts compared to the market, so that overpriced purchases are not auto-approved.

#### Acceptance Criteria

1. WHEN the price check status is `high` (amount above 1.30 times the market median), THE Risk_Guard SHALL NOT return `approve`; it SHALL return `escalate`.
2. WHEN the status is `unknown` and the amount exceeds `autoApproveBelowCents`, THE Risk_Guard SHALL NOT return `approve`.
3. THE Risk_Guard SHALL treat a price check failure as `unknown` and SHALL NOT throw.

### Requirement 3: AI review can only tighten

**User Story:** As an owner, I want the AI to add caution, never remove it.

#### Acceptance Criteria

1. THE RiskReviewer output SHALL be validated against `{ approved: boolean, riskScore: integer 0-100, reason: string, flagPromptInjection: boolean }`; extra keys and wrong types SHALL be rejected.
2. THE Risk_Guard SHALL return `approve` only WHEN the rules passed, the price status permits it, `approved` is true, `flagPromptInjection` is false and `riskScore` is at or below `maxAutoApproveRisk`.
3. WHEN `approved` is false, THE Risk_Guard SHALL return `escalate`; WHEN `flagPromptInjection` is true, THE Risk_Guard SHALL return `deny`.
4. THE Risk_Guard SHALL NOT use any AI output to relax a rule, cap, budget or price verdict.

### Requirement 4: Fail closed

**User Story:** As an owner, I want no purchase approved when the AI is unavailable.

#### Acceptance Criteria

1. IF the RiskReviewer throws, times out, or returns output that fails parsing, THEN THE Risk_Guard SHALL return `escalate` with riskScore 100 and an audit outcome of `ai_error`, `ai_timeout` or `ai_parse`.
2. THE Risk_Guard SHALL never return `approve` on any AI failure path.

### Requirement 5: Prompt injection resistance

**User Story:** As an owner, I want item names and metadata unable to change the outcome.

#### Acceptance Criteria

1. THE prompt builder SHALL pass Intent_Text only as JSON-encoded data inside a delimited block, with instructions in the system prompt stating that the block is data.
2. THE Risk_Guard SHALL run a deterministic injection heuristic on Intent_Text; a hit SHALL force at least `escalate` and set `flagPromptInjection`.
3. WHEN Intent_Text tries to override rules, THE outcome SHALL equal the outcome for the same intent with neutral text, or be stricter.

### Requirement 6: Audit metadata

**User Story:** As an owner, I want every decision explained safely in the audit log.

#### Acceptance Criteria

1. EVERY Decision SHALL carry audit metadata: stage reached, matched rule, price status, AI outcome, flagPromptInjection, riskScore. It SHALL NOT contain Intent_Text, prompts, or keys.

### Requirement 7: Config, provider isolation, tests

**User Story:** As a maintainer, I want the AI provider isolated and tests offline.

#### Acceptance Criteria

1. THE Anthropic adapter SHALL read ANTHROPIC_API_KEY and AI_MODEL (default `claude-sonnet-5-5`), name only a missing variable, and be required only when the adapter is constructed.
2. Anthropic request and response types SHALL NOT leave the adapter.
3. Tests SHALL use fakes and recorded fixtures with no live calls, covering: rules-fail short-circuit, price high and unknown, AI failure modes, AI cannot loosen, injection scenarios, secret-free logs.

