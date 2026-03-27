# Summary

Extend `sql-orm-client`'s `ModelAccessor` proxy so that fields backed by extension codec types (e.g. pgvector's `Vector`) expose the operations declared by those extensions (e.g. `cosineDistance`). The result of calling an extension operation returns an object that behaves like a scalar column — exposing comparison methods (`lt`, `gt`, `eq`, …) and ordering methods (`asc`, `desc`) — so extension expressions compose naturally in `where()`, `orderBy()`, and `select()` callbacks.

# Description

Today the ORM client's `ModelAccessor` returns `ComparisonMethods<T, Traits>` for every scalar field, where the available methods are gated by the codec's declared traits (e.g. `'equality'`, `'order'`, `'numeric'`, `'textual'`). Extension operations like pgvector's `cosineDistance` are already modeled in the contract (via `SqlOperationSignature` and `OperationTypes`) and work in the lower-level `sql-builder-new` DSL, but the ORM client has no mechanism to surface them.

The goal is to make this work:

```typescript
await posts
  .where(p => p.embedding.cosineDistance(searchParam).lt(0.2))
  .orderBy(p => p.embedding.cosineDistance(searchParam).asc())
  .all()
```

Key constraints:
- Extension methods must only appear on fields whose codec type declares those operations (type-safe).
- The return value of an extension method (e.g. `cosineDistance(...)`) must expose the same comparison/ordering interface as a scalar column, based on the operation's declared return type.
- Extension expressions must produce proper AST nodes (`AnyWhereExpr` for filters, an expression-based order node for ordering) with `ParamRef` nodes carrying parameter values directly. The query planner compiles these to SQL via the operation's `lowering` template, and `deriveParamsFromAst()` extracts parameters at compile time.
- The existing `ToWhereExpr` protocol (which now returns bare `AnyWhereExpr`) should be leveraged for where-clause integration.
- `orderBy()` currently only accepts `OrderByDirective` (a plain `{ column, direction }` object). It needs to be extended to accept expression-based ordering (for computed values like distance functions).

# Requirements

## Functional Requirements

### FR-1: Extension methods on ModelAccessor fields

When a model field's storage column has a codec type that declares operations (e.g. `pg/vector@1` declares `cosineDistance`), accessing that field on the `ModelAccessor` proxy must return an object that includes both:
- The standard trait-gated `ComparisonMethods<T, Traits>` for the field's JS type (methods gated by the codec's declared traits via `COMPARISON_METHODS_META`), and
- Additional methods for each operation declared by the codec type.

Example: `p.embedding` returns an object with trait-gated comparison methods (e.g. `eq()` if the codec has `'equality'` trait), `asc()`/`desc()` (if `'order'` trait), **and** `cosineDistance()`.

The `createModelAccessor` function already receives `ExecutionContext` which carries the `CodecRegistry`. The codec registry's `traitsOf(codecId)` is used for trait-based method gating. Extension operation lookup should follow a similar pattern — the `ExecutionContext` (or an operation registry derived from it) provides the operation signatures for a given codec ID.

### FR-2: Extension operation return values behave like scalar expressions

The object returned by calling an extension method (e.g. `p.embedding.cosineDistance(searchParam)`) must expose:
- Trait-gated comparison methods that produce `AnyWhereExpr` nodes. The traits are determined by the operation's declared return type's codec (e.g. `cosineDistance` returns `number` which maps to a codec with `['equality', 'order', 'numeric']` traits, so `lt()`, `gt()`, `sum()` etc. are available). Parameter values are carried inside `ParamRef` AST nodes — no separate binding wrapper.
- Ordering methods (`asc`, `desc`) if the return type's codec has the `'order'` trait.
- `isNull()` / `isNotNull()` (always available, as these have no trait requirement).

The available comparison methods and their argument types should be determined by the operation's declared return type (e.g. `cosineDistance` returns `number`, so `lt(0.2)` accepts a `number`). The trait gating follows the same `COMPARISON_METHODS_META` mechanism used for regular fields.

### FR-3: Expression-based orderBy

`Collection.orderBy()` must accept not just plain column-based ordering but also expression-based order specifications produced by extension operations. The query planner must compile these to SQL using the operation's lowering template.

The current `OrderByDirective` (`{ column, direction }`) is replaced with a richer AST-based representation, following a pattern similar to `WhereExpr` / `ToWhereExpr`. The new representation must still preserve the leftmost ordered columns in the type state, since `distinctOn` depends on knowing the ordered column names at the type level. `CollectionState.orderBy` and `compileSelect` must be updated accordingly.

### FR-4: Parameter binding for extension operations

