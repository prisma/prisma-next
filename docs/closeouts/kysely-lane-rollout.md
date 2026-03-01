# Kysely lane rollout close-out

## Summary

The Kysely lane rollout is closed out as completed work with durable architecture documentation and tracked follow-ups. Transient project-planning artifacts are removed as part of this close-out.

## Acceptance verification

### Phase 1 (merge-ready stabilization)

- [x] Phase 1 scope boundary documented and constrained to merge-ready correctness.
- [x] Supported Kysely-authored queries produce Prisma Next plans with PN `QueryAst` and lane metadata.
- [x] Supported execution path uses Prisma Next lowering/adapter visibility (not SQL-string-only black-box plans).
- [x] Guardrails/plugins can inspect AST-backed plans.
- [x] Phase 1 shipped independently from lane extraction refactors.

### Phase 2 (build-only lane extraction)

- [x] Build-only `@prisma-next/sql-kysely-lane` exists in SQL lanes.
- [x] Lane is decoupled from runtime package boundaries (`lint:deps` verified).
- [x] Runtime attachment/lane responsibilities are separated.
- [x] Postgres exposes build-only `db.kysely` surface.
- [x] Unsupported kinds fail fast with structured errors.
- [x] Execution-capable public Kysely API is not exposed from Postgres.

### Phase 3 (optional decision)

- [x] Decision recorded: defer compile-free plan assembly.
- [x] Tracked follow-up created: [TML-2024](https://linear.app/prisma-company/issue/TML-2024/kysely-lane-evaluate-compile-free-plan-assembly-avoid-discarded-sql).

## Verification evidence

- Gate scripts passed in this close-out worktree:
  - `pnpm typecheck:packages`
  - `pnpm lint:packages`
  - `pnpm lint:deps`
  - `pnpm test:packages`
  - `pnpm test:integration`
- Note: test suites were run with `TEST_TIMEOUT_MULTIPLIER=3` to account for aggressive default local unit-test timeouts in this repository.
- Durable architecture references:
  - `docs/architecture docs/subsystems/3. Query Lanes.md`
  - `docs/architecture docs/adrs/ADR 162 - Kysely lane emits PN SQL AST.md`
  - `docs/architecture docs/adrs/ADR 165 - ORM WhereArg literal normalization.md`
  - `docs/architecture docs/adrs/ADR 166 - Referential actions for foreign keys.md`

## Follow-ups

- [TML-2023](https://linear.app/prisma-company/issue/TML-2023/execution-plane-structured-runtime-error-envelopes-plan-helpers): execution-plane structured runtime error envelope helpers (`PLAN.*`).
- [TML-2024](https://linear.app/prisma-company/issue/TML-2024/kysely-lane-evaluate-compile-free-plan-assembly-avoid-discarded-sql): evaluate compile-free Kysely plan assembly.

## ADR numbering normalization completed

To remove collisions and keep ADR IDs unique:

- `ADR 159 - Postgres JSON and JSONB typed columns` → `ADR 163`
- `ADR 161 - Repository Layer` → `ADR 164`
- `ADR 162 - ORM WhereArg literal normalization` → `ADR 165`
- `ADR 162 - Referential actions for foreign keys` → `ADR 166`
- `ADR 162 - Typed default literal pipeline and extensibility` → `ADR 167`
