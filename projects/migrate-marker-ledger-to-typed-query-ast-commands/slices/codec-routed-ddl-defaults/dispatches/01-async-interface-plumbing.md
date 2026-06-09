# Brief: D1 — Define `DriverExecutableStatement` + add `lowerForControl` on both adapters

## What this dispatch does

Adds the missing half of the SQL adapter's lowering pipeline: a new async method `lowerForControl(ast, ctx): Promise<DriverExecutableStatement>` on both PG and SQLite control adapter implementations. The method consults the column's codec to encode literal default values, then either keeps them as parameters or substitutes them inline depending on the grammar position. The existing sync `lower(ast, ctx): LoweredStatement` method is **untouched**; the runtime query path keeps its existing two-stage flow (lower → middleware → encodeParams → driver) exactly as it works today.

The renderer's `defaultVisitor.literal` on both targets gets its hand-rolled type-branching deleted. It emits a parameter placeholder (`$N`) plus a `{kind: 'literal', value, inlineRequired: true}` entry in the `LoweredStatement.params` array, marking the position as one that grammar forces inline. The substitution actually happens inside `lowerForControl`.

No `*Call.toOp()` changes in this dispatch. No framework-interface changes. No consumer changes. The substrate goes in; D2 and D3 wire `*Call.toOp` onto it.

## Concrete changes

### 1. Define `DriverExecutableStatement`

Where: co-locate with `LoweredStatement` — likely `packages/2-sql/4-lanes/relational-core/src/ast/types.ts` (where `LoweredStatement` lives at line 1984). Confirm by grep before writing.

```ts
export interface DriverExecutableStatement {
  readonly sql: string;                              // fully lowered, all literals materialized
  readonly params: readonly unknown[];               // codec-encoded wire values; driver-ready
}
```

Export from the package's existing exports surface (whatever `LoweredStatement` exports through).

### 2. Extend `LoweredParam` with `inlineRequired`

```ts
// types.ts:1980 — current
export type LoweredParam =
  | { readonly kind: 'literal'; readonly value: unknown }
  | { readonly kind: 'bind'; readonly name: string };

// change to
export type LoweredParam =
  | { readonly kind: 'literal'; readonly value: unknown; readonly inlineRequired?: boolean }
  | { readonly kind: 'bind'; readonly name: string };
```

