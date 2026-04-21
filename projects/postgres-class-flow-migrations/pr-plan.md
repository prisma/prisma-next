# PR plan

How the work in [`plan.md`](./plan.md) maps onto GitHub pull requests.

## Strategy

**3 PRs, merged serially to `main`** — not a long-lived stack. Each PR branches off updated `main` after the previous merges. That sidesteps stack-maintenance pain while keeping each PR reviewable.

The project is carved at the points where behavior change lands: PR 1 is pure foundation with no user-visible effect, PR 2 is the single "switch the lights" moment, PR 3 is cleanup. Every PR is independently mergeable; if any one is reverted, the repo stays in a coherent state.

## Phase-to-PR mapping

| PR | Phases | Net effect | Risk |
|---|---|---|---|
| 1 — Foundation | 0 + 1 | Additive — new IR in place, `db update` runs through it; `migration plan` unchanged | Low |
| 2 — Flip | 2 + 3 | `migration plan` switches to class-flow; every example migration re-scaffolded | High |
| 3 — Cleanup | 4 + 5 + 6 | Planner collapse + delete descriptor-flow + delete `migration emit` | Medium |

## PR 1 — Foundation (Phases 0 + 1)

### Contents

- Extract pure factory functions from `operation-resolver.ts` (Phase 0). No new helpers are added to `@prisma-next/errors/migration` in this phase.
- Introduce the framework `OpFactoryCall` interface in `packages/1-framework/1-core/framework-components/src/control-migration-types.ts` and the `MigrationPlanWithAuthoringSurface` interface (Phase 1).
- Mongo IR sync (Phase 1): Mongo's `OpFactoryCallNode` gains `implements OpFactoryCall` and `extends MigrationTsExpression` (new Mongo-internal abstract, sibling of the Postgres one); each Mongo concrete call class grows `renderTypeScript()` + `importRequirements()`; Mongo's `renderCallsToTypeScript` is rewritten to walk nodes polymorphically (byte-identical output; existing Mongo snapshot tests are the regression gate). Add the Family-SQL `SqlMigration<TDetails>` alias (Phase 1).
- Introduce the Postgres class-flow IR in `packages/3-targets/3-targets/postgres/src/core/migrations/`: the abstract `MigrationTsExpression` base (Postgres sibling of the Mongo one), the concrete `PlaceholderExpression` node, the internal `PostgresOpFactoryCallNode` base extending `MigrationTsExpression` and implementing `OpFactoryCall`, one frozen concrete call class per factory, the `PostgresOpFactoryCallVisitor<R>` interface, the `renderOps` visitor (with its local `bodyToClosure` helper), the polymorphic `renderCallsToTypeScript`, and `TypeScriptRenderablePostgresMigration` (Phase 1).
- Retarget the walk-schema planner (`planner-reconciliation.ts` + `planner.ts`'s `buildX` helpers) to produce `PostgresOpFactoryCall[]` internally, then rendering to `SqlMigrationPlanOperation<PostgresPlanTargetDetails>[]` via `renderOps` at the tail (Phase 1).

### Behavior change

None visible to users:
- `migration plan` still goes through the descriptor branch of `migrationStrategy`.
- `db update` still walks the live schema; the code now produces class-flow IR internally but renders to the same `SqlMigrationPlanOperation[]` the runner consumes today.

### Why combine Phases 0 and 1

Phase 0 is a pure source refactor with no independent user-visible value. The factories it extracts are the inputs to the call classes in Phase 1; combining removes a trivial review round-trip and keeps the factory extraction reviewable in the context of the IR it enables.

### Merge gate

- `pnpm -r typecheck` + `pnpm -r lint` across the monorepo.
- Full CLI journey e2e suite green (`test/integration/test/cli-journeys/*.e2e.test.ts`).
- `db update` e2e green — this is the end-to-end signal that the walk-schema retarget produces equivalent recipes.
- New unit tests per concrete call class (construct, `accept()`, label) and per visitor case.
- New unit test for `TypeScriptRenderablePostgresMigration` round-trip (render TypeScript → dynamic import → reconstruct `operations`).
- Mongo regression: existing `render-typescript` snapshot tests pass byte-identically; new per-class `renderTypeScript()` / `importRequirements()` unit tests land alongside; Mongo `migration plan` e2e (empty scaffold + non-empty planned migration) green.

### Size estimate

~7–8 days of implementation, ~2.5–3.5k LOC mostly additive. Framework interface lift is small; bulk is Postgres call classes + visitors + walk-schema retarget, plus a smaller Mongo IR sync (mechanical polymorphic rewrite gated by existing snapshot tests).

### Rollback

Revert the PR. Walk-schema planner returns to its pre-IR shape. No user impact.

## PR 2 — Flip (Phases 2 + 3)

### Contents

- Retarget every strategy in `migrationPlanStrategies` and the default-mapping layer in `issue-planner.ts` to emit `PostgresOpFactoryCall[]` (Phase 2).
- Emit `dataTransform` stubs using `new PlaceholderExpression(slot)` for `check` and `run`; `renderCallsToTypeScript` renders these as `() => placeholder("slot")` in the scaffolded `migration.ts` and adds the `placeholder` import automatically (Phase 2).
- Wire the `migration plan` CLI to catch `errorUnfilledPlaceholder` at the `ops.json` / `migration.json` serialization boundary and skip both derived artifacts when placeholders are present, writing `migration.ts` only (Phase 3, R2.11).
- Add per-strategy apply/verify tests that run each emitted recipe against a fresh Postgres and assert the runner's post-apply `verifySqlSchema` passes, for each of the four data-safety scenarios (Phase 2).
- Flip Postgres's `migrationStrategy` registration: remove `resolveDescriptors`, register `emit` instead (Phase 3).
- Remove descriptor-flow entry points from the Postgres `TargetMigrationsCapability` (`planWithDescriptors`, `resolveDescriptors`, `renderDescriptorTypeScript`). The framework-level interface still has these methods — deletion from the interface happens in PR 3 — but Postgres no longer implements them (Phase 3).
- Re-scaffold every `examples/**/migrations/*/`: regenerate `migration.ts`, `ops.json`, `migration.json` through the class-flow pipeline. `migrationId` values change (Phase 3).

### Behavior change

This is the "switch the lights" moment. Users who run `migration plan --target postgres` get a class-flow `migration.ts` from this PR forward. Every example migration in the repo is replaced with its class-flow regeneration.

### Why combine Phases 2 and 3

Phase 2 in isolation would land a dormant parallel code path in `main` — the retargeted issue planner exists but nothing calls it until Phase 3 flips the selector. That's worse than a larger PR because dead code rots and conceals bugs. Merging 2 and 3 together means no dead code ever sits in `main` between the retarget and the flip.

### Merge gate

- `pnpm -r typecheck` + `pnpm -r lint`.
- Per-strategy apply/verify tests pass for all four data-safety scenarios.
- All CLI journey e2e pass — their fixtures and assertions get updated as part of this PR.
- **Per-example apply/verify**: each re-scaffolded `examples/**/migrations/*/` is applied against a fresh Postgres (e.g. `pnpm --filter <example> db:update` against a disposable database) and the runner's post-apply `verifySqlSchema` check passes. The PR description lists the examples that were exercised and the commands that were run. This is the merge gate for schema equivalence — not a standing test.

### Review strategy

This PR will be large, dominated by re-scaffolded example diffs. Make it navigable by structuring commits:

1. One commit per retargeted strategy (data-safety scenarios, one by one).
2. One commit for the issue-planner default-mapping retarget.
3. One commit for the CLI flip (`migrationStrategy` registration change, Postgres capability cleanup).
4. One commit per re-scaffolded example (or one per `examples/<project>/`, if per-migration is too noisy).

Reviewers can then focus line-by-line on the first three groups and treat the example-diff commits as "accept the regen".

### Size estimate

Largest PR. ~8–10 days of implementation. ~4–6k LOC including re-scaffolded examples.

### Rollback

Revert the PR. `resolveDescriptors` returns to the Postgres capability, descriptor-flow becomes the active branch again, examples revert to their pre-flip committed state. No data loss — the revert restores the exact committed state of the example migrations, and operators who already applied the new migrations are unaffected (the runner tracks `migrationId` on the target DB, independent of what the repo ships).

## PR 3 — Cleanup (Phases 4 + 5 + 6)

### Contents

- Absorb walk-schema logic into the issue-based planner (Phase 4). Delete `planner-reconciliation.ts`; reduce `planner.ts` to a thin `PostgresMigrationPlanner` shell or delete it entirely. `db update` now runs through the same issue-based pipeline as `migration plan`.
- Delete descriptor-flow framework surface: `OperationDescriptor`, `PostgresMigrationOpDescriptor`, `DataTransformDescriptor`, `planWithDescriptors`, `resolveDescriptors`, `renderDescriptorTypeScript`, `MigrationDescriptorArraySchema`, `evaluateMigrationTs` (Phase 5).
- Delete `operation-descriptors.ts`, `operation-resolver.ts`, `descriptor-planner.ts` (or its renamed successor) from the Postgres package (Phase 5).
- Delete `renderDescriptorTypeScript` from `scaffolding.ts` (Phase 5).
- Delete `TargetMigrationsCapability.planWithDescriptors`, `.resolveDescriptors`, `.renderDescriptorTypeScript`, and `.emit` methods from the framework interface (Phase 5).
- Delete `migration emit` CLI command (Phase 6).
- Delete `postgresEmit` and `mongoEmit` source files (Phase 6).
- Remove `hints.planningStrategy` from the manifest writer (Phase 6).

### Behavior change

None user-visible. `db update` now runs through the issue-based planner, but external behavior is pinned by existing `db update` e2e tests. The deleted CLI commands and capability methods have no remaining callers after PR 2.

### Why combine Phases 4, 5, 6

Phase 4 is non-trivial absorption work, but every walk-schema branch is guided by the audit performed in PR 1 (committed at `wip/walk-schema-audit.md` or similar — not in-repo; see `specs/walk-schema-audit.spec.md`). Phases 5 and 6 are pure deletions. The risk profile is "make sure we didn't break something", not "design a new thing" — lumping them gives one well-scoped cleanup review.

### Merge gate

- `pnpm -r typecheck` + `pnpm -r lint`.
- Full integration + e2e green, especially `db update` e2e (now running through issue-based pipeline).
- Grep assertions from [`spec.md` §"Removal (end of project)"](./spec.md) pass — no source file imports any deleted symbol.
- New strategy ordering tests from Phase 4 pin the chain order.

### Escape hatch

If the walk-schema audit (done during PR 1 implementation) reveals Phase 4 is larger than expected — e.g. many extensions to `SchemaIssue` needed, or novel strategy-ordering work — split Phase 4 from Phases 5+6 into two PRs:

- PR 3a — Planner collapse (Phase 4).
- PR 3b — Descriptor-flow deletion (Phases 5 + 6).

The decision is gated on audit output and shouldn't be pre-committed here. Default to combined; split if the implementer flags complexity.

### Size estimate

~3–4 days. Mostly deletions, net-negative LOC.

### Rollback

Revert the PR. `db update` returns to the walk-schema planner; descriptor-flow sources and `migration emit` come back. `migration plan` is unaffected because it's been on class-flow since PR 2.

## Total

~3 PRs, ~17–21 days of implementation serialized, each independently mergeable.

## Guardrails

- **Don't stack.** Each PR branches off `main` only after the previous has merged. If PR 2 must be drafted before PR 1 lands, draft it locally on top of PR 1's branch but don't open it on GitHub until rebased onto updated `main`.
- **Don't split foundations.** Phase 0 alone is too small to justify a PR. Combining with Phase 1 keeps the factory extraction reviewable in context.
- **Don't defer the flip.** Don't merge Phase 2 without Phase 3. Dormant parallel code paths rot in `main`.
- **Do split PR 3 if forced.** The audit outcome is the trigger; use the escape hatch above if warranted.
- **Do grow PR 2's commits, not its commit size.** The re-scaffolded examples will dominate LOC. Commits structured around logical boundaries (one per strategy, one per example) make review tractable at any diff size.

## References

- [`spec.md`](./spec.md) — project spec.
- [`plan.md`](./plan.md) — phase-by-phase execution plan.
- [`specs/walk-schema-audit.spec.md`](./specs/walk-schema-audit.spec.md) — audit that gates the PR 3 escape hatch.
- [`specs/phase-0-factory-extraction.spec.md`](./specs/phase-0-factory-extraction.spec.md) — in PR 1.
- [`specs/phase-1-walk-schema-class-flow.spec.md`](./specs/phase-1-walk-schema-class-flow.spec.md) — in PR 1.
