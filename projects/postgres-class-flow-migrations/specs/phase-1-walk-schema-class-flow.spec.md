# Task spec — Phase 1: Walk-schema planner → class-flow IR

## Summary

Introduce the class-flow IR (`OpFactoryCall` interface + Postgres concrete call classes + visitor interface + two renderers + renderable-migration class) and retarget the **walk-schema planner** (`createPostgresMigrationPlanner.plan()` in `planner.ts` and `planner-reconciliation.ts`) to build `PostgresOpFactoryCall[]` internally. The planner's existing `MigrationPlannerResult` output shape is unchanged; `renderOps` is invoked at the tail of `plan()` to produce the same `SqlMigrationPlanOperation[]` the planner emits today.

`migration plan` is untouched. The issue planner is untouched. `db update` is the live integration coverage for the new path.

## Why

- Phase 2 needs the IR, renderers, and renderable-migration class in place before retargeting the issue planner. Doing the IR work alongside the walk-schema retarget lets Phase 1 prove the mechanics via the richest existing test suite in the project (`planner.*.test.ts`) without touching the CLI's `migration plan` flow.
- `createPostgresMigrationPlanner` is the only path that doesn't ship through descriptor flow today — the walk-schema planner already returns a `MigrationPlannerResult` and already has to be a `MigrationPlanner`. That makes it the lowest-friction home for `MigrationPlanWithAuthoringSurface`.

## Prerequisites

- Phase 0 has landed: pure factories in `op-factories.ts`. No placeholder-related work was folded into Phase 0 — the placeholder-as-AST-node machinery ships with this phase.
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

### Mongo IR sync

Mongo and Postgres ship the same IR shape. The abstract-expression hierarchy introduced for Postgres later in this phase (`MigrationTsExpression`, polymorphic `renderTypeScript()` / `importRequirements()`) is applied to Mongo here so the two targets don't drift. Mongo's planner doesn't emit `dataTransform`, so `PlaceholderExpression` has no Mongo counterpart — the hierarchy stays open to future variants. No change to Mongo's rendered output (byte-identical), no change to Mongo's planner.

**1. Framework interface retrofit.**

Mongo's existing `OpFactoryCallNode` (in `packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts`) already declares `factory`, `operationClass`, and `label` — the exact three members of the new framework interface:

1. Import `OpFactoryCall` from `@prisma-next/framework-components/control`.
2. Add `implements OpFactoryCall` to the `OpFactoryCallNode` abstract class declaration.

All five concrete Mongo call classes inherit interface satisfaction from the base — no per-class changes for this step.

**2. Mongo-internal `MigrationTsExpression` (new file).**

`packages/3-mongo-target/1-mongo-target/src/core/migration-ts-expression.ts` — structurally identical to the Postgres sibling added later in this phase:

```ts
export interface ImportRequirement {
  readonly moduleSpecifier: string;
  readonly symbol: string;
}

export abstract class MigrationTsExpression {
  abstract renderTypeScript(): string;
  abstract importRequirements(): readonly ImportRequirement[];
}
```

Not exported from the package. Not referenced in any cross-package signature. The two sibling copies of this class (Mongo's and Postgres's) are the target of the cross-target consolidation follow-up called out in `plan.md` — they're intentionally duplicated here to keep each target's internals self-contained until the lift lands.

**3. `OpFactoryCallNode` extends `MigrationTsExpression`.**

```ts
import { MigrationTsExpression, type ImportRequirement } from './migration-ts-expression';

abstract class OpFactoryCallNode extends MigrationTsExpression implements OpFactoryCall {
  abstract readonly factory: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract accept<R>(visitor: OpFactoryCallVisitor<R>): R;
  // inherited abstracts from MigrationTsExpression:
  // abstract renderTypeScript(): string;
  // abstract importRequirements(): readonly ImportRequirement[];

  protected freeze(): void {
    Object.freeze(this);
  }
}
```

