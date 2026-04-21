# Postgres class-flow migrations — Plan

This plan describes how we execute the [spec](./spec.md) — the phases, their ordering rationale, the risks, and the acceptance gates.

## Critical risk up front

**`migrationId` stability is the single non-negotiable invariant for this project.** Every example migration in the repo has an attested `migration.json` with a `migrationId` derived from the hash of its `ops.json` and its source-storage hash (ADR 199). A Postgres-only authoring-surface refactor must produce **byte-identical** `ops.json` for every existing migration. Any diff is a bug.

Every phase from Phase 1 onward runs a pre-merge attestation check: regenerate each example migration's `ops.json`, compare byte-for-byte against the checked-in file, recompute `migrationId`. Any diff blocks the PR.

## Where we're going

By the end of the project, the framework gains an `OpFactoryCall` interface and the Postgres target hosts the concrete call classes, factories, renderers, and migration wrapper:

```
packages/1-framework/1-core/framework-components/src/
└── control-migration-types.ts  # + OpFactoryCall interface { factory, operationClass, label }

packages/3-targets/3-targets/postgres/src/core/migrations/
├── op-factory-call.ts       # PostgresOpFactoryCall concrete classes (each implements OpFactoryCall) + visitor interface
├── op-factories.ts          # Pure createX(...literalArgs) functions
├── render-ops.ts            # renderOps visitor (PostgresOpFactoryCall[] → operations)
├── render-typescript.ts     # renderCallsToTypeScript visitor (PostgresOpFactoryCall[] → migration.ts source)
├── planner.ts               # PostgresMigrationPlanner + TypeScriptRenderablePostgresMigration class
├── issue-planner.ts         # SchemaIssue[] → strategy chain → default mapping → PostgresOpFactoryCall[]
├── strategies.ts            # NOT-NULL backfill, unsafe type change, nullable tightening, enum rebuild
├── planner-ddl-builders.ts  # Pure SQL-string builders (unchanged, reused by factories)
├── planner-sql-checks.ts    # Pure check-SQL builders (unchanged)
├── planner-identity-values.ts
├── planner-recipes.ts
├── runner.ts                # Unchanged
└── scaffolding.ts           # Only non-descriptor scaffolding helpers remain
```

No SQL-family base class is added: `family-sql` ships no `SqlOpFactoryCallBase` and no `PlannerProducedSqlMigration`. The `OpFactoryCall` interface is lifted directly to the framework so any future target (sql or otherwise) can reuse it without going through a family layer.

**Deleted**: `descriptor-planner.ts`, `operation-descriptors.ts`, `operation-resolver.ts`, `planner-reconciliation.ts`, `renderDescriptorTypeScript` from `scaffolding.ts`.

**The production pipeline becomes**:

```
fromContract, toContract, schema
    │
    ▼
  verifySqlSchema
    │
    ▼
  SchemaIssue[]
    │
    ▼
  strategy chain (consume issues, emit calls)
    │
    ▼
  default issue mapping (emit calls for residual issues)
    │
    ▼
  PostgresOpFactoryCall[]
    │
    ├─► renderOps ────────────► SqlMigrationPlanOperation[]  →  ops.json
    │
    └─► renderCallsToTypeScript ► migration.ts source         →  disk
```

## Concept cheatsheet

