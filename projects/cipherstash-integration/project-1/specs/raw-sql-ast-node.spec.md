# Summary

Add `RawSqlExpr` to the SQL `AnyQueryAst` union as a first-class AST node carrying interpolated `ParamRef`s embedded in literal SQL fragments, and extend the Postgres lowerer with a corresponding arm. This unblocks the [migration-factories task spec](migration-factories.spec.md) — which needs to issue raw EQL function calls (`SELECT eql_v2.add_search_config(...)`) inside `DataTransformOperation` bodies — without requiring the (separate) public `raw\`...\`` template factory to land first. The AST node is independently useful: any caller who can construct one gets full participation in the codec registry, middleware seam, and standard lowering pipeline.

# Description

`packages/2-sql/4-lanes/relational-core/src/ast/types.ts:1629` declares `AnyQueryAst = SelectAst | InsertAst | UpdateAst | DeleteAst`. There's no AST kind for "already-rendered SQL with embedded `ParamRef`s." Today's only path to raw SQL is hand-constructing a `SqlExecutionPlan` literal (test fixtures only — no production callers; the user-facing `raw\`...\`` factory promised in `types.ts:259` is type-only, not implemented). That hand-constructed-plan path is structurally wrong: it bypasses codec resolution at the `ParamRef` layer, bypasses middleware that walks `params.entries()` looking for codec ids, bypasses any AST-level analyzer.

Adding `RawSqlExpr` as a real AST node fixes the structural problem and lets cipherstash's migration factories produce `DataTransformOperation`s carrying `invariantId`s — *without* coupling cipherstash to the (separate, parallel) effort to ship a public `raw\`...\`` template-literal factory at [`sql-raw-factory`](../../sql-raw-factory/spec.md).

The cleavage is deliberate: this task spec ships the **AST node + lowerer arm + minimum package-internal construction surface**. The public user-facing `raw\`...\`` factory, the `RawArg` type union (Expression | ParamRef | Identifier), bare-value type rejection, and the `identifier(...)` escape hatch all live in `projects/sql-raw-factory/`. Cipherstash needs none of those — it constructs `RawSqlExpr` directly from validated `ParamRef`s built inside the migration-factories module.

If `sql-raw-factory` ships before this spec, the work merges into that project. If this spec ships first, `sql-raw-factory` consumes the AST node and adds the user-facing factory on top.

# Requirements

## Functional Requirements

### `RawSqlExpr` AST node

A new variant of `AnyQueryAst` added to `packages/2-sql/4-lanes/relational-core/src/ast/types.ts`. The node carries:

```ts
export class RawSqlExpr extends AstNode {
  readonly kind = 'raw-sql' as const;
  /**
   * Literal SQL chunks. Interleaved with `args`: rendering produces
   * `fragments[0] + lower(args[0]) + fragments[1] + lower(args[1]) + ... + fragments[n]`.
   * Always exactly `args.length + 1` entries — enforced at construction.
   */
  readonly fragments: readonly string[];
  /**
   * Interpolated AST nodes, one per gap between fragments. Each is a
   * `ParamRef` carrying a codec id, or an `AnyExpression` from the typed
   * builder. `RawSqlExpr` itself does not perform any value-to-AST
   * conversion — callers construct `ParamRef.of(value, { codecId })`
   * (or build typed expressions) before passing them in.
   */
  readonly args: readonly AnyExpression[];

  constructor(fragments: readonly string[], args: readonly AnyExpression[]);
  static of(fragments: readonly string[], args: readonly AnyExpression[]): RawSqlExpr;
}
```

Construction enforces `fragments.length === args.length + 1` (the template-literal invariant) and freezes the instance. Construction does **not** validate the interpolated args — the caller is responsible for ensuring each arg is a real `ParamRef` or `AnyExpression`. Type-level rejection of bare values is the public-factory's responsibility, not the AST node's.

The node extends `AstNode` (not `Expression`) — it represents a *whole* query, not a sub-expression embeddable in a `WHERE` clause. A separate `rawSqlExpr` (sub-expression-shaped) variant is out of scope for this spec; if it's needed later it lives separately.

### `AnyQueryAst` union update

```ts
export type AnyQueryAst = SelectAst | InsertAst | UpdateAst | DeleteAst | RawSqlExpr;
```

Downstream:

- `queryAstKinds: ReadonlySet<string>` (currently includes `'select' | 'insert' | 'update' | 'delete'`) gains `'raw-sql'`.
- `isQueryAst(value)` recognizes the new kind.
- Any exhaustive switch on `kind` in the AST visitors / rewriters / folders gains a `'raw-sql'` arm. The framework's existing visitor-pattern code surfaces these as compilation errors when the union widens, providing a worklist.