`OpFactoryCallVisitor<R>` stays. It's still used by the runtime-op side (wherever Mongo's IR-to-command dispatch currently lives); only the TypeScript renderer moves to polymorphism.

**4. Concrete call classes implement `renderTypeScript()` and `importRequirements()`.**

Each of the five classes (`CreateIndexCall`, `DropIndexCall`, `CreateCollectionCall`, `DropCollectionCall`, `CollModCall`) gains two new methods whose output exactly matches what the existing `renderCallVisitor` + `collectFactoryNames` path produces today. Example:

```ts
export class CreateIndexCall extends OpFactoryCallNode {
  readonly factory = 'createIndex' as const;
  // ... existing fields ...

  renderTypeScript(): string {
    return this.options
      ? `createIndex(${renderLiteral(this.collection)}, ${renderLiteral(this.keys)}, ${renderLiteral(this.options)})`
      : `createIndex(${renderLiteral(this.collection)}, ${renderLiteral(this.keys)})`;
  }

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: '@prisma-next/target-mongo/migration', symbol: 'createIndex' }];
  }

  accept<R>(visitor: OpFactoryCallVisitor<R>): R {
    return visitor.createIndex(this);
  }
}
```

The `renderLiteral` / `renderKey` helpers currently in `render-typescript.ts` move to a small shared utility (e.g. `packages/3-mongo-target/1-mongo-target/src/core/render-literal.ts`) so the per-class `renderTypeScript()` methods can import them. This keeps the split between "how to render a value literal" (shared helper) and "how to render a call" (per-class method).

**5. `renderCallsToTypeScript` goes polymorphic.**

In `packages/3-mongo-target/1-mongo-target/src/core/render-typescript.ts`:

```ts
export function renderCallsToTypeScript(
  calls: ReadonlyArray<OpFactoryCall>,
  meta: RenderMigrationMeta,
): string {
  const imports = buildImports(calls);
  const operationsBody = calls.map((c) => c.renderTypeScript()).join(',\n');
  // ... existing class / describe / default-export wiring unchanged ...
}

function buildImports(calls: ReadonlyArray<OpFactoryCall>): string {
  const requirements = calls.flatMap((c) => c.importRequirements());
  // Always-present base import:
  const perModule = new Map<string, Set<string>>([
    ['@prisma-next/family-mongo/migration', new Set(['Migration'])],
  ]);
  for (const req of requirements) {
    if (!perModule.has(req.moduleSpecifier)) perModule.set(req.moduleSpecifier, new Set());
    perModule.get(req.moduleSpecifier)!.add(req.symbol);
  }
  return [...perModule.entries()]
    .map(([mod, symbols]) => `import { ${[...symbols].sort().join(', ')} } from '${mod}';`)
    .join('\n');
}
```

Deleted: the `renderCallVisitor` constant and the hand-rolled `collectFactoryNames` helper. The `OpFactoryCallVisitor<R>` interface is retained (still used by the runtime-op side).

**6. No other Mongo changes.**

`planner-produced-migration.ts`, the Mongo planner, `mongoEmit`, and all Mongo CLI wiring are untouched. Only the IR and the TS renderer change.

**Regression net.** Mongo's existing `render-typescript` unit / snapshot tests are the correctness gate — the polymorphic rewrite must produce byte-identical output to the pre-change visitor implementation. New per-class unit tests for `renderTypeScript()` and `importRequirements()` land alongside. `pnpm -r typecheck` and the Mongo test suite cover the rest.

### Family-SQL `Migration` alias

Mirrors Mongo's layout exactly: implementation under `src/core/`, a one-line re-export barrel under `src/exports/`. `src/exports/` is for re-exports only — no implementation.

**Implementation** — `packages/2-sql/9-family/src/core/sql-migration.ts` (new file):

