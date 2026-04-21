# Task spec — Phase 1: Walk-schema planner → class-flow IR

## Summary

Introduce the class-flow IR (`OpFactoryCall` interface + Postgres concrete call classes + visitor interface + two renderers + renderable-migration class) and retarget the **walk-schema planner** (`createPostgresMigrationPlanner.plan()` in `planner.ts` and `planner-reconciliation.ts`) to build `PostgresOpFactoryCall[]` internally. The planner's existing `MigrationPlannerResult` output shape is unchanged; `renderOps` is invoked at the tail of `plan()` to produce the same `SqlMigrationPlanOperation[]` the planner emits today.

`migration plan` is untouched. The issue planner is untouched. `db update` is the live integration coverage for the new path.

## Why

- Phase 2 needs the IR, renderers, and renderable-migration class in place before retargeting the issue planner. Doing the IR work alongside the walk-schema retarget lets Phase 1 prove the mechanics via the richest existing test suite in the project (`planner.*.test.ts`) without touching the CLI's `migration plan` flow.
- `createPostgresMigrationPlanner` is the only path that doesn't ship through descriptor flow today — the walk-schema planner already returns a `MigrationPlannerResult` and already has to be a `MigrationPlanner`. That makes it the lowest-friction home for `MigrationPlanWithAuthoringSurface`.

## Prerequisites

- Phase 0 has landed: pure factories in `op-factories.ts`, `placeholderClosure` in `@prisma-next/errors/migration`.
- Walk-schema audit (`assets/walk-schema-audit.md`) is committed and the call-class inventory has been cross-referenced against it.

## Scope

### Framework lift

`packages/1-framework/1-core/framework-components/src/control-migration-types.ts`:

```ts
export interface OpFactoryCall {
  readonly factory: string;
  readonly operationClass: MigrationOperationClass;
  readonly label: string;
}
```

Exported through the existing `framework-components/control` entrypoint. No abstract base class at framework level. No changes to existing framework interfaces. Adding `OpFactoryCall` is a pure addition.

### Mongo retrofit

Mongo's existing `OpFactoryCallNode` (in `packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts`) declares `factory`, `operationClass`, and `label` — the exact three members of the new framework interface. Retrofit is a two-line change:

1. Import `OpFactoryCall` from `@prisma-next/framework-components/control`.
2. Add `implements OpFactoryCall` to the `OpFactoryCallNode` abstract class declaration.

All five concrete Mongo call classes (`CreateIndexCall`, `DropIndexCall`, `CreateCollectionCall`, `DropCollectionCall`, `CollModCall`) inherit interface satisfaction from the base class — no per-class changes. No behavior change, no new tests needed beyond confirming `pnpm -r typecheck` still passes.

### Family-SQL `Migration` alias

`packages/2-sql/9-family/src/exports/migration.ts` (new file, or extend existing):

```ts
import { Migration as FrameworkMigration } from '@prisma-next/framework-components/migration';
import type { SqlMigrationPlanOperation, SqlPlanTargetDetails } from '@prisma-next/sql-operations';

export class Migration<TDetails extends SqlPlanTargetDetails> extends FrameworkMigration<SqlMigrationPlanOperation<TDetails>> {}
```

Exact shape mirrors `@prisma-next/target-mongo/migration`. Postgres re-exports a bound alias from `@prisma-next/target-postgres/migration`.

### Postgres IR — `op-factory-call.ts`

Layout mirrors `packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts`:

