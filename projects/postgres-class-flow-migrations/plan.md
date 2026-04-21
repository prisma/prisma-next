# Postgres class-flow migrations — Plan

This plan describes how we execute the [spec](./spec.md) — the phases, their ordering rationale, the risks, and the acceptance gates. See [`pr-plan.md`](./pr-plan.md) for how the phases map onto pull requests.

## Detailed task specs

Several work items have their own task spec under `projects/postgres-class-flow-migrations/specs/`. The implementer should read the relevant task spec before starting the corresponding phase. When a phase has no linked task spec, the phase section in this document is authoritative.

| Task | Task spec | Consumed by |
|---|---|---|
| Walk-schema audit (categorize every walk branch by `SchemaIssue` kind) | [`specs/walk-schema-audit.spec.md`](./specs/walk-schema-audit.spec.md) | Phase 1 (input), Phase 4 (input) |
| Phase 0 — pure factory extraction | [`specs/phase-0-factory-extraction.spec.md`](./specs/phase-0-factory-extraction.spec.md) | Phase 0 |
| Phase 1 — walk-schema planner → class-flow IR | [`specs/phase-1-walk-schema-class-flow.spec.md`](./specs/phase-1-walk-schema-class-flow.spec.md) | Phase 1 |

Phases 2, 3, 4, 5, 6 are covered at the granularity in this document; add a task spec if a maker discovers the granularity here is insufficient.

## Critical risk up front

**Schema equivalence is the invariant.** The goal is that every example migration continues to produce the schema its target contract expects. It is **not** a goal that `ops.json` stays byte-identical or that `migrationId` hashes stay stable. During Phase 3 we re-scaffold example migrations; the regenerated `ops.json` may differ from what's committed today, and the new `migrationId` values are free to change.

The safety net is already in place: the Postgres runner's post-apply `verifySqlSchema` check fails the apply if the live schema doesn't match the target contract. Phase 3's PR exercises this per example by applying each regenerated example migration against a fresh Postgres and asserting the runner accepts it. Existing CLI journey tests (`test/integration/test/cli-journeys/*.e2e.test.ts`) exercise the same planner / renderer / runner codepaths on fixture contracts and are the standing regression net.

`migrationId` is computed by the existing `computeMigrationId` in `packages/1-framework/3-tooling/migration/src/attestation.ts`; that module is untouched by this project.

## Where we're going

By the end of the project, the framework gains an `OpFactoryCall` interface and the Postgres target hosts the concrete call classes, factories, renderers, and migration wrapper:

```
packages/1-framework/1-core/framework-components/src/
└── control-migration-types.ts  # + OpFactoryCall interface { factory, operationClass, label }

packages/3-targets/3-targets/postgres/src/core/migrations/
├── migration-ts-expression.ts  # abstract MigrationTsExpression (internal)
├── placeholder-expression.ts   # PlaceholderExpression (scaffolded dataTransform body)
├── op-factory-call.ts       # PostgresOpFactoryCall concrete classes (each implements OpFactoryCall) + visitor interface
├── op-factories.ts          # Pure createX(...literalArgs) functions
├── render-ops.ts            # renderOps visitor (PostgresOpFactoryCall[] → operations)
├── render-typescript.ts     # renderCallsToTypeScript polymorphic walk (PostgresOpFactoryCall[] → migration.ts source)
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

No SQL-family base class is added for the IR: `family-sql` ships no `SqlOpFactoryCallBase` and no `PlannerProducedSqlMigration`. The `OpFactoryCall` interface is lifted directly to the framework so any future target (SQL or otherwise) can reuse it without going through a family layer. (What family-SQL *does* ship is a thin `SqlMigration<TDetails>` alias that binds `Migration`'s `TOp` to `SqlMigrationPlanOperation<TDetails>` — a convenience for target-side concrete migration classes; see Phase 1.) The Postgres target uses two internal abstract base classes inside `core/migrations/` to share plumbing across the concrete call classes. The outer one, `MigrationTsExpression`, is the root of the TypeScript-renderable AST (`renderTypeScript()` + `importRequirements()`) and is also extended by `PlaceholderExpression`, the scaffolded `dataTransform` body. The inner one, `PostgresOpFactoryCallNode`, adds the visitor `accept()` plus the `OpFactoryCall` slots. Both are private to the Postgres package: not exported, not referenced in cross-package signatures, not visible to non-Postgres consumers. Mongo receives a structurally identical hierarchy in Phase 1 (its existing `OpFactoryCallNode` is extended to `implements OpFactoryCall` and `extends MigrationTsExpression`, with its own package-private `MigrationTsExpression`) so the two targets stay aligned; cross-target lift of these abstractions to the framework is a known follow-up.

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
| `OpFactoryCall` | **Interface, framework-level** (`{ factory, operationClass, label }`). Concrete call classes (`CreateTableCall`, `DataTransformCall`, …) implement it. The framework ships no abstract base class. | ADR 195, `framework-components/control-migration-types.ts` |
| `MigrationTsExpression` | **Internal** abstract base class. Root of the target's IR expression hierarchy: any node renderable as a TypeScript expression in the generated `migration.ts` extends it and supplies `renderTypeScript(): string` plus `importRequirements(): readonly ImportRequirement[]`. Each target carries its own package-private copy (Postgres and Mongo are byte-compatible siblings); a cross-target lift to the framework is a known follow-up. Not exported, not in any cross-package signature. | `packages/3-targets/3-targets/postgres/src/core/migrations/migration-ts-expression.ts`; sibling at `packages/3-mongo-target/1-mongo-target/src/core/migration-ts-expression.ts` |
| `PostgresOpFactoryCallNode` / Mongo's `OpFactoryCallNode` | **Internal** abstract base class. Extends `MigrationTsExpression` and implements `OpFactoryCall`; adds visitor `accept()` for each target's runtime-op dispatch. Shared plumbing for every concrete call class. Both targets use the same structural shape. Not exported. | Postgres: `core/migrations/op-factory-call.ts`; Mongo: `core/op-factory-call.ts` |
| `PlaceholderExpression` | Concrete `MigrationTsExpression`. Represents a planner-generated stub for a `dataTransform` `check` or `run` body. `renderTypeScript()` returns `() => placeholder("slot")`; `importRequirements()` declares `placeholder` from `@prisma-next/errors/migration`. Not a member of the `PostgresOpFactoryCall` union — it appears only inside `DataTransformCall`. | `packages/3-targets/3-targets/postgres/src/core/migrations/placeholder-expression.ts`, ADR 200 |
| Concrete call class | Frozen class representing a single factory call (e.g. `CreateTableCall`, `DataTransformCall`) with literal args + planner-derived label/class. Discriminated union per target. Extends `PostgresOpFactoryCallNode` (Postgres) or `OpFactoryCallNode` (Mongo); satisfies `OpFactoryCall`. Postgres call classes implement `renderTypeScript()` / `importRequirements()` in addition to `accept()`. `DataTransformCall` holds `check: MigrationTsExpression` and `run: MigrationTsExpression`. | ADR 195, `op-factory-call.ts` |
| `PostgresOpFactoryCallVisitor<R>` | `interface { createTable(c: CreateTableCall): R; … }`. Used by `renderOps` for compile-time-exhaustive dispatch over the `PostgresOpFactoryCall` union. | ADR 195 |
| `renderOps` | Visitor over the `PostgresOpFactoryCall` union; each case invokes the corresponding pure factory. The `dataTransform` case routes `check` / `run` through a local `bodyToClosure(expr)` helper, which returns `() => placeholder(slot)` for `PlaceholderExpression`. | ADR 195, `render-ops.ts` |
| `renderCallsToTypeScript` | Polymorphic (non-visitor) traversal of `PostgresOpFactoryCall[]`; calls each node's `renderTypeScript()` / `importRequirements()` directly, recurses into `DataTransformCall` children, deduplicates the import list, and composes the final `migration.ts` source. | ADR 195, `render-typescript.ts` |
| Pure factory | Function `(literalArgs) => SqlMigrationPlanOperation`. No context, no contract lookup, no codec hooks. | ADR 195 |
| `TypeScriptRenderablePostgresMigration` | Postgres-specific concrete class. Extends `SqlMigration<PostgresPlanTargetDetails>` (the family-SQL alias), implements `MigrationPlanWithAuthoringSurface<SqlMigrationPlanOperation<PostgresPlanTargetDetails>>`. Holds `readonly calls: readonly PostgresOpFactoryCall[]`. `operations` delegates to `renderOps`; `renderTypeScript()` delegates to `renderCallsToTypeScript`. Sibling of Mongo's `PlannerProducedMongoMigration`; consolidation candidate for a follow-up project. | `planner-produced-postgres-migration.ts` |
| `SchemaIssue` | Normalized diff record (e.g. `{ kind: 'missing_column', table, column, expected, actual }`). Output of `verifySqlSchema`. | `family-sql/schema-verify` |
| `MigrationStrategy` | `(issues, ctx) => { kind: 'match'; calls: OpFactoryCall[] } \| { kind: 'no_match' }`. Pattern-matches recognized issues, emits multi-op recipes. | `strategies.ts` |
| Placeholder slot | The string label on a `PlaceholderExpression`, carried end-to-end from planner construction, through the rendered `() => placeholder("slot")` in `migration.ts`, to the runtime `errorUnfilledPlaceholder(slot)` thrown if anything invokes an unfilled slot. There is no `stub: boolean` flag on `DataTransformCall`; "is this slot a stub?" reduces to "is this body a `PlaceholderExpression`?". | ADR 200, `@prisma-next/errors/migration` |
| `Migration.run(import.meta.url, M)` | Static entrypoint. Dynamically imports the migration module, constructs the migration, emits `ops.json` + `migration.json` to disk. Only sanctioned emit driver post-project. When a migration contains unfilled placeholders, `instance.operations` throws `errorUnfilledPlaceholder` and `Migration.run` cannot produce the two derived artifacts — that's Option B in Phase 3. | ADR 196 |

## Phases at a glance

Seven phases. Phase 0 prepares pure factories. Phase 1 retargets the **walk-schema** planner (the planner that backs `db update`) to produce class-flow IR — this proves the IR mechanics with the lowest blast radius because the walk-schema planner is **not** wired into `migration plan` today, so the CLI is unaffected. Phase 2 retargets the **issue planner** (the planner `migration plan` actually uses) to produce class-flow IR — at that point the strategies and `dataTransform(stub)` scaffolding light up. Phase 3 flips `migration plan` to call the class-flow path. Phases 4–6 fold the two planners together and delete the descriptor scaffolding.

| Phase | Theme | Shape | Blast radius |
|---|---|---|---|
| **0. Code motion** | Factor `operation-resolver` into pure factories | Internal refactor, descriptor flow unchanged | Low |
| **1. Walk-schema → class-flow IR** | Lift `OpFactoryCall` interface to framework; add Postgres concrete call classes + renderers; retarget the **walk-schema planner** (`createPostgresMigrationPlanner.plan()`) to build `OpFactoryCall[]` internally and run them through `renderOps`. CLI untouched — `db update` exercises the new path through its existing integration tests. | Additive; descriptor flow and `migration plan` wiring untouched | Low |
| **2. Issue planner → class-flow IR** | Retarget the **issue planner** (`planDescriptors` → `planCalls`); strategies emit `OpFactoryCall[]`; data-safety scaffolding (`DataTransformCall` with `PlaceholderExpression` bodies) lights up. `renderCallsToTypeScript` is wired through `MigrationPlanWithAuthoringSurface`. CLI still on descriptor branch. | Additive; needs new exhaustive tests for strategies under the new IR | Medium |
| **3. Flip `migration plan` to class-flow** | Switch the `migrationStrategy` selector for Postgres from descriptor to class-based; re-scaffold every `examples/**/migrations/*/`; each re-scaffolded example is apply/verified against a fresh Postgres as part of the PR. | User-visible — the one "switch the lights" moment | High |
| **4. Collapse the two planners** | Fold walk-schema logic into the issue planner (or vice versa); delete `planner-reconciliation.ts`; reduce or delete `planner.ts` | Internal, planner-only | Medium |
| **5. Delete descriptor IR** | Remove `OperationDescriptor`, capability methods, CLI branches | Cross-package delete | Medium |
| **6. Delete `migration emit`** | Remove CLI command + `emit` capability + `postgresEmit` / `mongoEmit` | CLI + framework | Low |

Phases 0–3 are load-bearing and sequential. Phases 4–6 are cleanup and can be reordered or combined pragmatically; the plan presents them in their natural order.

## Spec-requirement to phase mapping

| Requirement | Phases | Notes |
|---|---|---|
| R1.1–R1.3 (`migration new` produces class-flow file) | 2, 3 | Phase 2 makes `emptyMigration` return a class-flow renderable; Phase 3 makes `migration new` use it |
| R2.1–R2.6 (issue-based planner with strategies, materialization at call-construction) | 2 | Strategies retargeted to emit `OpFactoryCall[]` directly |
| R2.7–R2.9 (`TypeScriptRenderablePostgresMigration`, two renderers, `PlaceholderExpression` bodies) | 1, 2 | Phase 1 introduces the renderable-migration class, the two renderers, `MigrationTsExpression` / `PlaceholderExpression`, using walk-schema output; Phase 2 reuses them under the issue planner when emitting `DataTransformCall` stubs |
| R2.11 (CLI skips `ops.json` + `migration.json` on placeholder throw) | 3 | `migration plan` catches `errorUnfilledPlaceholder` at serialization; only `migration.ts` is written when placeholders are present |
| R2.10 (single planner) | 4 | Planner consolidation |
| R3.1–R3.3 (pure factories, visitor discipline, module-scope query builder) | 0, 1 | Phase 0 creates pure factories; Phase 1 wires the visitor surface |
| R4.1–R4.3 (unchanged wire format, unchanged runner) | all | Schema-equivalence invariant; runner's post-apply `verifySqlSchema` enforces per-example at Phase 3 |
| Removal acceptance criteria | 5, 6 | |

## Phase 0 — Code motion: pure factory extraction

**Why first?** Phase 1 needs the pure factories to exist. Doing this as a first, isolated refactor de-risks Phase 1: when we introduce `OpFactoryCall` classes whose constructors take the same args as the factories, we can be confident the factories already work correctly because they're covered by today's descriptor-flow tests.

**Why safe?** The refactor is strictly internal to `operation-resolver.ts` (929 LOC) and is behavior-preserving. Descriptor flow continues to work identically because we leave thin `resolveX(descriptor, context)` wrappers that extract literal args and delegate to the pure `createX`.

### Scope

`packages/3-targets/3-targets/postgres/src/core/migrations/operation-resolver.ts` is refactored in place:

- Every `resolveX(descriptor, context)` is split into:
  - `createX(...literalArgs): SqlMigrationPlanOperation<PostgresPlanTargetDetails>` — pure, no `OperationResolverContext`, no codec hooks, no `db` handle.
  - `resolveX(descriptor, context)` — thin wrapper that performs context-dependent materialization (contract lookup, codec expansion, schema qualification, default rendering) from descriptor + context, then calls `createX`.
- Pure factories are extracted into a new file, `op-factories.ts`, so they survive descriptor deletion in Phase 5.
- **One-to-many resolvers split into multiple pure factories.** Where today's `resolveCreateDependency` expands one descriptor into create-extension + create-schema + create-enum-type ops, Phase 0 produces *separate* pure factories `createExtension`, `createSchema`, `createEnumType` and the wrapper fans the descriptor out into N `createX` calls. **Each pure factory returns exactly one `SqlMigrationPlanOperation`** — no factory returns an array. This is what lets Phase 1's `OpFactoryCall` mapping be 1:1 (one factory → one call class) and keeps the eventual class-flow `migration.ts` unambiguous: every line in `plan()` corresponds to exactly one operation.
- **`dataTransform` is extracted untouched.** The pure `createDataTransform(label, check, run, operationClass?)` factory takes plain `check` / `run` closures. The thin `resolveDataTransform` wrapper preserves today's `TODO`-sentinel behavior by constructing a user-equivalent closure (`() => placeholder(slot)` via the existing `placeholder` helper in `@prisma-next/errors/migration`). No new helpers are added in this phase; the `PlaceholderExpression` AST node that replaces this closure-based scaffolding is a Phase 1 introduction. Detail in `projects/postgres-class-flow-migrations/specs/phase-0-factory-extraction.spec.md`.

### Validation

- `pnpm -r typecheck`, `pnpm -r lint`.
- All Postgres package tests pass unchanged.
- Integration test `schema-evolution-migrations.e2e.test.ts` passes unchanged.

### Rollback

Phase 0 is a behavior-preserving internal refactor. Revert the PR if tests fail.

## Phase 1 — Walk-schema planner → class-flow IR

**Why this is Phase 1, not the issue planner.** The walk-schema planner (`createPostgresMigrationPlanner.plan(...)` in `planner.ts` + `planner-reconciliation.ts`, ~1,700 LOC combined) is **not** wired into `migration plan` today — it backs `db update` only. `migration plan` for Postgres goes through `migrations.planWithDescriptors → planDescriptors → renderDescriptorTypeScript → resolveDescriptors`, a separate issue-based pipeline (`descriptor-planner.ts`, 464 LOC). Retargeting the walk-schema planner first lets us prove the entire class-flow IR (`OpFactoryCall` interface, concrete call classes, visitor renderers, the renderable-migration class) using the existing rich test coverage for `createPostgresMigrationPlanner` (`planner.integration.test.ts`, `planner.behavior.test.ts`, `planner.storage-types.integration.test.ts`, `planner.reconciliation.integration.test.ts`) — without touching the CLI's `migration plan` flow at all. `db update` remains the live integration coverage for the new path.

**Why additive?** Descriptor-flow code continues to back `migration plan` through all of Phase 1. The walk-schema planner now builds `OpFactoryCall[]` internally and runs them through `renderOps` to produce its existing `SqlMigrationPlanOperation[]` output — its external API is unchanged, `db update` is unchanged. Issue planner and `migration plan` wiring are untouched until Phase 2 / Phase 3.

### Scope

**Framework lift** (`packages/1-framework/1-core/framework-components/src/control-migration-types.ts`):

- Add `OpFactoryCall` interface: `{ readonly factory: string; readonly operationClass: MigrationOperationClass; readonly label: string }`. Re-exported through `framework-components`'s control entrypoint. No abstract base class at framework or family level.
- Rationale: the structural shape is identical across targets (Mongo, Postgres, anything future). Lifting now means consumer-facing type positions (renderer signatures, planner returns, visitor inputs) reference a single framework-level interface rather than a target-specific or family-specific abstraction.

**Mongo IR sync** (`packages/3-mongo-target/1-mongo-target/src/core/`):

Mongo and Postgres ship the same IR shape — the abstract-expression hierarchy introduced for Postgres is applied to Mongo in this phase too, so the two targets don't drift. Mongo has no planner-emitted `dataTransform` (its planner only produces collection / index ops), so `PlaceholderExpression` has no Mongo counterpart; the hierarchy remains open to future variants.

- `migration-ts-expression.ts` (new) — internal abstract base `MigrationTsExpression` (private; structurally identical to the Postgres sibling). Declares `renderTypeScript(): string` and `importRequirements(): readonly ImportRequirement[]`. Not exported, not referenced outside the Mongo package.
- `op-factory-call.ts` — `OpFactoryCallNode` gains `extends MigrationTsExpression` (adding the two abstract methods) and `implements OpFactoryCall` (framework-level interface). Each of the five concrete call classes (`CreateIndexCall`, `DropIndexCall`, `CreateCollectionCall`, `DropCollectionCall`, `CollModCall`) grows `renderTypeScript()` and `importRequirements()` polymorphic methods. The `OpFactoryCallVisitor<R>` interface stays — still used by the runtime-op side (`renderOpsToMongoCommands` / `mongo-emit`).
- `render-typescript.ts` — `renderCallsToTypeScript` switches from the existing visitor implementation to a polymorphic walk: `calls.map((c) => c.renderTypeScript())` for the body, and `calls.flatMap((c) => c.importRequirements())` + dedupe for the import block. The hand-rolled `collectFactoryNames` + `buildImports` helpers are deleted. Output format is preserved byte-for-byte — existing Mongo render-typescript snapshot tests are the regression net.
- No change to `planner-produced-migration.ts` (Mongo's `PlannerProducedMongoMigration` is unaffected; it only wires `renderCallsToTypeScript` through). No change to `mongoEmit` or the Mongo planner.

Rationale: the Postgres IR introduces the abstract-expression / polymorphic-render pattern for a concrete reason (`DataTransformCall` needs expression children, which polymorphism handles more cleanly than a second visitor). Landing the same shape in Mongo at the same time means the two targets converge rather than diverge, and the follow-up cross-target consolidation (see §"Known follow-ups") becomes a pure lift rather than a harmonize-then-lift.

**Family-SQL abstractions** (`packages/2-sql/9-family`):

- Add only the `Migration` alias bound to `SqlMigrationPlanOperation<PostgresPlanTargetDetails>`-shaped operations, mirroring `@prisma-next/target-mongo/migration`. Concrete details remain target-specific; Postgres re-exports its own bound alias.
- No `SqlOpFactoryCallBase`. No `PlannerProducedSqlMigration<TCall>`. The framework-level `OpFactoryCall` interface and the target-specific concrete migration class are the only abstractions involved.

**Postgres IR** (`packages/3-targets/3-targets/postgres/src/core/migrations`):

- `migration-ts-expression.ts` — internal abstract base `MigrationTsExpression` (private). Declares `renderTypeScript(): string` and `importRequirements(): readonly ImportRequirement[]`. Common root for everything the TypeScript renderer walks: concrete call classes and `PlaceholderExpression`.
- `placeholder-expression.ts` — concrete `PlaceholderExpression extends MigrationTsExpression`. Holds a `readonly slot: string`; `renderTypeScript()` returns `() => placeholder("slot")`; `importRequirements()` declares the `placeholder` import. Not a member of the `PostgresOpFactoryCall` union.
- `op-factory-call.ts` — internal abstract base `PostgresOpFactoryCallNode extends MigrationTsExpression` and `implements OpFactoryCall` (private; mirrors Mongo's `OpFactoryCallNode`), plus the `PostgresOpFactoryCall` discriminated union. One frozen class per factory: `CreateTableCall`, `DropTableCall`, `AddColumnCall`, `DropColumnCall`, `AlterColumnTypeCall`, `SetNotNullCall`, `DropNotNullCall`, `SetDefaultCall`, `DropDefaultCall`, `AddPrimaryKeyCall`, `AddForeignKeyCall`, `AddUniqueCall`, `CreateIndexCall`, `DropIndexCall`, `DropConstraintCall`, `CreateEnumTypeCall`, `AddEnumValuesCall`, `DropEnumTypeCall`, `RenameTypeCall`, `CreateExtensionCall`, `DataTransformCall`. Each extends the internal base, implements `accept()` for the `renderOps` visitor and `renderTypeScript()` / `importRequirements()` for the polymorphic TypeScript walk. Constructor args mirror Phase 0 factory signatures 1:1, except `DataTransformCall.check` / `DataTransformCall.run` which are typed `MigrationTsExpression`.
- `PostgresOpFactoryCallVisitor<R>` interface with one method per variant. Used only by `renderOps`.
- `render-ops.ts` — `renderOps(calls)` visitor; dispatches each call to its factory. The `dataTransform` case routes `check` / `run` through a local `bodyToClosure(expr)` helper, which returns `() => placeholder(slot)` for `PlaceholderExpression`. Invoking that closure throws `errorUnfilledPlaceholder(slot)` (`PN-MIG-2001`); the factory's closure-invocation during op materialization propagates the throw out through `instance.operations`. This is the asymmetry Option B in Phase 3 depends on.
- `render-typescript.ts` — `renderCallsToTypeScript(calls, meta)` polymorphic function (not a visitor); walks the node array, calls each node's `renderTypeScript()` / `importRequirements()`, deduplicates the import list, and composes the module source. (Used in this phase only by tests; Phase 3 wires it into `migration plan`.)
- `planner-produced-postgres-migration.ts` (named to match Mongo's `planner-produced-migration.ts`) — `TypeScriptRenderablePostgresMigration` concrete class extending the family-SQL `SqlMigration<PostgresPlanTargetDetails>` alias and implementing `MigrationPlanWithAuthoringSurface<SqlMigrationPlanOperation<PostgresPlanTargetDetails>>`. Holds `readonly calls: readonly PostgresOpFactoryCall[]`; `operations` delegates to `renderOps`; `renderTypeScript()` delegates to `renderCallsToTypeScript`. For placeholder-bearing plans, `operations` throws via `renderOps`; `renderTypeScript()` always succeeds.

**Walk-schema planner retargeting** (`planner.ts` + `planner-reconciliation.ts`):

- Every site in walk-schema that today constructs a `SqlMigrationPlanOperation` directly (or via the `operation-resolver.ts` pure factories from Phase 0) is rewritten to construct a `PostgresOpFactoryCall` instead. The planner accumulates a `PostgresOpFactoryCall[]`.
- `createPostgresMigrationPlanner.plan()` invokes `renderOps(calls)` at the end to produce its existing `SqlMigrationPlanOperation[]` output. The planner's external `MigrationPlannerResult` shape is unchanged. `db update` is unchanged.
- The empty-plan path (`emptyMigration`) returns a `TypeScriptRenderablePostgresMigration` with empty `calls` (the only consumer of `renderTypeScript()` in this phase). `migration new` continues to use the descriptor-flow path because `migrations.resolveDescriptors` is still present, so the strategy selector still chooses `descriptor`; the empty-plan TypeScript output is exercised by unit tests.

**No issue-planner work in this phase.** `descriptor-planner.ts`, `planner-strategies.ts`, `planWithDescriptors`, `resolveDescriptors`, and `renderDescriptorTypeScript` are all untouched.

### Validation

- `pnpm -r typecheck`, `pnpm -r lint`.
- Unit tests per `OpFactoryCall` class (literal-arg preservation, frozen-instance behavior, `accept()` dispatch).
- Visitor tests: every `renderOps` and `renderCallsToTypeScript` case.
- Existing walk-schema integration tests pass unchanged (`planner.integration.test.ts`, `planner.behavior.test.ts`, `planner.storage-types.integration.test.ts`, `planner.reconciliation.integration.test.ts`).
- `TypeScriptRenderablePostgresMigration` unit test: construct with a fixed call list, verify `operations` round-trips through `renderOps`, verify `renderTypeScript()` emits parseable TypeScript whose dynamic import reconstructs the same call list.
- Mongo regression net: all existing Mongo `render-typescript` and `op-factory-call` unit / snapshot tests pass unchanged after the polymorphic rewrite (byte-identical output required). Mongo `migration plan` e2e for an empty scaffold and a non-empty planned migration unchanged.
- `db update` end-to-end smoke (existing tests).
- Full existing descriptor-flow `migration plan` e2e still passes (descriptor path is untouched).

### Risks

- **Exhaustiveness drift.** Adding a new factory must be a three-site change. Enforce with `satisfies PostgresOpFactoryCallVisitor<R>` on every visitor so skipping a case is a TypeScript error.
- **Walk-schema → call mapping completeness.** Walk-schema constructs ops via paths that aren't all covered by the Phase 0 factories (e.g. inline lookups in `buildTableOperations`). Phase 1 may need to either (a) call additional Phase 0 factories that turn out to be needed, or (b) introduce a small number of additional `createX` factories. Either is fine — the test net catches the regression. Detail in `projects/postgres-class-flow-migrations/specs/phase-1-walk-schema-class-flow.spec.md`.
- **Scope creep into Phase 2.** Resist folding the issue planner into this phase. Phase 2 owns that retargeting.

### Rollback

Phase 1 is additive. Revert deletes the new files and the class-flow code paths; the descriptor flow and the walk-schema planner's external API are untouched.

## Phase 2 — Issue planner → class-flow IR

**Why now?** Phase 1 proved the IR mechanics. Phase 2 retargets the issue-based pipeline (the one `migration plan` uses today via descriptors) to construct `OpFactoryCall[]` and produce a `TypeScriptRenderablePostgresMigration`. The data-safety strategies (NOT-NULL backfill, unsafe type change, nullable tightening, enum rebuild) emit `DataTransformCall` instances whose `check` and `run` are `PlaceholderExpression`s here.

**Why additive?** `migration plan` still goes through the descriptor branch of `migrationStrategy` until Phase 3. Phase 2 stands up the alternative path; Phase 3 flips the switch. The two paths do not need to produce byte-identical output — schema equivalence is the invariant (see §"Critical risk up front"). Phase 2's per-strategy tests assert each strategy emits *a* valid operation recipe that applies cleanly; the exact `ops.json` bytes may differ from the descriptor-flow recipe and that's fine.

### Scope

**Retargeted strategies** (`strategies.ts`, evolved from today's `planner-strategies.ts`):

- Strategy signature changes from `(issues, ctx) => { ops: Descriptor[] }` to `(issues, ctx) => { kind: 'match'; issues; calls: PostgresOpFactoryCall[] } | { kind: 'no_match' }`.
- `StrategyContext` expands to `{ toContract, fromContract, schemaName, codecHooks }` so strategies fully materialize literal args at call-construction time.
- Each of `notNullBackfillStrategy`, `typeChangeStrategy`, `nullableTighteningStrategy`, `enumChangeStrategy` is rewritten to construct `OpFactoryCall` instances. Pattern-matching logic preserved verbatim.
- Strategies that emit a stub `DataTransformCall` construct it with `check` and `run` set to `new PlaceholderExpression(slot)` (introduced in Phase 1). The `slot` string is preserved in the rendered TypeScript output and in the runtime `errorUnfilledPlaceholder` thrown if anything invokes an unfilled slot.
- `enumRebuildRecipe` emits `CreateEnumTypeCall + AlterColumnTypeCall + DropEnumTypeCall + RenameTypeCall`, wrapped by a `DataTransformCall` step.

**Retargeted issue planner** (`issue-planner.ts`, evolved from `descriptor-planner.ts`):

- Dispatch skeleton preserved: strategy chain → sort residual issues by dependency order → default issue-to-call mapping → phased concat (deps, drops, tables, columns, patterns, alters, constraints).
- `mapIssue(issue, ctx)` returns `PostgresOpFactoryCall[]` instead of descriptors.
- `planCalls(options)` replaces `planDescriptors`; returns `{ ok: true; calls } | { ok: false; conflicts }`.

**New capability hook** (`exports/control.ts`):

- `migrations.emit = postgresEmit` (transitional; deleted in Phase 6). Mirrors `mongoEmit`. Necessary so that once Phase 3 flips `migrationStrategy` to `'class-based'`, the `emit` capability is present.
- `migrations.planWithDescriptors`, `migrations.resolveDescriptors`, `migrations.renderDescriptorTypeScript` remain — for now Phase 2 keeps both flows valid; the strategy selector still picks descriptor because `resolveDescriptors` is present. Phase 3 removes `resolveDescriptors` from the capability registration so the selector picks `'class-based'`.

### Validation

- `pnpm -r typecheck`, `pnpm -r lint`.
- Strategy tests: existing strategy tests ported to assert `OpFactoryCall[]` emission for each of the four data-safety scenarios.
- New: `planCalls` unit tests covering the same scenarios as today's `planDescriptors` tests.
- New: end-to-end test that calls `planCalls` → `renderCallsToTypeScript` → dynamic import → `Migration.run` → apply against a fresh Postgres → assert the runner's post-apply `verifySqlSchema` check passes for each of the four data-safety scenarios. Schema-equivalence, not byte-equivalence, is what's asserted.
- Full existing descriptor-flow `migration plan` e2e still passes.

### Risks

- **Strategy emission correctness.** A retargeted strategy might produce an incorrect recipe (missing a step, wrong ordering, wrong operation class). Drift from descriptor-flow *output* is not itself a bug — the two pipelines can produce different-but-equivalent recipes. Mitigation: each strategy has an apply/verify test that runs the emitted recipe against a fresh Postgres and asserts the live schema matches the target contract.
- **`StrategyContext` field plumbing.** Today's strategies access codec hooks through `OperationResolverContext` at descriptor-resolution time. Class-flow strategies need codec hooks at call-construction time. The expanded `StrategyContext` is the seam.

### Rollback

Phase 2 is additive. Revert deletes the new files and the class-flow strategy / planner code; the descriptor flow continues to back `migration plan`.

## Phase 3 — Flip `migration plan` to class-flow

**Why after Phase 2?** The class-flow machinery exists and passes its own tests; the issue planner has a class-flow path that's been apply/verified against a fresh Postgres for the data-safety scenarios. Now we point the CLI at it. This is a behavior change, so it lands in its own PR with the example-migration apply/verify gate.

**Why the risk?** This is the "switch the lights" moment. Every Postgres example migration and every CLI journey test fixture gets re-scaffolded. The regenerated `migration.ts` files replace the committed ones; their `ops.json` and `migrationId` values change. That's expected — the merge gate is that each re-scaffolded example applies cleanly against a fresh Postgres and the runner's post-apply verify passes.

### Scope

**Capability flip** (`packages/3-targets/3-targets/postgres/src/exports/control.ts`):

- Remove `migrations.resolveDescriptors`. (`emit` from Phase 2 stays.) `migrationStrategy(migrations, 'postgres')` now returns `'class-based'`.
- Optional: also remove `migrations.planWithDescriptors` and `migrations.renderDescriptorTypeScript` here, OR defer to Phase 5; either is fine because nothing reads them once `resolveDescriptors` is gone. Recommend deferring to Phase 5 to keep this PR's diff focused on the strategy flip.

**CLI dispatch** (`packages/1-framework/3-tooling/cli/src`):

- `commands/migration-new.ts`: confirm behavior — `emptyMigration` already returns `MigrationPlanWithAuthoringSurface`; Postgres output now matches the class-flow template (since the issue planner is now what backs Postgres's `MigrationPlanner`).
- `commands/migration-plan.ts`: remove or simplify the `if (strategy === 'descriptor')` branch — Postgres now takes the class-flow branch (Mongo already does). The descriptor branch may stay for Phase 5 if other targets still need it; Postgres just doesn't reach it.
- `commands/migration-plan.ts` — **placeholder handling (Option B)**: after writing `migration.ts` from the plan's `renderTypeScript()` output, the CLI attempts to materialize the plan's `operations` (which runs `renderOps`). When the plan contains `PlaceholderExpression` bodies, this throws `errorUnfilledPlaceholder` (`PN-MIG-2001`). The CLI catches that specific error at the serialization boundary and **skips writing both `ops.json` and `migration.json`**, printing a user-facing message that the migration has unfilled placeholder slots and directing the user to fill them in and re-run `node migration.ts`. Plans with no placeholders go through the normal path and produce all three artifacts. Any error other than `errorUnfilledPlaceholder` propagates as a CLI failure. The user-facing invariant is: if `ops.json` exists, it is valid; if it does not exist, the user needs to edit `migration.ts` and run it.
- `commands/migration-apply.ts`: confirm no change (reads `ops.json`, flow-agnostic). If `ops.json` is missing (because placeholders are unfilled), `migration apply` fails with a clear diagnostic pointing the user at `migration.ts`.
- `commands/migration-show.ts` / `commands/migration-status.ts`: confirm no change.

**Example migrations** (`examples/**/migrations/`): for each Postgres-using example:

1. Regenerate the migration directory via `migration plan`. The new `ops.json` / `migration.json` / `migration.ts` replace the committed ones; `migrationId` may change and that's expected.
2. Verify the new `migration.ts` is class-flow shape.
3. Apply the regenerated migration against a fresh Postgres (e.g. via `pnpm --filter <example> db:update` against a disposable database) and assert the runner's post-apply `verifySqlSchema` check passes. The result is committed as part of the PR — one commit per example makes the diff reviewable.

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
- Each re-scaffolded example migration has been applied against a fresh Postgres and the runner's post-apply `verifySqlSchema` check passed. Evidence: PR description lists the examples that were exercised and the commands that were run.
- New CLI integration test: `migration plan` over a NOT-NULL backfill scenario writes `migration.ts` only — `ops.json` and `migration.json` are absent. The emitted `migration.ts` contains `() => placeholder("…")` at the scaffolded slots and imports `placeholder` from `@prisma-next/errors/migration`. After replacing the placeholder bodies with real backfill logic, running `node migration.ts` produces both `ops.json` and `migration.json`, and `migration apply` then applies cleanly. Covers R2.11 end-to-end.

### Risks

- **Emitted migration is functionally wrong for an example.** A factory, strategy, or default-mapping bug produces a recipe that doesn't reconstruct the target schema. Mitigation: the per-example apply/verify is a hard gate; any failure blocks merge. Fix the underlying bug, add a regression test to Phase 2's suite, re-scaffold, re-verify.
- **Novel example corners.** Some examples may exercise code paths the strategy/default-mapping tests don't cover. Each discovered gap adds a test in Phase 2's test suite as part of the Phase 3 PR.

### Rollback

Revert the PR. `resolveDescriptors` returns to the capability, descriptor-flow CLI branches return, examples revert to their previous descriptor-flow `migration.ts` / `ops.json` / `migration.json`. No data loss — the revert restores the exact committed state of the example migrations, and operators who already applied the new migrations are unaffected (the runner tracks `migrationId` on the target DB, not the ones we ship in the repo).

## Phase 4 — Collapse the two planners

**Why after Phase 3?** Class-flow is live; `migration plan` works end-to-end; example migrations are re-scaffolded and CLI journey tests keep the planner / renderer / runner pipeline honest on an ongoing basis. Now we can fold the walk-schema logic — the code that today serves `db update` — into the issue-based planner without risking the main `migration plan` flow.

**End state.** `planner-reconciliation.ts` is deleted. `planner.ts` is either deleted or reduced to a thin `PostgresMigrationPlanner` shell that wraps the issue-based pipeline. The planner has one code path. Both `db update` and `migration plan` go through it.

### Scope

**Audit walk-schema logic** — done in Phase 1 as a research task (output: `wip/walk-schema-audit.md`, not committed). The audit categorizes every branch in `planner-reconciliation.ts` (798 LOC) and `planner.ts`'s `buildDatabaseDependencyOperations`, `buildStorageTypeOperations`, `buildTableOperations` by the `SchemaIssue` kind(s) it handles, and flags branches that depend on information not currently in `SchemaIssue`. The audit is the input to this phase. See `projects/postgres-class-flow-migrations/specs/walk-schema-audit.spec.md`.

**Absorb**: for each walk-schema branch identified by the audit, either extend an existing strategy, add a new strategy, or extend the default mapping in `issue-planner.ts`. Branches that depend on information not currently in `SchemaIssue[]` require a local extension to `verifySqlSchema`'s output shape — a minor, localized contract change, not a planner bypass. Each such extension lands in its own commit for reviewability.

**Delete**: `planner-reconciliation.ts`. Reduce `planner.ts` to a thin shell (or delete it, moving `PostgresMigrationPlanner` into `issue-planner.ts`).

### Validation

- `pnpm -r typecheck`, `pnpm -r lint`.
- Full integration + e2e pass.
- `db update` integration tests pass — they now run through the issue-based pipeline, which is the proof that the absorbed walk-schema logic still produces recipes that reconstruct the live schema.
- New strategy ordering tests: pin the strategy chain order; any reordering is a test failure until explicitly approved.

### Risks

- **`SchemaIssue` extensions.** If walk-schema absorption requires `verifySqlSchema` to emit additional issue metadata, that's a contract change with family-sql callers. Keep each such extension in its own commit so it's reviewable in isolation.
- **Strategy interaction.** Newly absorbed strategies may interact with existing ones (e.g. two strategies both claiming a `missing_column` issue). Pin ordering with tests.
- **`db update` semantic drift.** `db update` previously called walk-schema directly; now it calls the issue-based pipeline. Any difference in operation order or content shows up here. Mitigation: existing `db update` integration tests guard the externally-visible behavior; per-strategy tests guard the internals.

### Rollback

Revert the PR; walk-schema planner returns.

## Phase 5 — Delete descriptor IR

**Why after Phase 4?** Every consumer of the descriptor IR is now going through the class-flow path. The descriptor code is dead weight and can be removed safely.

### Scope

**Postgres deletes**:

- `operation-descriptors.ts`
- `operation-resolver.ts` — thin `resolveX` wrappers from Phase 0 die; pure `createX` factories live on as `op-factories.ts`.
- `descriptor-planner.ts` (if not already renamed/merged into `issue-planner.ts` during Phase 2 or 4).
- `renderDescriptorTypeScript` function in `scaffolding.ts`.
- `MigrationDescriptorArraySchema` in `exports/migration.ts`.

**Framework deletes**:

- `OperationDescriptor` type in `framework-components/control-migration-types.ts`.
- `TargetMigrationsCapability` methods: `planWithDescriptors`, `resolveDescriptors`, `renderDescriptorTypeScript`.

**CLI deletes**:

- `migrationStrategy()` selector.
- `emitDescriptorFlow()`, `evaluateMigrationTs()`.
- Strategy branches in `migration-plan.ts`, `migration-emit.ts` (already dead post-Phase 3).
- Help formatters referring to descriptor-flow.

**Manifest**: remove `hints.planningStrategy` field. `migrationId` is unchanged (ADR 199 excludes `hints` from the id hash).

**Lint**: audit `scripts/lint-framework-target-imports.mjs` for references to descriptor symbols.

### Validation

- `pnpm -r typecheck`, `pnpm -r lint`.
- Grep sweep: zero matches for `OperationDescriptor`, `PostgresMigrationOpDescriptor`, `DataTransformDescriptor`, `planWithDescriptors`, `resolveDescriptors`, `renderDescriptorTypeScript`, `MigrationDescriptorArraySchema`, `evaluateMigrationTs`, `emitDescriptorFlow`, `migrationStrategy` under `packages/` and `test/`.
- Full integration + e2e pass.

### Rollback

Pure delete; revert restores.

## Phase 6 — Delete `migration emit` + `emit` capability

**Why last?** `migration emit` is used by test fixtures that hand-author `migration.ts` and emit after. Once those fixtures invoke `node migration.ts` directly (post-Phase 3), the CLI command is dead weight.

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

Every phase: `pnpm -r typecheck` + `pnpm -r lint` must pass. Phase 3 and later additionally require full integration + live-DB e2e. Mirrors PR #349's D/A/B/C stack policy.

### Example-migration validation policy

No new standing test is introduced for example-migration equivalence. The safety net is twofold:

1. **Runner post-apply verify.** The Postgres runner's `verifySqlSchema` check already fails the apply if the resulting live schema doesn't match the target contract. Any bug that makes a regenerated example apply to an incorrect schema surfaces as a hard apply failure, not a silent drift.
2. **Existing fixture-driven integration coverage.** `test/integration/test/cli-journeys/*.e2e.test.ts` drives the same planner / renderer / runner codepaths on fixture contracts. Those tests continue to run on every PR.

Phase 3's PR exercises the runner post-apply verify per example: each re-scaffolded `examples/**/migrations/*/` is applied against a fresh Postgres as part of PR prep, and the PR description lists the examples that were exercised. `migrationId` values may change across the re-scaffold — that is expected and not a bug.

### Parallelization

- **Sequential**: 0 → 1 → 2 → 3. Each phase depends on the previous.
- **Internally parallel within Phase 1**: framework lift, Postgres IR (call classes + visitors), renderers, walk-schema retargeting can be developed in parallel and merged as a single PR.
- **Internally parallel within Phase 2**: strategy retargeting, issue-planner retargeting, and the per-strategy apply/verify tests can be developed in parallel.
- **Parallel after Phase 3**: Phases 4, 5, and 6 touch largely disjoint files and can overlap, though the natural order is 4 → 5 → 6.

### Relationship to the Mongo sibling project

`projects/mongo-migration-authoring/` (completed via PR #349) established the class-flow template. This project ports the architecture to Postgres and folds in the issue-based diff layer that Mongo does not need — Mongo operates directly on the target contract, while Postgres requires structured diff-over-schema because the live-DB schema can drift from the contract in ways the migration must reconcile.

Mongo-side changes in this project:

- **Phase 1 (Mongo IR sync):** `OpFactoryCallNode` gains `implements OpFactoryCall` (framework interface) and `extends MigrationTsExpression` (new internal abstract). Each concrete call class grows `renderTypeScript()` + `importRequirements()`, and `renderCallsToTypeScript` switches from visitor-based to polymorphic. No planner, factory, or rendered-output change.
- **Phase 6 (emit deletion):** `mongoEmit` and `TargetMigrationsCapability.emit` are removed.

No Mongo planner change, no Mongo factory change, no change to rendered migration.ts output.

### Risk register

| Risk | Primary phase | Mitigation |
|---|---|---|
| Regenerated example migration reconstructs the wrong schema | 3, 4 | Runner's post-apply `verifySqlSchema` fails the apply; per-example apply/verify in Phase 3's PR catches this before merge |
| Walk-schema → call-class mapping completeness | 1 | Phase 1 starts with a walk-schema audit (output: `wip/walk-schema-audit.md`) that categorizes every `buildX` helper by the call classes it needs to construct. The audit is also input to Phase 4 |
| Strategy exhaustiveness regression | 2 | Rewrite existing strategy tests against the new `OpFactoryCall` emission; per-strategy apply/verify tests that run the emitted recipe against a fresh Postgres and assert the runner accepts it, for each of the four data-safety scenarios |
| Walk-schema absorption misses a corner | 4 | `db update` integration tests guard external behavior; audit from Phase 1 is the checklist for Phase 4; pin strategy ordering with unit tests |
| Visitor drift (new factory, visitor not updated) | all | `satisfies PostgresOpFactoryCallVisitor<R>` on every visitor → compile-time error |
| Phase 1 regressions leak into `migration plan` | 1 | `migration plan` stays on the descriptor branch through Phases 1 and 2; `migrations.resolveDescriptors` remains registered until Phase 3 |
| CI fixture reliance on `migration emit` | 6 | Phase 6 audits CI scripts before delete; fixtures switch to direct invocation ahead of merge |

## Known follow-ups

These items are explicitly out of scope for this project but fall out naturally once it lands. Each is a self-contained future PR.

### Cross-target consolidation of the IR and renderable-migration class

Once Postgres ships, the codebase has two structurally identical IR / rendering stacks across Mongo and Postgres:

- `MigrationTsExpression` abstract base (one copy per target, package-private).
- `ImportRequirement` shape (one copy per target).
- `OpFactoryCallNode` / `PostgresOpFactoryCallNode` abstract that extends `MigrationTsExpression` and implements the framework-level `OpFactoryCall` interface.
- `TypeScriptRenderableXMigration` concrete class that extends `Migration<TOp>`, implements `MigrationPlanWithAuthoringSurface<TOp>`, holds `readonly calls`, and delegates `operations` and `renderTypeScript()` to injected / imported renderers.

The follow-up lifts these into `framework-components`:

1. Lift `MigrationTsExpression` and `ImportRequirement` to the framework. Each target re-exports / extends from the framework instead of maintaining a private copy.
2. Lift a `TypeScriptRenderableMigration<TCall extends OpFactoryCall, TOp>` generic class. Retrofit Mongo (`PlannerProducedMongoMigration` → `TypeScriptRenderableMongoMigration`) and Postgres (`TypeScriptRenderablePostgresMigration`) to extend it. Optional alias types preserve existing names.
3. Consider whether `PlaceholderExpression` belongs in the framework (it's Postgres-only today, but Mongo or a future target may adopt planner-emitted `dataTransform`-like operations).

This is a purely structural refactor — no behavior change, no ADR change. It's deferred until both targets have the full abstract-expression hierarchy so the lift is a true de-duplication rather than an up-front guess at the right shape. The Phase 1 Mongo IR sync in this project is designed so the Mongo and Postgres hierarchies are byte-compatible at lift time.

## References

- Spec: [`spec.md`](./spec.md)
- [ADR 193 — Class-flow as the canonical migration authoring strategy](../../docs/architecture%20docs/adrs/ADR%20193%20-%20Class-flow%20as%20the%20canonical%20migration%20authoring%20strategy.md)
- [ADR 194 — Plans carry their own authoring surface](../../docs/architecture%20docs/adrs/ADR%20194%20-%20Plans%20carry%20their%20own%20authoring%20surface.md)
- [ADR 195 — Planner IR with two renderers](../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md)
- [ADR 196 — In-process emit for class-flow targets](../../docs/architecture%20docs/adrs/ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md)
- [ADR 199 — Storage-only migration identity](../../docs/architecture%20docs/adrs/ADR%20199%20-%20Storage-only%20migration%20identity.md)
- [ADR 200 — Placeholder utility for scaffolded migration slots](../../docs/architecture%20docs/adrs/ADR%20200%20-%20Placeholder%20utility%20for%20scaffolded%20migration%20slots.md)
- Sibling project: [`projects/mongo-migration-authoring/`](../mongo-migration-authoring/)