```ts
import { Migration } from '@prisma-next/migration-tools/migration';
import type { SqlMigrationPlanOperation, SqlPlanTargetDetails } from '../core/types';

/**
 * Family-owned base class for class-flow SQL migrations.
 *
 * Unlike `MongoMigration`, this class stays generic over `TDetails` because
 * the SQL family serves multiple concrete targets (Postgres today, others
 * later). Each target-specific migration class binds `TDetails` and fixes
 * `targetId` in its own core module.
 */
export abstract class SqlMigration<TDetails extends SqlPlanTargetDetails>
  extends Migration<SqlMigrationPlanOperation<TDetails>> {}
```

**Re-export barrel** — `packages/2-sql/9-family/src/exports/migration.ts` (new file):

```ts
export { SqlMigration as Migration } from '../core/sql-migration';
```

**Package.json** — add a `./migration` subpath to `packages/2-sql/9-family/package.json`'s `exports`, mirroring how Mongo family exposes `@prisma-next/mongo-family/migration`.

**`architecture.config.json`** — register the new subpath under the migration plane (cross-reference `multi-plane-entrypoints.mdc`).

Postgres does not re-export `SqlMigration` directly. Postgres's own concrete migration class (`TypeScriptRenderablePostgresMigration`, defined in the target package's `src/core/`) extends `SqlMigration<PostgresPlanTargetDetails>` and fixes `targetId = 'postgres'`, mirroring how Mongo's concrete classes extend `MongoMigration`.

### Postgres IR — expression hierarchy

Every node that can appear as a TypeScript expression in the generated `migration.ts` — whether a top-level `PostgresOpFactoryCall` or a `dataTransform` body — shares a common Postgres-internal abstract base, `MigrationTsExpression`, in `packages/3-targets/3-targets/postgres/src/core/migrations/migration-ts-expression.ts`:

```ts
export interface ImportRequirement {
  readonly moduleSpecifier: string;
  readonly symbol: string;
}

export abstract class MigrationTsExpression {
  /**
   * Render this node as a TypeScript expression suitable for embedding in
   * the generated `migration.ts` source.
   */
  abstract renderTypeScript(): string;

  /**
   * Declare every top-level symbol `renderTypeScript()` references. Used by
   * `renderCallsToTypeScript` to build the module-level import block.
   */
  abstract importRequirements(): readonly ImportRequirement[];
}
```

`MigrationTsExpression` is **not** exported from the package. External consumers never see it — they interact with `PostgresOpFactoryCall` through the framework-level `OpFactoryCall` interface. The class exists purely to give every TypeScript-renderable node a uniform shape for the polymorphic `renderCallsToTypeScript` walk, and for uniform import aggregation.

Two subtypes participate in Phase 1:

- `PostgresOpFactoryCallNode` — abstract base for every concrete call class. Extends `MigrationTsExpression`, implements `OpFactoryCall`, and adds the visitor `accept()` for the `renderOps` side (see below).
- `PlaceholderExpression` — concrete. Represents a planner-generated stub for a `dataTransform` `check` or `run` body. It is **not** an `OpFactoryCall` and never appears in the `PostgresOpFactoryCall` union; it appears only as a field value inside `DataTransformCall`.

```ts
// packages/3-targets/3-targets/postgres/src/core/migrations/placeholder-expression.ts
import { MigrationTsExpression, type ImportRequirement } from './migration-ts-expression';

export class PlaceholderExpression extends MigrationTsExpression {
  constructor(readonly slot: string) {
    super();
    Object.freeze(this);
  }

  renderTypeScript(): string {
    return `() => placeholder(${JSON.stringify(this.slot)})`;
  }

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: '@prisma-next/errors/migration', symbol: 'placeholder' }];
  }
}
```

The hierarchy is deliberately open to future expression variants (for example a `ClosureExpression` wrapping a pre-computed transformation, once we need one). `DataTransformCall` accepts any `MigrationTsExpression` for its `check` and `run` fields — narrowing to `PlaceholderExpression` would collapse the abstraction to "the slot string plus a bit of ceremony" and foreclose that extension.

### Postgres IR — `op-factory-call.ts`

Layout mirrors `packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts`, with the `MigrationTsExpression` ancestry layered in:

```ts
import type { MigrationOperationClass, OpFactoryCall } from '@prisma-next/framework-components/control';
import { MigrationTsExpression, type ImportRequirement } from './migration-ts-expression';
import { PlaceholderExpression } from './placeholder-expression';

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

abstract class PostgresOpFactoryCallNode extends MigrationTsExpression implements OpFactoryCall {
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

  renderTypeScript(): string {
    return `createTable(${stringifyArgs(this.schemaName, this.tableName, this.columns, this.options)})`;
  }

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: '@prisma-next/target-postgres/migration', symbol: 'createTable' }];
  }
}

// … one class per factory in Phase 0's inventory. Each class supplies a literal
// `factory` / `operationClass`, computes its `label` in the constructor from
// literal args, implements `accept()` (one-liner), `renderTypeScript()` (one-liner
// over `stringifyArgs(...)`), and `importRequirements()` (a single entry for its
// factory symbol). …

export class DataTransformCall extends PostgresOpFactoryCallNode {
  readonly factory = 'dataTransform' as const;
  readonly operationClass: MigrationOperationClass;
  readonly label: string;
  readonly check: MigrationTsExpression;
  readonly run: MigrationTsExpression;

  constructor(
    label: string,
    check: MigrationTsExpression,
    run: MigrationTsExpression,
    operationClass: MigrationOperationClass = 'data',
  ) {
    super();
    this.label = label;
    this.check = check;
    this.run = run;
    this.operationClass = operationClass;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.dataTransform(this);
  }

  renderTypeScript(): string {
    return `dataTransform(${JSON.stringify(this.label)}, ${this.check.renderTypeScript()}, ${this.run.renderTypeScript()})`;
  }

  importRequirements(): readonly ImportRequirement[] {
    return [
      { moduleSpecifier: '@prisma-next/target-postgres/migration', symbol: 'dataTransform' },
      ...this.check.importRequirements(),
      ...this.run.importRequirements(),
    ];
  }
}

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

Key design points:

- Constructor arg shapes mirror Phase 0's pure factory signatures 1:1, except that `DataTransformCall`'s `check` and `run` are `MigrationTsExpression` rather than plain closures. The pure `createDataTransform` factory still takes closures; the adaptation happens in `render-ops.ts` (see below).
- Every concrete class is frozen at construction.
- `operationClass` is a literal constant per class for additive / destructive variants. `DataTransformCall.operationClass` is the only one the caller supplies (defaults to `'data'`).
- `label` is computed in the constructor from the literal args. The planner doesn't inject labels.
- **Two dispatch mechanisms, one per audience.** The `accept(visitor)` method is for `renderOps` — a single exhaustive switch over the `PostgresOpFactoryCall` union. The `renderTypeScript()` / `importRequirements()` polymorphic methods are for `renderCallsToTypeScript` — the walk must recurse into `MigrationTsExpression` children of `DataTransformCall` uniformly, which is exactly what polymorphism does well and what a visitor rooted at the `PostgresOpFactoryCall` union cannot express.
- `PostgresOpFactoryCallNode` is package-private. External consumers see only `OpFactoryCall` (framework) and the `PostgresOpFactoryCall` union. The internal abstract class gives the Postgres IR the Mongo-parity structure without leaking any Postgres-specific abstraction into cross-package signatures.

### Postgres IR — `render-ops.ts` (visitor; `OpFactoryCall` → runtime op)

`renderOps` stays a visitor. Its job is one-to-one with the `PostgresOpFactoryCall` union, and the visitor pattern is what gives us compile-time exhaustiveness over that union.

```ts
// packages/3-targets/3-targets/postgres/src/core/migrations/render-ops.ts
class OpsRenderer implements PostgresOpFactoryCallVisitor<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
  createTable(call: CreateTableCall) {
    return createTable(call.schemaName, call.tableName, call.columns, call.options);
  }
  // …one method per factory, each delegating to the Phase 0 pure factory…

  dataTransform(call: DataTransformCall) {
    return dataTransform(
      call.label,
      bodyToClosure(call.check),
      bodyToClosure(call.run),
      call.operationClass,
    );
  }
}