### Postgres lowerer arm

`packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts` (the renderer both `PostgresAdapterImpl.lower` and `PostgresControlAdapter.lower` delegate to) gains a `'raw-sql'` arm. Skeleton:

```ts
function lowerRawSqlExpr(node: RawSqlExpr, ctx: LowererContext): LoweredStatement {
  const sqlBuf: string[] = [];
  const params: unknown[] = [];

  for (let i = 0; i < node.fragments.length; i++) {
    sqlBuf.push(node.fragments[i]);
    if (i < node.args.length) {
      const arg = node.args[i];
      if (arg.kind === 'param-ref') {
        // Standard ParamRef lowering: resolve via codec registry, append to
        // params array, emit positional placeholder. The renderer already
        // implements this; reuse it.
        const placeholder = appendParam(params, arg, ctx);
        sqlBuf.push(placeholder);
      } else {
        // Inlined sub-expression — recursively lower; concat its rendered SQL,
        // append its resolved params in order.
        const lowered = lowerExpression(arg, ctx);
        sqlBuf.push(lowered.sql);
        params.push(...lowered.params);
      }
    }
  }

  return { sql: sqlBuf.join(''), params };
}
```

Codec resolution at the `ParamRef` layer goes through the existing path (the same `appendParam` / equivalent helper the renderer uses for typed-builder `ParamRef`s in `BinaryExpr` / `InsertAst` / etc.). Async codec resolution per ADR 204 works identically — the renderer's existing async-aware machinery doesn't care which AST kind contains the `ParamRef`.

### Package-internal construction surface

`RawSqlExpr` is exported from `@prisma-next/sql-relational-core/ast` so any package in the monorepo can construct one. There's no public *factory function* — callers use `new RawSqlExpr(fragments, args)` or `RawSqlExpr.of(fragments, args)`. The cipherstash migration-factories module constructs `RawSqlExpr` instances directly:

```ts
// packages/3-extensions/cipherstash/src/exports/migration.ts (sketch)
import { RawSqlExpr, ParamRef } from '@prisma-next/sql-relational-core/ast';

function buildAddSearchConfigAst(table: string, column: string, indexName: string, castAs: string) {
  return RawSqlExpr.of(
    ['SELECT eql_v2.add_search_config(', ', ', ', ', ', ', ')'],
    [
      ParamRef.of(table,    { codecId: 'pg/text@1' }),
      ParamRef.of(column,   { codecId: 'pg/text@1' }),
      ParamRef.of(indexName,{ codecId: 'pg/text@1' }),
      ParamRef.of(castAs,   { codecId: 'pg/text@1' }),
    ],
  );
}
```

The cipherstash factory wraps the resulting AST in a `SqlQueryPlan` shape (with `meta.lane: 'raw'`, `meta.storageHash` from the supplied `endContract`, and `params: []` — the resolved params array is populated at lowering time, not at construction). That `SqlQueryPlan` then flows through `dataTransform({ run: () => ... })` unchanged.

### `SqlQueryPlan` envelope helper

A small helper exported from `@prisma-next/sql-relational-core` (or `relational-core/plan`) that wraps an `AnyQueryAst` plus a contract reference into a fully-populated `SqlQueryPlan`:

```ts
export function planFromAst<R = unknown>(
  ast: AnyQueryAst,
  contract: Contract<SqlStorage>,
  laneId: string = 'raw',
): SqlQueryPlan<R> {
  return {
    ast,
    params: [],
    meta: {
      target: contract.target,
      targetFamily: contract.targetFamily,
      storageHash: contract.storage.storageHash,
      lane: laneId,
    },
  };
}
```

This helper exists because every caller of `RawSqlExpr.of` (cipherstash today; future others) needs to produce a `SqlQueryPlan`, and the boilerplate is identical. Without the helper, every consumer hand-rolls the meta object — and `dataTransform`'s `assertContractMatches` then fails subtly when consumers get `storageHash` wrong.

