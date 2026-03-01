# Kysely build-only lane extraction (Phase 2)

## Summary

Create a build-only Kysely query lane in the SQL domain (`@prisma-next/sql-kysely-lane`) and move transformer/guardrail responsibilities out of `@prisma-next/integration-kysely`. Success means Kysely authoring produces Prisma Next-native plans without requiring runtime attachment, `pnpm lint:deps` passes, and ORM can consume Kysely-authored filters via a lane-agnostic `WhereArg` protocol.

**Spec:** `projects/kysely-lane-rollout/specs/02-kysely-lane-build-only.spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will Madden | Drives Phase 2 extraction |
| Reviewer | SQL/Lanes maintainers (TBD) | Confirms layering and public API shape |
| Collaborator | Runtime/plugins maintainers (TBD) | Ensures plan metadata remains compatible with runtime/plugin expectations |
| Collaborator | `integration-kysely` maintainers (TBD) | Helps re-scope runtime attachment package |

## Milestones

### Milestone 1: Define lane boundary + interop protocol

Deliverables:

- `WhereArg` / `ToWhereExpr` / bound payload types exist in `@prisma-next/sql-relational-core`.
- ORM can consume `WhereArg` without importing Kysely types.
- Call sites can pass `ToWhereExpr` directly; ORM performs conversion (no manual `.toWhereExpr()` at call sites).
- Lane offers an ergonomic helper to create `ToWhereExpr` from Kysely-authored filters (users do not author `{ expr, params, paramDescriptors }` objects).

**Tasks:**

- [x] Add/adjust failing tests first for `WhereArg` interop contract (`WhereExpr` param-free path, `ToWhereExpr` bound payload path, and local param indexing invariants).
- [x] Add `WhereArg = WhereExpr | ToWhereExpr` and `ToWhereExpr.toWhereExpr(): BoundWhereExpr` to `@prisma-next/sql-relational-core` (lane-agnostic; no Kysely imports).
- [x] Implement validation rule: bare `WhereExpr` accepted by ORM must be param-free (reject `ParamRef` usage).
- [x] Implement ORM normalization path for `WhereArg`:
  - call `toWhereExpr()` immediately for `ToWhereExpr`
  - validate payload invariants (`ParamRef` starts at 1, contiguous, max index equals params/descriptors length)
  - normalize `ParamRef` entries into `LiteralExpr` values for ORM-internal param-free filters
- [x] Add unit tests for `WhereArg` normalization and payload-index invariant enforcement (including nested `and/or/exists` shapes).
- [x] Add lane helper for filters: `kysely.whereExpr(...) -> ToWhereExpr` built from Kysely-authored where clauses (lane-owned; call sites do not touch `{ expr, params, paramDescriptors }`).
- [x] Remove `SqlQueryPlan` acceptance from ORM `.where(...)` normalization (keep the public interop surface constrained to `WhereArg`).
- [x] Update interop demo to use the lane helper (no hand-authored AST, no `.where(plan)`).

### Milestone 2: Create `@prisma-next/sql-kysely-lane` package

Deliverables:

- New lane package exists at `packages/2-sql/4-lanes/` with build-only semantics and no runtime dependency.

**Tasks:**

- [x] Add/port failing lane tests first (transform parity, guardrails, refs determinism, SQL redaction, execution backstop) before moving implementation.
- [x] Scaffold `packages/2-sql/4-lanes/kysely-lane/` (package.json, tsconfig, exports, README with responsibilities + mermaid).
- [x] Move/port transformer and guardrails from `@prisma-next/integration-kysely` into the lane package.
- [x] Implement plan assembly API: build-only Kysely query → `SqlQueryPlan<Row>` with PN `QueryAst`, params, paramDescriptors, refs, etc.
- [x] Harden `meta.refs` generation with deterministic ordering + dedup semantics in the extracted transformer path.
- [x] Implement SQL redaction (Option A): ensure any compiled SQL string exposed by internal compilation is stubbed, while preserving `query` + `parameters`.
- [x] Implement execution backstop behavior for build-only surface (throws deterministically if execution is attempted via casts).
- [x] Expand guardrail traversal to a broader and safer node walk strategy in the extracted lane package.
- [x] Port and/or update tests so transformer + guardrails parity is preserved in the lane package, including the new refs/guardrail hardening behavior.
- [x] Add dependency/layering assertions: lane must not import `@prisma-next/sql-runtime` (enforced by `pnpm lint:deps`).

### Milestone 3: Re-scope extensions and update Postgres public surface

Deliverables:

- `@prisma-next/integration-kysely` is runtime attachment only.
- `@prisma-next/postgres` exposes build-only `db.kysely` (no runtime argument).

**Tasks:**

- [x] Add/adjust type tests first for Postgres build-only `db.kysely` API and any separated execution-capable attachment API.
- [x] Update `@prisma-next/integration-kysely` exports so it no longer owns transformer/guardrails/lane planning logic.
- [x] If runtime attachment remains: have it delegate lane transforms to `@prisma-next/sql-kysely-lane` (or fail fast for unsupported kinds).
- [x] Update `@prisma-next/postgres`:
  - expose build-only `db.kysely` surface (no runtime arg)
  - do not expose an execution-capable public Kysely API in this phase
- [x] Update demo/example usage to match the new public surface (and keep execution-capable path explicit if retained).

### Milestone 4: Validation, docs, and close-out

Deliverables:

- Layering checks pass, docs are updated, and the transient project folder can be deleted at the appropriate close-out point.

**Tasks:**

- [x] Run and fix `pnpm lint:deps` for the new package boundaries.
- [x] Update READMEs for any touched packages to reflect new responsibilities (lane vs runtime attachment).
- [ ] Update architecture docs/ADRs if a new decision is introduced (e.g. unsupported-kinds policy).
- [x] Verify every acceptance criterion in the spec has a passing test or explicit manual verification step.
- [ ] Close-out: migrate any long-lived docs into `docs/` and delete `projects/kysely-lane-rollout/` (when the overall project is complete).

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| Lane exists: `@prisma-next/sql-kysely-lane` builds `SqlQueryPlan<Row>` | Unit + Integration | Milestone 2: scaffold + plan assembly + parity tests | Assert `ast`, params, descriptors, and meta payload are present |
| No runtime dependency: lane has no `@prisma-next/sql-runtime` import | Lint / Architecture | Milestone 2 + 4 | `pnpm lint:deps` gates boundary |
| Build-only types: `db.kysely` and lane exports hide execution APIs | Type tests | Milestone 3 | Add `.test-d.ts` assertions for missing `.execute*` / `.stream*` / `.transaction*` |
| Execution backstop: `any`/cast execution attempts throw deterministically | Unit | Milestone 2 | Cover at least one blocked execution path |
| Interop protocol exists: `WhereArg` / zero-arg `ToWhereExpr` with bound payload | Unit | Milestone 1 | Verify `{ expr, params, paramDescriptors }` and local index origin at 1 |
| ORM consumption handles bare `WhereExpr` + bound `ToWhereExpr` with strict payload validation + literal normalization | Unit + Integration | Milestone 1 | Include nested boolean/exists compositions and descriptor alignment |
| ORM does not accept `SqlQueryPlan` for `.where(...)` | Unit | Milestone 1 | Ensure `.where(...)` is constrained to `WhereArg` and plan-shorthand is rejected/absent |
| Lane helper produces `ToWhereExpr` from Kysely-authored filters | Unit + Demo | Milestone 1 | Demo uses `kysely.whereExpr(...)` (or equivalent) with no manual payload construction |
| SQL redaction (Option A): compiled SQL string is stubbed while params remain intact | Unit | Milestone 2 | Assert SQL is redacted and parameter ordering/values are unchanged |
| Integration re-scope: `@prisma-next/integration-kysely` no longer owns lane transform/guardrails | Integration | Milestone 3 | Assert runtime-attachment-only boundary |
| Parity preserved: existing transformer/guardrail coverage is retained after move/port | Unit + Integration | Milestone 2 + 3 | No net coverage loss on supported node kinds |
| Refs determinism: extracted lane emits deterministic, deduplicated `meta.refs` | Unit | Milestone 2 | Stability across equivalent query shapes |
| Guardrail breadth: traversal covers broader supported node shapes | Unit | Milestone 2 | Add explicit cases for previously narrow traversal paths |

## Open Items

- Decide whether Phase 3 should adopt bound-param-preserving ORM composition for `ToWhereExpr` payloads (instead of Phase 2 literal normalization).
- Confirm minimum supported Kysely subset for the build-only surface and document it.

## Decision Log

- Unsupported Kysely kinds policy for this phase: **fail fast** (no raw fallback).
- Postgres API shape for this phase: `db.kysely` is **build-only only**; no execution-capable public Kysely API.
- ORM `WhereArg` policy for this phase: consume bound `ToWhereExpr` payloads via strict validation + `ParamRef -> LiteralExpr` normalization (descriptor propagation deferred to Phase 3).