export function renderOps(
  calls: readonly PostgresOpFactoryCall[],
): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
  const renderer = new OpsRenderer();
  return calls.map((call) => call.accept(renderer));
}
```

`bodyToClosure(expr: MigrationTsExpression): () => SqlQueryPlan` is a local helper whose single responsibility is: "given a `MigrationTsExpression` used as a `dataTransform` body, produce the closure the pure `dataTransform` factory expects." In Phase 1 the only variant it handles is `PlaceholderExpression`:

```ts
import { placeholder } from '@prisma-next/errors/migration';

function bodyToClosure(expr: MigrationTsExpression): () => never {
  if (expr instanceof PlaceholderExpression) {
    return () => placeholder(expr.slot); // invocation throws errorUnfilledPlaceholder
  }
  // Future variants (e.g. ClosureExpression) extend this switch. Any unsupported
  // variant is a planner bug, surfaced as an internal-invariant throw.
  throw new Error(`DataTransformCall body: unsupported expression variant ${expr.constructor.name}`);
}
```

The invariant this helper establishes — and which the rest of the system relies on — is: when the planner emits a `DataTransformCall` with placeholder bodies, the closures the pure `dataTransform` factory receives **throw** when invoked. The factory invokes `check()` / `run()` to materialize their `SqlQueryPlan`s into the runtime op's pre/postcheck / execute steps, so the throw propagates out through `renderOps` → `instance.operations` → `Migration.run`'s JSON-serialization path.

`renderOps` itself does not catch. It is the shared path between `db update` (walk-schema today, issue-planner post-Phase 4) and `migration plan` (post-Phase 3); catching belongs at the CLI boundary. See plan.md §"Phase 3" for the catch.

### Postgres IR — `render-typescript.ts` (polymorphic; `OpFactoryCall` → migration.ts source)

`renderCallsToTypeScript` is **not** a visitor. Each node renders itself via `renderTypeScript()` and declares its own imports via `importRequirements()`; the top-level function composes the module source:

```ts
// packages/3-targets/3-targets/postgres/src/core/migrations/render-typescript.ts
export function renderCallsToTypeScript(
  calls: readonly PostgresOpFactoryCall[],
  meta: { readonly contractRelativePath: string /* and any other metadata */ },
): string {
  const imports = deduplicate(calls.flatMap((call) => call.importRequirements()));
  const body = calls
    .map((call) => `      ${call.renderTypeScript()},`)
    .join('\n');
  return [
    '#!/usr/bin/env -S node --experimental-strip-types',
    renderImportBlock(imports, meta),
    '',
    renderContractImport(meta),
    '',
    'export default class extends Migration {',
    '  plan() {',
    '    return [',
    body,
    '    ];',
    '  }',
    '}',
    '',
    'Migration.run(import.meta.url, (await import(import.meta.url)).default);',
    '',
  ].join('\n');
}
```

- Polymorphism is sufficient here because `DataTransformCall.renderTypeScript()` recurses into `this.check.renderTypeScript()` / `this.run.renderTypeScript()` uniformly — whether the children are `PlaceholderExpression`s today or a future `ClosureExpression` tomorrow. A visitor rooted at `PostgresOpFactoryCallVisitor` would require a separate `MigrationTsExpressionVisitor` to handle the children, which is more machinery than the polymorphic methods buy.
- `renderImportBlock(imports, meta)` collapses `ImportRequirement[]` entries by `moduleSpecifier` and emits a sorted `import { a, b, c } from "…"` block. The `Migration` import from `@prisma-next/family-sql/migration` is always emitted (meta-driven, not derived from any node).
- Output shape (shebang, `Migration` import from `@prisma-next/family-sql/migration`, contract import, `export default class … extends Migration`, `Migration.run(import.meta.url, …)`) mirrors today's `renderDescriptorTypeScript` output and Mongo's `renderCallsToTypeScript` output, so Phase 3's flip produces structurally-equivalent files.
- Non-placeholder `MigrationTsExpression` variants are not produced by Phase 1. If one appears in a `DataTransformCall` during Phase 1 it's a planner bug. The renderer itself prints it polymorphically without objection; the invariant is enforced by `bodyToClosure` on the ops side.

### Postgres IR — `planner-produced-postgres-migration.ts`

Named to mirror Mongo's `planner-produced-migration.ts`. Contents:

```ts
export class TypeScriptRenderablePostgresMigration
  extends SqlMigration<PostgresPlanTargetDetails>
  implements MigrationPlanWithAuthoringSurface<SqlMigrationPlanOperation<PostgresPlanTargetDetails>>
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