```ts
import type { MigrationOperationClass, OpFactoryCall } from '@prisma-next/framework-components/control';

export interface PostgresOpFactoryCallVisitor<R> {
  createTable(call: CreateTableCall): R;
  dropTable(call: DropTableCall): R;
  addColumn(call: AddColumnCall): R;
  dropColumn(call: DropColumnCall): R;
  alterColumnType(call: AlterColumnTypeCall): R;
  setNotNull(call: SetNotNullCall): R;
  dropNotNull(call: DropNotNullCall): R;
  setDefault(call: SetDefaultCall): R;
  dropDefault(call: DropDefaultCall): R;
  addPrimaryKey(call: AddPrimaryKeyCall): R;
  addForeignKey(call: AddForeignKeyCall): R;
  addUnique(call: AddUniqueCall): R;
  createIndex(call: CreateIndexCall): R;
  dropIndex(call: DropIndexCall): R;
  dropConstraint(call: DropConstraintCall): R;
  createExtension(call: CreateExtensionCall): R;
  createSchema(call: CreateSchemaCall): R;
  createEnumType(call: CreateEnumTypeCall): R;
  addEnumValues(call: AddEnumValuesCall): R;
  dropEnumType(call: DropEnumTypeCall): R;
  renameType(call: RenameTypeCall): R;
  dataTransform(call: DataTransformCall): R;
}

abstract class PostgresOpFactoryCallNode implements OpFactoryCall {
  abstract readonly factory: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R;

  protected freeze(): void {
    Object.freeze(this);
  }
}

// `PostgresOpFactoryCallNode` is NOT exported. External consumers depend on the
// framework-level `OpFactoryCall` interface and the `PostgresOpFactoryCall` union.

export class CreateTableCall extends PostgresOpFactoryCallNode {
  readonly factory = 'createTable' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columns: readonly ColumnSpec[];
  readonly options: CreateTableOptions | undefined;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    columns: readonly ColumnSpec[],
    options?: CreateTableOptions,
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columns = columns;
    this.options = options;
    this.label = `Create table ${schemaName}.${tableName}`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.createTable(this);
  }
}

// … one class per factory in Phase 0's inventory …

export type PostgresOpFactoryCall =
  | CreateTableCall
  | DropTableCall
  | AddColumnCall
  | DropColumnCall
  | AlterColumnTypeCall
  | SetNotNullCall
  | DropNotNullCall
  | SetDefaultCall
  | DropDefaultCall
  | AddPrimaryKeyCall
  | AddForeignKeyCall
  | AddUniqueCall
  | CreateIndexCall
  | DropIndexCall
  | DropConstraintCall
  | CreateExtensionCall
  | CreateSchemaCall
  | CreateEnumTypeCall
  | AddEnumValuesCall
  | DropEnumTypeCall
  | RenameTypeCall
  | DataTransformCall;
```

- Constructor arg shapes mirror Phase 0's pure factory signatures 1:1.
- Every concrete class is frozen at construction.
- `operationClass` is a literal constant per class for additive / destructive variants. `DataTransformCall.operationClass` is the only one the caller supplies (defaults to `'data'`).
- `label` is computed in the constructor from the literal args. The planner doesn't inject labels.

### Postgres IR — visitor renderers

`packages/3-targets/3-targets/postgres/src/core/migrations/render-ops.ts`:

```ts
class OpsRenderer implements PostgresOpFactoryCallVisitor<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
  createTable(call: CreateTableCall) { return createTable(call.schemaName, call.tableName, call.columns, call.options); }
  // …one method per factory, each delegating to the Phase 0 pure factory…
}

export function renderOps(
  calls: readonly PostgresOpFactoryCall[],
): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
  const renderer = new OpsRenderer();
  return calls.map((call) => call.accept(renderer));
}
```

`packages/3-targets/3-targets/postgres/src/core/migrations/render-typescript.ts`:

```ts
class TypeScriptRenderer implements PostgresOpFactoryCallVisitor<string> {
  createTable(call: CreateTableCall) {
    return `ops.push(createTable(${stringifyArgs(call.schemaName, call.tableName, call.columns, call.options)}));`;
  }
  // …
  dataTransform(call: DataTransformCall) {
    const check = isPlaceholderClosure(call.check)
      ? `() => placeholder("${extractSlot(call.check)}")`
      : stringifyClosure(call.check);
    const run = isPlaceholderClosure(call.run)
      ? `() => placeholder("${extractSlot(call.run)}")`
      : stringifyClosure(call.run);
    return `ops.push(dataTransform(${JSON.stringify(call.label)}, ${check}, ${run}));`;
  }
}

export function renderCallsToTypeScript(
  calls: readonly PostgresOpFactoryCall[],
  meta: { readonly contractPath: string /* and any other metadata */ },
): string { /* …produces a complete migration.ts source string… */ }
```