Extension operations that take parameters (e.g. `cosineDistance(searchParam)`) must store parameter values directly in `ParamRef` AST nodes. This follows the current architecture where:
- `ParamRef.of(value, { name, codecId })` creates a self-contained parameter node.
- `CollectionState.filters` stores bare `AnyWhereExpr` nodes (which may contain `LiteralExpr` for user-provided values).
- At compile time, `bindWhereExpr()` converts `LiteralExpr` → `ParamRef` with the appropriate `codecId` from the column's storage metadata.
- `deriveParamsFromAst()` extracts all `ParamRef` values from the finalized AST to build the `params[]` array for execution.

Extension operation expressions must produce AST nodes that fit into this flow. When building an extension expression like `cosineDistance(searchParam)`, the parameter should be wrapped in a `ParamRef` with the appropriate codec ID for the operation's argument type.

### FR-5: Type safety

At the type level:
- Extension methods must only appear on fields whose codec type declares them. A field typed as `String` must not show `cosineDistance`.
- The argument types of extension methods must match the operation signature's declared args.
- The return type's comparison methods must be trait-gated based on the return type's codec traits (using the same `ComparisonMethods<T, Traits>` mechanism as regular fields).
- All of this must be driven by the contract's type information (codec types, operation types, codec traits) without runtime type generation.

At runtime:
- `createModelAccessor` already gates comparison methods via `context.codecs.traitsOf(codecId)` and `COMPARISON_METHODS_META`. Extension operations on the return value must follow the same pattern — look up the return type's codec traits and only attach methods whose required traits are satisfied.

### FR-6: Multiple extensions compose

If multiple extension packs are active and declare operations on different (or the same) codec types, all operations must be available on the appropriate fields. Operations from different extensions on the same codec type are merged.

## Non-Functional Requirements

### NFR-1: No runtime overhead for models without extensions

Models/fields that don't use extension types must not pay any performance cost. The proxy should only look up extension operations when the field's codec type actually declares them.

### NFR-2: Compilation correctness

Extension expressions must compile to correct SQL. The lowering template (e.g. `1 - ({{self}} <=> {{arg0}})`) must be correctly interpolated with the column reference and bound parameters.

### NFR-3: Incremental adoption

Adding extension operation support must not break existing ORM client usage. All current `where()`, `orderBy()`, `select()` patterns must continue to work unchanged.

## Non-goals

- **Extension operations in `select()` projections**: While valuable, the ORM client's `select()` currently works with field names, not arbitrary expressions. Supporting computed columns in select is a follow-up.
- **Extension operations in `groupBy()` / `having()`**: Same rationale — expression-based grouping is a separate concern.
- **Aggregation over extension expressions**: e.g. `avg(cosineDistance(...))` — future work.
- **Custom extension authoring documentation**: This spec covers the runtime/type machinery, not the developer guide for writing new extensions.
- **Extension operations in mutation inputs**: Extensions operate on query expressions, not on data input shapes.

# Acceptance Criteria

## Core functionality

- [ ] `p.embedding.cosineDistance(param)` is callable inside a `where()` callback on a field with codec type `pg/vector@1`, and the resulting expression compiles to correct SQL (`1 - (embedding <=> $1)`).
- [ ] `p.embedding.cosineDistance(param).lt(0.2)` produces a valid `AnyWhereExpr` (with `ParamRef` nodes carrying values) that compiles to `(1 - (embedding <=> $1)) < $2` (or equivalent).
- [ ] `p.embedding.cosineDistance(param).asc()` produces an order expression that compiles to `ORDER BY 1 - (embedding <=> $1) ASC`.
- [ ] Parameters are correctly bound and passed through to the query execution layer.
- [ ] A field without extension operations (e.g. a plain `String` column) does not expose `cosineDistance` or any other extension method — both at the type level and at runtime.

## Type safety

- [ ] TypeScript reports an error when calling `p.title.cosineDistance(...)` on a non-vector field.
- [ ] TypeScript reports an error when passing wrong argument types to an extension method (e.g. `cosineDistance("not a vector")`).
- [ ] The return type of `cosineDistance(...)` correctly types comparison methods — `lt()` accepts `number`, not `string`.
- [ ] The return type of `cosineDistance(...)` is trait-gated: `lt()` is available (return codec has `'order'` trait) but `like()` is not (no `'textual'` trait).
- [ ] Extension methods are discoverable via IDE autocomplete on fields that support them.

## orderBy extension

- [ ] `orderBy(p => p.embedding.cosineDistance(param).asc())` works end-to-end and produces correct SQL.
- [ ] Existing `orderBy(p => p.name.asc())` continues to work without changes.
- [ ] Mixed ordering (plain columns + extension expressions) works: `orderBy([p => p.embedding.cosineDistance(param).asc(), p => p.createdAt.desc()])`.

