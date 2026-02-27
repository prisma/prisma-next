---
title: fix: Resolve on-disk migrations code review findings
type: fix
status: completed
date: 2026-02-27
---

# fix: Resolve on-disk migrations code review findings

## Overview

Address all actionable items documented in `projects/on-disk-migrations/reviews/pr-184/code-review.md`, including correctness fixes, consistency cleanup, and follow-up validation.  
This plan assumes the existing decisions in that review are source of truth:

- Items marked `✅ Fix it` are in scope.
- Items marked `❌ Won't fix` remain out of scope unless explicitly reopened.

## Problem Statement / Motivation

The migration workflow (`migration plan/new/verify/apply`) is close to merge quality, but review findings identified issues that can cause:

- incorrect CLI exit behavior for integrity checks,
- confusing DAG behavior around drafts,
- avoidable runtime risk from malformed draft contracts,
- inconsistent error handling and maintainability drift.

Closing these issues before final merge reduces production risk and avoids follow-up churn across CLI, tooling, and tests.

## Proposed Solution

Deliver a focused remediation pass across migration CLI and migration-tools, then verify behavior with targeted unit/e2e tests and documentation updates.

Implementation is split into 4 phases:

1. **Triage + state reconciliation** (verify which findings are already resolved on branch).
2. **Behavioral fixes** (only open issues that affect runtime or user behavior).
3. **Consistency + docs fixes** (error-handling pattern, naming, docs/exports alignment).
4. **Validation + close-out** (tests, lint, acceptance checklist).

## Technical Considerations

- **Architecture / layering**
  - Keep CLI (`packages/1-framework/3-tooling/cli`) family-agnostic.
  - Keep SQL-family logic in `packages/2-sql/3-tooling/family`.
  - Do not move `detectDestructiveChanges` into CLI (matches existing `Won't fix` decision).

- **Security**
  - Per OWASP Logging Cheat Sheet, never log primary secrets or DB connection strings.
  - Verify no migration command prints raw credentials in styled headers or error payloads.

- **Determinism / integrity**
  - Preserve deterministic edge attestation behavior in `@prisma-next/migration-tools`.
  - Ensure draft handling does not produce misleading DAG states.

- **Testing**
  - Extend tests only where behavior changed.
  - Keep test descriptions concise and direct (omit "should" per repo conventions).

## Flow & Edge Case Analysis (SpecFlow Pass)

Key flow gaps to verify as part of this work:

- Draft lifecycle edge cases:
  - `migration new` on empty history,
  - attesting an unedited draft,
  - planning after draft artifacts exist.
- Verification contract:
  - `migration verify` mismatch returns non-zero exit and machine-readable error.
- Explicit user input:
  - `migration plan --from <hash>` fails fast when hash does not exist.
- DAG safety:
  - no regressions for `findLeaf` ambiguity and self-loop detection.

## Implementation Plan

### Phase 0: Reconcile current branch vs review checklist

- [x] Build a remediation matrix in `projects/on-disk-migrations/reviews/pr-184/remediation-matrix.md`:
  - finding id,
  - status (`open` / `already fixed` / `won't fix`),
  - evidence file path(s),
  - required action.
- [x] Confirm all `✅ Fix it` decisions in `projects/on-disk-migrations/reviews/pr-184/code-review.md` are represented.
- [x] Explicitly tag `❌ Won't fix` items as deferred with rationale.

### Phase 1: Behavioral fixes (open runtime-impact items)

- [x] `packages/1-framework/3-tooling/cli/src/commands/migration-verify.ts`
  - Ensure mismatch path is outer `notOk(...)` so CLI exits non-zero.
- [x] `packages/1-framework/3-tooling/migration/src/attestation.ts`
  - Ensure hash composition is explicit and avoids double counting contract payload in metadata blob.
- [x] `packages/1-framework/3-tooling/cli/src/commands/migration-new.ts`
  - Ensure draft scaffold does not create invalid `storage` shape.
  - Ensure `from` chaining behavior uses DAG leaf where available.
- [x] `packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts`
  - Ensure `--from` unknown hash returns structured error (no silent fallback).
  - Remove dead/unreachable no-op branch in empty-ops conflict handling.

### Phase 2: Consistency and maintainability cleanup

- [x] `packages/1-framework/3-tooling/cli/src/commands/migration-new.ts`
  - Use `MigrationToolsError.is(...)` consistently in catch blocks.
