# ADR 201 — State-machine pattern for typed DSL builders

## At a glance

When a fluent builder has multiple terminals (`.build()`, `.updateMany()`, `.findOneAndUpdate()`, …) and the set of legal terminals depends on which chain methods were called before, encode each *phase* of the chain as its own concrete class. Carry the transitions on return types. Where two phases differ only in which subset of terminals is available, use phantom type parameters on the class rather than adding another class.

Concretely, `@prisma-next/mongo-query-builder` splits the chain into three classes:

```ts
mongoQuery<Contract>({ contractJson })
  .from('users')                // CollectionHandle
  .match((f) => f.status.eq(1)) // FilteredCollection
  .sort({ createdAt: 1 })       // PipelineChain<…, 'update-cleared', 'fam-ok'>
  .findOneAndUpdate((f) => [f.status.set(2)]);
  // ^ compiles — FindAndModifyEnabled is still 'fam-ok'

mongoQuery<Contract>({ contractJson })
  .from('users')
  .match((f) => f.status.eq(1))
  .sort({ createdAt: 1 })
  .limit(10)                    // limit clears both markers
  .findOneAndUpdate((f) => [f.status.set(2)]);
  // ^ type error: findOneAndUpdate does not exist on PipelineChain<…, _, 'fam-cleared'>
```

Two properties to notice:

1. **The illegal chain does not compile.** `findOneAndUpdate` isn't a method you can call on a `.limit(...)`-terminated pipeline, so there is nothing to run at the wrong time.
2. **The legal chain's return type narrows *within* `PipelineChain`** — a single class, parameterised by marker types, not three separate pipeline classes (`SortedPipeline`, `LimitedPipeline`, …).

## Context

The Mongo query builder exposes a surface with unusually broad state-dependent vocabulary:

- From `q.from('users')` you can `insertOne`, `insertMany`, `updateAll`, `deleteAll`, `match`, or go straight to a pipeline stage.
- After one or more `.match(...)` calls you can `updateMany`, `updateOne`, `upsertOne`, `findOneAndUpdate`, `findOneAndDelete`, or continue into a pipeline.
- Inside a pipeline, some terminals remain valid (`$merge`, `$out`, `.aggregate()`) and some depend on what preceded — `.updateMany()` (no-arg, pipeline-style) only works if every prior stage can be lowered into an update-with-pipeline spec, and `findOneAndUpdate` only works if the prior stages fit the wire command's `{ filter, sort, skip }` slots.

A conventional fluent builder — a single `PipelineBuilder` class with every method — is forced into one of two failure modes:

- **Accept everything, validate at runtime.** Every method exists on every instance; invalid combinations throw when `.build()` runs. The type system contributes nothing. This is where `@prisma-next/mongo-pipeline-builder` started.
- **Use overloads to fake state.** Overload each terminal with "this overload exists only when the prior chain is X" conditions. This works for simple cases and collapses under real-world shape: overload resolution messages become illegible, conditional types blow up, and the "when is `findOneAndUpdate` legal?" rule is smeared across every method signature instead of being written down once.

Neither approach scales to the unified CRUD surface the builder now ships.

## Problem

How do you encode a fluent builder surface where:

1. The set of legal terminals depends on the sequence of prior method calls.
2. Some transitions are discrete phase changes (unfiltered → filtered → pipeline) with fundamentally different vocabularies.
3. Other transitions are continuous within a phase (pipeline stages appending to a pipeline) but incrementally *retract* capabilities (e.g. `.limit(...)` makes `findOneAndUpdate` illegal).

…without sacrificing compile-time safety, hover-legible types, or JIT-friendly runtime dispatch.

## Decision

### 1. Discrete phases become concrete classes

Each qualitatively different state is its own class. Transitions between phases are return types on methods:

| Class | Reached by | Terminals |
| --- | --- | --- |
| `CollectionHandle<TContract, ModelName>` | `q.from(name)` | inserts, unqualified writes (`updateAll` / `deleteAll`), unqualified upsert, then transitions out via `.match(...)` or stage methods |
| `FilteredCollection<TContract, ModelName>` | `.match(...)` on a handle (or chained match) | filtered writes (`updateMany`, `updateOne`, `deleteMany`, `deleteOne`), `upsertOne`, `findOneAnd*`, and transitions into `PipelineChain` |
| `PipelineChain<TContract, Shape, U, F>` | any pipeline-stage call | `$merge` / `$out`, read terminals (`.build()`, `.aggregate()`), and — conditional on `U` and `F` — pipeline-style writes and find-and-modify |

Three classes, three vocabularies, no overloads.

### 2. Conditional terminals on a phase use phantom type parameters