## Composition

- [ ] Extension expressions compose with `and()` / `or()`: `where(p => and(p.embedding.cosineDistance(param).lt(0.2), p.title.eq("foo")))`.
- [ ] Multiple extension operations on the same query work (e.g. where + orderBy both using `cosineDistance`).

## Backwards compatibility

- [ ] All existing ORM client tests pass without modification.
- [ ] The `CollectionState` shape change (richer `orderBy`) is handled without breaking serialization or plan compilation.

# Other Considerations

## Security

No new attack surface. Extension operations are declared in the contract (which is validated at startup) and compiled to parameterized SQL — no injection risk beyond what already exists.

## Cost

No infrastructure or operating cost impact. This is a compile-time type enrichment + runtime proxy enhancement.

## Observability

No new observability requirements. Extension-generated SQL is logged through the same query logging pipeline as standard queries.

## Data Protection

No change — extension operations are query-time expressions, not data storage changes.

## Analytics

N/A — internal infrastructure change.

# References

- [README.md "Extensibility (extension packs)"](/README.md) — Target developer experience
- [`pgvector` descriptor meta](/packages/3-extensions/pgvector/src/core/descriptor-meta.ts) — Operation signature definition
- [`pgvector` operation types](/packages/3-extensions/pgvector/src/types/operation-types.ts) — Type-level operation descriptors
- [`sql-builder-new` extension function tests](/packages/2-sql/4-lanes/sql-builder-new/test/playground/extension-functions.test-d.ts) — Prior art for extension ops in the lower-level DSL
- [`model-accessor.ts`](/packages/3-extensions/sql-orm-client/src/model-accessor.ts) — Current proxy implementation
- [`where-interop.ts`](/packages/3-extensions/sql-orm-client/src/where-interop.ts) — `normalizeWhereArg` (converts `ToWhereExpr` → bare `AnyWhereExpr`)
- [`where-binding.ts`](/packages/3-extensions/sql-orm-client/src/where-binding.ts) — `bindWhereExpr` (converts `LiteralExpr` → `ParamRef` with codec ID)
- [`query-plan-meta.ts`](/packages/3-extensions/sql-orm-client/src/query-plan-meta.ts) — `deriveParamsFromAst` (extracts `ParamRef` values from finalized AST)
- [`collection.ts`](/packages/3-extensions/sql-orm-client/src/collection.ts) — `where()` and `orderBy()` implementations
- [`types.ts`](/packages/3-extensions/sql-orm-client/src/types.ts) — `ComparisonMethods<T, Traits>`, `COMPARISON_METHODS_META`, `OrderExpr`, `ModelAccessor`, `CollectionState`, `FieldTraits`
- [`codec-types.ts`](/packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts) — `CodecTrait`, `CodecRegistry.traitsOf()`/`hasTrait()`

# Resolved Questions

1. **Runtime operation discovery:** Build a `Map<codecTypeId, OperationSignature[]>` at `OrmClient` initialization from the contract's extension pack metadata, and pass it into `createModelAccessor`.

2. **OrderBy representation:** The current `OrderByDirective` (`{ column, direction }`) cannot represent computed expressions. Replace it with a richer AST-based representation, following a similar pattern to `WhereExpr` / `ToWhereExpr`. The new representation must still preserve the leftmost ordered columns in the type state, since `distinctOn` depends on knowing the ordered column names at the type level.

3. **Parameter binding:** `BoundWhereExpr` has been removed. `ParamRef` now carries values directly (`ParamRef.of(value, { name, codecId })`). `CollectionState.filters` stores bare `AnyWhereExpr[]`. At compile time, `bindWhereExpr()` converts `LiteralExpr` → `ParamRef`, and `deriveParamsFromAst()` extracts all `ParamRef` values from the finalized AST. Extension operations use the same mechanism — wrap parameters in `ParamRef` nodes with the appropriate codec ID.

4. **AST node for extension operations:** Reuse and extend the existing AST from `sql-relational-core`. Add new subclasses as needed for extension operation calls. Do not create a parallel AST in the ORM layer.

5. **Extension metadata plumbing:** `CollectionContext` now carries `ExecutionContext<TContract>`, which bundles the contract, `CodecRegistry` (with `traitsOf()`/`hasTrait()`), and operations metadata. `createModelAccessor` already receives this context for trait-based method gating. Extension operation signatures should be discoverable through the same `ExecutionContext` — either via an operation registry on the context, or by building a `Map<codecTypeId, OperationSignature[]>` at ORM init time and threading it through the context.

# Open Questions

None — remaining decisions are implementation-time.
