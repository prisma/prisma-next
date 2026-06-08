# Slice: codec-routed-ddl-defaults

_(In-project slice: parent project `projects/migrate-marker-ledger-to-typed-query-ast-commands/`. Outcome it contributes: a substrate fix surfaced by slice 5 review — DDL default-literal rendering routes through the column's codec on both PG and SQLite, replacing hand-rolled type-branching in the adapter renderer with the same encoding path the runtime parameter-binding already uses. Untangles a duplicated encoding surface and unblocks correct DDL emission for `Date` and `bigint` defaults on both targets.)_

## At a glance

Both adapter DDL renderers' `defaultVisitor.literal` today inspect `typeof value` to decide how to render the SQL literal — boolean as `0/1`, string as quoted-and-escaped, JSON via `JSON.stringify`. That logic is a parallel mini-codec. It's also wrong: `Date` falls through to `JSON.stringify` and produces invalid SQL (`'"2025-...Z"'`); `bigint` throws. The runtime parameter-binding path doesn't have this bug because it routes the value through the column's `Codec.encode(value, ctx) → Promise<TWire>`. The DDL emission path should too.

```ts
// before — packages/3-targets/6-adapters/postgres/src/core/ddl-renderer.ts:112-126 (SQLite has the same shape)
literal(node, ctx): string {
  const { value } = node;
  if (typeof value === 'number' || typeof value === 'boolean') return `DEFAULT ${String(value)}`;
  if (value === null) return 'DEFAULT NULL';
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const literal = `'${escapeLiteral(serialized)}'`;
  return isTextLikeNativeType(ctx.nativeType) ? `DEFAULT ${literal}` : `DEFAULT ${literal}::${ctx.nativeType}`;
}

// after
async literal(node, ctx): Promise<string> {
  if (node.value === null) return 'DEFAULT NULL';
  const wire = await node.codec.encode(node.value, {});
  const literalFragment = wireToDefaultLiteral(wire);   // target-specific: string vs Uint8Array
  return isTextLikeNativeType(ctx.nativeType) ? `DEFAULT ${literalFragment}` : `DEFAULT ${literalFragment}::${ctx.nativeType}`;
}
```

The codec is the canonical encoder for a column's type. The renderer's job collapses to "wrap-and-quote the codec's wire output, add the `::nativeType` cast suffix when the native type isn't text-like." `isTextLikeNativeType` from TML-2861 stays as the cast-suffix decision — that part isn't codec business.

## Chosen design

### `LiteralColumnDefault` gains a `codec` reference

The IR node carries the codec it was constructed with. The construction-time helpers (`postgresDefaultToDdlColumnDefault` in `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:96`, `sqliteDefaultToDdlColumnDefault` in `packages/3-targets/3-targets/sqlite/src/core/migrations/issue-planner.ts:272`) gain a `codec: Codec` parameter and pass it into the node constructor. The IR is self-describing — the renderer doesn't need to look up the codec separately.

```ts
// packages/2-sql/4-lanes/relational-core/src/ast/ddl-types.ts
export class LiteralColumnDefault extends DdlColumnDefault {
  constructor(
    readonly value: ColumnDefaultLiteralInputValue,
    readonly codec: Codec<unknown, unknown>,
  ) { super(); freezeNode(this); }
  accept<R>(visitor: DdlColumnDefaultVisitor<R>, ctx: DdlColumnRenderContext): R {
    return visitor.literal(this, ctx);
  }
}
```

### Async everywhere through the DDL chain

`Codec.encode` is async (`Promise<TWire>`). Decision: propagate async through the DDL render / lower chain rather than introducing a sync sibling on the Codec interface. Reasons:

1. The encode path is intentionally async — codecs may consult network resources or async-only crypto primitives. A sync sibling forces every codec implementation to be sync-only, narrowing what codecs can do.
2. The consumers of the chain (runner, planner-strategies, planner constructors) are already in async context. The async propagation doesn't reach a sync boundary that would force a re-architecture.
3. The async propagation is mechanical (`async`, `await`, `Promise.all`) — no architectural decision per call site.

Methods and interfaces that go async:

```text
defaultVisitor.literal        → Promise<string>
DdlColumnDefaultVisitor<R>    → both methods return Promise<R>
DdlColumnDefault.accept       → returns R (still works; R becomes Promise<string>)
renderColumn (PG & SQLite)    → async
createTable visitor entry     → async (await Promise.all over column renders)
renderLoweredDdl              → async, returns Promise<*LoweredStatement>
*ControlAdapter.lower         → async
Lowerer.lower (interface)     → Promise<LoweredStatement>
abstract *Call.toOp           → Promise<Op>
PG CreateTableCall.toOp       → async (awaits lowerer.lower)
PG CreateSchemaCall.toOp      → async (awaits lowerer.lower)
SQLite CreateTableCall.toOp   → async (awaits lowerer.lower)
other *Call.toOp              → return Promise.resolve(...) (signature-only change)
renderOps (PG & SQLite)       → async, returns Promise<Op[]>
MigrationPlanWithAuthoringSurface.operations  → getOperations(): Promise<Op[]>  (sync getter becomes async method)
```

The `MigrationPlanWithAuthoringSurface` change is the only consumer-facing interface change. Consumers (both targets' `runner.ts` + `planner-strategies.ts` + `planner.ts`) are already async; the call sites add `await`. CLI formatters (`packages/1-framework/3-tooling/cli/src/utils/formatters/migrations.ts`) consume the SERIALIZED form (post-`stripOperations`), not the live planner-produced instance — they're untouched.

### Target-specific wire → SQL literal helper

`Codec.encode` returns `TWire`, which is typically a `string` (most codecs) or a `Uint8Array` (bytea / blob codecs). The renderer wraps this into a SQL literal fragment:

```ts
// packages/3-targets/6-adapters/postgres/src/core/ddl-renderer.ts
function wireToDefaultLiteral(wire: string | Uint8Array): string {
  if (typeof wire === 'string') return `'${escapeLiteral(wire)}'`;
  return `'\\x${bytesToHex(wire)}'`;   // PG bytea hex-escape literal
}

// packages/3-targets/6-adapters/sqlite/src/core/ddl-renderer.ts
function wireToDefaultLiteral(wire: string | Uint8Array): string {
  if (typeof wire === 'string') return `'${escapeLiteral(wire)}'`;
  return `X'${bytesToHex(wire)}'`;     // SQLite blob literal
}
```

If a codec returns something neither string nor Uint8Array, the helper throws (codecs that return objects/numbers/booleans/Dates would need to be aligned with the wire-encoding contract; today no such codec ships).

### Codec resolution at IR-construction time

The construction-time helpers need a `Codec` to pass into `LiteralColumnDefault`. The resolution path:

```
*ControlAdapter (knows codecLookup)
  → create*MigrationPlanner(adapter)            (gains codecLookup from adapter)
  → IssuePlannerOptions { codecLookup }         (new field)
  → StrategyContext { codecLookup }             (threaded down)
  → toDdlColumn (PG) / tableToDdlParts (SQLite) (resolves codec via codecLookup + column type)
  → postgresDefaultToDdlColumnDefault / sqliteDefaultToDdlColumnDefault (gains codec parameter)
  → new LiteralColumnDefault(value, codec)
```

Files that thread the `codecLookup` resolver (mirror on each target):
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts` (PG planner constructor reads adapter's `codecLookup`)
- `packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts` (`IssuePlannerOptions` interface)
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts` (`StrategyContext` interface)
- Same trio under `packages/3-targets/3-targets/sqlite/src/core/migrations/`

### `MigrationPlanWithAuthoringSurface.operations` becomes async

```ts
// before — framework-components/control
interface MigrationPlanWithAuthoringSurface {
  get operations(): Op[];
  // ...
}

// after
interface MigrationPlanWithAuthoringSurface {
  getOperations(): Promise<Op[]>;
  // ...
}
```

Consumers — exhaustive list (all already in async context):
- `packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts` (4 call sites)
- `packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts` (5 call sites)
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts` (2 call sites)
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts` (the planner constructor that returns the live instance)
- Both targets' `planner-produced-*-migration.ts` implementations (the implementors of the interface)

The CLI consumers in `migration-plan.ts`, `db-init.ts`, `db-update.ts`, `db-run.ts`, `migration-show.ts`, `formatters/migrations.ts` consume `result.plan.operations` and `space.operations` from the serialized form (post-`stripOperations`) — they're untouched.

## Done when

- `git grep "typeof value === 'boolean'" packages/3-targets/6-adapters` → zero matches in `ddl-renderer.ts` files (both targets).
- `LiteralColumnDefault` carries a required `codec` field; the construction-time helpers populate it.
- Both `defaultVisitor.literal` implementations call `codec.encode` and emit the result via the target's `wireToDefaultLiteral` helper. No `JSON.stringify` fallback. No type-branching on the JS value.
- DDL render chain is async end-to-end through `*Call.toOp(lowerer)`. `Lowerer.lower()` returns `Promise<LoweredStatement>`. `MigrationPlanWithAuthoringSurface.getOperations()` returns `Promise<Op[]>`.
- Target-specific `wireToDefaultLiteral` helpers handle `string` and `Uint8Array`; throw on unexpected wire types.
- TML-2861's `::jsonb` / `::json` cast behaviour preserved — the cast suffix is decided by `isTextLikeNativeType(ctx.nativeType)` against the codec-produced literal.
- TML-2859 D5's expanded type-branching in the SQLite `defaultVisitor.literal` (boolean, Date, bigint) is deleted (the codec handles these correctly).
- `pnpm fixtures:check` green; PG and SQLite migration goldens green with no regeneration.
- `pnpm lint:deps` green; `pnpm lint:casts` delta zero.

## Out of scope

- Codec interface changes. The existing `encode(value, ctx) → Promise<TWire>` is reused. No `encodeLiteral` sibling, no sync variant.
- Migration of remaining `*Call` classes (`AddColumn`, `DropColumn`, `CreateIndex`, `DropIndex`, `DropTable`, `RecreateTable`) onto the DDL-AST path. Those stay on the existing flat-spec / string-build path; they're Phase 2 of the parent project.
- The structural fix for `DdlColumn.type` smuggling `PRIMARY KEY AUTOINCREMENT` (TML-2866). The cross-linking comments TML-2859 D5 added stay; the SQLite renderer's autoincrement substring check stays.
- Slice 4 / PR #751's `family.adapter` shape. Untouched.
- Mongo. The change touches the SQL DDL chain only; Mongo migration ops don't go through `Lowerer`.
- `planner-ddl-builders.ts`'s `renderDefaultLiteral` helper. Two surviving callers (`buildColumnDefaultSql` for the Phase 2 flat-spec path; `sqliteRenderDefault` for the schema-verify hook) keep it alive. Deleting it is Phase 2 work.

## Notes

- Linear issue: [TML-2867](https://linear.app/prisma-company/issue/TML-2867).
- Plan: [`./plan.md`](./plan.md).
- Originating review: TML-2859 slice-DoD reviewer pass, finding F1.
- Related: TML-2754 (PG planner adoption — shipped with the type-branching bug); TML-2859 (SQLite planner adoption — ships with same transitional state); TML-2861 (`::jsonb` cast — preserved); TML-2866 (`DdlColumn.type` smuggling — orthogonal).