`inlineRequired` is set by the renderer when emitting in a DDL `DEFAULT` position (or any other position that the dialect grammar doesn't accept parameters in). Default `false` / `undefined` means parameterize. Optional field so existing literal-param construction sites don't need to change.

### 3. Add `lowerForControl` to `SqlControlAdapter`

Where: `packages/2-sql/9-family/src/core/control-adapter.ts` around line 232 (where the existing `lower` is declared on `SqlControlAdapter`).

```ts
export interface SqlControlAdapter<TTarget extends string = string> extends ... {
  // existing
  lower(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): LoweredStatement;

  // new
  lowerForControl(
    ast: AnyQueryAst | DdlNode,
    context: LowererContext<unknown>,
  ): Promise<DriverExecutableStatement>;
}
```

Don't change the `Lowerer` structural interface — that one stays sync (`lower` only). `lowerForControl` is specific to control adapters; the structural `Lowerer` used by the runtime query path doesn't need to know about it.

### 4. Implement `lowerForControl` on PG

Where: `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts` (the class with the existing sync `lower` at line 157).

Sketch:

```ts
async lowerForControl(
  ast: AnyQueryAst | PostgresDdlNode,
  context: LowererContext<unknown>,
): Promise<DriverExecutableStatement> {
  const lowered = this.lower(ast, context);          // existing sync path
  const wireParams: unknown[] = [];
  let sql = lowered.sql;
  let nextParamIndex = 1;
  let nextInputParamIndex = 0;
  // walk lowered.params; for each {kind:'literal'} resolve codec + encode;
  // if inlineRequired, substitute into sql with proper quoting + cast suffix;
  // otherwise put wire value into wireParams and renumber placeholder
  for (const param of lowered.params) {
    if (param.kind !== 'literal') {
      // bind passthrough — keep $N referencing this param's slot
      ...
      continue;
    }
    const codec = this.resolveCodec(param /* codec selection — see (5) */);
    const wire = await codec.encode(param.value, {});
    if (param.inlineRequired) {
      const literal = renderInlineLiteral(wire, /* native type from context */);
      sql = substituteAt(sql, nextInputParamIndex + 1, literal);
    } else {
      wireParams.push(wire);
    }
    nextInputParamIndex += 1;
  }
  return { sql, params: wireParams };
}
```

`renderInlineLiteral(wire, nativeType)` is target-specific:
- `string` wire: `'${escapeLiteral(wire)}'` then if not text-like (per TML-2861's `isTextLikeNativeType`) append `::${nativeType}`.
- `Uint8Array` wire: `'\\x${bytesToHex(wire)}'` then `::bytea`.
- `number` / `bigint`: `String(wire)` — unquoted, no cast.
- Anything else: throw with `RUNTIME.ENCODE_UNSUPPORTED_WIRE_TYPE` (or whatever envelope fits the pattern in the file).

Move TML-2861's `isTextLikeNativeType` helper from `ddl-renderer.ts` into the adapter's `lowerForControl` (or a helper file alongside it). It stops being a renderer concern; it's a substitution-time concern.

### 5. Codec resolution in `lowerForControl`

The adapter has access to the codec registry via its constructor (`codecLookup` field — grep `PostgresControlAdapter` for the field). The renderer must pass enough information through `LoweredParam` for `lowerForControl` to resolve the right codec per param. Two ways:

- **(a)** Extend `LoweredParam.literal` with a `codecRef?: CodecRef` field. The renderer emits the codec ref when it knows it (every DDL literal default's column has a known codec).
- **(b)** Extend `LoweredParam.literal` with a `nativeType?: string` field. The adapter uses `codecLookup` to find the codec by storage type.

(a) is more direct (codec is named, not resolved by lookup). (b) reuses the existing `codecLookup` shape but adds an indirection.

Pick (a). The DDL renderer has the column's `DdlColumn` in hand when it visits the default; the column type maps to a codec ref via the adapter's existing codec ref resolution (grep `codecRefForNativeType` or similar — likely in `relational-core`). Pass that ref through `LoweredParam`.

For `nativeType` (needed for the `::nativeType` cast suffix and for `isTextLikeNativeType`), also add it to `LoweredParam.literal`:

```ts
type LoweredParam =
  | { kind: 'literal'; value: unknown; inlineRequired?: boolean; codecRef?: CodecRef; nativeType?: string }
  | { kind: 'bind'; name: string };
```

The renderer fills `inlineRequired` / `codecRef` / `nativeType` when emitting DDL literal defaults. Other literal-param emit sites (e.g. query lowering for `WHERE id = literal(5)`) keep the existing fields and ignore the new ones (they don't need them — runtime path doesn't use `lowerForControl`).

### 6. Implement `lowerForControl` on SQLite

Where: `packages/3-targets/6-adapters/sqlite/src/core/control-adapter.ts` (the class with the existing sync `lower` at line 128).

Same shape as PG, modulo dialect differences:
- No `::nativeType` cast suffix — SQLite has no cast syntax in DDL.
- `Uint8Array` wire → `X'${bytesToHex(wire)}'` (SQLite blob literal syntax).
- `string` / `number` / `bigint` wire same as PG.

The `isTextLikeNativeType` helper isn't needed on SQLite (no cast).

### 7. Renderer cleanup — PG

Where: `packages/3-targets/6-adapters/postgres/src/core/ddl-renderer.ts:112-126`.

Delete the existing `defaultVisitor.literal` body. Replace with:

```ts
literal(node: LiteralColumnDefault, ctx): string {
  // The visitor's job is to emit the SQL fragment for the default. For
  // literal values, emit a parameter placeholder and surface the value +
  // grammar position + codec metadata as a LoweredParam. The adapter's
  // lowerForControl substitutes the wire-encoded value back into the
  // SQL string at lowering time.
  const paramIndex = ctx.allocParam({
    kind: 'literal',
    value: node.value,
    inlineRequired: true,                          // DDL DEFAULT can't be parameterized in PG
    codecRef: ctx.codecRefForColumn,               // threaded through ctx by the column visitor
    nativeType: ctx.nativeType,
  });
  return `DEFAULT $${paramIndex}`;
}
```

The renderer's visitor-context mechanism — how params are allocated and threaded — already exists for query AST lowering; reuse the same path. Find it (grep `allocParam` or how `ParamRef` lowers to `$N`); follow that pattern. If the DDL visitor doesn't currently have a param-allocation context, extend it.

The `function` visitor stays unchanged (`autoincrement()` → empty; everything else → `DEFAULT (${expression})`).

Delete `isTextLikeNativeType` from this file (moves to `lowerForControl` / its helper).

### 8. Renderer cleanup — SQLite

Where: `packages/3-targets/6-adapters/sqlite/src/core/ddl-renderer.ts:79-106`.

Same pattern as PG. Delete the TML-2859 D5 expanded type-branching (boolean / Date / bigint / null / JSON fallback). Replace with the `DEFAULT $N` + `allocParam` shape.

SQLite has no `nativeType` cast, so the `nativeType` field on the param is set but `lowerForControl`'s inline-substitution helper ignores it (or uses it only to dispatch wire-shape, not to emit `::type`).

### 9. Out of scope

- **`*Call.toOp()` changes.** D2 / D3 own that. The existing `*Call.toOp` bodies that call `lowerer.lower(...)` keep doing so; their output now includes parameterized DDL defaults that the existing path can't render correctly **for the live executable path**. That's expected — those `*Call`s still funnel through the old code; D2 / D3 rewire them onto `lowerForControl`. D1's renderer changes only need to be observable through new adapter-level tests for `lowerForControl`, NOT through full migration-emission integration tests.
- **Framework-interface widening.** `MigrationPlan.operations` / `MigrationPlanWithAuthoringSurface.operations` stay `readonly Op[]`. The type-system widening is D2's job (when async `*Call.toOp` actually returns Promise<Op>).
- **Consumers adding `await Promise.all`.** D2 / D3.
- **`SerializedQueryPlan`.** Leave unchanged. Whether to unify it with `DriverExecutableStatement` (they have the same shape) is a follow-up decision.

## Completed when

- [ ] `DriverExecutableStatement` type defined and exported.
- [ ] `LoweredParam.literal` extended with optional `inlineRequired`, `codecRef`, `nativeType` fields.
- [ ] `SqlControlAdapter.lowerForControl(ast, ctx): Promise<DriverExecutableStatement>` exists on the interface and on both `PostgresControlAdapter` and `SqliteControlAdapter` implementations.
- [ ] `Lowerer` structural interface (used by runtime query path) is **unchanged** — still has only `lower`.
- [ ] PG `defaultVisitor.literal` and SQLite `defaultVisitor.literal` no longer type-branch on the JS value. Both emit `DEFAULT $N` + populate `LoweredParam` with `inlineRequired: true` + codec/nativeType metadata.
- [ ] Inline-substitution helper handles `string`, `Uint8Array`, `number`, `bigint` wire types per target; throws on unexpected wire types with a named error.
- [ ] TML-2861's `isTextLikeNativeType` helper moved from PG renderer into PG `lowerForControl` (or its helper file).
- [ ] TML-2859 D5's expanded type-branching in SQLite renderer is deleted (boolean → 0/1, Date → ISO, bigint → String(value)). The autoincrement guard in `sqliteDefaultToDdlColumnDefault` (in `issue-planner.ts`) STAYS (codec-orthogonal).
- [ ] Adapter-level tests for `lowerForControl` covering string / Date / bigint / Uint8Array / null literal defaults on both targets, asserting that the returned SQL has the wire value substituted inline with correct quoting + cast (PG only).
- [ ] Existing PG migration goldens / SQLite migration goldens — may regenerate for `Date` / `bigint` / `jsonb` default cases where the codec-routed output is the correct one. **The regen IS the intended bug fix; don't try to preserve the broken output.** Capture which fixtures regenerated and why in the dispatch summary.
- [ ] `pnpm typecheck` green workspace-wide.
- [ ] `pnpm test:packages` green.
- [ ] `pnpm fixtures:check` green (including any expected fixture regens).
- [ ] `pnpm lint:deps` + `pnpm lint:casts` green.
- [ ] Runtime query path (`pnpm test:packages --filter relational-core`, `... --filter sql-runtime`) **unchanged** — no test changes in those packages. If a test fails there, D1 leaked.

## Halt conditions

- The visitor context mechanism doesn't have a param-allocation path that's reusable for DDL defaults (the existing path is queries-only). Surface; the brief assumes the mechanism exists.
- A codec implementation returns a wire type outside `string | Uint8Array | number | bigint` and the inline-substitution helper can't format it. Surface with the codec name + wire type.
- The runtime query path tests fail. The slice should NOT change that path; if a test fails, the dispatch leaked into territory it shouldn't have. Surface.
- A migration golden regenerates in a way that suggests a bug — output WORSE than what the broken type-branching produced for a case where the broken output happened to be valid by accident. Surface with the diff.
- More than 25 source files modified. Surface.
- 200+ tool calls without committing. Surface.

## Standing instruction

Stay focused. Substrate-only. Do NOT touch `*Call.toOp` bodies (D2 / D3 own that). Do NOT widen the framework `MigrationPlan` interface (D2). Do NOT change consumers (D2 / D3). Do NOT touch the runtime query path (`relational-core`, `sql-runtime`, the runtime middleware lifecycle, `encodeParams`, `LoweredStatement` consumers outside the renderer).

## References

- **Spec:** [`../spec.md`](../spec.md) — full design.
- **Plan:** [`../plan.md`](../plan.md) § Dispatch 1.
- **Codec interface:** `packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts:75` (`encode`).
- **Existing `Lowerer.lower`:** `packages/2-sql/9-family/src/core/control-adapter.ts:31`.
- **Existing PG `lower` impl:** `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts:157`.
- **Existing SQLite `lower` impl:** `packages/3-targets/6-adapters/sqlite/src/core/control-adapter.ts:128`.
- **PG renderer's `defaultVisitor`:** `packages/3-targets/6-adapters/postgres/src/core/ddl-renderer.ts:112`.
- **SQLite renderer's `defaultVisitor`:** `packages/3-targets/6-adapters/sqlite/src/core/ddl-renderer.ts:79`.
- **`LoweredStatement` / `LoweredParam`:** `packages/2-sql/4-lanes/relational-core/src/ast/types.ts:1980`.
- **Mongo's gold-standard wire-type pattern (reference):** `packages/2-mongo-family/4-query/query-ast/src/migration-operation-types.ts:17` (`MongoMigrationStep.command: AnyMongoDdlCommand`).

## Operational metadata

- **Model tier:** sonnet — substrate work + adapter implementation.
- **Time-box:** 90 minutes wall-clock. Surface at 90 minutes.
- **Tool-call budget:** 200 max before committing intermediate state.

## Repo standing constraints

- Worktree: `/Users/wmadden/Projects/prisma/prisma-next/.claude/worktrees/adoring-swartz-9d66c0`.
- Branch: `tml-2867-codec-routed-ddl-defaults`.
- `pnpm`, never `npm` / `npx`.
- No bare `as` casts in production code; tests exempt.
- No TS import file extensions.
- No transient project refs in code or comments (`// D1`, `// TML-2867`, etc. all forbidden in code; allowed in commit messages).

## Commit + sign-off

Commit on `tml-2867-codec-routed-ddl-defaults`. Sign off as `Will Madden <madden@prisma.io>`. End with `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`. Commit message describes the structural change (e.g. `add lowerForControl + DriverExecutableStatement; renderer stops inlining literal defaults`).