- Output format mirrors today's `renderDescriptorTypeScript` output shape (imports, class, `plan()` method, `Migration.run(...)`) so that Phase 3's flip produces byte-equivalent `migration.ts` source where possible.
- Output shape is finalized against the existing Mongo `renderCallsToTypeScript` output, with Postgres-specific imports substituted.
- Non-placeholder closures in `DataTransformCall` are never produced by Phase 1 (the walk-schema planner never synthesizes user-authored closures), but the renderer paths for them exist so Phase 2's issue planner can exercise them. In Phase 1, hitting a non-placeholder closure during rendering is an assertion failure.

### Postgres IR — `planner-produced-postgres-migration.ts`

Named to mirror Mongo's `planner-produced-migration.ts`. Contents:

```ts
export class TypeScriptRenderablePostgresMigration
  extends Migration<PostgresPlanTargetDetails>
  implements MigrationPlanWithAuthoringSurface
{
  readonly targetId = 'postgres' as const;

  constructor(
    private readonly calls: readonly PostgresOpFactoryCall[],
    private readonly meta: MigrationMeta,
  ) { super(); }

  override get operations(): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    return renderOps(this.calls);
  }

  override describe(): MigrationMeta { return this.meta; }

  renderTypeScript(): string {
    return renderCallsToTypeScript(this.calls, { /* meta fields */ });
  }
}
```

Structurally identical to Mongo's `PlannerProducedMongoMigration` modulo the target-bound `Migration` alias and the call union.

### Walk-schema planner retargeting

- `planner.ts` accumulator: every `private buildX` method returns `PostgresOpFactoryCall[]` instead of `SqlMigrationPlanOperation[]`.
- `planner-reconciliation.ts` accumulator: same — `buildReconciliationPlan` now produces `PostgresOpFactoryCall[]`.
- `PostgresMigrationPlanner.plan()` concatenates the call arrays and runs them through `renderOps` at the tail to produce its existing `MigrationPlannerResult` — the shape of the result is unchanged.
- Every construction site that today calls a `resolveX` wrapper is changed to construct the corresponding concrete call class. The Phase 0 audit from `assets/walk-schema-audit.md` is the checklist: every row's "Corresponding `OpFactoryCall` class(es)" column is a construction site that must be touched.
- `emptyMigration()` now returns `new TypeScriptRenderablePostgresMigration([], meta)` with a real `renderTypeScript()`. (Not reached by `migration new` in Phase 1 because strategy selector is still descriptor-flow; reached by unit tests.)

### Capability wiring

No changes to `packages/3-targets/3-targets/postgres/src/exports/control.ts` in Phase 1. `migrations.emit` / `resolveDescriptors` / `planWithDescriptors` / `renderDescriptorTypeScript` wiring is Phase 2 and Phase 3 territory.

## Acceptance criteria

