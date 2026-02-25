# Summary

Extract a **build-only Kysely query lane** into the SQL domain so Kysely authoring behaves like other Prisma Next lanes: it **builds plans**, does **not execute**, and does **not depend on runtime**. The lane must output Prisma Next-native artifacts (PN `QueryAst`, `SqlQueryPlan`, and ORM-safe filter payloads) while preserving existing transformer/guardrail behavior.

# Description

Today, Kysely support exists primarily as `@prisma-next/integration-kysely` (extensions domain) and blends two responsibilities:

- **Runtime attachment** (Kysely Dialect/Driver/Connection that routes `.execute()` through Prisma Next runtime)
- **Lane responsibilities** (Kysely operation tree → PN AST + metadata transforms, and guardrails)

That blend violates the repo’s layering model:

- **Lanes are build-only** and should live in the SQL domain lanes layer (`packages/2-sql/4-lanes/*`).
- **Runtime executes** plans and can depend on drivers/adapters.

Phase 1 work on this branch made Kysely-authored execution less of a black box by producing PN AST-backed plans so runtime plugins can reason about queries. This Phase 2 work finishes the architectural correction by creating a real Kysely lane package and re-scoping integration/runtime attachment code accordingly.

This spec is a Drive-format conversion of `agent-os/specs/2026-02-19-kysely-query-lane-build-only/spec.md`, with concrete deliverables and acceptance criteria suitable for execution planning.

# Requirements

## Functional Requirements

### 1) New build-only lane package

- Create `@prisma-next/sql-kysely-lane` under `packages/2-sql/4-lanes/`.
- Lane responsibilities:
  - Kysely authoring surface (build-only)
  - guardrails
  - Kysely op tree → PN `QueryAst` transform
  - `SqlQueryPlan<Row>` assembly (`ast`, `params`, `meta.*`)
  - **SQL redaction** (Option A): compilation may occur internally, but any SQL string returned by compilation must be a stub
  - **execution backstop**: if a user circumvents types and attempts execution, it fails deterministically
- Lane must **not** execute queries, stream results, or manage transactions.
- Lane must **not** depend on `@prisma-next/sql-runtime`.

### 2) Relational-core interop protocol for ORM filters

- Introduce a lane-agnostic filter interop protocol in `@prisma-next/sql-relational-core`:
  - `WhereArg = WhereExpr | ToWhereExpr`
  - `ToWhereExpr.toWhereExpr()` is **zero-arg** and returns a **fully bound payload**:
    - `expr: WhereExpr` with local `ParamRef(index)` starting at 1
    - `params: readonly unknown[]` aligned to those indices
    - `paramDescriptors: ReadonlyArray<ParamDescriptor>` aligned to those indices
- ORM must be able to consume `WhereArg` without importing Kysely types.

### 3) Postgres convenience client exposes build-only Kysely surface

- Update `@prisma-next/postgres` to expose `db.kysely` as a **build-only** authoring surface (no runtime argument).
- If an execution-capable Kysely attachment is still required for migration, expose it as a **separate, clearly named** API so `db.kysely` remains build-only (example name: `db.kyselyRuntime(runtime)`).

### 4) Re-scope `@prisma-next/integration-kysely`

- `@prisma-next/integration-kysely` becomes “runtime attachment only” (dialect/driver/connection).
- It must delegate transformer/guardrails/lane planning responsibilities to `@prisma-next/sql-kysely-lane` (or stop exposing them).

### 5) Preserve behavior (no coverage regressions)

- Transformer and guardrail behavior for currently supported Kysely node kinds must not regress for MVP; this phase is primarily a **layering/package refactor** with the new build-only surface and interop protocol.

## Non-Functional Requirements

