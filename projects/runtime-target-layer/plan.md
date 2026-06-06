# Project Plan

## Summary

The project ships in three PRs sequenced rename-only → infrastructure → documentation. M1 lands the no-behaviour-change refactor: rename `SqlRuntimeImpl` → `SqlRuntime`, export it, and introduce `PostgresRuntime` (initially identity-like). This is the smallest possible "structural home exists" deliverable and isolates hot-path regression risk into a focused PR. M2 lands the new primitives: the `protected withRawConnection<R>(callback)` accessor below the user middleware chain and the formalised `withTransaction` contract for subclass composition. M3 promotes the ADR draft into `docs/architecture docs/adrs/`, updates the runtime + middleware subsystem doc, and updates the umbrella decisions log.

**Spec:** [`projects/runtime-target-layer/spec.md`](spec.md)
**Linear:** _(to be created — see project tracker in umbrella `projects/supabase-integration/README.md`)_

## Cross-project dependencies

This project has no upstream dependencies in the umbrella. It is the most independent of the four constituents and can land first. It does not depend on [TML-2459](../target-extensible-ir/spec.md) (different concern); does not depend on [postgres-rls](../postgres-rls/spec.md) (static side vs dynamic side); does not depend on [cross-contract-refs](../cross-contract-refs/spec.md) (orthogonal).

It is a hard dependency of [extension-supabase](../extension-supabase/spec.md), which extends `PostgresRuntime` to ship `SupabaseRuntime`.

Resulting global sequence (within the Supabase umbrella): **this project ∥ TML-2459 ∥ postgres-rls ∥ cross-contract-refs** → **extension-supabase**.

## Milestones

The three PRs below correspond to the three milestones (M1, M2, M3). Each milestone is one PR.

### M1 — Rename + export + identity-like `PostgresRuntime`

**Goal:** the no-behaviour-change refactor. After this PR, `SqlRuntime` is the exported family-layer class, `PostgresRuntime extends SqlRuntime` is the (near-empty) target-layer class, the `postgres()` factory returns `PostgresRuntime`, and every existing test passes unchanged.

**Tasks:**

- [ ] Rename `SqlRuntimeImpl` → `SqlRuntime` in `packages/2-sql/5-runtime/src/sql-runtime.ts`. Mechanical rename across the file + the package's `index.ts` export.
- [ ] Update all downstream consumers in the workspace to import `SqlRuntime` directly (no compatibility shim — per the no-backwards-compat rule).
- [ ] Add `class PostgresRuntime extends SqlRuntime` in the Postgres extension package. Constructor forwards options to `super(...)` unchanged. No new methods, no new behaviour.
- [ ] Update the Postgres extension's `postgres({...})` factory to return `new PostgresRuntime(...)`. The factory's return type widens from `Runtime` to `PostgresRuntime`.
- [ ] (If implementer agrees with the open-question working assumption) Add `class SqliteRuntime extends SqlRuntime` in the SQLite extension package for symmetry. Same identity-like shape.
- [ ] Verify hot-path performance: run existing runtime micro-benchmarks before + after the rename. Confirm no statistically significant regression. (NFR1 / AC7.)
- [ ] All existing tests pass: `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`. (AC3.)
- [ ] `pnpm lint:deps` passes; no new layering violations.

**Validation:** AC1, AC2, AC3, AC7, AC8 verified.

### M2 — Infrastructure (`withRawConnection` + formalised `withTransaction`)

**Goal:** add the load-bearing primitives subclasses need. After this PR, `SupabaseRuntime` (in the [extension-supabase](../extension-supabase/spec.md) project) can be written cleanly without further framework changes.

**Tasks:**