The `laneId` parameter defaults to `'raw'`. Future lanes (e.g. an explicit `'sql-raw'` for the public factory's outputs, if we want to distinguish) can override.

This helper is **public, package-internal-friendly, narrow** — it doesn't validate the AST, doesn't do any of the `RawArg`-style type pinning. It's strictly the SqlQueryPlan envelope assembler.

### No type-level rejection of bare values at this layer

`RawSqlExpr.of` accepts `readonly AnyExpression[]`. Passing a bare value (a `string`, a `number`) is a *type error* because `string` doesn't satisfy `AnyExpression`. That's accidental safety, not designed safety — the rejection is downstream of the typed-builder's `Expression<T>` and `ParamRef` already being typed shapes.

The full SQL-injection-defense story (rejecting bare values *at the user's call site*, with helpful error messages, and providing the `identifier(...)` escape hatch) lives in `projects/sql-raw-factory/`. That project layers a typed-template-literal factory on top of `RawSqlExpr.of` and adds the `RawArg = Expression | ParamRef | RawSqlIdentifier` union. Until that project lands, this spec deliberately doesn't try to ship the user-facing affordances — the AST node is consumed by cipherstash internally, with cipherstash itself responsible for ensuring it only constructs valid `ParamRef`s.

## Non-Functional Requirements

- **No regression in existing AST traversal.** Visitors and folders that don't add a `'raw-sql'` arm need to surface as compilation errors so they get explicit handling. The existing exhaustiveness checks make this automatic.
- **Frozen, immutable AST nodes.** `RawSqlExpr` follows the existing AST-node convention — `Object.freeze` at construction.
- **Lowerer is single-pass.** The renderer walks `fragments` and `args` in interleaved order, producing the rendered SQL string and the params array in canonical traversal order.
- **Codec resolution is uniform.** `RawSqlExpr`-embedded `ParamRef`s go through the same `resolveParamValue` / `appendParam` path as typed-builder-embedded `ParamRef`s. Bulk-encrypt middleware (per [middleware-param-transform task spec](middleware-param-transform.spec.md)) sees raw-plan params in `params.entries()` because `params.entries()` walks the AST's `ParamRef`s by structural recursion.

## Non-goals

- **Public user-facing `raw\`...\`` factory.** That's `projects/sql-raw-factory/`.
- **Type-level rejection of bare interpolated values.** That's `projects/sql-raw-factory/`. This spec accepts whatever type-level rejection naturally falls out of accepting `AnyExpression[]`.
- **`identifier(...)` escape hatch for SQL identifiers.** Cipherstash's migration factories don't need it — the EQL `add_search_config` function accepts its identifier-like args (table, column) as text params. `identifier(...)` lives in `sql-raw-factory` for the general-purpose case.
- **Sub-expression `RawSqlExpr` variant.** Whether `RawSqlExpr` should be an `Expression` (embeddable in a `WHERE` clause) rather than just an `AstNode` (top-level only) is deferred. Defer the moment a real consumer needs it.
- **Mongo `RawMongoCommand` parity.** Mongo has its own raw-command path (`packages/2-mongo-family/4-query/query-ast/src/raw-commands.ts`); SQL and Mongo raw paths evolve independently.
- **Lowering for targets other than Postgres.** SQLite / MySQL / future SQL targets each ship their own lowerer arm when they need it. Postgres-only in this spec.

# Acceptance Criteria

## AST node

- [ ] **AC-AST1**: `RawSqlExpr` is exported from `@prisma-next/sql-relational-core/ast` with `kind: 'raw-sql'`.
- [ ] **AC-AST2**: `RawSqlExpr.of(fragments, args)` and `new RawSqlExpr(fragments, args)` both construct frozen instances.
- [ ] **AC-AST3**: Construction enforces `fragments.length === args.length + 1`; mismatched lengths throw a clearly-typed error at construction.
- [ ] **AC-AST4**: `AnyQueryAst` includes `RawSqlExpr` as an arm.
- [ ] **AC-AST5**: `queryAstKinds` and `isQueryAst` recognize `'raw-sql'`.

## Lowerer

- [ ] **AC-LOW1**: A `RawSqlExpr` containing one `ParamRef` lowers to SQL with `$1` substituted at the param's position; the lowered `params` array contains the codec-encoded value.
- [ ] **AC-LOW2**: A `RawSqlExpr` containing multiple `ParamRef`s in different positions lowers with `$1`, `$2`, ... in source order.
- [ ] **AC-LOW3**: A `RawSqlExpr` whose embedded args include an inlined `Expression` from the typed builder lowers correctly — sub-SQL interpolated, sub-params appended in canonical order.
- [ ] **AC-LOW4**: Async codec resolution (per ADR 204) works for `RawSqlExpr`-embedded `ParamRef`s identically to typed-builder-embedded `ParamRef`s.
- [ ] **AC-LOW5**: A `RawSqlExpr` with `args.length === 0` lowers to its single `fragments[0]` string with empty `params`.

## SqlQueryPlan envelope helper

- [ ] **AC-PLAN1**: `planFromAst(ast, contract)` produces a `SqlQueryPlan` whose `meta.storageHash` matches `contract.storage.storageHash`.
- [ ] **AC-PLAN2**: `meta.lane` defaults to `'raw'` and is overridable.
- [ ] **AC-PLAN3**: The returned plan satisfies `dataTransform`'s `assertContractMatches` for the supplied contract.

## End-to-end with cipherstash and `dataTransform`

- [ ] **AC-E2E1**: A migration-factory test constructs a `RawSqlExpr` via `RawSqlExpr.of(...)` for a `SELECT eql_v2.add_search_config(...)` call, wraps it via `planFromAst`, hands the plan to `dataTransform({ run: () => plan })`, and the resulting `DataTransformOperation` carries the expected `{ sql, params }` after `assertContractMatches` and `adapter.lower(plan.ast, ctx)`.
- [ ] **AC-E2E2**: Same scenario as AC-E2E1 but with `invariantId: 'cipherstash.user.email.search-enabled'` declared on the `dataTransform` options — `deriveProvidedInvariants(...)` reads the invariant id back unchanged.

# Other Considerations

## Security

This spec does not ship type-level SQL-injection defense — that's `sql-raw-factory`'s job. Within Project 1 of cipherstash, the only consumer is the migration-factories module, which constructs `RawSqlExpr` instances over a closed set of known-string inputs (table name, column name, EQL index name, EQL cast type). Those four inputs flow into `ParamRef`s, not into `fragments`, so they're parameterized rather than text-inlined — SQL-injection-safe at the cipherstash-internal level.

If a future caller uses `RawSqlExpr.of` outside `sql-raw-factory`'s typed wrapper, the security responsibility falls on that caller. Documented in the AST node's docstring with a pointer to `sql-raw-factory`'s `raw\`...\`` factory as the recommended user-facing surface.

## Cost

CI delta: ~5-7 unit tests (AST node construction + freezing, kind recognition, lowerer arm with various arg counts, async codec interaction, end-to-end with `dataTransform`). No runtime cost in any path that doesn't construct a `RawSqlExpr`.

## Observability

`SqlExecutionPlan.meta.lane: 'raw'` continues to be the discriminator. The `ast?: AnyQueryAst` field on `SqlExecutionPlan` is now meaningfully populated for raw plans (where today's hand-constructed test fixtures left it absent), giving telemetry consumers the option to inspect the structured form.

## Data Protection

No new data-protection surface. Codec encoding (which is the layer responsible for any per-value transformation including encryption) runs identically against `RawSqlExpr`-embedded params and typed-builder params.

# References

- [Project 1 spec](../spec.md)
- [Umbrella spec](../../spec.md)
- [migration-factories task spec](migration-factories.spec.md) — the immediate consumer.
- [`sql-raw-factory`](../../sql-raw-factory/spec.md) — sibling component of the umbrella that ships the user-facing `raw\`...\`` factory on top of the AST node this spec adds.
- [`packages/2-sql/4-lanes/relational-core/src/ast/types.ts:1629`](../../../../packages/2-sql/4-lanes/relational-core/src/ast/types.ts) — `AnyQueryAst` union (extended by this project).
- [`packages/2-sql/4-lanes/relational-core/src/ast/types.ts:395-436`](../../../../packages/2-sql/4-lanes/relational-core/src/ast/types.ts) — existing `ParamRef` class.
- [`packages/2-sql/4-lanes/relational-core/src/plan.ts`](../../../../packages/2-sql/4-lanes/relational-core/src/plan.ts) — `SqlQueryPlan` shape.
- [`packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts:72`](../../../../packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts) — `PostgresControlAdapter.lower` (the lowerer entry point).
- [`packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts) — `dataTransform` factory and `Buildable` (composes with this AST unchanged).

# Open Questions

1. **Lowerer arm packaging.** The `'raw-sql'` arm is a small addition to the renderer's existing `kind` switch. Whether to factor it into a separate helper file (`sql-renderer-raw.ts`) or inline it into the existing renderer module is implementation choice — default: inline, factor only if the renderer module gets unwieldy.
2. **`planFromAst` location and naming.** Lives in `relational-core/plan.ts` next to `SqlQueryPlan`, or in a utility module? Default: `relational-core/plan.ts`. Naming: `planFromAst` is descriptive but verbose; `wrapAst` is shorter but less precise. Confirm.
3. **Visitor / rewriter / folder arms.** The existing `ExprVisitor` / `AstRewriter` / `ExpressionFolder` interfaces in `ast/types.ts:30-59` cover *expression* visitors. `RawSqlExpr` is a *query* AST node, not an expression — the existing query-level walker (whatever shape it takes — likely a switch on `AnyQueryAst.kind` in the lowerer) gains the new arm. There's no new visitor interface to add. Confirm by reading the renderer's actual structure during implementation.
4. **`fragments[0]` empty-string case.** A template literal like `\`${value} extra\`` produces `fragments = ['', ' extra']`. Empty strings in fragments are normal and the lowerer must handle them (concatenation already does). No special case needed; flagged just for test-coverage explicitness.