- **Layering validation**: `pnpm lint:deps` passes with the intended dependency directions.
- **Type-level safety**: build-only Kysely surface must not expose `.execute*`, `.stream*`, `.transaction*`, etc. in public types.
- **Runtime safety**: execution attempted via `any`/casts fails deterministically.
- **DX parity**: build-only authoring should feel Kysely-shaped for the supported subset; users should not be forced into calling `.compile()` at call sites.
- **Docs and onboarding**: READMEs and architecture docs are updated for any package-level responsibility changes introduced here.

## Non-goals

- Supporting query execution directly from the lane.
- Option B / compile-free parameter extraction (tracked separately; not required for this phase).
- Promoting Kysely raw SQL (`sql\`...\``) as a first-class Prisma Next surface in MVP.
- Broadly expanding transformer coverage for new Kysely node kinds beyond what’s already supported.

# Acceptance Criteria

- [ ] **Lane exists**: `@prisma-next/sql-kysely-lane` is present in `packages/2-sql/4-lanes/` with a clear public API for building `SqlQueryPlan<Row>` from build-only Kysely-authored queries.
- [ ] **No runtime dependency**: `@prisma-next/sql-kysely-lane` does not depend on `@prisma-next/sql-runtime`; `pnpm lint:deps` passes.
- [ ] **Build-only types**: `db.kysely` (and any exported build-only lane types) do not expose execution entrypoints in their public TypeScript types.
- [ ] **Execution backstop**: runtime execution via `any` casts throws deterministically (tests cover at least one blocked path).
- [ ] **Interop protocol**: `WhereArg`/`ToWhereExpr` exist in `@prisma-next/sql-relational-core`; `ToWhereExpr.toWhereExpr()` is zero-arg and returns `{expr, params, paramDescriptors}` with local param indices starting at 1.
- [ ] **ORM consumption**: ORM accepts `WhereArg` and handles:
  - param-free bare `WhereExpr`
  - bound `ToWhereExpr` payloads, including param reindexing when composing into a plan
- [ ] **SQL redaction (Option A)**: compilation (if reachable) yields a stub SQL string while preserving operation tree and parameter ordering/values; tests confirm this.
- [ ] **Integration re-scope**: `@prisma-next/integration-kysely` no longer owns transformer/guardrail logic (moved to lane or delegated).
- [ ] **Parity preserved**: existing transformer/guardrail tests continue to pass (or are ported to the new lane package without reducing coverage).

# Other Considerations

## Security

Guardrails are security/safety-adjacent. Refactoring must not weaken enforcement. Any behavior change in guardrails must be explicit, tested, and called out in release notes.

## Cost

Primary cost is engineering time and review complexity. Runtime cost should be unchanged because this phase changes build-time planning boundaries, not execution complexity.

## Observability

- `pnpm lint:deps` is the primary “architecture observability” signal.
- Parity tests and integration tests act as regression signals for supported Kysely query shapes.

## Data Protection

No new data handling is expected. Ensure parameter descriptor and param handling remains aligned (no accidental param leaks or mis-ordering).

# References

- Source spec (Agent OS): `agent-os/specs/2026-02-19-kysely-query-lane-build-only/spec.md`
- Project tracker: `projects/kysely-lane-rollout/spec.md`
- Project plan: `projects/kysely-lane-rollout/plan.md`
- Architecture: `docs/Architecture Overview.md`
- Subsystem docs (query lanes): `docs/architecture docs/subsystems/3. Query Lanes.md`

# Open Questions

1. **Unsupported Kysely kinds** in runtime attachment: keep raw fallback behavior or fail fast with stable error codes?
2. **Public surface naming**: keep `db.kysely` build-only and introduce `db.kyselyRuntime(runtime)` (or similar) for execution-capable attachment—what name best avoids confusion?
3. **Interop strictness**: should ORM reject paramful bare `WhereExpr` immediately (as proposed) or allow it and normalize later?
4. **Minimum supported Kysely subset** for the build-only surface in Phase 2: exactly “what exists today”, or do we need to prune/clarify support before extraction?

