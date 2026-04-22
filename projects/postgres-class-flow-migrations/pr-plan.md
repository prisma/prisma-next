# PR plan

How the work in [`plan.md`](./plan.md) maps onto GitHub pull requests.

## Strategy

**3 PRs, merged serially to `main`** — not a long-lived stack. Each PR branches off updated `main` after the previous merges. That sidesteps stack-maintenance pain while keeping each PR reviewable.

The project is carved at the points where behavior change lands: PR 1 is pure foundation with no user-visible effect, PR 2 is the single "switch the lights" moment, PR 3 is cleanup. Every PR is independently mergeable; if any one is reverted, the repo stays in a coherent state.

## Phase-to-PR mapping

| PR | Phases | Net effect | Risk |
|---|---|---|---|
| 1 — Foundation | 0 + 1 | Additive — new IR in place, `db update` runs through it; `migration plan` unchanged | Low |
| 2 — Flip | 2 + 3 | `migration plan` switches to class-flow; the Postgres demo is re-scaffolded end-to-end under class-flow | High |
| 3 — Cleanup | 4 + 5 + 6 | Planner collapse + delete descriptor-flow + delete `migration emit` | Medium |

## PR 1 — Foundation (Phases 0 + 1)

### Contents

- Extract pure factory functions from `operation-resolver.ts` and split them into thematic files under `operations/` (Phase 0 + W06).
- Introduce the framework-level `OpFactoryCall` interface (`{ factoryName, operationClass, label }`) in `packages/1-framework/1-core/framework-components/src/control-migration-types.ts` (Phase 1, W02). `MigrationPlanWithAuthoringSurface` already exists from ADR 194 / the Mongo work and is reused unchanged.
- Introduce a shared framework package `@prisma-next/framework-ts-render` exporting `TsExpression`, `ImportRequirement`, and `jsonToTsSource` (W04+W05). Both targets extend `TsExpression` for their call classes; per-target duplicates of these primitives are deleted.
- Mongo IR sync (Phase 1): Mongo's `OpFactoryCallNode` gains `implements OpFactoryCall` and `extends TsExpression`; each Mongo concrete call class grows `renderTypeScript()` + `importRequirements()`; Mongo's `renderCallsToTypeScript` is rewritten to walk nodes polymorphically (byte-identical output; existing Mongo snapshot tests are the regression gate). Add the Family-SQL `SqlMigration<TDetails extends SqlPlanTargetDetails>` alias (Phase 1, F12/W03).
- Introduce the Postgres class-flow IR in `packages/3-targets/3-targets/postgres/src/core/migrations/`: the internal `PostgresOpFactoryCallNode` base extending `TsExpression` and implementing `OpFactoryCall`, with an abstract `toOp(): SqlMigrationPlanOperation<PostgresPlanTargetDetails>` method; one frozen concrete call class per factory (each class's `toOp()` is a one-line delegation to its pure factory — W10); the polymorphic `renderCallsToTypeScript`; and `TypeScriptRenderablePostgresMigration` (Phase 1). `DataTransformCall` accepts `checkSlot` / `runSlot` strings directly; its `renderTypeScript()` emits `() => placeholder("slot")`; its `toOp()` always throws `PN-MIG-2001` (W07). The factory inventory additionally contains `rawSql`, `createExtension`, and `createSchema` (F05/F06); a `liftOpToCall(op)` helper dispatches walk-schema emissions into structured call classes with `RawSqlCall` as the fallback.
- Retarget the walk-schema planner (`planner-reconciliation.ts` + `planner.ts`'s `buildX` helpers) to produce `PostgresOpFactoryCall[]` internally via `liftOpToCall`, then render to `SqlMigrationPlanOperation<PostgresPlanTargetDetails>[]` via `renderOps` at the tail (Phase 1, F05 cluster).

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
- Emit `dataTransform` stubs by constructing `new DataTransformCall(label, checkSlot, runSlot)` with slot strings for `check` and `run`; `DataTransformCall.renderTypeScript()` emits `() => placeholder("slot")` in the scaffolded `migration.ts` and adds the `placeholder` import automatically (Phase 2).
- Wire the `migration plan` CLI to catch `errorUnfilledPlaceholder` at the `ops.json` / `migration.json` serialization boundary and skip both derived artifacts when placeholders are present, writing `migration.ts` only (Phase 3, R2.11).
- Add per-strategy apply/verify tests that run each emitted recipe against a fresh Postgres and assert the runner's post-apply `verifySqlSchema` passes, for each of the four data-safety scenarios (Phase 2).
- Flip Postgres's `migrationStrategy` registration: remove `resolveDescriptors`, register `emit` instead (Phase 3).
- Remove descriptor-flow entry points from the Postgres `TargetMigrationsCapability` (`planWithDescriptors`, `resolveDescriptors`, `renderDescriptorTypeScript`). The framework-level interface still has these methods — deletion from the interface happens in PR 3 — but Postgres no longer implements them (Phase 3).
- Re-scaffold the Postgres demo (`examples/prisma-next-demo/`) end-to-end under class-flow. The previous single reference migration at `examples/prisma-next-demo/prisma/migrations/20260421T1000_backfill_user_kind/` is removed and replaced by a three-migration history at `examples/prisma-next-demo/migrations/`: `20260422T0720_initial/` (full-schema initial apply — extension + enum types + tables + indexes + foreign keys), `20260422T0742_migration/` (additive nullable `displayName`), and `20260422T0748_migration/` (planner-emitted NOT-NULL backfill: `dataTransform(endContract, …, { check, run }) + setNotNull(…)`). The last migration was produced by driving `migration plan` → fill placeholders → `migration emit` → `migration apply` against a live Postgres dev DB, so the full class-flow data-migration flow is exercised end-to-end on a realistic contract. All three migrations carry their full attested artifacts (`end-contract.{json,d.ts}`, `start-contract.{json,d.ts}`, `migration.json`, `ops.json`, `migration.ts`). `retail-store` and `mongo-demo` are Mongo examples and out of scope.
- Narrow fixes surfaced by the re-scaffolding, each with a targeted regression test: resolve `typeRef` before expanding column metadata in `contract-to-schema-ir.ts` (pgvector's `Embedding1536` no longer round-trips as a spurious `type_mismatch`); filter `dependency_missing` / `type_missing` issues in `planViaIssues` (already handled by `buildDatabaseDependencyOperations` / `buildStorageTypeOperations`); probe the marker table via `information_schema` before reading it in `verify.ts` (PGlite stream corruption); re-parameterize `SqlMigration<TDetails>` on `AnySqlMigrationOperation<TDetails> = SqlMigrationPlanOperation<TDetails> | DataTransformOperation` so a single `operations` array can mix DDL and data-transform ops (matches Mongo). These aren't the advertised scope of PR 2 — they're bug fixes that only became reachable once `migration plan` actually routed through `planIssues`, and the demo re-scaffolding was the first production-shaped driver that exercised them.
- Target-owned `PostgresMigration` base class re-exported as `Migration` from `@prisma-next/target-postgres/migration`. Pins the `SqlMigration` generic to `PostgresPlanTargetDetails` and the `targetId` to `'postgres'`, so hand-authored and generated migrations both read `export default class M extends Migration { … }` without generic parameters. `render-typescript.ts` emits the `export default class M extends Migration {` shape directly on the class declaration line (no trailing `export default M;`). Planner-emitted `migration.ts` files are additionally formatted through prettier before writing so they don't churn on re-emit.

### Behavior change

This is the "switch the lights" moment. Users who run `migration plan --target postgres` get a class-flow `migration.ts` from this PR forward. The Postgres demo's committed migrations are regenerated under class-flow to match the new authoring surface end-to-end (a three-migration history covering initial apply → additive column → planner-emitted NOT-NULL backfill, with the last migration produced by driving `migration plan` → fill placeholders → apply against a live Postgres dev DB).

### Why combine Phases 2 and 3

Phase 2 in isolation would land a dormant parallel code path in `main` — the retargeted issue planner exists but nothing calls it until Phase 3 flips the selector. That's worse than a larger PR because dead code rots and conceals bugs. Merging 2 and 3 together means no dead code ever sits in `main` between the retarget and the flip.

### Merge gate

- `pnpm -r typecheck` + `pnpm -r lint`.
- Per-strategy apply/verify tests pass for all four data-safety scenarios.
- All CLI journey e2e pass — their fixtures and assertions get updated as part of this PR.
- **Per-strategy live-DB e2e**: each of the four planner-emitted recipes (NOT-NULL backfill, unsafe type change, nullable tightening, enum value removal) drives `migration plan` against a contract diff that triggers exactly that strategy and runs `migration apply` against a live Postgres dev DB, asserting both the placeholder-slot shape and the post-apply data + schema state. These are standing tests; the NOT-NULL case also pins `migration apply` idempotency on re-apply (AC4.2 idempotency half).
- **Postgres demo apply/verify**: each of the three re-scaffolded demo migrations at `examples/prisma-next-demo/migrations/` was applied against a live Postgres dev DB and the runner's post-apply `verifySqlSchema` check passed. The NOT-NULL backfill migration in particular was produced by the full `migration plan → fill placeholders → emit → apply` cycle, proving the class-flow pipeline end-to-end on a realistic contract rather than a test fixture. This is the schema-equivalence gate for AC4.1 for the single Postgres example in the repo — not a standing test.

### Review strategy

Large PR, dominated by code and live-DB test fixtures. The demo re-scaffolding adds three full migration directories' worth of attested artifacts (`end-contract.{json,d.ts}`, `start-contract.{json,d.ts}`, `migration.json`, `ops.json`, `migration.ts`) but these are regenerated outputs — reviewers should accept them as machine-produced rather than diff them line-by-line. Make the PR navigable by structuring commits:

1. One commit per retargeted strategy (data-safety scenarios, one by one).
2. One commit for the issue-planner default-mapping retarget.
3. One commit for the CLI flip (`migrationStrategy` registration change, Postgres capability cleanup).
4. One commit per demo migration (initial / additive / NOT-NULL backfill).
5. One commit per per-strategy live-DB e2e, plus one for the class-flow round-trip e2e.
6. One commit per narrow fix surfaced by the re-scaffolding (typeRef resolution, issue filtering in `planViaIssues`, `readMarker` probe, `AnySqlMigrationOperation` union), each alongside its regression test.
7. `PostgresMigration` base class + prettier formatting of generated TypeScript.

Reviewers focus line-by-line on groups 1–3 and 6–7; group 4 is "accept the regen" with a quick sanity check on each migration's shape; group 5 is the live-DB pins for the Step 2 / Step 4 spec ACs.

### Size estimate

Large PR. Code-side is ~8–10 days of implementation (retargeted strategies, issue-planner retarget, CLI flip, per-strategy live-DB e2es, demo re-scaffolding, four narrow fixes, `PostgresMigration` base class). Regenerated demo artifacts add ~2k LOC of machine-produced JSON / TypeScript on top; these are review-cheap because they're deterministic outputs of the committed contract.

### Rollback

Revert the PR. `resolveDescriptors` returns to the Postgres capability, descriptor-flow becomes the active branch again. The re-scaffolded demo migrations under `examples/prisma-next-demo/migrations/` are removed along with the rest of the revert, and the previous single reference migration at `examples/prisma-next-demo/prisma/migrations/20260421T1000_backfill_user_kind/` returns. No data loss — operators who already applied the new migrations are unaffected (the runner tracks `migrationId` on the target DB, independent of what the repo ships).

## PR 3 — Cleanup (Phases 4 + 5 + 6)

### Contents

- Absorb walk-schema logic into the issue-based planner (Phase 4). Delete `planner-reconciliation.ts`; reduce `planner.ts` to a thin `PostgresMigrationPlanner` shell or delete it entirely. `db update` now runs through the same issue-based pipeline as `migration plan`.
- Delete descriptor-flow framework surface: `OperationDescriptor`, `PostgresMigrationOpDescriptor`, `DataTransformDescriptor`, `planWithDescriptors`, `resolveDescriptors`, `renderDescriptorTypeScript`, `MigrationDescriptorArraySchema`, `evaluateMigrationTs` (Phase 5).
- Delete `operation-descriptors.ts`, `operation-resolver.ts`, `descriptor-planner.ts` (or its renamed successor), and `scaffolding.ts` + `scaffolding.test.ts` from the Postgres package (Phase 5). `scaffolding.ts` only ever hosted `renderDescriptorTypeScript`, which has no production callers after PR 2 — only its own test imports it.
- Delete `TargetMigrationsCapability.planWithDescriptors`, `.resolveDescriptors`, `.renderDescriptorTypeScript`, and `.emit` methods from the framework interface (Phase 5).
- Delete `migration emit` CLI command (Phase 6).
- Delete `postgresEmit` and `mongoEmit` source files (Phase 6).
- Remove `hints.planningStrategy` from the manifest writer (Phase 6).
- **(Maybe)** re-run `migration plan` over the Postgres demo one more time once the walk-schema half of `PostgresMigrationPlanner` is deleted, to confirm the same `ops.json` / `migration.json` come out of the unified pipeline as came out of the split pipeline in PR 2. This is a validation step, not a new deliverable — the demo was already fully re-scaffolded under class-flow in PR 2.

### Behavior change

None user-visible. `db update` now runs through the issue-based planner, but external behavior is pinned by existing `db update` e2e tests. The deleted CLI commands and capability methods have no remaining callers after PR 2.

### Why combine Phases 4, 5, 6

Phase 4 is non-trivial absorption work, but every walk-schema branch is guided by the audit performed in PR 1 (committed in-repo at `projects/postgres-class-flow-migrations/assets/walk-schema-audit.md`; see [`specs/walk-schema-audit.spec.md`](./specs/walk-schema-audit.spec.md)). Phases 5 and 6 are pure deletions. The risk profile is "make sure we didn't break something", not "design a new thing" — lumping them gives one well-scoped cleanup review.

### Merge gate

- `pnpm -r typecheck` + `pnpm -r lint`.
- Full integration + e2e green, especially `db update` e2e (now running through issue-based pipeline).
- Grep assertions from [`spec.md` §"Removal (end of project)"](./spec.md) pass — no source file imports any deleted symbol.
- New strategy ordering tests from Phase 4 pin the chain order.
- **Post-collapse replan check** (optional): if the maybe-bullet above is exercised, assert that a `migration plan` run over the Postgres demo's committed contract through the unified pipeline produces the same `ops.json` / `migration.json` (modulo hash differences from the collapsed walk-schema path) as the split pipeline did in PR 2. Not a standing test.

### Escape hatch

If the walk-schema audit (done during PR 1 implementation) reveals Phase 4 is larger than expected — e.g. many extensions to `SchemaIssue` needed, or novel strategy-ordering work — split Phase 4 from Phases 5+6 into two PRs:

- PR 3a — Planner collapse (Phase 4).
- PR 3b — Descriptor-flow deletion (Phases 5 + 6).

The decision is gated on audit output and shouldn't be pre-committed here. Default to combined; split if the implementer flags complexity.

### Size estimate

~3–5 days. Mostly deletions in code (net-negative LOC). The example re-scaffolding that previously dominated PR 3's diff happened in PR 2.

### Rollback

Revert the PR. `db update` returns to the walk-schema planner; descriptor-flow sources and `migration emit` come back. `migration plan` is unaffected because it's been on class-flow since PR 2.

## Total

~3 PRs, ~17–21 days of implementation serialized, each independently mergeable.

## Guardrails

- **Don't stack.** Each PR branches off `main` only after the previous has merged. If PR 2 must be drafted before PR 1 lands, draft it locally on top of PR 1's branch but don't open it on GitHub until rebased onto updated `main`.
- **Don't split foundations.** Phase 0 alone is too small to justify a PR. Combining with Phase 1 keeps the factory extraction reviewable in context.
- **Don't defer the flip.** Don't merge Phase 2 without Phase 3. Dormant parallel code paths rot in `main`.
- **Do split PR 3 if forced.** The audit outcome is the trigger; use the escape hatch above if warranted.
- **Do grow PR 2's commits, not its commit size.** PR 2 is the large PR (retargeted strategies, issue-planner retarget, CLI flip, per-strategy live-DB e2es, demo re-scaffolding, four surfaced fixes). Structuring commits around logical boundaries (one per strategy; one per demo migration; one per narrow fix with its regression test) keeps review tractable at any diff size.

## References

- [`spec.md`](./spec.md) — project spec.
- [`plan.md`](./plan.md) — phase-by-phase execution plan.
- [`specs/walk-schema-audit.spec.md`](./specs/walk-schema-audit.spec.md) — audit that gates the PR 3 escape hatch.
- [`specs/phase-0-factory-extraction.spec.md`](./specs/phase-0-factory-extraction.spec.md) — in PR 1.
- [`specs/phase-1-walk-schema-class-flow.spec.md`](./specs/phase-1-walk-schema-class-flow.spec.md) — in PR 1.
