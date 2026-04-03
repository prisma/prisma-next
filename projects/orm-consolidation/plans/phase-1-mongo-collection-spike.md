# Phase 1: Mongo Collection Spike — Execution Plan

## Summary

Build a `MongoCollection` class with the same fluent chaining API as the SQL `Collection`, compiling to typed aggregation pipeline stages at terminal methods. This is an isolated spike — no changes to the SQL ORM or framework layer. The options-bag API (`findMany`) is replaced by immutable method chaining (`.where().select().include().orderBy().take().skip().all().first()`).

**Design constraint:** All read queries compile to typed pipeline stages exclusively — the `find()` API is not used ([ADR 183](../../../docs/architecture%20docs/adrs/ADR%20183%20-%20Pipeline-only%20query%20representation%20for%20MongoDB.md)). The typed stage representation is the foundation for the future pipeline query builder (WS4 stretch goal).

**Spec:** [projects/orm-consolidation/spec.md](../spec.md)

**Linear:** [TML-2189](https://linear.app/prisma-company/issue/TML-2189)

## Collaborators

| Role  | Person | Context                                           |
| ----- | ------ | ------------------------------------------------- |
| Maker | Will   | Drives execution                                  |
| FYI   | Alexey | SQL ORM owner — no changes to SQL ORM in Phase 1  |

## Key references (implementation)

- SQL `Collection`: `packages/3-extensions/sql-orm-client/src/collection.ts` (~1000 lines)
- SQL `CollectionState` / types: `packages/3-extensions/sql-orm-client/src/types.ts`
- SQL `ModelAccessor`: `packages/3-extensions/sql-orm-client/src/model-accessor.ts`
- SQL `orm()` factory: `packages/3-extensions/sql-orm-client/src/orm.ts`
- Current Mongo ORM: `packages/2-mongo-family/4-orm/src/mongo-orm.ts` (~145 lines)
- Current Mongo types: `packages/2-mongo-family/4-orm/src/types.ts`
- Mongo commands: `packages/2-mongo-family/1-core/src/commands.ts` (`AggregateCommand` — `FindCommand` is not used for reads per [ADR 183](../../../docs/architecture%20docs/adrs/ADR%20183%20-%20Pipeline-only%20query%20representation%20for%20MongoDB.md))
- Mongo demo: `examples/mongo-demo/`

## Milestones

### Milestone 1: Collection state + immutable chaining skeleton

The chaining machinery: `MongoCollection` class with `CollectionState`, `#clone`, `#createSelf`, and chaining methods that return new instances. Terminal methods (`.all()`, `.first()`) exist but delegate to compilation (Milestone 2). The where DSL is not yet typed — `.where()` accepts raw filter objects only.

**Tasks:**

- **1.1** Define `MongoCollectionState` — the family-agnostic state bag: `filters` (`MongoFilterExpr[]` — structured AST, not raw documents), `includes` (relation names + refinement state), `orderBy`, `selectedFields`, `limit`, `offset`. Mirror the shape of SQL's `CollectionState` but with Mongo-specific expression types.
- **1.2** Implement `MongoCollection<TContract, ModelName>` class with immutable-clone pattern:
  - Constructor takes contract, modelName, executor, and optional state (default: empty).
  - `#clone(overrides)` → spread state with overrides, construct new instance via `#createSelf`.
  - `#createSelf` uses `this.constructor` to preserve custom subclasses.
  - Chaining methods: `.where(filter)`, `.select(...fields)`, `.include(relation)`, `.orderBy(spec)`, `.take(n)`, `.skip(n)` — each returns a new `MongoCollection` with updated state.
  - Terminal methods: `.all()` and `.first()` — call internal `#execute()` which compiles state to plan and runs it.
- **1.3** Write tests for chaining behavior:
  - Chaining returns new instances (immutable).
  - State accumulates correctly across chained calls.
  - `#createSelf` preserves custom subclasses.
  - `.first()` adds `limit: 1` and returns single result or null.

### Milestone 2: Typed pipeline stages + terminal compilation

Define typed pipeline stage nodes and compile accumulated `MongoCollectionState` into a `MongoReadStage[]` array wrapped in `AggregateCommand`. All read queries produce pipelines — `FindCommand` is not used ([ADR 183](../../../docs/architecture%20docs/adrs/ADR%20183%20-%20Pipeline-only%20query%20representation%20for%20MongoDB.md)).

**Tasks:**

- **2.1** Define typed pipeline stage nodes in `packages/2-mongo-family/1-core/src/`:
  - `MongoMatchStage` — `{ kind: 'match', filter: MongoFilterExpr }` (contains a structured filter expression)
  - `MongoLookupStage` — `{ kind: 'lookup', from: string, localField: string, foreignField: string, as: string }`
  - `MongoProjectStage` — `{ kind: 'project', projection: Record<string, 0 | 1> }` (include/exclude)
  - `MongoSortStage` — `{ kind: 'sort', sort: Record<string, 1 | -1> }`
  - `MongoUnwindStage` — `{ kind: 'unwind', path: string, preserveNullAndEmptyArrays: boolean }`
  - `MongoLimitStage` — `{ kind: 'limit', limit: number }`
  - `MongoSkipStage` — `{ kind: 'skip', skip: number }`
  - `MongoReadStage` — discriminated union of the above
- **2.2** Update `AggregateCommand` to accept `MongoReadStage[]` instead of `RawPipeline`. Retain `RawPipeline` support for raw escape-hatch queries if needed.
- **2.3** Update the adapter's `#lowerCommand` for `aggregate` to lower typed stages → plain document arrays (`Record<string, unknown>[]`) for the driver. Each stage kind maps to its MongoDB document representation (e.g., `MongoMatchStage` → `{ $match: lowerFilter(stage.filter) }`).
- **2.4** Implement `compileMongoQuery(contract, modelName, state)` → `MongoQueryPlan`:
  - Produce a `MongoReadStage[]` pipeline from the state:
    - `state.filters` → `MongoMatchStage` (combined with `$and` if multiple, or single filter)
    - Includes → `MongoLookupStage` + `MongoUnwindStage` for to-one (port existing `buildLookupStages` to produce typed stages)
    - `state.selectedFields` → `MongoProjectStage`
    - `state.orderBy` → `MongoSortStage`
    - `state.offset` → `MongoSkipStage`
    - `state.limit` → `MongoLimitStage`
  - Wrap in `AggregateCommand(collection, pipeline)` → `MongoQueryPlan`
  - Stage ordering: `$match` → `$lookup`/`$unwind` → `$sort` → `$skip` → `$limit` → `$project`
- **2.5** Wire `MongoCollection.#execute()` to call `compileMongoQuery` and pass the plan to the executor.
- **2.6** Write compilation tests:
  - Filters compile to correct `MongoMatchStage` with `$and` / single filter
  - Select compiles to `MongoProjectStage`
  - OrderBy compiles to `MongoSortStage`
  - Limit/skip produce `MongoLimitStage`/`MongoSkipStage`
  - Includes produce `MongoLookupStage` + `MongoUnwindStage` for to-one, `MongoLookupStage` only for to-many
  - Pipeline stage ordering is correct
  - Adapter lowering produces correct plain document arrays from typed stages

### Milestone 3: Typed where DSL

`MongoModelAccessor` — a Proxy-based typed accessor that attaches comparison methods producing structured `MongoFilterExpr` AST nodes. Mirrors SQL `ModelAccessor` but produces Mongo filter expressions instead of SQL AST nodes. The adapter lowers `MongoFilterExpr` to plain Mongo filter documents when lowering `MongoMatchStage`.

**Tasks:**

- **3.1** Define structured Mongo filter expression AST in `packages/2-mongo-family/1-core/src/`:
  - `MongoFieldFilter` — `{ kind: 'field', field: string, op: '$eq' | '$ne' | '$gt' | '$lt' | '$gte' | '$lte' | '$in', value: MongoValue }`
  - `MongoAndExpr` — `{ kind: 'and', exprs: MongoFilterExpr[] }`
  - `MongoOrExpr` — `{ kind: 'or', exprs: MongoFilterExpr[] }`
  - `MongoNotExpr` — `{ kind: 'not', expr: MongoFilterExpr }`
  - `MongoExistsExpr` — `{ kind: 'exists', field: string, exists: boolean }`
  - `MongoFilterExpr` — discriminated union of the above
  - Each node carries a `kind` discriminant for visitor dispatch. Use the same `accept(visitor)` / interpreter pattern as SQL's `AnyExpression`, with a `MongoFilterVisitor<R>` interface.
- **3.2** Implement `createMongoModelAccessor(contract, modelName)` → Proxy:
  - Property access for scalar fields returns an object with comparison methods.
  - Comparison methods: `.eq(value)`, `.neq(value)`, `.gt(value)`, `.lt(value)`, `.gte(value)`, `.lte(value)`, `.in(values)`, `.isNull()`.
  - Each method returns a `MongoFilterExpr` node (e.g., `MongoFieldFilter({ field: 'email', op: '$eq', value })`)
  - Methods are gated by codec semantic traits (from `contract.models[model].fields[field].codecId`): equality → eq/neq/in, order → gt/lt/gte/lte, etc.
- **3.3** Implement filter expression lowering in the adapter: `lowerFilterExpr(expr: MongoFilterExpr)` → `Document`. Converts the structured AST to the plain document format the MongoDB driver expects (e.g., `MongoFieldFilter({ field: 'email', op: '$eq', value: 'alice' })` → `{ email: { $eq: 'alice' } }`). This is called by the `MongoMatchStage` lowering logic (Milestone 2, task 2.3).
- **3.4** Update `MongoCollection.where()` to accept:
  - Callback: `(model: MongoModelAccessor) => MongoFilterExpr` — invoke callback with accessor, push result to filters.
  - Shorthand object: `{ field: value }` — convert to `MongoFieldFilter({ field, op: '$eq', value })`.
  - Raw `MongoFilterExpr` — pass through.
- **3.5** Define TypeScript types for the accessor:
  - `MongoModelAccessor<TContract, ModelName>` — maps field names to `MongoComparisonMethods<FieldType>`.
  - `MongoComparisonMethods<T>` — `eq(value: T)`, `neq(value: T)`, `gt(value: T)`, etc., each returning `MongoFilterExpr`.
  - Trait-gated: fields without `order` trait don't expose `gt`/`lt`/`gte`/`lte`.
- **3.6** Write tests:
  - Each comparison method produces correct `MongoFilterExpr` AST node.
  - Filter expression lowering produces correct Mongo filter documents.
  - Shorthand object conversion.
  - Callback-style invocation.
  - Trait gating (type-level tests).
  - Multiple `.where()` calls combine with `MongoAndExpr`.

### Milestone 4: Wire `mongoOrm()` + update demo + integration tests

Replace the current `mongoOrm()` factory and update the demo to use the chaining API. Full integration test coverage against `mongodb-memory-server`.

**Tasks:**

- **4.1** Refactor `mongoOrm()` to return `MongoCollection` instances. The factory iterates `contract.roots` and creates a `MongoCollection` per root (same structure, different class).
- **4.2** Update `MongoOrmClient` type to reflect Collection instances instead of `{ findMany }` accessors.
- **4.3** Remove `MongoCollectionImpl` and `findMany`-related types (`MongoFindManyOptions`, `MongoIncludeSpec` as top-level options). The include/where types are now internal to the Collection.
- **4.4** Update Mongo demo (`examples/mongo-demo/`) to use chaining API: replace `findMany({ where, include })` with `.where().include().all()`.
- **4.5** Write integration tests against `mongodb-memory-server`:
  - Basic `.all()` returns all documents
  - `.where()` with callback filters correctly
  - `.where()` with shorthand filters correctly
  - `.select()` returns only selected fields
  - `.include()` resolves reference relations via `$lookup`
  - `.orderBy()` sorts correctly
  - `.take()` and `.skip()` paginate correctly
  - `.first()` returns single result or null
  - Chained combinations: `.where().include().orderBy().take().all()`
- **4.6** Verify all existing Mongo tests continue to pass (update to use new API where needed).

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
| --- | --- | --- | --- |
| Fluent chaining methods exist and return new instances | Unit | 1.3 | Immutability tests |
| Custom subclass preservation via `#createSelf` | Unit | 1.3 | Subclass identity checks |
| Typed pipeline stage nodes defined | Unit | 2.6 | Stage construction + lowering |
| All reads produce `AggregateCommand` (no `FindCommand`) | Unit | 2.6 | Pipeline-only per ADR 183 |
| Adapter lowers typed stages to plain documents | Unit | 2.6 | Lowering tests |
| `.where()` callback and shorthand styles | Unit | 3.6 | Accessor + conversion tests |
| Comparison methods produce correct `MongoFilterExpr` AST | Unit | 3.6 | Per-method output tests |
| Filter expression lowering produces correct documents | Unit | 3.6 | Lowering round-trip tests |
| Trait-gated comparison methods | Type test | 3.6 | `test-d.ts` assertions |
| `.select()` → `MongoProjectStage` | Unit | 2.6 | Compilation tests |
| `.orderBy()` → `MongoSortStage` | Unit | 2.6 | Compilation tests |
| `.take()` / `.skip()` → `MongoLimitStage` / `MongoSkipStage` | Unit | 2.6 | Compilation tests |
| `.include()` → `MongoLookupStage` + `MongoUnwindStage` | Unit | 2.6 | Pipeline stage tests |
| `.first()` returns `T \| null` | Unit + Integration | 1.3, 4.5 | Behavioral tests |
| `mongoOrm()` returns Collection instances | Unit | 4.1 | Factory tests |
| Demo uses chaining API | Integration | 4.5 | End-to-end against mongodb-memory-server |
| Multiple `.where()` combines with `MongoAndExpr` | Unit | 3.6 | Filter combination tests |

## Open Items

1. ~~**Mongo filter expression representation.**~~ **Resolved.** `MongoModelAccessor` produces structured `MongoFilterExpr` AST nodes (mirroring SQL's `AnyExpression`), not raw Mongo filter documents. The adapter lowers the AST to plain documents. This enables composable AND/OR/NOT nesting, visitor-based interpretation, and aligns with [ADR 183](../../../docs/architecture%20docs/adrs/ADR%20183%20-%20Pipeline-only%20query%20representation%20for%20MongoDB.md)'s typed pipeline stage design.

2. **Codec trait resolution.** The SQL `ModelAccessor` resolves traits via `context.codecs.traitsOf(codecId)`. The Mongo ORM needs equivalent access to codec trait metadata. Check whether `mongo-core` already provides this or if it needs to be added.

3. **`orderBy` callback shape.** The SQL ORM uses `(model) => model.field.asc()` / `.desc()`. The Mongo accessor needs the same pattern, producing `MongoSortStage` specs. The sort stage itself carries `Record<string, 1 | -1>`.

4. **Include refinement.** The SQL ORM supports include refinement callbacks (`include('user', (user) => user.select('id', 'email'))`). For the Mongo spike, should includes support refinement or just `include('relation')` (boolean-style)? Recommendation: support refinement — it's needed for the shared interface and the compilation to `$lookup` pipeline can handle `$project` within the lookup.

5. **`RawPipeline` escape hatch.** Task 2.2 retains `RawPipeline` support for raw/escape-hatch queries that bypass the typed stage system. Decide whether `AggregateCommand` accepts `MongoReadStage[] | RawPipeline` (union) or uses a separate command variant.
