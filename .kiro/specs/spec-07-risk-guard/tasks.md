# Implementation Plan

spec-07 Risk Guard engine behind injected collaborators. No live calls in tests; secrets never printed.

## Overview

Types and pure helpers first, then the reviewer interface and Anthropic adapter, then combine and the guard, then tests, then verification.

## Tasks

- [x] 1. Types, schema, injection heuristic, audit
  - risk/types.ts, schema.ts (strict AiReviewSchema, parseAiReview), injection.ts, audit.ts, combine.ts (pure)
  - _Requirements: 2.1-2.3, 3.1-3.4, 5.2, 6.1_

- [x] 2. RiskReviewer and Anthropic adapter
  - reviewer.ts interface, prompt.ts (system prompt plus JSON data block), config.ts (ANTHROPIC_API_KEY, AI_MODEL default claude-sonnet-5-5), anthropic.ts (injected fetch, timeout)
  - Add ANTHROPIC_API_KEY and AI_MODEL placeholders to .env.example if missing
  - _Requirements: 5.1, 7.1, 7.2_

- [x] 3. evaluateRisk pipeline and public surface
  - guard.ts (rules, then price check, then heuristic, then reviewer with timeout, then combine), index.ts
  - _Requirements: 1.1-1.3, 2.3, 4.1, 4.2, 6.1_

- [x] 4. Tests
  - Unit tests: short-circuit, price high/unknown, each AI failure mode, adapter fixtures, config, log spy
  - Prompt-injection scenario tests
  - Property tests (Properties 1-3), tagged `// Feature: spec-07-risk-guard, Property N: ...`
  - _Requirements: 3.1-3.4, 4.1, 4.2, 5.1-5.3, 7.3_

- [x] 5. Verify gates
  - pnpm -r run typecheck, pnpm lint, pnpm build, pnpm test
  - _Requirements: 7.3_

## Notes

- Anthropic types never leave anthropic.ts. Money stays in integer cents.
- TODO(verify): model id acceptance, JSON-only output, fail-closed result (escalate vs deny).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3"] },
    { "id": 2, "tasks": ["4"] },
    { "id": 3, "tasks": ["5"] }
  ]
}
```