- [x] `packages/1-framework/3-tooling/cli/src/commands/migration-verify.ts`
  - Use `MigrationToolsError.is(...)` consistently in catch blocks.
- [x] `packages/2-sql/3-tooling/family/src/core/migrations/contract-to-schema-ir.ts`
  - Reattach/reorder JSDoc so each block documents the correct function.
- [x] `packages/1-framework/3-tooling/cli/package.json`
  - Ensure command exports include migration command entry points expected by consumers.
- [x] `packages/1-framework/3-tooling/cli/src/commands/migration-new.ts`
  - Normalize local variable naming (`defaultFlags` over ambiguous aliases).
- [x] `packages/1-framework/3-tooling/cli/src/commands/migration-verify.ts`
  - Normalize local variable naming (`defaultFlags` over ambiguous aliases).

### Phase 3: Tests, docs, and verification

- [x] `packages/1-framework/3-tooling/cli/test/commands/migration-verify.test.ts`
  - Add/confirm mismatch case proves failing verification semantics at command boundary.
- [x] `packages/1-framework/3-tooling/cli/test/commands/migration-new.test.ts`
  - Add/confirm draft chaining + empty-storage safety coverage.
- [x] `packages/1-framework/3-tooling/cli/test/commands/migration-plan.test.ts`
  - Add/confirm unknown `--from` hash produces failure.
- [x] `packages/1-framework/3-tooling/cli/README.md`
  - Update command behavior docs where semantics changed (verify mismatch failure, draft expectations).
- [x] Run verification commands:
  - `pnpm --filter @prisma-next/cli test`
  - `pnpm --filter @prisma-next/migration-tools test`
  - `pnpm --filter @prisma-next/family-sql test`
  - `pnpm lint:deps`

## Acceptance Criteria

- [x] Every `✅ Fix it` item in `projects/on-disk-migrations/reviews/pr-184/code-review.md` is either implemented or marked with explicit follow-up issue link.
- [x] Every `❌ Won't fix` item remains unchanged and documented as intentionally deferred.
- [x] `migration verify` tamper mismatch exits non-zero and emits structured error payload.
- [x] `migration new` does not create malformed contract storage and does not silently corrupt lineage assumptions.
- [x] `migration plan --from <hash>` errors when hash is unknown.
- [x] Migration command error handling uses `MigrationToolsError.is(...)` consistently.
- [x] Updated tests pass and cover remediated behaviors.
- [x] CLI docs reflect behavior changes.

## Success Metrics

- 0 open `✅ Fix it` findings remaining in remediation matrix.
- No regressions in migration CLI test suites.
- No new layering violations from `pnpm lint:deps`.
- Reviewer can trace each original finding to:
  - implementation diff,
  - test evidence,
  - docs update (if user-visible behavior changed).

## Dependencies & Risks

- **Dependency**: Current PR branch state may already include some fixes; Phase 0 prevents duplicate work.
- **Risk**: Draft migration behavior has nuanced edge cases (empty graph vs chained history).  
  **Mitigation**: add focused tests for each lifecycle transition.
- **Risk**: Packaging/export changes can impact consumers unexpectedly.  
  **Mitigation**: verify command subpath exports and run integration checks.

## AI-Era Implementation Notes

- Prefer small, verifiable commits per remediation cluster (behavioral vs consistency).
- Use test-first updates for each bug class before implementation changes.
- Keep human review on:
  - security-sensitive output changes,
  - error envelope semantics,
  - DAG/integrity edge-case logic.

## References & Research

### Internal References

- Review source: `projects/on-disk-migrations/reviews/pr-184/code-review.md`
- Canonical project spec: `projects/on-disk-migrations/spec.md`
- CLI migration commands:
  - `packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts`
  - `packages/1-framework/3-tooling/cli/src/commands/migration-new.ts`
  - `packages/1-framework/3-tooling/cli/src/commands/migration-verify.ts`
- Migration tooling internals:
  - `packages/1-framework/3-tooling/migration/src/attestation.ts`
  - `packages/1-framework/3-tooling/migration/src/dag.ts`
  - `packages/1-framework/3-tooling/migration/src/errors.ts`
- Existing masking reference:
  - `packages/1-framework/3-tooling/cli/src/commands/db-introspect.ts`

### External References

- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html

### Related Work

- PR: https://github.com/prisma/prisma-next/pull/184
- Linked tickets: TML-1936, TML-1937, TML-1938