| Concept | What it is | Defined in |
|---|---|---|
| `Migration` | Abstract class implementing `MigrationPlan`. User-authored migration files extend it and override `plan()`. | `@prisma-next/framework-components/migration` |
| `MigrationPlanWithAuthoringSurface` | A `MigrationPlan` that also carries `renderTypeScript()`. Produced by planners. | ADR 194, `framework-components/control` |
| `OpFactoryCall` | **Interface, framework-level** (`{ factory, operationClass, label }`). Concrete call classes (`CreateTableCall`, `DataTransformCall`, …) implement it. No abstract base class. | ADR 195, `framework-components/control-migration-types.ts` |
| Concrete call class | Frozen class representing a single factory call (e.g. `CreateTableCall`, `DataTransformCall`) with literal args + planner-derived label/class. Discriminated union per target. Implements `OpFactoryCall`. | ADR 195, `op-factory-call.ts` |
| Visitor | `interface PostgresOpFactoryCallVisitor<R> { visitCreateTable(c: CreateTableCall): R; … }`. Every dispatch site uses the visitor for compile-time exhaustiveness. | ADR 195 |
| `renderOps` / `renderCallsToTypeScript` | Two visitors. `renderOps` invokes pure factories; `renderCallsToTypeScript` emits TypeScript source for a `migration.ts` file. Same IR, two outputs. | ADR 195 |
| Pure factory | Function `(literalArgs) => SqlMigrationPlanOperation`. No context, no contract lookup, no codec hooks. | ADR 195 |
| `TypeScriptRenderablePostgresMigration` | Postgres-specific concrete class. Extends `Migration<SqlMigrationPlanOperation<PostgresPlanTargetDetails>>`, implements `MigrationPlanWithAuthoringSurface`. Holds `readonly calls: readonly PostgresOpFactoryCall[]` + injected renderer functions. Sibling of Mongo's `PlannerProducedMongoMigration`; consolidation candidate for a follow-up project. | `planner.ts` |
| `SchemaIssue` | Normalized diff record (e.g. `{ kind: 'missing_column', table, column, expected, actual }`). Output of `verifySqlSchema`. | `family-sql/schema-verify` |
| `MigrationStrategy` | `(issues, ctx) => { kind: 'match'; calls: OpFactoryCall[] } \| { kind: 'no_match' }`. Pattern-matches recognized issues, emits multi-op recipes. | `strategies.ts` |
| Stub `DataTransformCall` | `DataTransformCall` with `stub: true` flag. Rendered as `placeholder()` closures in TypeScript, refused by `renderOps`. | ADR 200 |
| `Migration.run(import.meta.url, M)` | Static entrypoint. Dynamically imports the migration module, constructs the migration, emits `ops.json` + `migration.json` to disk. Only sanctioned emit driver post-project. | ADR 196 |

## Phases at a glance

Six phases. The first three build the class-flow path while leaving descriptor-flow intact; the fourth flips the lights; the last two delete the old scaffolding.

| Phase | Theme | Shape | Blast radius |
|---|---|---|---|
| **0. Code motion** | Factor operation-resolver into pure factories | Internal refactor, descriptor flow unchanged | Low |
| **1. Introduce class-flow** | Lift `OpFactoryCall` interface to framework; add concrete Postgres call classes + renderers; retarget strategies; implement `TypeScriptRenderablePostgresMigration` | Purely additive — both flows compile | Low |
| **2. Flip CLI to class-flow** | Switch CLI dispatch, re-scaffold examples, add live-DB e2e | User-visible — the one "switch the lights" moment | High |
| **3. Collapse planners** | Absorb walk-schema logic into issue-based planner; delete `planner-reconciliation.ts` | Internal, planner-only | Medium |
| **4. Delete descriptor IR** | Remove `OperationDescriptor`, capability methods, CLI branches | Cross-package delete | Medium |
| **5. Delete `migration emit`** | Remove CLI command + `emit` capability + `postgresEmit`/`mongoEmit` | CLI + framework | Low |

Phases 0–2 are load-bearing and sequential. Phases 3–5 are cleanup and can be reordered or combined pragmatically; the plan presents them in their natural order.

## Spec-requirement to phase mapping

| Requirement | Phases | Notes |
|---|---|---|
| R1.1–R1.3 (`migration new` produces class-flow file) | 1, 2 | Phase 1 lands the machinery; Phase 2 makes the CLI use it |
| R2.1–R2.6 (issue-based planner with strategies, materialization at call-construction) | 1 | Strategies retargeted to emit calls; planner wires them |
| R2.7–R2.9 (`TypeScriptRenderablePostgresMigration`, two renderers, stubs) | 1 | Core additive work |
| R2.10 (single planner) | 3 | Walk-schema absorption |
| R3.1–R3.3 (pure factories, visitor discipline, module-scope query builder) | 0, 1 | Phase 0 creates the factories; Phase 1 wires the visitor surface |
| R4.1–R4.3 (unchanged wire format, unchanged runner) | all | Invariant; attestation check enforces |
| Removal acceptance criteria | 4, 5 | |

## Phase 0 — Code motion: pure factory extraction

**Why first?** Phase 1 needs the pure factories to exist. Doing this as a first, isolated refactor de-risks Phase 1: when we introduce `OpFactoryCall` classes whose constructors take the same args as the factories, we can be confident the factories already work correctly because they're covered by today's descriptor-flow tests.

**Why safe?** The refactor is strictly internal to `operation-resolver.ts` (929 LOC) and is behavior-preserving. Descriptor flow continues to work identically because we leave thin `resolveX(descriptor, context)` wrappers that extract literal args and delegate to the pure `createX`.