- [ ] `OpFactoryCall` interface exported from `framework-components/control`.
- [ ] Mongo's `OpFactoryCallNode` abstract class declares `implements OpFactoryCall`; `pnpm -r typecheck` passes without additional per-class changes.
- [ ] Family-SQL `Migration` alias exists and is re-exported by `@prisma-next/target-postgres/migration`.
- [ ] `op-factory-call.ts`, `render-ops.ts`, `render-typescript.ts`, `planner-produced-postgres-migration.ts` all exist under `packages/3-targets/3-targets/postgres/src/core/migrations/`.
- [ ] `PostgresOpFactoryCallNode` is not exported (verify via `rg "PostgresOpFactoryCallNode" packages/3-targets/3-targets/postgres/src/exports/` returning zero matches).
- [ ] No non-Postgres file in `packages/` references `PostgresOpFactoryCallNode` (verify via `rg "PostgresOpFactoryCallNode" packages/ --glob '!packages/3-targets/3-targets/postgres/**'`).
- [ ] Every `private buildX` method on `PostgresMigrationPlanner` returns `PostgresOpFactoryCall[]`.
- [ ] `planner-reconciliation.ts` produces `PostgresOpFactoryCall[]`.
- [ ] `PostgresMigrationPlanner.plan()`'s external `MigrationPlannerResult` shape is unchanged.
- [ ] `pnpm -r typecheck`, `pnpm -r lint` pass.
- [ ] Every existing Postgres planner test passes unchanged: `planner.integration.test.ts`, `planner.behavior.test.ts`, `planner.storage-types.integration.test.ts`, `planner.reconciliation.integration.test.ts`, `planner.authoring-surface.test.ts`.
- [ ] New unit tests per concrete call class: construct with literal args, assert frozen, assert `accept()` dispatches to the correct visitor method, assert `label` is what the planner would produce.
- [ ] New unit tests per `renderOps` / `renderCallsToTypeScript` case: every variant in the union has an assertion.
- [ ] New unit test for `TypeScriptRenderablePostgresMigration`: construct with a fixed `calls` array + meta, assert `operations` = `renderOps(calls)`, assert `renderTypeScript()` produces parseable TypeScript whose dynamic import reconstructs the same `operations`.
- [ ] `db update` end-to-end smoke via existing CLI integration tests — applies against a live Postgres and the runner's post-apply `verifySqlSchema` check passes, confirming the retargeted walk-schema path still produces equivalent recipes.
- [ ] `satisfies PostgresOpFactoryCallVisitor<R>` is present on every visitor implementation — compile-time exhaustiveness for future variant additions.

## Non-goals

- No issue-planner changes. `descriptor-planner.ts`, `planner-strategies.ts` are untouched.
- No changes to `migrationStrategy` or `migration plan`.
- No CLI changes.
- No cross-target generic `TypeScriptRenderableMigration` lift. Mongo's class stays separate (see plan.md §"Known follow-ups").

## Risks

- **Call-class inventory drift.** Walk-schema paths that the Phase 0 factory inventory missed surface as type errors when retargeting `buildX`. Mitigation: the walk-schema audit is the authoritative checklist; cross-reference it before writing call classes.
- **`renderCallsToTypeScript` output shape.** The renderer's output isn't tested against existing scaffolded files in this phase (that's Phase 3). Mitigation: in Phase 1, snapshot the renderer output against hand-written expected strings for each variant so the shape is pinned; Phase 3's per-example apply/verify exercises the round-trip end-to-end.
- **Label regressions.** The planner today produces labels through various helpers (e.g. `buildTargetDetails`). The new call classes compute labels in their constructors — if the format regresses it's a user-facing diagnostic regression, independent of schema equivalence. Mitigation: a per-call-class label snapshot test pins the format.

## Estimate

4–5 days. 1 day framework+family lift + call-class skeleton, 2 days walk-schema retargeting, 1 day renderers + tests, 0.5–1 day for integration test pass and label-parity fixes.

## References

- Plan: [`plan.md`](../plan.md) §"Phase 1"
- Spec: [`spec.md`](../spec.md) §R2.7–R2.9, §R3.1–R3.3
- Walk-schema audit: [`walk-schema-audit.spec.md`](./walk-schema-audit.spec.md)
- Phase 0 factory extraction: [`phase-0-factory-extraction.spec.md`](./phase-0-factory-extraction.spec.md)
- [ADR 193 — Class-flow as the canonical migration authoring strategy](../../../docs/architecture%20docs/adrs/ADR%20193%20-%20Class-flow%20as%20the%20canonical%20migration%20authoring%20strategy.md)
- [ADR 194 — Plans carry their own authoring surface](../../../docs/architecture%20docs/adrs/ADR%20194%20-%20Plans%20carry%20their%20own%20authoring%20surface.md)
- [ADR 195 — Planner IR with two renderers](../../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md)
- Mongo reference: `packages/3-mongo-target/1-mongo-target/src/core/{op-factory-call.ts,planner-produced-migration.ts,render-typescript.ts}`
