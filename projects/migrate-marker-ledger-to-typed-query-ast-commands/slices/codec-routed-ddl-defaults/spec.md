# Slice: codec-routed-ddl-defaults

_(In-project slice. Parent project: `projects/migrate-marker-ledger-to-typed-query-ast-commands/`. Outcome contributed: the SQL family's migration ops conform to the gold-standard "driver-executable statement" pattern Mongo already follows — `*Call.toOp()` produces wire-typed payloads whose params are codec-encoded, and the adapter owns the full lowering from AST → driver-executable. The codec-routed-defaults bug fix is the immediate outcome; the architectural correction it sits on is what the slice actually delivers.)_

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

Same shape in SQLite. Result: `Date` defaults produce invalid SQL (`'"2025-01-01T00:00:00.000Z"'`), `bigint` defaults throw at plan time. Both bugs pre-exist in PG; SQLite's byte-parity test in TML-2859 D5 surfaced them, and verifying the PG side confirmed the same bug.

The architectural read is that the SQL family's migration step shape diverged from the gold-standard pattern Mongo already follows. Mongo's `MigrationStep.command: AnyMongoDdlCommand` carries a wire-typed AST that the driver executes directly. The SQL equivalent of the Mongo wire type is `{sql: string, params: readonly unknown[]}` where params hold codec-encoded wire values — the **driver-executable statement**. SQL has this shape today (`SqlMigrationPlanOperationStep`), but params is treated as a side door and the renderer ends up inlining raw JS values it shouldn't be touching. The adapter is the dialect authority for the wire type; codec encoding and grammar-position dispatch belong inside it.

## Chosen design

### Name the wire type

`DriverExecutableStatement` (or similar — pick taste; the name matters for documentation more than for compilation). Contract:

```ts
interface DriverExecutableStatement {
  readonly sql: string;                                    // fully lowered
  readonly params: readonly unknown[];                     // codec-encoded wire values, driver-ready
}
```

`SqlMigrationPlanOperationStep.params` becomes non-optional and contractually wire-encoded (today it's `params?: readonly unknown[]` with comments saying values "are bound at execution time"; the runner already passes them through `driver.query(sql, params ?? [])`). The shape doesn't change; the contract on `params` tightens.

### Adapter exposes the missing half of its lowering pipeline

Today the adapter exposes one method: `lower(ast, ctx): LoweredStatement` — sync, produces SQL template + params-with-raw-values for the runtime path. The runtime layer between adapter and driver handles the codec encoding (so middleware can mutate raw values before encode runs).

The control plane has no runtime sandwich; it persists migration ops directly to ops.json. So the adapter exposes a second method that finishes the lowering:

```ts
interface SqlControlAdapter<TTarget extends string = string> extends Lowerer {
  // existing — runtime path, sync, returns LoweredStatement with raw param values
  lower(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): LoweredStatement;

  // new — control path, async, returns driver-executable statement
  lowerForControl(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): Promise<DriverExecutableStatement>;
}
```

Internally, `lowerForControl` does roughly:
1. Call `lower(ast, ctx)` to get `{sql, params}` with raw JS values.
2. For each `{kind: 'literal', value}` in params, resolve the column's codec and `await codec.encode(value, ctx)` to get the wire value.
3. For each codec-encoded param: if its grammar position accepts a parameter placeholder, leave `$N` in `sql` and put the wire value in the result's `params` array. If the grammar position must inline (DDL `DEFAULT` clauses in PG/SQLite — parameters not accepted), substitute the wire value into `sql` as an inline SQL literal with proper quoting + cast suffix, omit from result params.
4. Return `{sql, params: encodedWireValues}`.

Step 3's grammar-position dispatch is a dialect-aware detail of the adapter — the renderer can mark each emitted `$N` with whether the position is parameterizable or must-inline, and `lowerForControl` honors that. Implementation detail; the public contract is the input/output shape.

The runtime query path is untouched. `lower()` keeps its existing signature and semantics; the runtime middleware lifecycle (`runBeforeCompile → lowerSqlPlan → beforeExecute → encodeParams → intercept → driver`) continues to live in `5-runtime/src/codecs/encoding.ts` exactly as it does today.

### `*Call.toOp()` returns `Op | Promise<Op>`

The abstract base widens:

```ts
abstract class OpFactoryCallNode {
  abstract toOp(lowerer?: Lowerer): MigrationPlanOperation | Promise<MigrationPlanOperation>;
}
```

Concrete `*Call`s that don't lower DDL with literal defaults (`DropTable`, `RawSql`, `AddColumn` without a default, etc.) keep returning `MigrationPlanOperation` directly — they don't need codec orchestration.

Concrete `*Call`s that lower DDL with literal defaults (PG `CreateTableCall`, PG `CreateSchemaCall`, SQLite `CreateTableCall` — plus any data-transform calls whose params have raw JS values today) become async and delegate to `lowerForControl`:

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
    const statement = await lowerer.lowerForControl(node, { contract: {} });
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

### The renderer's `defaultVisitor.literal` shrinks or vanishes

`defaultVisitor.literal` no longer inlines values. Either it emits `$N` placeholders (treating literal defaults like any other parameter, with a marker indicating "must inline at lowerForControl time"), or the renderer skips emitting `DEFAULT (...)` for literal defaults entirely and `lowerForControl` adds the clause after encoding. Implementation choice during the dispatch — the public contract is that `lower()` doesn't have to do anything intelligent with literal default values.

The TML-2861 `isTextLikeNativeType` cast-suffix heuristic stops living in the renderer's visitor; `lowerForControl` adds the cast suffix when it inline-substitutes (because that's the point at which the wire value is known and the cast can be applied correctly). The TML-2859 D5 expanded type-branching in SQLite's `defaultVisitor.literal` is deleted as part of the same cleanup.

## Done when

- `DriverExecutableStatement` type is defined and exported from family-sql.
- `SqlControlAdapter.lowerForControl(ast, ctx): Promise<DriverExecutableStatement>` exists on both PG and SQLite adapter implementations, with grammar-position dispatch for parameterizable-vs-inline positions correctly handled.
- `SqlMigrationPlanOperationStep` embeds `DriverExecutableStatement` (or its shape); `params` is non-optional and contractually wire-encoded.
- The three DDL-lowering `*Call`s — PG `CreateTableCall`, PG `CreateSchemaCall`, SQLite `CreateTableCall` — become `async toOp` and delegate to `lowerForControl`. All other `*Call`s stay sync.
- `*Call.toOp` abstract base allows `Op | Promise<Op>` return.
- `MigrationPlanWithAuthoringSurface.operations` and `MigrationPlan.operations` type widens to `readonly (Op | Promise<Op>)[]`.
- Every consumer of `.operations` on a live plan adds `await Promise.all(...)`: PG runner, SQLite runner, PG planner-strategies, synth.ts, planner-produced migration accessors, anywhere else grep surfaces.
- `stripOperations` (or the equivalent serialization step) awaits all promises before producing the serialized form persisted to ops.json.
- The renderer's `defaultVisitor.literal` no longer hand-rolls type-branching for value-to-SQL-literal conversion on either target. TML-2861's `isTextLikeNativeType` heuristic moves into `lowerForControl`. TML-2859 D5's expanded type-branching in SQLite's renderer is deleted.
- `pnpm fixtures:check` green; existing PG and SQLite migration goldens pass (the bug fix may regenerate fixtures for Date / bigint / jsonb defaults; if so, the regeneration is the slice's intended output).
- `pnpm test:packages`, `pnpm test:integration`, `pnpm lint:deps`, `pnpm lint:casts` green.
- The user-authoring shape in `examples/*/migrations/**/migration.ts` is byte-for-byte unchanged — no `async`, no `await`, no method-name changes.

## Out of scope

- **Control-plane Runtime / middleware lifecycle**. The control path doesn't go through middleware today; `lowerForControl` is a one-shot adapter method. If the control plane ever needs middleware (CipherStash-for-DDL, audit, dry-run hooks), the right answer is a control-plane Runtime that splits `lowerForControl` into stages with middleware between them — exactly mirroring the runtime path's `lower → middleware → encodeParams → driver` shape. That's a separate project; this slice doesn't touch it.
- **Runtime query path changes**. `lower()`, `LoweredStatement`, `LoweredParam`, `5-runtime/src/codecs/encoding.ts`, the runtime middleware lifecycle — all untouched. The runtime path keeps splitting lower from encode so middleware can sit between them.
- **Mongo migration ops**. Mongo already follows the gold-standard pattern (`MigrationStep.command: AnyMongoDdlCommand`). No changes needed there.
- **Other `*Call` migrations onto the AST + lowerForControl path** (`AddColumn`, `DropColumn`, `CreateIndex`, `DropTable`, `RecreateTable`, etc.). Phase 2 of the parent project. The slice's named outcome is the three DDL-lowering calls that lower with literal defaults.
- **The `*Call` layer's two-renderer pattern** (`renderTypeScript()` + `toOp()`). Unchanged. `renderTypeScript()` produces the same TS source it does today; `toOp()` widens its return type and one body becomes async per the three calls in scope.
- **`SerializedQueryPlan`** at `control-migration-types.ts:90`. The shape (`{sql: string, params: readonly unknown[]}`) is the same as `DriverExecutableStatement` — could be the same type. Whether to unify is a small naming decision during the dispatch; the architecture doesn't change either way.

## Notes

- Linear issue: [TML-2867](https://linear.app/prisma-company/issue/TML-2867).
- Plan: [`./plan.md`](./plan.md).
- Originating bug: TML-2859 (slice 5 / SQLite CreateTable adoption) review finding F1 — byte-parity test caught SQLite's broken `defaultVisitor.literal`; investigation confirmed PG has the same shape.
- Related: TML-2754 (PG planner adoption — shipped with the type-branching bug); TML-2859 (SQLite planner adoption — ships with same transitional state in PR #768); TML-2861 (`::jsonb` cast — its `isTextLikeNativeType` heuristic moves from the renderer into `lowerForControl`); TML-2866 (`DdlColumn.type` smuggling — orthogonal).
- ADR reference: ADR 195 ("Planner IR with two renderers") — the `*Call` IR layer this slice operates within. Mongo's `MongoMigrationStep` is the working precedent the slice mirrors for SQL.