### Scope

`packages/3-targets/3-targets/postgres/src/core/migrations/operation-resolver.ts` is refactored in place:

- Every `resolveX(descriptor, context)` is split into:
  - `createX(...literalArgs): SqlMigrationPlanOperation<PostgresPlanTargetDetails>` — pure, no `OperationResolverContext`, no codec hooks, no `db` handle.
  - `resolveX(descriptor, context)` — thin wrapper that performs context-dependent materialization (contract lookup, codec expansion, schema qualification, default rendering) from descriptor + context, then calls `createX`.
- Pure factories are extracted into a new file, `op-factories.ts`, so they survive descriptor deletion in Phase 4.
- One-to-many resolvers (e.g. `resolveCreateDependency` → multiple ops) become multiple pure factories; the wrapper returns an array.
- `TODO` sentinel handling in `dataTransform` is preserved: the pure factory accepts `stub: boolean`; the wrapper passes `stub: true` when it detects `TODO`.

### Validation

- `pnpm -r typecheck`, `pnpm -r lint`.
- All Postgres package tests pass unchanged.
- Integration test `schema-evolution-migrations.e2e.test.ts` passes unchanged.

### Rollback

Phase 0 is a behavior-preserving internal refactor. Revert the PR if tests fail.

## Phase 1 — Introduce class-flow infrastructure

**Why after Phase 0?** The factories exist and are pure. Phase 1 introduces `OpFactoryCall` classes whose constructors accept the same literal-arg shapes, plus the visitor renderers that call the factories. Without Phase 0, this phase would be conflating two refactors.

**Why additive?** Descriptor-flow code continues to back the live CLI through all of Phase 1. The class-flow machinery exists alongside the descriptor machinery. The postgres planner exposes both paths via a `planningMode: 'walk' | 'issues'` flag defaulting to `'walk'`; class-flow is only selected by opting into `'issues'`. This lets us test the new path in isolation without touching user-visible CLI behavior.

### Scope

**Framework lift** (`packages/1-framework/1-core/framework-components/src/control-migration-types.ts`):

- Add `OpFactoryCall` interface: `{ readonly factory: string; readonly operationClass: MigrationOperationClass; readonly label: string }`. Re-exported through `framework-components`'s control entrypoint. No abstract base class. No SQL-family layer.
- Rationale: the structural shape is identical across targets (Mongo, Postgres, anything future). Lifting now means consumer-facing type positions (renderer signatures, planner returns, visitor inputs) reference a single framework-level interface rather than a target-specific or family-specific abstraction. Mongo's existing concrete call classes are not retrofitted in this project — they already happen to satisfy the interface structurally; the explicit `implements OpFactoryCall` annotation is a follow-up item bundled with the broader cross-target consolidation.

**Family-SQL abstractions** (`packages/2-sql/9-family`):

- Add only `Migration` alias bound to `SqlMigrationPlanOperation<PostgresPlanTargetDetails>`-shaped operations, mirroring `@prisma-next/target-mongo/migration`. (Concrete details target-specific; Postgres re-exports its own bound alias.)
- No `SqlOpFactoryCallBase`. No `PlannerProducedSqlMigration<TCall>`. The framework-level `OpFactoryCall` interface and the target-specific concrete migration class are the only abstractions involved.

**Postgres IR** (`packages/3-targets/3-targets/postgres/src/core/migrations`):

- `op-factory-call.ts` — `PostgresOpFactoryCall` discriminated union. One frozen class per factory: `CreateTableCall`, `DropTableCall`, `AddColumnCall`, `DropColumnCall`, `AlterColumnTypeCall`, `SetNotNullCall`, `DropNotNullCall`, `SetDefaultCall`, `DropDefaultCall`, `AddPrimaryKeyCall`, `AddForeignKeyCall`, `AddUniqueCall`, `CreateIndexCall`, `DropIndexCall`, `DropConstraintCall`, `CreateEnumTypeCall`, `AddEnumValuesCall`, `DropEnumTypeCall`, `RenameTypeCall`, `CreateExtensionCall`, `DataTransformCall`. Each `implements OpFactoryCall`. Constructor args mirror Phase 0 factory signatures 1:1.
- `PostgresOpFactoryCallVisitor<R>` interface with one method per variant.
- `render-ops.ts` — `renderOps(calls)` visitor; dispatches each call to its factory. Refuses stub `DataTransformCall` with a planner error.
- `render-typescript.ts` — `renderCallsToTypeScript(calls, meta)` visitor; emits class-flow `migration.ts` source. Renders stub `DataTransformCall` with `placeholder()` closures per ADR 200.

