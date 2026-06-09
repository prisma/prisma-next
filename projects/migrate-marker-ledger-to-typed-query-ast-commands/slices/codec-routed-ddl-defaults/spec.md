# Slice: codec-routed-ddl-defaults

_(In-project slice. Parent project: `projects/migrate-marker-ledger-to-typed-query-ast-commands/`. Outcome contributed: the SQL family's migration ops conform to the gold-standard pattern Mongo already follows — `*Call.toOp()` produces a wire-typed payload whose params are codec-encoded, and the adapter owns the full lowering from AST → driver-ready statement. The codec-routed-defaults bug fix is the immediate outcome; the architectural correction it sits on is what the slice actually delivers.)_

## At a glance

Both adapter renderers hand-roll `defaultVisitor.literal` to inline DDL default literal values into the emitted SQL string:

```ts
// packages/3-targets/6-adapters/postgres/src/core/ddl-renderer.ts:113
literal(node, ctx) {
  if (typeof value === 'number' || typeof value === 'boolean') return `DEFAULT ${String(value)}`;
  // ...
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);  // ← Date / bigint fall here
}
```

Same shape in SQLite. Result: `Date` defaults produce invalid SQL, `bigint` defaults throw at plan time. Both bugs pre-exist in PG; SQLite's byte-parity test in TML-2859 D5 surfaced them, and verifying the PG side confirmed the same bug.

The architectural read is that the SQL family's migration step shape diverged from the gold-standard pattern Mongo already follows. Mongo's `MigrationStep.command: AnyMongoDdlCommand` carries a wire-typed AST that the driver executes directly. The SQL equivalent of the Mongo wire type is `{sql: string, params: readonly unknown[]}` where params hold codec-encoded wire values — what we're naming the **driver statement**. SQL has this shape today (`SqlMigrationPlanOperationStep`), but params is treated as a side door and the renderer ends up inlining raw JS values it shouldn't be touching. The adapter is the dialect authority for the wire type; codec encoding and grammar-position dispatch belong inside it.

## Chosen design

### Name the wire type

`DriverStatement`. Contract:

```ts
interface DriverStatement {
  readonly sql: string;                                    // fully lowered
  readonly params: readonly unknown[];                     // codec-encoded wire values, driver-ready
}
```

`SqlMigrationPlanOperationStep.params` becomes non-optional and contractually wire-encoded (today it's `params?: readonly unknown[]` with comments saying values "are bound at execution time"; the runner already passes them through `driver.query(sql, params ?? [])`). The shape doesn't change; the contract on `params` tightens.

### Adapter exposes a second lowering method

Today the adapter exposes one method: `lower(ast, ctx): LoweredStatement` — sync, produces SQL template + params-with-raw-values for the runtime path. The runtime layer between adapter and driver handles the codec encoding (so middleware can mutate raw values before encode runs).

The control plane has no runtime sandwich; it persists migration ops directly to ops.json. So the adapter exposes a second, **independent** method that finishes the lowering:

```ts
interface SqlControlAdapter<TTarget extends string = string> extends Lowerer {
  // existing — runtime path, sync, returns LoweredStatement with raw param values
  lower(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): LoweredStatement;

  // new — control path, async, returns the driver-ready statement
  lowerToDriverStatement(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): Promise<DriverStatement>;
}
```

The two methods are independent. `lowerToDriverStatement` does NOT call `lower()` and does NOT share output with it. Internally it walks the AST and produces `DriverStatement` directly — codec encoding happens during that walk (the adapter resolves the codec for each column native type via its existing `codecLookup` and `await`s `codec.encode`). For positions where the dialect grammar accepts parameter placeholders (most query positions), wire values are kept as `$N` + params array entries. For positions where the grammar requires inlining (DDL `DEFAULT` clauses on PG/SQLite), the wire value is substituted into the SQL string with the appropriate quoting and (PG only) `::nativeType` cast suffix.

How `lowerToDriverStatement` shares (or doesn't share) code with the existing renderer is an internal implementation detail of the adapter package — could be a separate visitor with parameterized literal handling, could be a fork of the existing visitor, could be a different mechanism. The public contract is the input/output shape; the existing public surfaces (`Lowerer.lower`, `LoweredStatement`, `renderLoweredDdl`, `defaultVisitor.literal`) stay byte-for-byte as they are.

### `*Call.toOp()` returns `Op | Promise<Op>`

The abstract base widens:

```ts
abstract class OpFactoryCallNode {
  abstract toOp(lowerer?: Lowerer): MigrationPlanOperation | Promise<MigrationPlanOperation>;
}
```

Concrete `*Call`s that don't lower DDL with literal defaults (`DropTable`, `RawSql`, `AddColumn` without a default, etc.) keep returning `MigrationPlanOperation` directly — they don't need codec orchestration.

Concrete `*Call`s that lower DDL with literal defaults (PG `CreateTableCall`, PG `CreateSchemaCall`, SQLite `CreateTableCall` — plus any data-transform calls whose params have raw JS values today) become async and delegate to `lowerToDriverStatement`:

```ts
class PostgresCreateTableCall extends OpFactoryCallNode {
  override async toOp(lowerer: Lowerer): Promise<MigrationPlanOperation> {
    if (lowerer === undefined) throw errorMissingLowerer(this.tableName);
    const node = contractFreeDdl.createTable({
      schema: this.schemaName,
      table: this.tableName,
      columns: this.columns,
      ...(this.constraints ? { constraints: this.constraints } : {}),
    });
    const statement = await lowerer.lowerToDriverStatement(node, { contract: {} });
    return {
      id, label, operationClass, target,
      precheck: [],
      execute: [{ description: `create table "${this.tableName}"`, ...statement }],
      postcheck: [],
    };
  }
}
```

The `*Call` no longer knows about codec selection, grammar positions, or inline substitution. It assembles a DDL AST, hands it to the adapter, wraps the result into the migration op shape.

### `operations` getter stays sync, returns `(Op | Promise<Op>)[]`

The user-authoring shape stays bit-for-bit identical to today (`examples/prisma-next-postgis-demo/migrations/app/20260512T1309_migration/migration.ts`):

```ts
export default class M extends Migration {
  override describe() { return { ... }; }
  override get operations() {
    return [
      this.createTable({ schema: 'public', table: 'cafe', columns: [...], constraints: [...] }),
      this.createTable({ schema: 'public', table: 'neighborhood', columns: [...], constraints: [...] }),
    ];
  }
}
```

`this.createTable({...})` returns whatever `toOp()` returns — `Op` or `Promise<Op>`. The getter is a sync array literal. The user writes no `async`, no `await`, no special syntax. The async-ness is invisible at the authoring surface.

The planner-produced migration's getter on the framework side stays sync too:

```ts
// packages/3-targets/3-targets/postgres/src/core/migrations/planner-produced-postgres-migration.ts:62
override get operations(): readonly (MigrationPlanOperation | Promise<MigrationPlanOperation>)[] {
  return renderOps(this.#calls, this.#lowerer);
}
```

`renderOps` becomes `(calls, lowerer) => calls.map(c => c.toOp(lowerer))`. Returns a mixed array.

### Consumers await once at the boundary

Every consumer that today reads `plan.operations` and iterates it adds `await Promise.all(...)` at the point of access:

```ts
// runner.ts (sketch)
const ops = await Promise.all(options.plan.operations);
for (const op of ops) { ... }
```

`Promise.all` over `(T | Promise<T>)[]` resolves both kinds correctly — sync entries are wrapped trivially, async entries are awaited. Consumers of the serialized form (post-`stripOperations`) see only sync `Op[]` and `Promise.all` is a pass-through.

The framework `MigrationPlanWithAuthoringSurface.operations` type widens:

```ts
interface MigrationPlanWithAuthoringSurface extends MigrationPlan {
  readonly operations: readonly (MigrationPlanOperation | Promise<MigrationPlanOperation>)[];
}
```

For the `extends` relationship to hold, `MigrationPlan.operations` (the parent — the serialized form) widens too:

```ts
interface MigrationPlan {
  readonly operations: readonly (MigrationPlanOperation | Promise<MigrationPlanOperation>)[];
}
```

In practice the serialized form's array only ever contains sync `Op`s (Promises don't survive JSON). The widening is a type-level statement that consumers must `await Promise.all` defensively; it's a no-op when there are no actual promises. `stripOperations` becomes the natural materialization point: `{ ...plan, operations: await Promise.all(plan.operations) }`. After that, downstream JSON-serialization paths handle a plain `Op[]`.

### The existing renderer + `lower()` stay untouched until consumers migrate

`lower()` keeps its existing signature, semantics, and output bit-for-bit. The renderer's `defaultVisitor.literal` keeps its existing hand-rolled type-branching body. The TML-2861 `isTextLikeNativeType` heuristic stays in the renderer where it lives today.

The bug (Date / bigint / jsonb defaults produce wrong SQL) continues to manifest for any caller that goes through `lower()` until that caller migrates to `lowerToDriverStatement`. The slice is structured so the migration happens incrementally:
- **D1** adds `lowerToDriverStatement` + `DriverStatement` + the widened `*Call.toOp` return type. No consumer migration; existing `*Call.toOp()` bodies still call `lower()` and still produce broken-for-some-types SQL. The bug is unfixed.
- **D2** migrates PG `*Call.toOp()` to `lowerToDriverStatement` + widens the framework `MigrationPlan.operations` type + adapts consumers. PG side of the bug is fixed.
- **D3** mirrors on SQLite + deletes TML-2859 D5's expanded type-branching in the SQLite renderer (no longer reachable via the live executable path). SQLite side of the bug is fixed.

After D2/D3, the renderer's `defaultVisitor.literal` on both targets is dead code on the live executable path (only the runtime path's query lowering keeps it alive, and that path doesn't go through DDL defaults). Whether to delete it outright or leave it dormant is a small cleanup at the end of D3.

## Done when

- `DriverStatement` type defined and exported from family-sql.
- `SqlControlAdapter.lowerToDriverStatement(ast, ctx): Promise<DriverStatement>` exists on both PG and SQLite adapter implementations, with grammar-position dispatch for parameterizable-vs-inline positions correctly handled.
- The existing `Lowerer.lower()` interface, `LoweredStatement` shape, `LoweredParam` shape, and renderer `defaultVisitor.literal` bodies on both targets are bit-for-bit unchanged after D1.
- `SqlMigrationPlanOperationStep` embeds `DriverStatement` (or its shape); `params` is non-optional and contractually wire-encoded — applied when consumers actually populate the new shape (D2/D3).
- The three DDL-lowering `*Call`s — PG `CreateTableCall`, PG `CreateSchemaCall`, SQLite `CreateTableCall` — become `async toOp` and delegate to `lowerToDriverStatement` (D2/D3). All other `*Call`s stay sync.
- `*Call.toOp` abstract base allows `Op | Promise<Op>` return (D2 introduces the widening since that's where the first async concrete arrives).
- `MigrationPlanWithAuthoringSurface.operations` and `MigrationPlan.operations` type widens to `readonly (Op | Promise<Op>)[]` (D2).
- Every consumer of `.operations` on a live plan adds `await Promise.all(...)`: PG runner, SQLite runner, PG planner-strategies, synth.ts, planner-produced migration accessors, anywhere else grep surfaces (D2/D3).
- `stripOperations` (or the equivalent serialization step) awaits all promises before producing the serialized form persisted to ops.json (D2).
- TML-2859 D5's expanded type-branching in SQLite renderer's `defaultVisitor.literal` is deleted (D3, as part of the renderer cleanup once the live executable path no longer goes through it).
- `pnpm fixtures:check` green; existing PG and SQLite migration goldens regenerate for `Date` / `bigint` / `jsonb` default cases (the regen IS the bug fix).
- `pnpm test:packages`, `pnpm test:integration`, `pnpm lint:deps`, `pnpm lint:casts` green.
- The user-authoring shape in `examples/*/migrations/**/migration.ts` is byte-for-byte unchanged — no `async`, no `await`, no method-name changes.

## Out of scope

- **Control-plane Runtime / middleware lifecycle**. The control path doesn't go through middleware today; `lowerToDriverStatement` is a one-shot adapter method. If the control plane ever needs middleware (CipherStash-for-DDL, audit, dry-run hooks), the right answer is a control-plane Runtime that splits `lowerToDriverStatement` into stages with middleware between them — exactly mirroring the runtime path's `lower → middleware → encodeParams → driver` shape. That's a separate project; this slice doesn't touch it.
- **Runtime query path changes**. `lower()`, `LoweredStatement`, `LoweredParam`, `5-runtime/src/codecs/encoding.ts`, the runtime middleware lifecycle — all untouched. The runtime path keeps splitting lower from encode so middleware can sit between them.
- **Mongo migration ops**. Mongo already follows the gold-standard pattern (`MigrationStep.command: AnyMongoDdlCommand`). No changes needed there.
- **Other `*Call` migrations onto the AST + lowerToDriverStatement path** (`AddColumn`, `DropColumn`, `CreateIndex`, `DropTable`, `RecreateTable`, etc.). Phase 2 of the parent project. The slice's named outcome is the three DDL-lowering calls that lower with literal defaults.
- **The `*Call` layer's two-renderer pattern** (`renderTypeScript()` + `toOp()`). Unchanged. `renderTypeScript()` produces the same TS source it does today; `toOp()` widens its return type and one body becomes async per the three calls in scope.
- **`SerializedQueryPlan`** at `control-migration-types.ts:90`. The shape (`{sql: string, params: readonly unknown[]}`) is the same as `DriverStatement` — could be the same type. Whether to unify is a small naming decision during the dispatch; the architecture doesn't change either way.

## Notes

- Linear issue: [TML-2867](https://linear.app/prisma-company/issue/TML-2867).
- Plan: [`./plan.md`](./plan.md).
- Originating bug: TML-2859 (slice 5 / SQLite CreateTable adoption) review finding F1 — byte-parity test caught SQLite's broken `defaultVisitor.literal`; investigation confirmed PG has the same shape.
- Related: TML-2754 (PG planner adoption — shipped with the type-branching bug); TML-2859 (SQLite planner adoption — ships with same transitional state in PR #768); TML-2861 (`::jsonb` cast — its `isTextLikeNativeType` heuristic stays in the existing renderer for the runtime path; the new path inside `lowerToDriverStatement` reimplements the same decision); TML-2866 (`DdlColumn.type` smuggling — orthogonal).
- ADR reference: ADR 195 ("Planner IR with two renderers") — the `*Call` IR layer this slice operates within. Mongo's `MongoMigrationStep` is the working precedent the slice mirrors for SQL.