Structurally identical to Mongo's `PlannerProducedMongoMigration` modulo the target-bound `SqlMigration` alias and the call union.

**Behavior with placeholder-bearing plans.** When `this.calls` contains a `DataTransformCall` whose `check` or `run` is a `PlaceholderExpression`, accessing `this.operations` runs `renderOps`, which invokes the pure `dataTransform` factory, which invokes the placeholder closures to build the runtime op's precheck / execute steps, which throws `errorUnfilledPlaceholder(slot)` (`PN-MIG-2001`). `this.renderTypeScript()` is unaffected — it walks nodes polymorphically and never invokes closures, so it always produces a valid `migration.ts` source including `() => placeholder("slot")` at the right spots. This is the asymmetry Option B in Phase 3 relies on: the class can always produce its TypeScript source, but only produces its runtime operations when the user has filled every placeholder slot.

### Walk-schema planner retargeting

- `planner.ts` accumulator: every `private buildX` method returns `PostgresOpFactoryCall[]` instead of `SqlMigrationPlanOperation[]`.
- `planner-reconciliation.ts` accumulator: same — `buildReconciliationPlan` now produces `PostgresOpFactoryCall[]`.
- `PostgresMigrationPlanner.plan()` concatenates the call arrays and runs them through `renderOps` at the tail to produce its existing `MigrationPlannerResult` — the shape of the result is unchanged.
- Every construction site that today calls a `resolveX` wrapper is changed to construct the corresponding concrete call class. The walk-schema audit at `assets/walk-schema-audit.md` (produced as the first research task of this phase — see §Prerequisites) is the checklist: every row's "Corresponding `OpFactoryCall` class(es)" column is a construction site that must be touched.
- `emptyMigration()` now returns `new TypeScriptRenderablePostgresMigration([], meta)` with a real `renderTypeScript()`. (Not reached by `migration new` in Phase 1 because strategy selector is still descriptor-flow; reached by unit tests.)

### Capability wiring

No changes to `packages/3-targets/3-targets/postgres/src/exports/control.ts` in Phase 1. `migrations.emit` / `resolveDescriptors` / `planWithDescriptors` / `renderDescriptorTypeScript` wiring is Phase 2 and Phase 3 territory.

## Acceptance criteria

