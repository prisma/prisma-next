# Phase 1: Mongo Collection Spike — Execution Plan

## Summary

Build a typed pipeline AST in `mongo-core` as the shared primitive for all MongoDB read queries, then build a `MongoCollection` class on top of it with the same fluent chaining API as the SQL `Collection`. This mirrors the SQL architecture where `relational-core` owns the SQL AST and both the ORM and query builder are consumers of it.

**Design constraint:** All read queries compile to typed pipeline stages exclusively — the `find()` API is not used ([ADR 183](../../../docs/architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md)). The typed stage representation is the foundation for both the ORM and the future pipeline query builder (WS4 stretch goal).

**Spec:** [projects/orm-consolidation/spec.md](../spec.md)

**Linear:** [TML-2189](https://linear.app/prisma-company/issue/TML-2189)

## Collaborators

| Role  | Person | Context                                           |
| ----- | ------ | ------------------------------------------------- |
| Maker | Will   | Drives execution                                  |
| FYI   | Alexey | SQL ORM owner — no changes to SQL ORM in Phase 1  |

## Key references (implementation)

- SQL AST (the precedent): `packages/2-sql/4-lanes/relational-core/src/ast/types.ts` — `AnyExpression`, `SelectAst`, `ExprVisitor`
- SQL `Collection`: `packages/3-extensions/sql-orm-client/src/collection.ts` (~1000 lines)
- SQL `CollectionState` / types: `packages/3-extensions/sql-orm-client/src/types.ts`
- SQL `ModelAccessor`: `packages/3-extensions/sql-orm-client/src/model-accessor.ts`
- SQL `orm()` factory: `packages/3-extensions/sql-orm-client/src/orm.ts`
- Current Mongo ORM: `packages/2-mongo-family/4-orm/src/mongo-orm.ts` (~145 lines)
- Current Mongo types: `packages/2-mongo-family/4-orm/src/types.ts`
- Mongo commands: `packages/2-mongo-family/1-core/src/commands.ts` (`AggregateCommand` — `FindCommand` is not used for reads per [ADR 183](../../../docs/architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md))
- Mongo demo: `examples/mongo-demo/`

## Architecture

```
mongo-core (layer 1-core)              ← Pipeline AST: stages, filter expressions, lowering
    ↑                    ↑
    │                    │
mongo-pipeline-builder   mongo-orm (layer 4-orm)
(future, WS4 stretch)   │
    │                    └── ORM Collection compiles
    └── user-facing          CollectionState → MongoReadStage[] → MongoQueryPlan
        pipeline builder
```

The pipeline AST in `mongo-core` is contract-agnostic — it deals in MongoDB concepts (collections, fields, pipeline stages, filter operators), not contract concepts (models, codecIds, relations). The ORM bridges the gap, just as the SQL ORM bridges models to `SelectAst`.

## Milestones

### Milestone 1: Pipeline AST in `mongo-core`

The typed primitive layer. Defines pipeline stage nodes, filter expression AST, visitor interface, and lowering to plain documents for the driver. No ORM, no Collection, no contract awareness. This is the Mongo equivalent of `relational-core`'s SQL AST.

**Tasks:**

#### 1.1 Filter expression AST

Define structured filter expression types in `packages/2-mongo-family/1-core/src/`:

- `MongoFieldFilter` — `{ kind: 'field', field: string, op: '$eq' | '$ne' | '$gt' | '$lt' | '$gte' | '$lte' | '$in', value: MongoValue }`
- `MongoAndExpr` — `{ kind: 'and', exprs: MongoFilterExpr[] }`
- `MongoOrExpr` — `{ kind: 'or', exprs: MongoFilterExpr[] }`
- `MongoNotExpr` — `{ kind: 'not', expr: MongoFilterExpr }`
- `MongoExistsExpr` — `{ kind: 'exists', field: string, exists: boolean }`
- `MongoFilterExpr` — discriminated union of the above
- `MongoFilterVisitor<R>` — visitor interface for interpretation dispatch

#### 1.2 Pipeline stage types

Define typed pipeline stage nodes in `packages/2-mongo-family/1-core/src/`:

- `MongoMatchStage` — `{ kind: 'match', filter: MongoFilterExpr }`
- `MongoLookupStage` — `{ kind: 'lookup', from: string, localField: string, foreignField: string, as: string, pipeline?: MongoReadStage[] }`
- `MongoProjectStage` — `{ kind: 'project', projection: Record<string, 0 | 1> }`
- `MongoSortStage` — `{ kind: 'sort', sort: Record<string, 1 | -1> }`
- `MongoUnwindStage` — `{ kind: 'unwind', path: string, preserveNullAndEmptyArrays: boolean }`
- `MongoLimitStage` — `{ kind: 'limit', limit: number }`
- `MongoSkipStage` — `{ kind: 'skip', skip: number }`
- `MongoReadStage` — discriminated union of the above

#### 1.3 Lowering

Implement lowering from typed AST to plain documents for the driver:

- `lowerFilterExpr(expr: MongoFilterExpr)` → `Document` — recursive lowering of filter expressions (e.g., `MongoFieldFilter({ field: 'email', op: '$eq', value: 'alice' })` → `{ email: { $eq: 'alice' } }`, `MongoAndExpr` → `{ $and: [...] }`)
- `lowerStage(stage: MongoReadStage)` → `Record<string, unknown>` — per-stage lowering (e.g., `MongoMatchStage` → `{ $match: lowerFilterExpr(stage.filter) }`)
- `lowerPipeline(stages: MongoReadStage[])` → `Record<string, unknown>[]`

#### 1.4 Update `AggregateCommand`

Update `AggregateCommand` to accept `MongoReadStage[]` instead of (or alongside) `RawPipeline`.

#### 1.5 Update adapter lowering

Update the adapter's `#lowerCommand` for `aggregate` to use `lowerPipeline()` when the command carries typed stages.

#### 1.6 Tests

- Filter expression construction and lowering: each node kind produces correct driver documents
- Composite filters: `$and`, `$or`, `$not` nesting
- Stage construction and lowering: each stage kind produces correct driver documents
- Pipeline lowering: stage ordering preserved, output matches MongoDB driver expectations
- Round-trip: construct typed stages → lower → verify against known MongoDB pipeline documents

### Milestone 2: ORM Collection with chaining + compilation

Build `MongoCollection` with the fluent chaining API, compiling `CollectionState` to the pipeline AST from Milestone 1. The Collection is contract-aware — it bridges models, fields, and relations to pipeline stages.

**Tasks:**

#### 2.1 Collection state

Define `MongoCollectionState` — the state bag accumulated by chaining methods: `filters` (`MongoFilterExpr[]`), `includes` (relation names + refinement state), `orderBy`, `selectedFields`, `limit`, `offset`.

#### 2.2 Collection class

Implement `MongoCollection<TContract, ModelName>` with immutable-clone pattern:

- Constructor takes contract, modelName, executor, and optional state (default: empty).
- `#clone(overrides)` → spread state with overrides, construct new instance via `#createSelf`.
- `#createSelf` uses `this.constructor` to preserve custom subclasses.
- Chaining methods: `.where(filter)`, `.select(...fields)`, `.include(relation)`, `.orderBy(spec)`, `.take(n)`, `.skip(n)` — each returns a new `MongoCollection` with updated state.
- Terminal methods: `.all()` and `.first()` — call `#execute()` which compiles state to pipeline AST and runs it.

#### 2.3 Compilation

Implement `compileMongoQuery(contract, modelName, state)` → `MongoQueryPlan`:

- `state.filters` → `MongoMatchStage` (combined with `MongoAndExpr` if multiple)
- `state.includes` → `MongoLookupStage` + `MongoUnwindStage` for to-one (port existing `buildLookupStages` to produce typed stages)
- `state.selectedFields` → `MongoProjectStage`
- `state.orderBy` → `MongoSortStage`
- `state.offset` → `MongoSkipStage`
- `state.limit` → `MongoLimitStage`
- Stage ordering: `$match` → `$lookup`/`$unwind` → `$sort` → `$skip` → `$limit` → `$project`
- Wrap in `AggregateCommand(collection, pipeline)` → `MongoQueryPlan`

#### 2.4 Typed where DSL

Implement `MongoModelAccessor` — a Proxy-based typed accessor producing `MongoFilterExpr` nodes:

- Property access for scalar fields returns comparison methods: `.eq()`, `.neq()`, `.gt()`, `.lt()`, `.gte()`, `.lte()`, `.in()`, `.isNull()`.
- Each method returns a `MongoFilterExpr` node.
- Methods gated by codec semantic traits.
- `MongoCollection.where()` accepts: callback `(model) => MongoFilterExpr`, shorthand `{ field: value }`, or raw `MongoFilterExpr`.

#### 2.5 Tests

- Chaining returns new instances (immutable)
- State accumulates correctly across chained calls
- `#createSelf` preserves custom subclasses
- `.first()` adds limit 1, returns single result or null
- Compilation produces correct pipeline stages from state
- Where callback and shorthand styles work
- Comparison methods produce correct `MongoFilterExpr` nodes
- Trait gating (type-level tests)
- Multiple `.where()` calls combine with `MongoAndExpr`

### Milestone 3: Wire `mongoOrm()` + update demo + integration tests

Replace the current `mongoOrm()` factory and update the demo to use the chaining API. Full integration test coverage against `mongodb-memory-server`.

**Tasks:**

- **3.1** Refactor `mongoOrm()` to return `MongoCollection` instances. The factory iterates `contract.roots` and creates a `MongoCollection` per root.
- **3.2** Update `MongoOrmClient` type to reflect Collection instances instead of `{ findMany }` accessors.
- **3.3** Remove `MongoCollectionImpl` and `findMany`-related types (`MongoFindManyOptions`, `MongoIncludeSpec` as top-level options).
- **3.4** Update Mongo demo (`examples/mongo-demo/`) to use chaining API.
- **3.5** Write integration tests against `mongodb-memory-server`:
  - Basic `.all()` returns all documents
  - `.where()` with callback filters correctly
  - `.where()` with shorthand filters correctly
  - `.select()` returns only selected fields
  - `.include()` resolves reference relations via `$lookup`
  - `.orderBy()` sorts correctly
  - `.take()` and `.skip()` paginate correctly
  - `.first()` returns single result or null
  - Chained combinations: `.where().include().orderBy().take().all()`
- **3.6** Verify all existing Mongo tests continue to pass (update to use new API where needed).

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
| --- | --- | --- | --- |
| Filter expression AST: each node kind lowers correctly | Unit | 1.6 | Construction + lowering |
| Pipeline stage types: each stage kind lowers correctly | Unit | 1.6 | Construction + lowering |
| Composite filters ($and/$or/$not) nest and lower | Unit | 1.6 | Nesting tests |
| Round-trip: typed stages → lower → correct MongoDB docs | Unit | 1.6 | Known-good pipeline documents |
| All reads produce `AggregateCommand` (no `FindCommand`) | Unit | 1.6 | Pipeline-only per ADR 183 |
| Fluent chaining methods return new instances | Unit | 2.5 | Immutability tests |
| Custom subclass preservation via `#createSelf` | Unit | 2.5 | Subclass identity checks |
| Compilation: state → correct pipeline stages | Unit | 2.5 | Per-field compilation tests |
| Pipeline stage ordering is correct | Unit | 2.5 | match → lookup → sort → skip → limit → project |
| `.where()` callback and shorthand styles | Unit | 2.5 | Accessor + conversion tests |
| Comparison methods produce correct `MongoFilterExpr` | Unit | 2.5 | Per-method output tests |
| Trait-gated comparison methods | Type test | 2.5 | `test-d.ts` assertions |
| `.first()` returns `T \| null` | Unit + Integration | 2.5, 3.5 | Behavioral tests |
| `mongoOrm()` returns Collection instances | Unit | 3.1 | Factory tests |
| Demo uses chaining API | Integration | 3.5 | End-to-end against mongodb-memory-server |

## Open Items

1. ~~**Mongo filter expression representation.**~~ **Resolved.** Structured `MongoFilterExpr` AST with visitor pattern, not raw documents. Lowering to driver documents is a separate step.

2. **Codec trait resolution.** The SQL `ModelAccessor` resolves traits via `context.codecs.traitsOf(codecId)`. The Mongo ORM needs equivalent access to codec trait metadata — this must be added to `mongo-core`.

3. **`orderBy` callback shape.** Same `.asc()` / `.desc()` pattern as SQL. The Mongo sort spec `Record<string, 1 | -1>` is the lowered form.

4. **Include refinement.** The SQL ORM supports refinement callbacks (`include('user', (u) => u.select('id', 'email'))`). The pipeline AST supports this via `MongoLookupStage.pipeline` (the pipeline variant of `$lookup`). Whether to include refinement in the spike or add it later is a scope question.

5. **`RawPipeline` escape hatch.** Decide whether `AggregateCommand` accepts `MongoReadStage[] | RawPipeline` (union) or uses a separate variant.
