# Summary

Rename `@prisma-next/mongo-pipeline-builder` to `@prisma-next/mongo-query-builder` and grow it from a read-only pipeline builder into a typed, contract-bound builder for **all** MongoDB CRUD wire commands — reads, writes, find-and-modify, and pipeline-terminal writes — using a three-state machine that keeps illegal Mongo combinations out of the type system and forces unqualified writes (`updateAll`, `deleteAll`) to be explicit at the call site.

# Description

## Problem

Today the MongoDB family ships `@prisma-next/mongo-pipeline-builder`, a typed, contract-bound builder that produces `MongoQueryPlan` instances for aggregation pipelines. It sits one level below the ORM (`@prisma-next/mongo-orm`) and one level above the untyped AST construction exposed by `mongoRaw`.

Two structural gaps surfaced during the data-migrations work ([TML-2219](https://linear.app/prisma-company/issue/TML-2219)):

1. **Read-only by construction.** The builder only models aggregation pipelines. Writes (`updateMany`, `deleteMany`, `insertMany`, `findOneAndUpdate`, `$merge`/`$out`) have no typed counterpart; authors drop to raw AST construction (`new RawUpdateManyCommand(...)`, `new AggregateCommand(...)`).
2. **Misleading name.** "Pipeline builder" describes one specific chain shape. The package is the read half of a broader typed low-level Mongo query builder, and the name forecloses growing into the write side.

The retail-store data-migration example (in PR [#349](https://github.com/prisma/prisma-next/pull/349)) makes the gap concrete:

```ts
dataTransform('backfill-product-status', {
  check: {
    source: () =>
      pipeline.from('products').match(MongoExistsExpr.notExists('status')).limit(1),
  },
  run: () => ({
    collection: 'products',
    command: new RawUpdateManyCommand(
      'products',
      { status: { $exists: false } },
      { $set: { status: 'active' } },
    ),
    meta,
  }),
});
```

The `check.source` callback uses the typed builder; the `run` callback drops to raw AST construction. They should be the same surface.

## Guiding principles

1. **Low-level, close to the Mongo primitives.** This builder is the typed sibling of `mongoRaw`. It covers the commands the MongoDB driver exposes (reads, writes, pipeline-terminal writes, find-and-modify). It does not invent higher-level verbs — that is the ORM's job.
2. **Typed against the contract, not opinionated by it.** Shape tracking, field autocomplete, and codec-aware values are table stakes. Cross-collection semantics (includes, roots) belong in the ORM.
3. **Unsafe-looking code should be hard to type.** Unqualified writes (`updateAll`, `deleteAll`) are legal but must be typed out explicitly. Invalid Mongo combinations (`sort` + `updateMany`, `group` + `updateMany`) fail to compile, not at runtime.
4. **Output-type first.** Naming, package boundaries, and state transitions are driven by the `MongoQueryPlan` shape the builder produces — not by the internal stage-chain representation.

## Naming

Rename the package `@prisma-next/mongo-pipeline-builder` → `@prisma-next/mongo-query-builder` and the entry point `mongoPipeline(...)` → `mongoQuery(...)`.

- `MongoQueryPlan` is the compiled output for both reads and writes — `query` is the neutral umbrella term.
- `@prisma-next/mongo-query-ast` is the IR the builder targets; the builder's name aligns with its output.
- The parent directory `packages/2-mongo-family/5-query-builders/` is already plural "query builders".
- `pipeline` remains a correct description of one state inside the builder; it stops pretending to describe the whole package.

The rename lands first as a standalone change ([Milestone 0](#milestone-0--rename-package-and-entry-point)). Existing callers are updated in the same PR (hard rename, no deprecation alias — pre-1.0 internal package).

## Surface design

### Entry point

```ts
const q = mongoQuery<Contract>({ contractJson });
q.from('products'); // CollectionHandle<Row<'products'>>
q.rawCommand(cmd);  // escape hatch for non-CRUD commands (collStats, dbStats, …)
```

`from(name)` returns a `CollectionHandle<Row>` bound to the collection. The row type comes from the contract; the handle is where the state machine begins. `rawCommand(cmd)` packages an arbitrary `AnyMongoCommand` into a `MongoQueryPlan` for commands outside the typed CRUD surface.

### The three states

The builder is a state machine over three concrete classes. All transitions are encoded in return types; nothing is enforced at runtime.

```
CollectionHandle<Row>                   (from q.from('x'))
  ├─ .insertOne(doc)                    ─▶ InsertTerminal
  ├─ .insertMany(docs)                  ─▶ InsertTerminal
  ├─ .updateAll(updater)                ─▶ UpdateTerminal       (explicit unqualified)
  ├─ .deleteAll()                       ─▶ DeleteTerminal       (explicit unqualified)
  ├─ .upsertOne(filter, updater)        ─▶ UpsertTerminal       (filter required for upsert)
  ├─ .upsertMany(filter, updater)       ─▶ UpsertTerminal
  ├─ .match(filter | fn)                ─▶ FilteredCollection<Row>
  └─ .<pipeline stage>                  ─▶ PipelineChain<Row, …markers>

FilteredCollection<Row>                 (one or more .match() calls, AND-folded)
  ├─ .match(filter | fn)                ─▶ FilteredCollection<Row>
  ├─ .updateMany(updater)               ─▶ UpdateTerminal
  ├─ .updateOne(updater)                ─▶ UpdateTerminal
  ├─ .upsertOne(updater)                ─▶ UpsertTerminal
  ├─ .upsertMany(updater)               ─▶ UpsertTerminal
  ├─ .deleteMany()                      ─▶ DeleteTerminal
  ├─ .deleteOne()                       ─▶ DeleteTerminal
  ├─ .findOneAndUpdate(updater, opts?)  ─▶ ReturningTerminal
  ├─ .findOneAndDelete(opts?)           ─▶ ReturningTerminal
  └─ .<pipeline stage>                  ─▶ PipelineChain<Row, …markers>

PipelineChain<Shape, UpdateCompat?, FindAndModifyCompat?>
  ├─ .<pipeline stage>                  ─▶ PipelineChain        (markers preserved or cleared)
  ├─ .merge(opts) / .out(coll)          ─▶ WriteTerminal        (always available)
  ├─ .updateMany(updater?)              ─▶ UpdateTerminal       *only if UpdateCompat
  ├─ .updateOne(updater?)               ─▶ UpdateTerminal       *only if UpdateCompat
  ├─ .findOneAndUpdate(updater, opts?)  ─▶ ReturningTerminal    *only if FindAndModifyCompat
  ├─ .findOneAndDelete(opts?)           ─▶ ReturningTerminal    *only if FindAndModifyCompat
  └─ .build() / .aggregate()            ─▶ ReadTerminal
```

Each terminal exposes `.build()` returning a `MongoQueryPlan<Result>`, where `Result` is the resolved row type for reads, the affected-count shape for writes, and the returned-document shape for find-and-modify.

#### Marker semantics on `PipelineChain`

Each pipeline stage method either **preserves** or **clears** the two capability markers:

| Stage method                            | `UpdateCompat` | `FindAndModifyCompat` |
| --------------------------------------- | -------------- | --------------------- |
| `.match(...)`                           | preserve       | preserve              |
| `.sort(...)`                            | clear          | preserve              |
| `.skip(...)`                            | clear          | preserve              |
| `.limit(...)`                           | clear          | clear                 |
| `.addFields(...)` / `.set(...)`         | preserve       | clear                 |
| `.project(...)` / `.unset(...)`         | preserve       | clear                 |
| `.replaceRoot(...)` / `.replaceWith(.)` | preserve       | clear                 |
| `.redact(...)`                          | preserve       | clear                 |
| `.group(...)`                           | clear          | clear                 |
| `.lookup(...)`                          | clear          | clear                 |
| `.unwind(...)`                          | clear          | clear                 |
| `.facet(...)`                           | clear          | clear                 |
| other shape-changing stages             | clear          | clear                 |

- `UpdateCompat` permits `.updateMany(...)` / `.updateOne(...)` to consume the accumulated pipeline as an **update-with-pipeline** spec.
- `FindAndModifyCompat` permits `.findOneAndUpdate(...)` / `.findOneAndDelete(...)` to deconstruct the accumulated pipeline into the command's `{filter, sort, skip}` slots. (`limit` always clears the marker — `findOneAnd*` already implies single-document semantics.)

Markers live as phantom type parameters on `PipelineChain`; they have no runtime presence.

### Unified field accessor

Per [ADR 180 — Dot-path field accessor](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md), there is **one** accessor used across all callbacks (`match`, `addFields`, `project`, `group`, `update*`, `upsert*`, `findOneAndUpdate`). Naming convention: `f` in callback parameters. The accessor exposes:

- **Property access for scalar fields**: `f.status.eq('active')`, `f.status.set('active')`, `f.views.inc(1)`, `f.tags.push('featured')`.
- **Callable form for value-object dot-paths**: `f('homeAddress.city').eq('NYC')`, `f('stats.loginCount').inc(1)`, `f('tags').addToSet('premium')`. Type-checked via the recursive `ResolvePath` template-literal pattern in ADR 180.
- **Trait-gated operators on the returned `Expression`**: filter operators (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `exists`, `regex`, `all`, `elemMatch`, `size`, …) and Mongo update operators (`set`, `unset`, `inc`, `mul`, `min`, `max`, `rename`, `push`, `addToSet`, `pop`, `pull`, `pullAll`, `currentDate`, `setOnInsert`).

The existing `FieldProxy` and `FilterProxy` are **collapsed into this unified accessor**. Read-side callbacks keep the same shape (`.match(f => f.status.eq('active'))`) and continue to compile.

### Filter composition

Multiple `.match(...)` calls accumulate and AND-fold (via `MongoAndExpr`) when a terminal consumes them:

- At a read terminal, the folded filter becomes a single `$match` stage at the head of the pipeline (or stays as multiple `$match` stages — implementation detail).
- At a write terminal, the folded filter becomes the `filter` argument of the underlying wire command.
- When entering `PipelineChain` from `FilteredCollection` (e.g. `.match(...).group(...)`), accumulated `.match`es are emitted as a leading `$match` stage.

### Unqualified writes

`.updateAll(updater)` and `.deleteAll()` live **only on** `CollectionHandle`. Two properties:

1. A caller cannot accidentally produce an unqualified write by forgetting a `.match(...)`.
2. Every unqualified write is grep-visible at the call site (`rg 'updateAll|deleteAll'`).

The methods take no filter argument. The names exist solely to force the reader to recognise the unqualified scope.

### Insert terminals

`.insertOne(doc)` / `.insertMany(docs)` live **only on** `CollectionHandle` (inserts have no filter). They typecheck `doc` against the contract row's **input** types (per the existing `MongoTypeMaps.fieldInputTypes` machinery). Wire-level normalization (Date → BSON Date, etc.) remains the executor's job — the builder is static.

### Update terminals

`.updateMany(updater)` / `.updateOne(updater)` accept a callback `(f) => UpdateOps | UpdateOps[]`:

- **Single object**: traditional update-operators document. `f => [f.status.set('active'), f.views.inc(1)]` returns an array of update ops; the builder folds it into a `{ $set, $inc, … }` record.
- **Array form**: update-with-pipeline (Mongo 4.2+). `f => [f.set('total', fn.multiply(f.price, f.qty)), f.unset('legacyTotal')]`. The terminal emits a `MongoUpdateSpec` array of `MongoUpdatePipelineStage`.

On `PipelineChain` (when `UpdateCompat` is set), `.updateMany()` and `.updateOne()` may also be called **with no argument**: the accumulated pipeline (excluding leading `.match`es, which become the filter) becomes the update-with-pipeline spec. This is form 2 in the original Linear ticket.

### Upsert terminals

Distinct from `update*`: `.upsertOne(...)` / `.upsertMany(...)`. On `CollectionHandle` they take `(filter, updater)`; on `FilteredCollection` they take `(updater)`. Modelled as separate methods (rather than an `{ upsert: true }` option on `update*`) for the same explicit-footgun reason as `updateAll`/`deleteAll` — upsert behaviour is grep-visible.

### `findOneAndUpdate` / `findOneAndDelete`

Reuse the chain vocabulary instead of introducing a parallel options API. Available on `FilteredCollection` (always) and `PipelineChain` (gated by `FindAndModifyCompat`).

```ts
q.from('users')
  .match(f => f.status.eq('pending'))
  .sort({ createdAt: 1 })
  .findOneAndUpdate(f => f.status.set('claimed'), { returnDocument: 'after' });
```

Terminal options (subset of the wire command, for things the chain can't express):

- `returnDocument: 'before' | 'after'` (default `'after'`)
- `upsert: boolean` (default `false`)
- `projection`: omitted; users `.project(...)` in the chain instead. (Note: `.project()` clears `FindAndModifyCompat`, so users who want both need to project on the *result* of `.build()` — acceptable trade-off.)

### Pipeline-terminal writes (`$merge`, `$out`)

Available on `PipelineChain` regardless of markers — they are pipeline-terminal stages that persist output.

```ts
q.from('events')
  .match(f => f.type.eq('purchase'))
  .group(f => ({ _id: f.userId, total: acc.sum(f.amount) }))
  .merge({ into: 'purchase_totals', on: '_id', whenMatched: 'replace', whenNotMatched: 'insert' });

q.from('events').match(f => f.archived.eq(true)).out('events_archive');
```

`.merge` and `.out` return `WriteTerminal`, not `ReadTerminal`.

### Param descriptors

Late-binding parameter descriptors (`MongoQueryPlan.meta.paramDescriptors`) flow through the same expression-walking machinery for reads and writes. No parallel API. Each terminal builds the full `meta` block from the AST it constructs.

### Bulk writes

Out of scope for v1. Mentioned only so the state machine doesn't need to grow awkwardly later. A future `q.from(coll).bulk([...])` terminal can package a heterogeneous array of `UpdateTerminal | DeleteTerminal | InsertTerminal` as a single `BulkWriteCommand`.

## Non-goals

- **Replacing the ORM.** The ORM keeps roots/includes/model-centric verbs, transactions-with-retries, nested-mutation ergonomics. This builder stays at the single-collection wire-command level. No ORM internals refactor in scope.
- **Change streams, transactions, sessions.** Not modelled by the builder; runtime concerns.
- **Execution.** The builder is static. `.build()` returns a `MongoQueryPlan`. Running it is the runtime's job.
- **Non-Mongo operators.** No SQL-style JOINs, no operators outside the MongoDB driver's surface.
- **Migration tooling tie-in.** The migration factories (`dataTransform`, `createIndex`) call this builder like any other user code. The builder doesn't know about migrations.
- **Bulk writes** (deferred — see above).
- **`.limit(1)` literal-type preservation of `FindAndModifyCompat`.** Any `.limit(...)` clears the marker; users who want single-document semantics call `.findOneAndUpdate()` directly.
- **Atlas Search builder ergonomics.** The existing opaque `Record<string, unknown>` config form for `$search`/`$searchMeta`/`$vectorSearch` is preserved; no typed wrappers for Atlas Search query DSLs.

# Requirements

## Functional Requirements

### Naming and packaging (M0)

- The package directory `packages/2-mongo-family/5-query-builders/pipeline-builder/` is renamed to `query-builder/`.
- `package.json#name` becomes `@prisma-next/mongo-query-builder`.
- The entry point export is renamed `mongoPipeline` → `mongoQuery`. The returned `PipelineRoot` interface is renamed `QueryRoot`.
- All in-repo callers, docs, ADR references, and READMEs are updated. No deprecation alias.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm lint:deps` pass on `main` after the rename.

### State machine (M1)

- Three concrete classes — `CollectionHandle<TContract, ModelName>`, `FilteredCollection<TContract, ModelName>`, `PipelineChain<TContract, Shape, UpdateCompat, FindAndModifyCompat>` — replace the single `PipelineBuilder` runtime class.
- Phantom type parameters `UpdateCompat extends 'compat' | 'cleared'` and `FindAndModifyCompat extends 'compat' | 'cleared'` gate the relevant terminals on `PipelineChain`. Default on entry into `PipelineChain` from `FilteredCollection` is `('compat', 'compat')`; entry from `CollectionHandle` via a pipeline stage is also `('compat', 'compat')`.
- All read-side stage methods from the existing `PipelineBuilder` are partitioned across the three classes per the diagram in the [Surface design](#surface-design) section.
- `.match(...)` calls accumulate on `FilteredCollection`. When a terminal consumes them, they AND-fold into a single `MongoAndExpr` (or remain as multiple `$match` stages in pipeline terminals — implementation detail).
- The marker table for pipeline-stage methods is implemented exactly as specified in [Marker semantics on `PipelineChain`](#marker-semantics-on-pipelinechain).

### Unified field accessor (M1)

- A single `FieldAccessor<Shape>` type replaces the existing `FieldProxy` and `FilterProxy`.
- Property access exposes the contract's flat field names: `f.fieldName` returns an `Expression<F>` carrying the leaf codec.
- Callable form `f("dot.path")` traverses value objects and unions per [ADR 180](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md), implemented via a recursive template-literal `ResolvePath` type that walks `ContractValueObject.fields` (already present in `@prisma-next/mongo-contract`).
- The returned `Expression` exposes:
  - **Filter operators**: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `exists`, `regex`, `all`, `elemMatch`, `size`. Trait-gated by leaf codec where it matters (e.g. `regex` only on string codecs).
  - **Update operators** (Mongo): `set`, `unset`, `inc`, `mul`, `min`, `max`, `rename`, `push`, `addToSet`, `pop`, `pull`, `pullAll`, `currentDate`, `setOnInsert`. Trait-gated where it matters (e.g. array operators on array fields, numeric operators on numeric fields).
- All existing read-side callback shapes (`match(f => f.x.eq(...))`, `addFields(f => ({ y: ... }))`, `group(f => ({ _id: ..., total: acc.sum(f.amount) }))`, `project(f => ({...}))`) compile unchanged against the unified accessor.

### Read terminals (M1 — parity with current builder)

- `.build()` and `.aggregate()` are equivalent on `PipelineChain` and produce `MongoQueryPlan<ResolveRow<Shape, ExtractMongoCodecTypes<TContract>>>`.
- `CollectionHandle.aggregate()` and `FilteredCollection.aggregate()` shortcut to a `PipelineChain.aggregate()` (i.e. the chain is materialised lazily, but the API is uniform).
- All current pipeline-stage methods (match, sort, limit, skip, sample, addFields, lookup, project, unwind, group, replaceRoot, count, sortByCount, redact, out, merge, unionWith, bucket, bucketAuto, geoNear, facet, graphLookup, setWindowFields, densify, fill, search, searchMeta, vectorSearch, pipe) survive the split, located on the right class per the diagram.

### Insert and unqualified-write terminals (M2)

- `CollectionHandle.insertOne(doc)`, `.insertMany(docs)` typecheck `doc` against the contract row's input types and produce a `MongoQueryPlan<InsertResult>` whose command is `InsertOneCommand` / `InsertManyCommand`.
- `CollectionHandle.updateAll(updater)` produces an `UpdateManyCommand` with a tautological filter (`MongoAndExpr.empty()` or equivalent — i.e. matches all documents).
- `CollectionHandle.deleteAll()` produces a `DeleteManyCommand` with a tautological filter.
- All four are grep-visible by name; no overload provides a sneaky path to an unqualified write.

### Filtered write terminals (M2)

- `FilteredCollection.updateMany(updater)`, `.updateOne(updater)` produce `UpdateManyCommand` / `UpdateOneCommand` with the AND-folded filter and the updater's emitted `MongoUpdateSpec`.
- `.deleteMany()`, `.deleteOne()` produce `DeleteManyCommand` / `DeleteOneCommand`.
- `updater` is `(f: FieldAccessor<Row>) => UpdateOp | ReadonlyArray<UpdateOp> | ReadonlyArray<MongoUpdatePipelineStage>` — the builder dispatches on the returned shape.

### Find-and-modify terminals (M3)

- `FilteredCollection.findOneAndUpdate(updater, opts?)` returns a `MongoQueryPlan<ReturnedRow>` whose command is `FindOneAndUpdateCommand`.
- `FilteredCollection.findOneAndDelete(opts?)` returns a `MongoQueryPlan<ReturnedRow>` whose command is `FindOneAndDeleteCommand`.
- `PipelineChain<…, _, 'compat'>.findOneAndUpdate(...)` / `.findOneAndDelete(...)` deconstruct the chain's leading `match` / `sort` / `skip` stages into the wire-command slots (no `limit` because `.limit` clears the marker).
- Terminal options: `returnDocument: 'before' | 'after'` (default `'after'`), `upsert: boolean` (default `false`).

### Upsert terminals (M3)

- `CollectionHandle.upsertOne(filter, updater)`, `.upsertMany(filter, updater)` and `FilteredCollection.upsertOne(updater)`, `.upsertMany(updater)` produce `UpdateOneCommand` / `UpdateManyCommand` with `upsert: true` semantics. (If the existing AST does not have an `upsert` field on these commands, extend the AST in M3.)

### Update-with-pipeline (M4)

- The updater callback's array-return form emits `MongoUpdatePipelineStage[]` — full update-with-pipeline support (`$set`/`$addFields`, `$unset`/`$project`, `$replaceRoot`/`$replaceWith`, `$redact`).
- `PipelineChain<…, 'compat', _>.updateMany()` / `.updateOne()` (no argument) deconstructs the chain into `(filter, pipelineSpec)` and produces an `UpdateManyCommand` / `UpdateOneCommand` with the array-form `update`.
- `.merge(opts)` and `.out(coll)` on `PipelineChain` produce a `WriteTerminal` whose command is an `AggregateCommand` ending in `MongoMergeStage` / `MongoOutStage`.

### Raw-command escape hatch (M5)

- `mongoQuery<Contract>(...).rawCommand(cmd: AnyMongoCommand): MongoQueryPlan<unknown>` packages a hand-constructed command into a plan. This is the supported escape for non-CRUD wire commands (`collStats`, `dbStats`, etc.). Users wanting raw documents continue to use `mongoRaw`.

### Migration target compatibility (close-out)

- The `dataTransform.run` shape (from PR [#349](https://github.com/prisma/prisma-next/pull/349)) consumes `{ collection, command, meta }` — exactly what the new write terminals produce. After both PRs merge, a follow-up PR converts `examples/retail-store/migrations/20260416_backfill-product-status` to use `mongoQuery(...).from('products').match(f => f('status').exists(false)).updateMany(f => f.status.set('active'))` instead of `new RawUpdateManyCommand(...)`. (See [Open Items](#open-items) for sequencing.)

## Non-Functional Requirements

- No `any`, `@ts-expect-error` (outside negative type tests), or `@ts-nocheck`.
- All AST node instances remain immutable (frozen). Builder state (the `cloneState`-style pattern) remains immutable.
- Type casts minimised; `as unknown as T` only as a last resort with a justifying comment.
- Builder-level type machinery (`DocField`, `DocShape`, `ResolveRow`, `FieldAccessor`) bridges contract types to expression and update types in one place.
- Package layering: `@prisma-next/mongo-query-builder` may depend on `@prisma-next/contract`, `@prisma-next/mongo-contract`, `@prisma-next/mongo-query-ast`, `@prisma-next/mongo-value`. `pnpm lint:deps` passes after the rename and after each milestone.
- No runtime dependencies — the builder remains a static plan-construction tool.
- The three concrete state classes have monomorphic shapes (no megamorphic dispatch sites) — splitting the surface improves JIT-friendliness, not just typing.

# Acceptance Criteria

## Naming and packaging (M0)

- [ ] Package directory is `packages/2-mongo-family/5-query-builders/query-builder/`; old directory removed.
- [ ] `package.json#name` is `@prisma-next/mongo-query-builder`.
- [ ] Entry point `mongoQuery<TContract>(opts).from(name)` typechecks and produces a `CollectionHandle`.
- [ ] No occurrences of `mongoPipeline` or `@prisma-next/mongo-pipeline-builder` remain in the repo (excluding history-lock files like CHANGELOGs if any).
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm lint:deps` pass.

## State machine (M1)

- [ ] `CollectionHandle`, `FilteredCollection`, `PipelineChain` are three separate runtime classes; their public APIs match the diagram in [Surface design](#surface-design).
- [ ] Type test: `CollectionHandle<…>` exposes `match`, `insertOne`, `insertMany`, `updateAll`, `deleteAll`, `upsertOne`, `upsertMany`, and the pipeline-stage methods. It does **not** expose `updateMany`, `updateOne`, `deleteMany`, `deleteOne`, `findOneAndUpdate`, `findOneAndDelete`.
- [ ] Type test: `FilteredCollection<…>` exposes `match`, `updateMany`, `updateOne`, `deleteMany`, `deleteOne`, `upsertOne`, `upsertMany`, `findOneAndUpdate`, `findOneAndDelete`, and the pipeline-stage methods. It does **not** expose `insertOne`/`insertMany`/`updateAll`/`deleteAll`.
- [ ] Type test: `PipelineChain<S, 'compat', 'compat'>` exposes `updateMany()`, `updateOne()`, `findOneAndUpdate(...)`, `findOneAndDelete(...)`, `merge`, `out`, `build`, `aggregate`.
- [ ] Type test: `PipelineChain<S, 'cleared', 'cleared'>` (e.g. after `.group(...)`) exposes `merge`, `out`, `build`, `aggregate` but **not** `updateMany`, `updateOne`, `findOneAndUpdate`, `findOneAndDelete`.
- [ ] Type test: `PipelineChain<S, 'preserve', 'cleared'>` (e.g. after `.addFields(...)`) exposes `updateMany`, `updateOne` but **not** `findOneAndUpdate`, `findOneAndDelete`.
- [ ] Type test: `PipelineChain<S, 'cleared', 'preserve'>` (e.g. after `.sort(...)` only) exposes `findOneAndUpdate`, `findOneAndDelete` but **not** `updateMany()`/`updateOne()` no-arg form.
- [ ] Multiple consecutive `.match(...)` calls compile and AND-fold to a single filter at the consuming terminal (asserted by inspecting the produced command's `filter`).

## Unified field accessor (M1)

- [ ] A single `FieldAccessor<Shape>` type is exported; the old `FieldProxy` and `FilterProxy` types are removed.
- [ ] Property access: `f.scalarField.eq(value)` typechecks against the leaf codec; `f.scalarField.set(value)` and the full update-operator surface are available on the same expression.
- [ ] Callable form: `f("address.city").eq("NYC")` typechecks against a `ContractValueObject` field declared in the contract test fixture; `f("nonexistent.path")` is a type error.
- [ ] All existing read-side test files (in the renamed `query-builder` package) continue to compile and pass, with the unified accessor in place.

## Insert and unqualified-write terminals (M2)

- [ ] `q.from('orders').insertOne({ … })` produces a `MongoQueryPlan` whose `command` is an `InsertOneCommand` with the document; the document type is checked against the contract's input types.
- [ ] `q.from('orders').insertMany([{ … }, { … }])` similarly produces `InsertManyCommand`.
- [ ] `q.from('orders').updateAll(f => f.status.set('archived'))` produces an `UpdateManyCommand` with a tautological filter.
- [ ] `q.from('orders').deleteAll()` produces a `DeleteManyCommand` with a tautological filter.
- [ ] Compile error: `q.from('orders').match(...).updateAll(...)` (no `updateAll` on `FilteredCollection`).
- [ ] Compile error: `q.from('orders').match(...).insertOne({...})` (no `insertOne` on `FilteredCollection`).

## Filtered write terminals (M2)

- [ ] `q.from('orders').match(f => f.status.eq('pending')).updateMany(f => [f.status.set('shipped'), f.shippedAt.currentDate()])` produces an `UpdateManyCommand` with the folded filter and a `{ $set: { status: 'shipped' }, $currentDate: { shippedAt: true } }` update.
- [ ] `q.from('orders').match(...).deleteOne()` produces a `DeleteOneCommand`.
- [ ] Integration test (mongo-memory-server): match → updateMany executes and affects the expected documents.

## Find-and-modify terminals (M3)

- [ ] `q.from('users').match(f => f.status.eq('pending')).sort({ createdAt: 1 }).findOneAndUpdate(f => f.status.set('claimed'), { returnDocument: 'after' })` produces a `FindOneAndUpdateCommand` with the filter from `.match`, sort `{ createdAt: 1 }`, and `update: { $set: { status: 'claimed' } }`.
- [ ] Integration test (mongo-memory-server): the find-and-modify path returns the modified document.
- [ ] Compile error: `q.from('users').match(...).group(...).findOneAndUpdate(...)` (group clears `FindAndModifyCompat`).

## Upsert terminals (M3)

- [ ] `q.from('users').upsertOne(f => f.email.eq('a@b.c'), f => [f.email.set('a@b.c'), f.firstSeen.currentDate()])` produces an `UpdateOneCommand` with `upsert: true`.
- [ ] `q.from('users').match(f => f.email.eq('a@b.c')).upsertOne(f => [...])` produces an equivalent command.
- [ ] Integration test (mongo-memory-server): upsert against a missing document inserts; against an existing document updates.

## Update-with-pipeline (M4)

- [ ] `q.from('products').match(...).updateMany(f => [f.set('total', fn.multiply(f.price, f.qty)), f.unset('legacyTotal')])` produces an `UpdateManyCommand` whose `update` is `MongoUpdatePipelineStage[]`.
- [ ] `q.from('products').match(...).addFields(f => ({ total: fn.multiply(f.price, f.qty) })).updateMany()` produces an equivalent command (form 2: chain consumed).
- [ ] Integration test (mongo-memory-server): pipeline-style update with a cross-field reference executes correctly.
- [ ] Compile error: `q.from('products').match(...).group(...).updateMany()` (group clears `UpdateCompat`).
- [ ] `.merge({...})` and `.out('coll')` produce `AggregateCommand` plans whose final stage is `MongoMergeStage` / `MongoOutStage`.

## Raw-command escape hatch (M5)

- [ ] `q.rawCommand(new SomeAdHocCommand(...))` returns a `MongoQueryPlan<unknown>` carrying the supplied command and the contract's `storageHash` in `meta`.

## Documentation and close-out

- [ ] `projects/mongo-pipeline-builder/spec.md` is updated to reference this spec as the unifying scope; the read-side acceptance criteria continue to apply.
- [ ] Long-lived design content moves into the MongoDB Family subsystem doc (or an appropriate sibling). `projects/mongo-pipeline-builder/` is deleted in the close-out PR per the project workflow.
- [ ] `examples/retail-store/migrations/20260416_backfill-product-status` is converted to use `mongoQuery` instead of raw command construction, in a follow-up PR after this branch and PR [#349](https://github.com/prisma/prisma-next/pull/349) both merge.

# Other Considerations

## Security

No new attack surface. All operators are constructed as typed AST nodes; no string interpolation reaches the wire.

## Cost

No infrastructure cost implications. Compile-time/build-time library only.

## Observability

- Every produced `MongoQueryPlan` carries `meta.lane`. Read pipelines retain `'mongo-pipeline'`. New write terminals adopt new lane labels:
  - `'mongo-write'` for inserts/updates/deletes/upserts (single wire-command writes).
  - `'mongo-pipeline-write'` for `.merge`/`.out` and update-with-pipeline form 2 (writes that compile to an `AggregateCommand`).
  - `'mongo-find-and-modify'` for `findOneAndUpdate` / `findOneAndDelete`.
  - `'mongo-raw'` for `q.rawCommand(...)`.
  Distinguishes builder-produced traffic from ORM traffic in runtime instrumentation.

## Data Protection

No change. The builder produces the same wire commands the ORM and `mongoRaw` already use.

## Analytics

N/A — internal developer tool.

# References

- Linear ticket: [TML-2267 — Query builder unification](https://linear.app/prisma-company/issue/TML-2267/query-builder-unification)
- [`projects/mongo-pipeline-builder/spec.md`](../spec.md) — original pipeline-builder spec; this document is a supersession-in-scope. Read-side requirements remain valid.
- [`projects/mongo-pipeline-builder/specs/expression-accumulator-helpers.spec.md`](./expression-accumulator-helpers.spec.md) — unaffected; `fn` and `acc` helpers are shared between read and update-with-pipeline.
- [`projects/mongo-migration-authoring/spec.md`](../../mongo-migration-authoring/spec.md) — consumer of the typed write surface via `dataTransform.run`. Cross-references the motivating example.
- PR [#349](https://github.com/prisma/prisma-next/pull/349) (`tml-2219-data-migrations-for-mongodb`) — introduces `dataTransform()`. Not a git base for this work; integration validated post-merge of both branches.
- [ADR 180 — Dot-path field accessor](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md) — unified accessor design.
- [ADR 178 — Value objects in the contract](../../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md) — value-object contract representation (already landed; see `InferFieldType` in `mongo-contract`).
- [ADR 183 — Aggregation pipeline only, never `find()` API](../../../docs/architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md) — applies to read terminals; reads stay on `aggregate()`.
- Existing builder: `packages/2-mongo-family/5-query-builders/pipeline-builder/src/builder.ts`, `pipeline.ts`, `types.ts`, `field-proxy.ts`, `filter-proxy.ts`.
- Existing AST surface: `packages/2-mongo-family/4-query/query-ast/src/commands.ts`, `raw-commands.ts`, `stages.ts`.

# Open Items

1. **Upsert AST shape.** `UpdateOneCommand` / `UpdateManyCommand` in `commands.ts` currently have no `upsert` field; only `FindOneAndUpdateCommand` does. M3 must extend the AST. Confirm during M3 whether to extend the existing classes or introduce sibling `UpsertOneCommand` / `UpsertManyCommand` classes — leaning **extend existing** to keep the wire-command surface 1:1 with the driver.
2. **Tautological filter representation.** `updateAll` / `deleteAll` need a "matches all" filter expression. Confirm whether `MongoAndExpr` with an empty conjunction lowers to `{}` correctly, or whether we need a `MongoMatchAllExpr` node. Decide during M2.
3. **`AnyMongoCommand` for `rawCommand`.** Currently includes `RawMongoCommand` and the typed CRUD commands. `q.rawCommand(...)` should accept the union but is most useful for commands outside this set (e.g. `collStats`). Decide during M5 whether to widen to a string-keyed `Document` form or to introduce additional typed wrappers (likely the former — minimal surface, escape hatch is escape hatch).
4. **Trait-gating of update operators.** ADR 180 says the operator set is capability-gated by target and codec. Decide during M1 how strict to be (e.g. should `f.tags.inc(1)` on a string array be a type error?). Default: trait-gate where it's cheap, accept some over-permission where the cost of precise typing outweighs the benefit. Worst case the runtime fails with a clear Mongo error.
5. **Retail-store example conversion timing.** Listed under acceptance criteria as a follow-up PR. If PR [#349](https://github.com/prisma/prisma-next/pull/349) merges first, convert in this branch's close-out. If this branch merges first, convert in a small follow-up PR immediately after [#349](https://github.com/prisma/prisma-next/pull/349) merges. Tracked in [plan close-out](../plans/query-builder-unification-plan.md#close-out).