- [ ] `OpFactoryCall` interface exported from `framework-components/control`.
- [ ] Mongo's `OpFactoryCallNode` abstract class declares `implements OpFactoryCall` and `extends MigrationTsExpression`.
- [ ] Mongo's new `packages/3-mongo-target/1-mongo-target/src/core/migration-ts-expression.ts` defines `MigrationTsExpression` and `ImportRequirement`; the file is not re-exported (verify via `rg "MigrationTsExpression" packages/3-mongo-target/1-mongo-target/src/exports/` returns zero matches).
- [ ] All five Mongo concrete call classes (`CreateIndexCall`, `DropIndexCall`, `CreateCollectionCall`, `DropCollectionCall`, `CollModCall`) implement `renderTypeScript()` and `importRequirements()`.
- [ ] Mongo's `renderCallsToTypeScript` is rewritten to call `c.renderTypeScript()` / `c.importRequirements()` polymorphically; the `renderCallVisitor` const and `collectFactoryNames` helper are deleted.
- [ ] Mongo's `OpFactoryCallVisitor<R>` interface is retained (still used by the runtime-op side).
- [ ] Mongo's `render-typescript.test.ts` (and any snapshot tests) pass byte-identically after the rewrite.
- [ ] New per-class Mongo unit tests for `renderTypeScript()` and `importRequirements()` land alongside.
- [ ] Family-SQL `Migration` alias exists (implementation in `packages/2-sql/9-family/src/core/sql-migration.ts`, one-line re-export in `packages/2-sql/9-family/src/exports/migration.ts`) and is re-exported by `@prisma-next/target-postgres/migration`.
- [ ] `migration-ts-expression.ts`, `placeholder-expression.ts`, `op-factory-call.ts`, `render-ops.ts`, `render-typescript.ts`, `planner-produced-postgres-migration.ts` all exist under `packages/3-targets/3-targets/postgres/src/core/migrations/`.
- [ ] `MigrationTsExpression` and `PostgresOpFactoryCallNode` are not exported (verify via `rg "MigrationTsExpression|PostgresOpFactoryCallNode" packages/3-targets/3-targets/postgres/src/exports/` returning zero matches).
- [ ] No non-Postgres file in `packages/` references `MigrationTsExpression`, `PlaceholderExpression`, or `PostgresOpFactoryCallNode` (verify via `rg` scoped outside the Postgres package).
- [ ] `PostgresOpFactoryCallNode` extends `MigrationTsExpression` and implements `OpFactoryCall`.
- [ ] `PlaceholderExpression` extends `MigrationTsExpression`, is frozen at construction, and is **not** a member of the `PostgresOpFactoryCall` union.
- [ ] `DataTransformCall.check` and `DataTransformCall.run` are typed as `MigrationTsExpression` (not narrowed to `PlaceholderExpression`).
- [ ] Every concrete `PostgresOpFactoryCall` class implements `renderTypeScript()` and `importRequirements()` in addition to `accept()`.
- [ ] `renderCallsToTypeScript` is a plain function (no visitor): it calls `node.renderTypeScript()` / `node.importRequirements()` polymorphically and deduplicates the import list.
- [ ] `renderOps` is a visitor and satisfies `PostgresOpFactoryCallVisitor<SqlMigrationPlanOperation<PostgresPlanTargetDetails>>`. Its `dataTransform` case routes `check` / `run` through a local `bodyToClosure(expr)` helper.
- [ ] `bodyToClosure(expr)` returns `() => placeholder(slot)` for `PlaceholderExpression` (invocation throws `PN-MIG-2001`) and throws an internal-invariant error for any other variant.
- [ ] Every `private buildX` method on `PostgresMigrationPlanner` returns `PostgresOpFactoryCall[]`.
- [ ] `planner-reconciliation.ts` produces `PostgresOpFactoryCall[]`.
- [ ] `PostgresMigrationPlanner.plan()`'s external `MigrationPlannerResult` shape is unchanged.
- [ ] `pnpm -r typecheck`, `pnpm -r lint` pass.
- [ ] Every existing Postgres planner test passes unchanged: `planner.integration.test.ts`, `planner.behavior.test.ts`, `planner.storage-types.integration.test.ts`, `planner.reconciliation.integration.test.ts`, `planner.authoring-surface.test.ts`.
- [ ] New unit tests per concrete call class: construct with literal args, assert frozen, assert `accept()` dispatches to the correct visitor method, assert `label` is what the planner would produce, assert `renderTypeScript()` and `importRequirements()` outputs.
- [ ] New unit tests for `PlaceholderExpression`: `renderTypeScript()` returns `() => placeholder("slot")`, `importRequirements()` returns the `placeholder` entry, `bodyToClosure` of it returns a closure whose invocation throws `PN-MIG-2001`.
- [ ] New unit tests per `renderOps` case: every variant in the union has an assertion; `dataTransform` of a placeholder-bearing `DataTransformCall` produces a runtime op whose `check` / `run` closures throw `PN-MIG-2001` when invoked.
- [ ] New unit test for `renderCallsToTypeScript`: every variant round-trips through `renderTypeScript()`, the import block is deduplicated and sorted, and a `DataTransformCall` with placeholder bodies emits `() => placeholder("slot")` in-line while contributing a `placeholder` import.
- [ ] New unit test for `TypeScriptRenderablePostgresMigration`: construct with a fixed `calls` array + meta, assert `operations` = `renderOps(calls)` (for placeholder-free inputs), assert `renderTypeScript()` produces parseable TypeScript whose dynamic import reconstructs the same `operations`.
- [ ] `db update` end-to-end smoke via existing CLI integration tests — applies against a live Postgres and the runner's post-apply `verifySqlSchema` check passes, confirming the retargeted walk-schema path still produces equivalent recipes.
- [ ] `satisfies PostgresOpFactoryCallVisitor<R>` is present on every visitor implementation — compile-time exhaustiveness for future variant additions.