**Retargeted strategies** (`strategies.ts`, evolved from today's `planner-strategies.ts`):

- Strategy signature changes from `(issues, ctx) => { ops: Descriptor[] }` to `(issues, ctx) => { calls: PostgresOpFactoryCall[] }`.
- `StrategyContext` expands to `{ toContract, fromContract, schemaName, codecHooks }` so strategies fully materialize literal args at call-construction time.
- Each of `notNullBackfillStrategy`, `typeChangeStrategy`, `nullableTighteningStrategy`, `enumChangeStrategy` is rewritten to construct `OpFactoryCall` instances. Pattern-matching logic preserved verbatim.
- `enumRebuildRecipe` emits `CreateEnumTypeCall + AlterColumnTypeCall + DropEnumTypeCall + RenameTypeCall`.

**Retargeted issue planner** (`issue-planner.ts`, evolved from `descriptor-planner.ts`):

- Dispatch skeleton preserved: strategy chain → sort residual issues by dependency order → default issue-to-call mapping → phased concat (deps, drops, tables, columns, patterns, alters, constraints).
- `mapIssue(issue, ctx)` returns `PostgresOpFactoryCall[]` instead of descriptors.
- `planCalls(options)` replaces `planDescriptors`; returns `{ calls } | { conflicts }`.

**Planner wiring** (`planner.ts`):

- `TypeScriptRenderablePostgresMigration` — concrete class extending `Migration<SqlMigrationPlanOperation<PostgresPlanTargetDetails>>`, implementing `MigrationPlanWithAuthoringSurface`. Holds `readonly calls: readonly PostgresOpFactoryCall[]`, constructor-injects `renderOps` and `renderCallsToTypeScript`. No family-level base class.
- `PostgresMigrationPlanner.plan()` gets a `planningMode: 'walk' | 'issues'` flag. Default `'walk'` (descriptor-flow callers unchanged). `'issues'` runs the new pipeline: `verifySqlSchema` → `planCalls` → `new TypeScriptRenderablePostgresMigration(calls)`.
- The empty-plan path (`emptyMigration`) returns a `TypeScriptRenderablePostgresMigration` with empty `calls` and a real `renderTypeScript()`.

**Capability** (`exports/control.ts`):

- `postgresTargetDescriptor.migrations.emit = postgresEmit` (transitional; deleted in Phase 5). Mirrors `mongoEmit`.

### Validation

- `pnpm -r typecheck`, `pnpm -r lint`.
- New unit tests per `OpFactoryCall` class (JSON round-trip, literal-arg preservation).
- Visitor tests: every `renderOps` / `renderCallsToTypeScript` case.
- Strategy tests: existing strategy tests ported to assert `OpFactoryCall[]` emission.
- `TypeScriptRenderablePostgresMigration` unit test: construct with a fixed call list, verify `operations` round-trips through `renderOps`, verify `renderTypeScript()` emits parseable TypeScript that reconstructs the same call list on dynamic import.
- Full existing descriptor-flow e2e still passes (descriptor path is untouched).

### Risks

- **Exhaustiveness drift.** Adding a new factory must be a three-site change. Enforce with `satisfies PostgresOpFactoryCallVisitor<R>` on every visitor so skipping a case is a TypeScript error.
- **Scope creep into Phase 3.** Resist folding walk-schema logic into strategies here. Phase 3 owns that consolidation. Phase 1's Postgres planner keeps walk-schema as the default.

### Rollback

Phase 1 is additive. Revert deletes the new files and the class-flow code paths; the descriptor flow continues untouched.

## Phase 2 — Flip CLI to class-flow

**Why after Phase 1?** The class-flow machinery exists and passes its own tests; now we point the CLI at it. This is a behavior change, so it lands in its own PR with the attestation gate.

**Why the risk?** This is the "switch the lights" moment. Every Postgres example migration and every CLI journey test fixture gets re-scaffolded. If a factory or renderer bug regresses `ops.json` content, the attestation check catches it before merge — but investigating and fixing a drift takes real time.

### Scope

**Planner flip** (`planner.ts`): default `planningMode` changes from `'walk'` to `'issues'`. The flag remains, and the walk-schema code path remains reachable, for Phase 3 to fold in.

**CLI dispatch** (`cli/src/commands`):

- `migration-new.ts`: confirm behavior — `emptyMigration` already returns `MigrationPlanWithAuthoringSurface`; Postgres output matches the class-flow template.
- `migration-plan.ts`: remove the `if (strategy === 'descriptor')` branch. All targets go through `planner.plan(...).renderTypeScript()`.
- `migration-apply.ts`: confirm no change (reads `ops.json`, flow-agnostic).
- `migration-show.ts` / `migration-status.ts`: confirm no change.

**Example migrations** (`examples/**/migrations/`): for each Postgres-using example:

1. Regenerate the migration directory via `migration plan`.
2. Verify the new `migration.ts` is class-flow shape.
3. **Run the attestation script**: byte-compare the regenerated `ops.json` with the checked-in file. Fail the PR on any diff.
4. Verify `migrationId` in the regenerated `migration.json` matches the checked-in value.

**Integration tests**:

- Re-scaffold CLI journey fixtures in `test/integration/test/cli-journeys/schema-evolution-migrations.e2e.test.ts`. Update assertions against `migration.ts` content.
- Update CLI snapshot tests (`test/output.migration-commands.test.ts`) to reflect class-flow output.

**Live-DB e2e** (new): a Postgres integration test covering:

- Fresh migration with `createTable` + `dataTransform` + `addColumn`.
- First apply succeeds end-to-end.
- Re-apply is a no-op (idempotency).
- Generated `migration.ts` is directly re-runnable: `node migration.ts` produces identical `ops.json`.

### Validation

- `pnpm -r typecheck`, `pnpm -r lint`.
- All integration tests pass, including the new live-DB e2e.
- Attestation script passes: every example migration's `ops.json` is byte-identical before/after, `migrationId` is preserved.

### Risks

- **`migrationId` drift.** Primary risk. The attestation script is the hard gate — any diff blocks merge. If drift happens, it's a bug in a factory, strategy, or renderer; investigate with `diff <(jq -S < before/ops.json) <(jq -S < after/ops.json)` to locate.
- **Novel example corners.** Some examples may exercise code paths the strategy/default-mapping tests don't cover. Each discovered gap adds a test in Phase 1's test suite as part of the Phase 2 PR.

### Rollback

Revert the PR. Walk-schema returns as default, descriptor-flow CLI branches return, examples revert to descriptor-flow `migration.ts`. No data loss — example migrations' `ops.json` and `migration.json` are unchanged by rollback because the attestation gate guaranteed byte-identity.

## Phase 3 — Collapse the two planners

**Why after Phase 2?** Class-flow is live; `migration plan` works end-to-end; example migrations are re-scaffolded and attested. Now we can fold the walk-schema logic — the code that today serves `db update` — into the issue-based planner without risking the main `migration plan` flow.

**End state.** `planner-reconciliation.ts` is deleted. `planner.ts` is either deleted or reduced to a thin `PostgresMigrationPlanner` shell that wraps the issue-based pipeline. `planningMode: 'walk' | 'issues'` flag is removed. The planner has one code path.

### Scope

**Audit walk-schema logic**: categorize every branch in `planner-reconciliation.ts` (798 LOC) and `planner.ts`'s `buildDatabaseDependencyOperations`, `buildStorageTypeOperations`, `buildTableOperations` by which `SchemaIssue` kind(s) they handle.

**Absorb**: for each branch, either extend an existing strategy, add a new strategy, or extend the default mapping in `issue-planner.ts`. Branches that depend on information not currently in `SchemaIssue[]` require a local extension to `verifySqlSchema`'s output shape — a minor, localized contract change, not a planner bypass.

**Delete**: `planner-reconciliation.ts`. Reduce `planner.ts` to a thin shell (or delete it, moving `PostgresMigrationPlanner` into `issue-planner.ts`).

**Remove**: `planningMode` flag from `PostgresMigrationPlanner.plan()`.

### Validation

- `pnpm -r typecheck`, `pnpm -r lint`.
- Full integration + e2e pass.
- Attestation script passes (same gate as Phase 2).
- New strategy ordering tests: pin the strategy chain order; any reordering is a test failure until explicitly approved.

### Risks

- **`SchemaIssue` extensions.** If walk-schema absorption requires `verifySqlSchema` to emit additional issue metadata, that's a contract change with family-sql callers. Keep each such extension in its own commit so it's reviewable in isolation.
- **Strategy interaction.** Newly absorbed strategies may interact with existing ones (e.g. two strategies both claiming a `missing_column` issue). Pin ordering with tests.

### Rollback

Revert the PR; walk-schema planner returns.

## Phase 4 — Delete descriptor IR

**Why after Phase 3?** Every consumer of the descriptor IR is now going through the class-flow path. The descriptor code is dead weight and can be removed safely.

### Scope

**Postgres deletes**:

- `operation-descriptors.ts`
- `operation-resolver.ts` — thin `resolveX` wrappers from Phase 0 die; pure `createX` factories live on as `op-factories.ts`.
- `descriptor-planner.ts` (if not already renamed/merged into `issue-planner.ts` during Phase 1 or 3).
- `renderDescriptorTypeScript` function in `scaffolding.ts`.
- `MigrationDescriptorArraySchema` in `exports/migration.ts`.

**Framework deletes**:

- `OperationDescriptor` type in `framework-components/control-migration-types.ts`.
- `TargetMigrationsCapability` methods: `planWithDescriptors`, `resolveDescriptors`, `renderDescriptorTypeScript`.

**CLI deletes**:

- `migrationStrategy()` selector.
- `emitDescriptorFlow()`, `evaluateMigrationTs()`.
- Strategy branches in `migration-plan.ts`, `migration-emit.ts` (already dead post-Phase 2).
- Help formatters referring to descriptor-flow.

**Manifest**: remove `hints.planningStrategy` field. `migrationId` is unchanged (ADR 199 excludes `hints` from the id hash).

**Lint**: audit `scripts/lint-framework-target-imports.mjs` for references to descriptor symbols.

### Validation

- `pnpm -r typecheck`, `pnpm -r lint`.
- Grep sweep: zero matches for `OperationDescriptor`, `PostgresMigrationOpDescriptor`, `DataTransformDescriptor`, `planWithDescriptors`, `resolveDescriptors`, `renderDescriptorTypeScript`, `MigrationDescriptorArraySchema`, `evaluateMigrationTs`, `emitDescriptorFlow`, `migrationStrategy` under `packages/` and `test/`.
- Full integration + e2e pass.

### Rollback

Pure delete; revert restores.

## Phase 5 — Delete `migration emit` + `emit` capability

**Why last?** `migration emit` is used by test fixtures that hand-author `migration.ts` and emit after. Once those fixtures invoke `node migration.ts` directly (post-Phase 2), the CLI command is dead weight.

### Scope

**CLI deletes**:

- `packages/1-framework/3-tooling/cli/src/commands/migration-emit.ts`.
- `packages/1-framework/3-tooling/cli/src/lib/migration-emit.ts`.
- `migration emit` registration in `cli.ts`.

**Framework deletes**:

- `TargetMigrationsCapability.emit` interface method.
- `postgresEmit` source file and export.
- `mongoEmit` source file (`packages/2-mongo-family/9-family/src/core/mongo-emit.ts`) and its test.

**Audit**: CI and fixture scripts calling `migration emit`. Switch them to direct invocation.

**Docs**: update CLI help output and README.

### Validation

- `pnpm -r typecheck`, `pnpm -r lint`.
- CLI journey tests pass (`output.migration-commands.test.ts`, `migration-e2e.test.ts`) — no `migration emit` references.
- Full integration + e2e pass.

### Rollback

Pure delete; revert restores.

## Cross-cutting

### Validation policy

Every phase: `pnpm -r typecheck` + `pnpm -r lint` must pass. Phase 2 and later additionally require full integration + live-DB e2e. Mirrors PR #349's D/A/B/C stack policy.

### The attestation script

Pre-merge check run manually and in CI for any PR that touches migration planning or rendering:

```bash
# For every examples/**/migrations/<id>/:
#   1. Rename the directory aside
#   2. Run `migration plan` against the attested contract snapshots
#   3. Byte-compare the new ops.json against the original
#   4. Confirm migrationId on the new migration.json matches the original
# Any diff fails the check.
```

Script lives under `scripts/`, is referenced in the PR checklist for every phase from Phase 1 onward.

### Parallelization

- **Sequential**: 0 → 1 → 2. Each phase depends on the previous.
- **Internally parallel within Phase 1**: family-sql bases, postgres IR, renderers, strategy retargeting, issue-planner retargeting can be developed in parallel and merged as a single PR.
- **Parallel after Phase 2**: Phases 3, 4, and 5 touch largely disjoint files and can overlap, though the natural order is 3 → 4 → 5.

### Relationship to the Mongo sibling project

`projects/mongo-migration-authoring/` (completed via PR #349) established the class-flow template. This project ports the architecture to Postgres and folds in the issue-based diff layer that Mongo does not need — Mongo operates directly on the target contract, while Postgres requires structured diff-over-schema because the live-DB schema can drift from the contract in ways the migration must reconcile.

Mongo-side changes in this project are limited to Phase 5 deletions (`mongoEmit`, `TargetMigrationsCapability.emit`). No Mongo planner, factory, or renderer changes.

### Risk register

| Risk | Primary phase | Mitigation |
|---|---|---|
| `migrationId` drift on example migrations | 2, 3 | Attestation script blocks merge on any byte diff |
| Strategy exhaustiveness regression | 1 | Rewrite existing strategy tests against the new `OpFactoryCall` emission; confirm parity |
| Walk-schema absorption misses a corner | 3 | Live-DB e2e covers each schema-change shape; pin strategy ordering with unit tests |
| Visitor drift (new factory, visitor not updated) | all | `satisfies PostgresOpFactoryCallVisitor<R>` on every visitor → compile-time error |
| Phase 1 regressions leak into CLI | 1 | `planningMode` default stays `'walk'` in Phase 1; CLI keeps descriptor-flow until Phase 2 |
| CI fixture reliance on `migration emit` | 5 | Phase 5 audits CI scripts before delete; fixtures switch to direct invocation ahead of merge |

## Known follow-ups

These items are explicitly out of scope for this project but fall out naturally once it lands. Each is a self-contained future PR.

### Cross-target consolidation of the renderable-migration class

Once Postgres ships `TypeScriptRenderablePostgresMigration`, the codebase has two structurally identical implementations of the same concept (Mongo's `PlannerProducedMongoMigration` and Postgres's `TypeScriptRenderablePostgresMigration`). Both:

- extend `Migration<TOp>` with a target-bound `TOp`,
- implement `MigrationPlanWithAuthoringSurface<TOp>`,
- hold `readonly calls: readonly TCall[]` where `TCall extends OpFactoryCall`,
- inject `renderOps` and `renderCallsToTypeScript` callables via the constructor,
- delegate `operations` and `renderTypeScript()` to those injected functions.

The follow-up:

1. Lift a `TypeScriptRenderableMigration<TCall extends OpFactoryCall, TOp>` generic class into `framework-components`.
2. Retrofit Mongo: `class PlannerProducedMongoMigration extends TypeScriptRenderableMigration<MongoOpFactoryCall, MongoMigrationPlanOperation>` (or a type alias). Rename to `TypeScriptRenderableMongoMigration` for naming parity.
3. Retrofit Postgres: same treatment for `TypeScriptRenderablePostgresMigration`.
4. Add explicit `implements OpFactoryCall` annotations on Mongo's existing concrete call classes (currently they satisfy the interface structurally without an explicit annotation).

This is a purely structural refactor — no behavior change, no ADR change, no `migrationId` impact. It's deferred until both targets exist because lifting an abstraction with one concrete consumer is premature; lifting with two is justified.

## References

- Spec: [`spec.md`](./spec.md)
- [ADR 193 — Class-flow as the canonical migration authoring strategy](../../docs/architecture%20docs/adrs/ADR%20193%20-%20Class-flow%20as%20the%20canonical%20migration%20authoring%20strategy.md)
- [ADR 194 — Plans carry their own authoring surface](../../docs/architecture%20docs/adrs/ADR%20194%20-%20Plans%20carry%20their%20own%20authoring%20surface.md)
- [ADR 195 — Planner IR with two renderers](../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md)
- [ADR 196 — In-process emit for class-flow targets](../../docs/architecture%20docs/adrs/ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md)
- [ADR 199 — Storage-only migration identity](../../docs/architecture%20docs/adrs/ADR%20199%20-%20Storage-only%20migration%20identity.md)
- [ADR 200 — Placeholder utility for scaffolded migration slots](../../docs/architecture%20docs/adrs/ADR%20200%20-%20Placeholder%20utility%20for%20scaffolded%20migration%20slots.md)
- Sibling project: [`projects/mongo-migration-authoring/`](../mongo-migration-authoring/)
