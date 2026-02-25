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

**Tasks:**

- [ ] Add/adjust failing tests first for `WhereArg` interop contract (`WhereExpr` param-free path, `ToWhereExpr` bound payload path, and local param indexing invariants).
- [ ] Add `WhereArg = WhereExpr | ToWhereExpr` and `ToWhereExpr.toWhereExpr(): BoundWhereExpr` to `@prisma-next/sql-relational-core` (lane-agnostic; no Kysely imports).
- [ ] Implement validation rule: bare `WhereExpr` accepted by ORM must be param-free (reject `ParamRef` usage).
- [ ] Implement ORM normalization path for `WhereArg`:
  - call `toWhereExpr()` immediately for `ToWhereExpr`
  - reindex and append params/descriptors when composing into a plan
- [ ] Add unit tests for `WhereArg` normalization and param reindexing (including nested `and/or/exists` shapes).

### Milestone 2: Create `@prisma-next/sql-kysely-lane` package

Deliverables:

- New lane package exists at `packages/2-sql/4-lanes/` with build-only semantics and no runtime dependency.

**Tasks:**

- [ ] Add/port failing lane tests first (transform parity, guardrails, refs determinism, SQL redaction, execution backstop) before moving implementation.
- [ ] Scaffold `packages/2-sql/4-lanes/kysely-lane/` (package.json, tsconfig, exports, README with responsibilities + mermaid).
- [ ] Move/port transformer and guardrails from `@prisma-next/integration-kysely` into the lane package.
- [ ] Implement plan assembly API: build-only Kysely query → `SqlQueryPlan<Row>` with PN `QueryAst`, params, paramDescriptors, refs, etc.
- [ ] Harden `meta.refs` generation with deterministic ordering + dedup semantics in the extracted transformer path.
- [ ] Implement SQL redaction (Option A): ensure any compiled SQL string exposed by internal compilation is stubbed, while preserving `query` + `parameters`.
- [ ] Implement execution backstop behavior for build-only surface (throws deterministically if execution is attempted via casts).
- [ ] Expand guardrail traversal to a broader and safer node walk strategy in the extracted lane package.
- [ ] Port and/or update tests so transformer + guardrails parity is preserved in the lane package, including the new refs/guardrail hardening behavior.
- [ ] Add dependency/layering assertions: lane must not import `@prisma-next/sql-runtime` (enforced by `pnpm lint:deps`).

### Milestone 3: Re-scope extensions and update Postgres public surface

Deliverables:

- `@prisma-next/integration-kysely` is runtime attachment only.
- `@prisma-next/postgres` exposes build-only `db.kysely` (no runtime argument).

**Tasks:**

- [ ] Add/adjust type tests first for Postgres build-only `db.kysely` API and any separated execution-capable attachment API.
- [ ] Update `@prisma-next/integration-kysely` exports so it no longer owns transformer/guardrails/lane planning logic.
- [ ] If runtime attachment remains: have it delegate lane transforms to `@prisma-next/sql-kysely-lane` (or fail fast for unsupported kinds).
- [ ] Update `@prisma-next/postgres`:
  - expose build-only `db.kysely` surface (no runtime arg)
  - if needed, introduce a separate execution-capable API (e.g. `db.kyselyRuntime(runtime)`) rather than overloading `db.kysely`
- [ ] Update demo/example usage to match the new public surface (and keep execution-capable path explicit if retained).

### Milestone 4: Validation, docs, and close-out

Deliverables:

- Layering checks pass, docs are updated, and the transient project folder can be deleted at the appropriate close-out point.

**Tasks:**

- [ ] Run and fix `pnpm lint:deps` for the new package boundaries.
- [ ] Update READMEs for any touched packages to reflect new responsibilities (lane vs runtime attachment).
- [ ] Update architecture docs/ADRs if a new decision is introduced (e.g. unsupported-kinds policy).
- [ ] Verify every acceptance criterion in the spec has a passing test or explicit manual verification step.
- [ ] Close-out: migrate any long-lived docs into `docs/` and delete `projects/kysely-lane-rollout/` (when the overall project is complete).

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| Lane exists: `@prisma-next/sql-kysely-lane` builds `SqlQueryPlan<Row>` | Unit + Integration | Milestone 2: scaffold + plan assembly + parity tests | Assert `ast`, params, descriptors, and meta payload are present |
| No runtime dependency: lane has no `@prisma-next/sql-runtime` import | Lint / Architecture | Milestone 2 + 4 | `pnpm lint:deps` gates boundary |
| Build-only types: `db.kysely` and lane exports hide execution APIs | Type tests | Milestone 3 | Add `.test-d.ts` assertions for missing `.execute*` / `.stream*` / `.transaction*` |
| Execution backstop: `any`/cast execution attempts throw deterministically | Unit | Milestone 2 | Cover at least one blocked execution path |
| Interop protocol exists: `WhereArg` / zero-arg `ToWhereExpr` with bound payload | Unit | Milestone 1 | Verify `{ expr, params, paramDescriptors }` and local index origin at 1 |
| ORM consumption handles bare `WhereExpr` + bound `ToWhereExpr` with reindexing | Unit + Integration | Milestone 1 | Include nested boolean/exists compositions and descriptor alignment |
| SQL redaction (Option A): compiled SQL string is stubbed while params remain intact | Unit | Milestone 2 | Assert SQL is redacted and parameter ordering/values are unchanged |
| Integration re-scope: `@prisma-next/integration-kysely` no longer owns lane transform/guardrails | Integration | Milestone 3 | Assert runtime-attachment-only boundary |
| Parity preserved: existing transformer/guardrail coverage is retained after move/port | Unit + Integration | Milestone 2 + 3 | No net coverage loss on supported node kinds |
| Refs determinism: extracted lane emits deterministic, deduplicated `meta.refs` | Unit | Milestone 2 | Stability across equivalent query shapes |
| Guardrail breadth: traversal covers broader supported node shapes | Unit | Milestone 2 | Add explicit cases for previously narrow traversal paths |

## Open Items

- Decide unsupported Kysely kinds policy in runtime attachment (raw fallback vs fail-fast).
- Finalize naming for the execution-capable Kysely attachment API (if retained).
- Decide whether ORM should hard-reject paramful bare `WhereExpr` at normalization boundary (current plan assumes yes).
- Confirm minimum supported Kysely subset for the build-only surface and document it.