## Non-goals

- No issue-planner changes. `descriptor-planner.ts`, `planner-strategies.ts` are untouched.
- No changes to `migrationStrategy` or `migration plan`.
- No CLI changes.
- No cross-target generic `TypeScriptRenderableMigration` lift. Mongo's concrete class stays separate from Postgres's. The `MigrationTsExpression` / `ImportRequirement` duplication between the two targets is intentional here; it is the target of the cross-target consolidation follow-up (see `plan.md` §"Known follow-ups").
- No change to Mongo's rendered migration.ts output (byte-identical). No change to Mongo's planner, `mongoEmit`, or CLI wiring.

## Risks

- **Call-class inventory drift.** Walk-schema paths that the Phase 0 factory inventory missed surface as type errors when retargeting `buildX`. Mitigation: the walk-schema audit is the authoritative checklist; cross-reference it before writing call classes.
- **`renderCallsToTypeScript` output shape.** The renderer's output isn't tested against existing scaffolded files in this phase (that's Phase 3). Mitigation: in Phase 1, snapshot the renderer output against hand-written expected strings for each variant so the shape is pinned; Phase 3's per-example apply/verify exercises the round-trip end-to-end.
- **Label regressions.** The planner today produces labels through various helpers (e.g. `buildTargetDetails`). The new call classes compute labels in their constructors — if the format regresses it's a user-facing diagnostic regression, independent of schema equivalence. Mitigation: a per-call-class label snapshot test pins the format.

## Estimate

5–6 days. 1 day framework+family lift + call-class skeleton, 2 days walk-schema retargeting, 1 day renderers + tests, 0.5–1 day integration test pass and label-parity fixes, 0.5–1 day Mongo IR sync (mechanical; `MigrationTsExpression` + polymorphic renderer rewrite, gated by Mongo's existing snapshot tests).

## References

- Plan: [`plan.md`](../plan.md) §"Phase 1"
- Spec: [`spec.md`](../spec.md) §R2.7–R2.9, §R3.1–R3.3
- Walk-schema audit: [`walk-schema-audit.spec.md`](./walk-schema-audit.spec.md)
- Phase 0 factory extraction: [`phase-0-factory-extraction.spec.md`](./phase-0-factory-extraction.spec.md)
- [ADR 193 — Class-flow as the canonical migration authoring strategy](../../../docs/architecture%20docs/adrs/ADR%20193%20-%20Class-flow%20as%20the%20canonical%20migration%20authoring%20strategy.md)
- [ADR 194 — Plans carry their own authoring surface](../../../docs/architecture%20docs/adrs/ADR%20194%20-%20Plans%20carry%20their%20own%20authoring%20surface.md)
- [ADR 195 — Planner IR with two renderers](../../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md)
- [ADR 200 — Placeholder utility for scaffolded migration slots](../../../docs/architecture%20docs/adrs/ADR%20200%20-%20Placeholder%20utility%20for%20scaffolded%20migration%20slots.md)
- Mongo reference: `packages/3-mongo-target/1-mongo-target/src/core/{op-factory-call.ts,planner-produced-migration.ts,render-typescript.ts}`