Within `PipelineChain`, the set of legal terminals isn't binary — it depends on which pipeline stages have already run. Splitting `PipelineChain` into `SortedPipelineChain`, `LimitedPipelineChain`, `GroupedPipelineChain`, and every combination thereof is a class explosion.

Instead, `PipelineChain` has two phantom type parameters:

```ts
export type UpdateEnabled = 'update-ok' | 'update-cleared';
export type FindAndModifyEnabled = 'fam-ok' | 'fam-cleared';

export class PipelineChain<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  Shape extends DocShape,
  U extends UpdateEnabled = 'update-ok',
  F extends FindAndModifyEnabled = 'fam-ok',
> {
  declare readonly __updateCompat: U;
  declare readonly __findAndModifyCompat: F;
  // …
}
```

Each pipeline-stage method declares what it does to the markers in its return type. For example:

```ts
// $sort: clears update-with-pipeline compat, preserves find-and-modify
sort(spec: SortSpec<Shape>): PipelineChain<TContract, Shape, 'update-cleared', F>;

// $limit: clears both — update has no per-document limit,
// findAndModify already implies single-document semantics
limit(n: number): PipelineChain<TContract, Shape, 'update-cleared', 'fam-cleared'>;

// $match: pure filter, both preserved
match(filter: MongoFilterExpr): PipelineChain<TContract, Shape, U, F>;
```

Conditional terminals are then trivially expressible. `findOneAndUpdate` is a method on `PipelineChain<_, _, _, 'fam-ok'>` and no other specialisation. Call it on a `'fam-cleared'` instance and the method simply doesn't exist.

The marker values are literal strings (`'update-ok'` vs `'update-cleared'`) rather than `true`/`false` so hover tooltips, error messages, and IDE reveals name which capability is cleared.

### 3. Marker preservation/clearing is a documented table

Every pipeline-stage method is an entry in a table of what it does to each marker:

| Stage method | `UpdateEnabled` | `FindAndModifyEnabled` |
| --- | --- | --- |
| `.match(...)` | preserve | preserve |
| `.sort(...)` | clear | preserve |
| `.skip(...)` | clear | preserve |
| `.limit(...)` | clear | clear |
| `.addFields(...)` / `.set(...)` | preserve | clear |
| `.project(...)` / `.unset(...)` | preserve | clear |
| `.replaceRoot(...)` / `.replaceWith(...)` | preserve | clear |
| `.redact(...)` | preserve | clear |
| `.group(...)` | clear | clear |
| `.lookup(...)` | clear | clear |
| `.unwind(...)` | clear | clear |
| `.facet(...)` | clear | clear |
| other shape-changing stages | clear | clear |

The table is an obligation on the implementation, not an emergent property of the type system. Each method is type-annotated with its marker effects; the table captures the invariant a reviewer checks against.

## Worked example: why the marker types are worth the machinery

Consider a real chain that appeared during the builder's conversion from pipeline-only to CRUD:

```ts
// Valid: match, sort, findOneAndUpdate
q.from('pending_jobs')
  .match((f) => f.status.eq('queued'))    // FilteredCollection
  .sort({ priority: -1, createdAt: 1 })   // PipelineChain<…, 'update-cleared', 'fam-ok'>
  .findOneAndUpdate(
    (f) => [f.status.set('running'), f.claimedAt.currentDate()],
    { returnDocument: 'after' },
  );
```

`.sort(...)` cleared `UpdateEnabled` but preserved `FindAndModifyEnabled`, so `findOneAndUpdate` is still callable. The wire-level `findAndModify` command has a `sort` slot, so the sort maps cleanly.

Now add a `.limit(...)`:

```ts
q.from('pending_jobs')
  .match((f) => f.status.eq('queued'))
  .sort({ priority: -1, createdAt: 1 })
  .limit(10)                              // PipelineChain<…, 'update-cleared', 'fam-cleared'>
  .findOneAndUpdate(/* … */);
  // TS error: Property 'findOneAndUpdate' does not exist on type
  //          'PipelineChain<…, "update-cleared", "fam-cleared">'.
```

`.limit(...)` clears `FindAndModifyEnabled` because `findAndModify` already implies single-document semantics — `.limit(10).findOneAndUpdate(...)` is ambiguous (pick one of ten? the first of ten?). The type system enforces the semantic clarification at the call site. The author has to choose: drop `.limit(10)` and call `findOneAndUpdate` (first in priority order), or `.build()` the aggregation and handle the ten-candidate result manually.

The same pattern defends the implementation against every marker-clearing stage without the terminal-side code having to know which stages cleared its marker. `.group(...)` returns `PipelineChain<…, 'update-cleared', 'fam-cleared'>`; the absence of `findOneAndUpdate` and no-arg `updateMany` on that instance is automatic.

