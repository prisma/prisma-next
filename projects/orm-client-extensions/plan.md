# Support Extension Operations in ORM Client

## Summary

Extend the ORM client so that fields backed by extension codec types (e.g. pgvector's `Vector`) expose extension-declared operations (e.g. `cosineDistance`) in `where()` and `orderBy()` callbacks. Extension operation results behave like scalar columns — trait-gated comparison and ordering methods — and compile to correct SQL via the operation's lowering template. Success means `p.embedding.cosineDistance(param).lt(0.2)` and `.asc()` both work end-to-end with full type safety.

**Spec:** `projects/orm-client-extensions/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Alexey Orlenko | Drives execution (TML-2042 assignee) |

## Milestones

### Milestone 1: Expression-based OrderBy

Generalize `orderBy()` to accept expression-based ordering, not just plain column references. This is a prerequisite for extension operations in `orderBy()` and has standalone value. Deliverable: `orderBy()` accepts AST expression-based order items alongside column-based ones, the query planner compiles both, and existing orderBy behavior is preserved.

**Tasks:**

- [ ] **1.1** Write tests for expression-based orderBy: type-level tests verifying the new `orderBy()` accepts both column directives and expression-based orders, and runtime tests verifying `CollectionState.orderBy` stores both forms and `toOrderBy()` converts them to `OrderByItem` AST nodes.
- [ ] **1.2** Write tests for query plan compilation of expression-based orderBy: verify `compileSelect()` produces correct `ORDER BY` SQL when given expression-based orders (e.g. an `OperationExpr` wrapped in an `OrderByItem`), including parameter extraction via `deriveParamsFromAst()`.
- [ ] **1.3** Design and implement the richer `OrderByInput` type: extend `CollectionState.orderBy` to `ReadonlyArray<OrderExpr | ExpressionOrderExpr>` (or a discriminated union), where `ExpressionOrderExpr` wraps an arbitrary `AnyExpression` with a direction. Ensure the type-state for `distinctOn` still tracks column names from plain `OrderExpr` entries.
- [ ] **1.4** Update `Collection.orderBy()` to accept the new input types: the callback can return either an `OrderByDirective` (existing) or an expression-based order. Update the runtime to normalize both into `CollectionState.orderBy`.
- [ ] **1.5** Update `toOrderBy()` in `query-plan-select.ts` to handle both `OrderExpr` (creates `OrderByItem` from `ColumnRef`) and `ExpressionOrderExpr` (wraps the expression in `OrderByItem` directly).
- [ ] **1.6** Update `buildCursorWhere()` to handle expression-based orders in cursor pagination (or explicitly skip expression-based orders for cursor keys, since cursor pagination requires column references).
- [ ] **1.7** Verify all existing orderBy tests pass and the new tests pass.

### Milestone 2: Extension Operations on ModelAccessor

Surface extension-declared operations on fields in the `ModelAccessor` proxy. Extension methods return "expression result" objects with trait-gated comparison and ordering methods. Deliverable: `p.embedding.cosineDistance(param)` works in `where()` and `orderBy()` callbacks, producing correct AST nodes.

**Tasks:**

- [ ] **2.1** Write type-level tests (vitest `expectTypeOf`) for extension methods on `ModelAccessor`: verify that `p.embedding.cosineDistance` exists on a field with codec `pg/vector@1`, does not exist on a plain `String` field, and the return type exposes trait-gated comparison methods (e.g. `lt()` present, `like()` absent for a numeric return type).
- [ ] **2.2** Write runtime unit tests for extension method proxy: verify `createModelAccessor()` attaches `cosineDistance` to a vector field, does not attach it to a text field, and calling it returns an object with the correct comparison/ordering methods.
- [ ] **2.3** Write runtime unit tests for extension expression AST output: verify that `p.embedding.cosineDistance(param)` produces an `OperationExpr` node with correct `forTypeId`, `method`, `self` (ColumnRef), `args` (ParamRef with value), and `lowering`. Verify that `.lt(0.2)` wraps it in a `BinaryExpr`, and `.asc()` wraps it in an expression-based order.
- [ ] **2.4** Extend `ModelAccessor` type to include extension operations: add a type-level mapping from a field's codec type to its declared operations (from `OperationTypes` in the contract). Merge extension methods into the accessor type alongside `ComparisonMethods<T, Traits>`.
- [ ] **2.5** Build the operation lookup mechanism: at `createModelAccessor` time, use the `ExecutionContext.operations` registry (or build a `Map<codecTypeId, OperationSignature[]>` from it) to discover which operations apply to each field's codec ID.
- [ ] **2.6** Implement extension method factories in the proxy: when a field has operations, create methods that build `OperationExpr` AST nodes. Each method takes the operation's declared args, wraps them in `ParamRef.of(value, { codecId })`, and returns an "expression result" object.
- [ ] **2.7** Implement the "expression result" object: given an `OperationExpr` and the operation's return type, return an object with trait-gated comparison methods (reuse `COMPARISON_METHODS_META` pattern) and ordering methods (`asc()`/`desc()`). Comparison methods produce `BinaryExpr` nodes with the `OperationExpr` as the left side. Ordering methods produce expression-based orders from Milestone 1.
- [ ] **2.8** Wire the expression result's comparison output into `where()`: verify that `normalizeWhereArg()` / `isWhereExpr()` correctly handles `BinaryExpr` nodes whose left side is an `OperationExpr`. This should work without changes since `BinaryExpr` is already a valid `AnyWhereExpr`.
- [ ] **2.9** Verify all new tests pass and all existing tests still pass.

### Milestone 3: Query Plan Compilation & End-to-End

Ensure extension operation expressions compile to correct SQL through the query plan pipeline. Deliverable: full end-to-end queries with extension operations in `where()` and `orderBy()` produce correct parameterized SQL.

**Tasks:**

- [ ] **3.1** Write query plan compilation tests for extension operations in `where()`: given a `CollectionState` with a filter containing `BinaryExpr(lt, OperationExpr(cosineDistance, ...), LiteralExpr(0.2))`, verify `compileSelect()` produces SQL with the lowering template correctly applied (e.g. `(1 - (embedding <=> $1)) < $2`) and `deriveParamsFromAst()` extracts both parameters.
- [ ] **3.2** Write query plan compilation tests for extension operations in `orderBy()`: given a `CollectionState` with an expression-based order containing `OperationExpr(cosineDistance, ...)`, verify the compiled SQL includes `ORDER BY 1 - (embedding <=> $1) ASC`.
- [ ] **3.3** Write compilation tests for mixed queries: where + orderBy both using extension operations, with plain columns mixed in. Verify parameter ordering is correct.
- [ ] **3.4** Ensure `bindWhereExpr()` handles `OperationExpr` correctly: `OperationExpr` args may already contain `ParamRef` nodes (not `LiteralExpr`), so binding should pass them through unchanged. If the comparison value (e.g. `0.2` in `lt(0.2)`) is a `LiteralExpr`, it should be bound with the appropriate codec ID for the operation's return type.
- [ ] **3.5** Ensure SQL lowering of `OperationExpr` is handled by the SQL renderer: verify the existing `OperationExpr` rendering in the SQL serializer correctly interpolates `{{self}}` and `{{arg0}}` from the lowering template. If the renderer doesn't handle `OperationExpr` yet, add support.
- [ ] **3.6** Write composition tests: extension expressions combined with `and()`/`or()`, multiple extension operations in a single query, extension where + extension orderBy together.
- [ ] **3.7** Write backwards compatibility tests: verify all existing ORM client test suites pass without modification. Run `pnpm test` in the sql-orm-client package.
- [ ] **3.8** Write type-level tests (vitest `expectTypeOf`) for negative cases: `p.title.cosineDistance(...)` errors on non-vector fields, wrong argument types error, `like()` not available on numeric return type.

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| `cosineDistance(param)` callable on vector field, compiles to correct SQL | Unit + Compilation | 2.3, 3.1 | Verify OperationExpr AST + SQL output |
| `cosineDistance(param).lt(0.2)` produces valid AnyWhereExpr | Unit | 2.3 | BinaryExpr wrapping OperationExpr |
| `cosineDistance(param).asc()` compiles to ORDER BY expression | Unit + Compilation | 2.3, 3.2 | Expression-based order |
| Parameters correctly bound and passed through | Compilation | 3.1, 3.2, 3.3 | deriveParamsFromAst verification |
| Non-extension field does not expose extension methods (type + runtime) | Type + Unit | 2.1, 2.2, 3.8 | Negative type test + runtime assertion |
| TS error on `p.title.cosineDistance(...)` | Type | 2.1, 3.8 | vitest expectTypeOf |
| TS error on wrong argument types | Type | 2.1, 3.8 | vitest expectTypeOf |
| Return type correctly types comparison methods | Type | 2.1 | lt() accepts number |
| Return type is trait-gated (lt yes, like no) | Type + Unit | 2.1, 2.2 | Trait filtering on return codec |
| Extension methods discoverable via autocomplete | Type | 2.1 | Follows from correct types |
| `orderBy(cosineDistance.asc())` end-to-end | Compilation | 3.2 | Full SQL verification |
| Existing `orderBy(p.name.asc())` unchanged | Unit | 1.1, 3.7 | Regression test |
| Mixed ordering (columns + expressions) | Compilation | 3.3 | Mixed orderBy array |
| Compose with `and()`/`or()` | Unit | 3.6 | Composition test |
| Multiple extension ops on same query | Compilation | 3.3, 3.6 | where + orderBy both with cosineDistance |
| All existing tests pass | Regression | 3.7 | Full test suite run |
| CollectionState shape change doesn't break compilation | Compilation | 1.7, 3.7 | Existing tests + new orderBy tests |

## Open Items

- **SQL renderer support for OperationExpr**: The existing SQL serializer may or may not render `OperationExpr` nodes. Task 3.5 covers verifying and adding support if needed. This is a dependency that could reveal work in `sql-relational-core` beyond `sql-orm-client`.
- **Cursor pagination with expression-based orders**: Task 1.6 addresses this. Expression-based orders likely cannot participate in cursor keys (cursors need column references). The implementation should skip or error on expression-based cursor keys.
- **pgvector codec traits**: The pgvector codec (`pg/vector@1`) needs to declare appropriate traits for the extension operation return type to be trait-gated correctly. Verify the pgvector extension's codec and operation type declarations are complete.
- **Multiple extensions on same codec type (FR-6)**: Covered by the design (operation registry keyed by codec ID returns all operations), but no second extension exists to test against. Noted for future verification when ParadeDB or similar extensions are more complete.