- [ ] Add `protected withRawConnection<R>(callback: (conn: RawConnection) => Promise<R>): Promise<R>` to `RuntimeCore` (or to `SqlRuntime`, depending on which layer owns connection acquisition — implementer's choice, but consistent with where `withTransaction` lives today). Scoping-by-callback discipline, sticky connection inside the callback, release on resolve / throw.
- [ ] Formalise `withTransaction` as a stable composition point for subclasses. Document its sticky-connection property and its nesting semantics (same-connection escalation to savepoint, or no-op for nested calls — implementer chooses based on existing behaviour). Add unit tests asserting the sticky-connection property is observable.
- [ ] Unit tests for `withRawConnection`:
  - Scope discipline: connection is released when the callback resolves.
  - Scope discipline: connection is released when the callback throws.
  - Stickiness: subsequent `execute()` calls inside the callback use the same connection as `conn`.
  - Composition: `withTransaction(() => withRawConnection(conn => ...))` uses the transaction's connection.
- [ ] Unit tests for user middleware interaction:
  - User middleware registered via the `middleware` option runs as before during regular `execute()` calls.
  - Bootstrap SQL issued inside `withRawConnection` is *not* visible to user middleware (proves the "below the chain" architectural property — AC6).
- [ ] Integration test: a synthetic subclass of `PostgresRuntime` overrides `execute()` to wrap operations in `withTransaction(() => withRawConnection(conn => { conn.exec("SET LOCAL foo = 'bar'"); return super.execute(...); }))`. End-to-end against PGlite confirms the `SET LOCAL` persists for the transaction and reverts after commit. (AC4, AC5.)
- [ ] Performance re-check: no regression in the hot path.
- [ ] `pnpm lint:deps` passes.

**Validation:** AC4, AC5, AC6 verified.

### M3 — Documentation + close-out

**Goal:** capture the durable design decisions; clean up project artefacts.

**Tasks:**

- [ ] Promote `projects/runtime-target-layer/specs/adr-runtime-target-layer.md` to `docs/architecture docs/adrs/`. Use the ADR-numbering convention in force at promotion time. Update any cross-references that pointed at the workspace path.
- [ ] Update `docs/architecture docs/subsystems/runtime-and-middleware-framework.md` (or its analog) with:
  - The new three-layer hierarchy diagram.
  - A reference section for `withRawConnection` (when to use, what guarantees it carries, what the alternative is for cross-cutting concerns — user middleware).
  - A reference section for `withTransaction` as a stable subclass primitive.
- [ ] Update [umbrella `decisions.md` C12](../supabase-integration/decisions.md) marking the runtime cluster as ✅ shipped with links to merged PRs.
- [ ] Update the no-target-branches rule ([`.cursor/rules/no-target-branches.mdc`](../../.cursor/rules/no-target-branches.mdc)) if its wording references the old runtime-layer gap. The rule should now read as enforceable for runtime code, not as aspirational.
- [ ] Close-out: delete `projects/runtime-target-layer/` per the project workflow rule (after the durable docs land).

**Validation:** AC9 verified. Docs reviewed by the team.

## Walking-skeleton integration (cross-cutting DoD)

Per the umbrella's walking-skeleton strategy (decisions [C13/C14](../supabase-integration/decisions.md); [README](../supabase-integration/README.md) §"Walking skeleton"), this project's definition of done includes wiring its feature into the running `examples/supabase` app:

- [ ] Switch the `examples/supabase` `db.ts` onto the exported `PostgresRuntime` (the skeleton ran on the stock `@prisma-next/postgres/runtime` factory until now). This proves `PostgresRuntime` is the substrate `SupabaseRuntime` will extend in `extension-supabase` M2; no behaviour change expected, since the initial `PostgresRuntime` is identity-like.

## Risks and mitigations

- **Risk:** the rename in M1 inadvertently changes hot-path behaviour because of a missed `extends SqlRuntimeImpl` reference or a stale type cast somewhere in the workspace.
  - **Mitigation:** M1 is intentionally limited to the rename + identity-class addition. The PR diff is mechanical; the test suite is the regression check. Reviewers can read the entire PR top-to-bottom.
- **Risk:** the `withRawConnection` accessor's scoping discipline is bypassable through subclass abuse — a subclass holds the connection past the callback's resolution.
  - **Mitigation:** the discipline is enforced by API shape (callback-scoped, no method that returns the connection naked) plus TypeScript's `protected` visibility. Subclasses *could* shoot themselves in the foot by stashing `conn` in a class field, but that's a clear abuse. M2's unit tests assert the documented contract; if a subclass abuses it, the abuse is visible in code review.
- **Risk:** "while we're in here, let's redesign middleware" scope creep.
  - **Mitigation:** the spec's Non-goals section is explicit. Middleware seam redesign is out of scope; `withRawConnection` is `protected` precisely so the user-facing middleware contract doesn't change. Reviewers can reject any change that touches the public middleware API surface.
- **Risk:** performance regression in M1 from inlining-vs-virtual-call differences. Renaming a class doesn't typically affect inlining, but a new subclass layer could.
  - **Mitigation:** M1 runs the existing micro-benchmarks before + after. If a regression appears, the implementer investigates whether it's the rename, the new class layer, or unrelated. Identity-like `PostgresRuntime` should have near-zero overhead; v8 inlines through trivial subclass forwarding.
- **Risk:** the `protected withRawConnection` accessor accidentally lands at the wrong layer. If it lives in `SqlRuntime` instead of `RuntimeCore`, the Mongo target-layer follow-up project will have to add its own copy.
  - **Mitigation:** the implementer evaluates where today's `withTransaction` lives. `withRawConnection` belongs at the same layer for consistency. If today's `withTransaction` is at `RuntimeCore`, so is `withRawConnection`. If today's `withTransaction` is at the family layer, `withRawConnection` follows. The spec leaves this open intentionally; the implementer pins the right layer by inspection.