## Consequences

### Benefits

- **Illegal chains do not compile.** The set of `$sort` + `updateMany`, `$group` + `findOneAndUpdate`, `$limit` + `findOneAndUpdate`, `$lookup` + `updateMany`, and similar illegal combinations is a finite list; every one of them is rejected by the type system without a dedicated check.
- **Monomorphic runtime shapes.** Each class has a fixed set of methods and a fixed set of fields. V8 can specialise call sites — `collection.match(...)` is one receiver type, `pipeline.limit(...)` is another. This is not a generic "typed builder" argument; it is a direct consequence of having three concrete classes rather than one class with a union of optional methods. Relevant for hot paths in the ORM's compile-to-plan layer.
- **Hover tooltips read well.** On a `FilteredCollection<…>` the IDE shows the filtered-phase terminals, not a union of every possible terminal with "available iff X" commentary.
- **The spec's marker table is the source of truth.** Any disagreement between the table and a method's return-type annotation is a mechanical fix — grep for the stage, check the return type, reconcile.

### Costs

- **More classes to keep in lock-step.** Three classes share AND-folding logic (filter composition), builder-state cloning, and `meta`-block construction. Centralising these helpers (see `resolveUpdaterCallback`, `matchAllFilter`, `#writeMeta`) mitigates duplication, but it is a thing to remember.
- **Marker-table discipline.** Every new pipeline-stage method must declare its marker effects deliberately. Getting a marker wrong is a silent bug — terminals appear or disappear incorrectly, and only the test suite catches it.
- **Return types are verbose at the method declaration site.** `PipelineChain<TContract, Shape, 'update-cleared', 'fam-cleared'>` shows up a lot. Aliasing (e.g. `type PipelineChainAfterGroup<…> = PipelineChain<…, 'update-cleared', 'fam-cleared'>`) hides it at the cost of a layer of indirection — worth doing selectively, not globally.
- **Phantom parameters don't explain themselves.** A reader landing on `PipelineChain<_, _, 'update-cleared', 'fam-ok'>` in a type error needs to know what the third and fourth parameters mean. The `declare readonly __updateCompat: U;` and `__findAndModifyCompat: F;` fields exist purely to make the literal values visible in hover tooltips — a small amount of ceremony that materially improves error legibility.

## When to use this pattern

This is a candidate pattern, not a blanket recommendation. Reach for it when all of the following hold:

1. **The builder has multiple terminals.** A one-terminal builder (everything ends in `.build()`) gets no leverage from the marker mechanism.
2. **The chain has identifiable phases with qualitatively different vocabularies.** If every method is available at every point, a single class is fine.
3. **Some chain methods make some terminals *semantically* illegal**, not just unusual. "You can do it, but it does nothing useful" is not enough; the bar is "this combination cannot be lowered to a valid wire command / SQL statement / target operation".
4. **Illegal combinations are enumerable at build time.** If legality depends on runtime values (e.g. a contract flag loaded dynamically), the type system can't speak to it.

A plausible future user is a typed SQL query builder. It has the same ingredients: `SELECT` vs. `INSERT` vs. `UPDATE` are phases with distinct vocabularies; within a `SELECT`, adding `GROUP BY` makes some operations (`RETURNING`, non-aggregated columns in the projection) illegal; within an `UPDATE`, the `FROM`/join clause is available only under certain dialect rules. The three-class + phantom-markers split should translate with mostly-mechanical changes to the phases and markers.

A poor fit is a builder whose chain is just progressive configuration of a single plan (e.g. an HTTP client builder — `.timeout(…)`, `.header(…)`, `.retry(…)` can be called in any order, each terminal is universally legal). Use regular fluent chaining there.

## Related

- [ADR 180 — Dot-path field accessor](ADR%20180%20-%20Dot-path%20field%20accessor.md) — the unified `FieldAccessor` callback type that stage methods accept (`.match(f => …)`, `.updateMany(f => …)`, etc.)
- [ADR 183 — Aggregation pipeline only, never find API](ADR%20183%20-%20Aggregation%20pipeline%20only%2C%20never%20find%20API.md) — the upstream constraint that made a unified read builder coherent (everything is a pipeline; `find()` is not a parallel surface)
- [MongoDB Family subsystem](../subsystems/10.%20MongoDB%20Family.md) — conceptual summary of the query builder inside the wider Mongo stack
- `@prisma-next/mongo-query-builder` [package README](../../../packages/2-mongo-family/5-query-builders/query-builder/README.md) — user-facing surface documentation
