# ADR 201 — State-machine pattern for typed DSL builders

## At a glance

`@prisma-next/mongo-query-builder` exposes a contract-bound, typed CRUD surface. Its chain looks like any fluent builder — `q.from('users').match(...).build()` for a read, `q.from('users').match(...).updateMany(...)` for a write — but the *set of methods available on the chain changes as you call them*. Here's a happy-path read next to a happy-path write next to a find-and-modify, with the class name of each intermediate value on the right:

```ts
// Read
q.from('orders')                          // CollectionHandle
  .match((f) => f.status.eq('open'))      // FilteredCollection
  .sort({ createdAt: -1 })                // PipelineChain
  .project('id', 'total')                 // PipelineChain
  .build();                               // MongoQueryPlan<{ id, total }>

// Filtered write
q.from('orders')                          // CollectionHandle
  .match((f) => f.status.eq('open'))      // FilteredCollection
  .updateMany((f) => [f.total.mul(1.1)]); // MongoQueryPlan<UpdateResult>

// Find-and-modify
q.from('pending_jobs')                    // CollectionHandle
  .match((f) => f.status.eq('queued'))    // FilteredCollection
  .sort({ priority: -1 })                 // PipelineChain (see below)
  .findOneAndUpdate((f) => [f.status.set('running')]);
```

Each intermediate value is a different concrete class with a different menu of methods. `CollectionHandle` can insert; `FilteredCollection` can't, but *can* do filtered writes and find-and-modify. Inside `PipelineChain`, some methods (`$merge`, `$out`, `.aggregate()`) are always available, and some (`.findOneAndUpdate(...)`, no-arg `.updateMany()`) are available only if the preceding pipeline stages can be lowered to the downstream wire command. *If a method isn't legal for the chain you've written, it doesn't exist on the receiver, so you can't call it.*

This ADR is the decision record for how that works: a small state machine encoded in the type system, using three concrete classes plus a pair of phantom type parameters on the pipeline class.

## Decision

### 1. Three concrete classes, one per state

The chain has three qualitatively different vocabularies, so it gets three classes. Transitions are return types on methods; there is no shared base class and no overload-driven method-hiding.

- **`CollectionHandle<TContract, ModelName>`** — reached by `q.from(name)`. Inserts (`insertOne`, `insertMany`), unqualified writes (`updateAll`, `deleteAll`), `upsertOne(filter, updater)`. Transitions out via `.match(...)` into `FilteredCollection`, or via any pipeline-stage method into `PipelineChain`.
- **`FilteredCollection<TContract, ModelName>`** — reached by `.match(...)` on a `CollectionHandle` (or chained match). Filtered writes (`updateMany`, `updateOne`, `deleteMany`, `deleteOne`), `upsertOne(updater)`, `findOneAndUpdate`, `findOneAndDelete`. Further `.match(...)` calls stay on `FilteredCollection` (AND-folded); any pipeline-stage method moves to `PipelineChain`.
- **`PipelineChain<TContract, Shape, U, F>`** — reached by any pipeline-stage method on either earlier state. Pipeline stages (`.sort`, `.limit`, `.group`, `.lookup`, …), `$merge`/`$out` write terminals, and read terminals (`.build()`, `.aggregate()`). Pipeline-style writes and find-and-modify are *conditional* — available only when the phantom markers `U` and `F` are still "enabled". See § 2.

The user-facing entry point `mongoQuery<Contract>({...}).from(name)` returns a `CollectionHandle`. Everything else is reached from there.

> Throughout this ADR a **terminal** is a method that ends the chain by returning a `MongoQueryPlan` (e.g. `.build()`, `.updateMany()`, `.findOneAndUpdate(...)`). A **stage** is a method that extends the chain and returns another builder class.

### 2. Phantom markers inside `PipelineChain`

Once the chain is inside `PipelineChain`, the remaining distinctions aren't whole new vocabularies — they're subsets of terminals that become illegal as specific pipeline stages accumulate. Two terminals are in this bucket:

- The no-arg `.updateMany()` / `.updateOne()` form, which consumes the accumulated pipeline as an `update`-with-pipeline spec. Legal only if every prior stage is representable as an update-pipeline stage (so no `$limit`, no `$group`, no `$lookup`, …).
- `.findOneAndUpdate(...)` / `.findOneAndDelete(...)`, which deconstructs the accumulated pipeline into the wire command's `{ filter, sort }` slots. Legal only if every prior stage fits one of those slots.

Splitting `PipelineChain` into `SortedPipelineChain`, `LimitedPipelineChain`, `GroupedPipelineChain`, `SortedLimitedPipelineChain`, … is a combinatorial class explosion. Instead, `PipelineChain` stays a single class and carries two **phantom type parameters** — type parameters that never appear in a runtime value, only in the type position, used to track compile-time state:

```ts
export type UpdateEnabled = 'update-ok' | 'update-cleared';
export type FindAndModifyEnabled = 'fam-ok' | 'fam-cleared';

export class PipelineChain<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  Shape extends DocShape,
  U extends UpdateEnabled = 'update-ok',
  F extends FindAndModifyEnabled = 'fam-ok',
> {
  // Nothing uses these fields at runtime. They exist so that a hover
  // tooltip on a `PipelineChain` value shows the marker literals inline
  // ("__updateCompat: 'update-cleared'") instead of leaving the reader
  // to decode the third and fourth generic parameters.
  declare readonly __updateCompat: U;
  declare readonly __findAndModifyCompat: F;
  // …
}
```

A stage method declares what it does to the markers directly in its return type. When a stage produces content a downstream wire command cannot lower, it **clears** the corresponding marker:

```ts
// $match: pure filter, both preserved
match(...): PipelineChain<TContract, Shape, U, F>;

// $sort: clears update-with-pipeline (update has no per-document sort)
//        but preserves FAM (findAndModify has a sort slot)
sort(spec: SortSpec<Shape>): PipelineChain<TContract, Shape, 'update-cleared', F>;

// $limit: clears both. update has no per-document limit; findAndModify
//         already implies single-document semantics, so .limit(10) before
//         .findOneAndUpdate(...) would be ambiguous, not useful.
limit(n: number): PipelineChain<TContract, Shape, 'update-cleared', 'fam-cleared'>;
```

The conditional terminals are then a one-liner: `.findOneAndUpdate(...)` is declared as a method on `PipelineChain<_, _, _, 'fam-ok'>` only. Call it on a `'fam-cleared'` instance and TypeScript reports the method as not existing — no defensive runtime check needed.

The markers use literal string values (`'update-ok'` vs `'update-cleared'`) rather than `true` / `false` so that hover tooltips, inferred-type reveals, and error messages name the capability that was cleared. "`PipelineChain<…, 'update-cleared', 'fam-ok'>`" tells the reader what's gone; "`PipelineChain<…, false, true>`" would require them to remember which parameter position is which.

### 3. A chain, end to end

Here's a real chain that went through a `.sort(...)` (clears update, preserves FAM) and terminates in `.findOneAndUpdate(...)`:

```ts
q.from('pending_jobs')
  .match((f) => f.status.eq('queued'))    // FilteredCollection
  .sort({ priority: -1, createdAt: 1 })   // PipelineChain<…, 'update-cleared', 'fam-ok'>
  .findOneAndUpdate(
    (f) => [f.status.set('running'), f.claimedAt.currentDate()],
    { returnDocument: 'after' },
  );
```

`.sort(...)` cleared `UpdateEnabled` but preserved `FindAndModifyEnabled`, so `.findOneAndUpdate(...)` is still callable. The sort maps cleanly into the `findAndModify` wire command's `sort` slot.

Adding a `.limit(10)` between the sort and the terminal invalidates the chain at compile time:

```ts
q.from('pending_jobs')
  .match((f) => f.status.eq('queued'))
  .sort({ priority: -1, createdAt: 1 })
  .limit(10)                              // PipelineChain<…, 'update-cleared', 'fam-cleared'>
  .findOneAndUpdate(/* … */);
  // TS error: Property 'findOneAndUpdate' does not exist on type
  //          'PipelineChain<…, "update-cleared", "fam-cleared">'.
```

The author has to resolve the ambiguity that `.limit(10).findOneAndUpdate(...)` would encode (is the limit part of the sort-and-claim, or a safety bound?) by picking one of two options: drop `.limit(10)` and claim the single first-in-priority job, or call `.build()` and deal with the ten-candidate result imperatively.

### 4. The marker table

Every pipeline-stage method's return type must match this table. It is the invariant an implementation reviewer checks against:

| Stage method         | `UpdateEnabled` | `FindAndModifyEnabled` | Why                                                                                      |
| -------------------- | --------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| `.match(...)`        | preserve        | preserve               | Pure filter; AND-folds into every downstream command's filter slot.                      |
| `.sort(...)`         | clear           | preserve               | `update` has no per-document sort; `findAndModify` has a `sort` slot.                    |
| `.skip(...)`         | clear           | clear                  | `update` has no skip; `findAndModify` has no skip slot either (aggregation-only stage).  |
| `.limit(...)`        | clear           | clear                  | `update` has no limit; `findAndModify` already implies single-document semantics.        |
| `.sample(...)`       | clear           | clear                  | Random-ordered; not representable as either update pipeline or find-and-modify inputs.   |
| `.addFields(...)`    | preserve        | clear                  | Representable as update-with-pipeline `$set`; no analogue in the find-and-modify slots.  |
| `.project(...)`      | preserve        | clear                  | Representable as update-with-pipeline projection; no analogue in find-and-modify.        |
| `.replaceRoot(...)`  | preserve        | clear                  | Representable as update-with-pipeline `$replaceRoot`; no find-and-modify analogue.       |
| `.redact(...)`       | preserve        | clear                  | Representable as update-with-pipeline `$redact`; no find-and-modify analogue.            |
| `.group(...)`        | clear           | clear                  | Aggregates away per-document identity — nothing downstream can lower this.               |
| `.lookup(...)`       | clear           | clear                  | Joins are not representable in either wire command.                                      |
| `.unwind(...)`       | clear           | clear                  | Splits documents; not representable as either update pipeline or find-and-modify inputs. |
| `.facet(...)`        | clear           | clear                  | Fans out the pipeline; not lowerable to either wire command.                             |
| other shape-changing | clear           | clear                  | Default-conservative: a new stage clears both until proven representable.                |

There is no machinery that derives this table from the type system. Each method is manually annotated with its marker effects, and the table is the check the reviewer applies.

## Consequences

### Benefits

- **Illegal chains do not compile.** The finite list of bad combinations — `$sort` + no-arg `.updateMany()`, `$group` + `.findOneAndUpdate(...)`, `$limit` + `.findOneAndUpdate(...)`, `$lookup` + no-arg `.updateMany()`, and the rest — is rejected by the type system with no dedicated runtime check and no per-terminal validation code. The terminal-side code doesn't even need to know which stages would have cleared its marker; the method is simply absent on the receiver.
- **Monomorphic runtime shapes.** Each of the three classes has a fixed set of methods and fields. V8 can specialise call sites — `handle.match(...)` is one receiver type, `chain.limit(...)` is another — rather than chasing optional methods on a megamorphic union. This matters for the ORM's compile-to-plan layer, which sits on the hot path.
- **Hover tooltips are legible.** On a `FilteredCollection<…>` the IDE shows the filtered-phase terminals. On a `PipelineChain<…, 'fam-cleared'>` it shows the pipeline terminals *minus* find-and-modify. Contrast with a single-class design where every terminal is present in the type and gated by a conditional return — the tooltip then shows every terminal with a `never` return type, which is strictly worse than absence.
- **The marker table is the single source of truth.** Disagreements between the table and a method's return-type annotation are mechanical to find and fix: grep for the stage, read the return type, reconcile. No type-level inference to debug.

### Costs

- **Three classes to keep in lock-step.** AND-folding of filters, builder-state cloning, and `meta`-block construction are shared across classes and have to be centralised manually. Today the shared helpers live alongside the classes (`resolveUpdaterCallback`, `matchAllFilter`, `#writeMeta` in [`state-classes.ts`](../../../packages/2-mongo-family/5-query-builders/query-builder/src/state-classes.ts) and [`builder.ts`](../../../packages/2-mongo-family/5-query-builders/query-builder/src/builder.ts)). Any new cross-state concern has to be placed deliberately.
- **Marker-table discipline.** Adding a new pipeline-stage method requires deciding its marker effects and writing them into the return type. Get it wrong and a terminal appears or disappears incorrectly — a silent bug that only the test suite catches.
- **Verbose return types at the declaration site.** `PipelineChain<TContract, Shape, 'update-cleared', 'fam-cleared'>` recurs. Selective aliases (e.g. `type PipelineChainAfterGroup<TC, S> = PipelineChain<TC, S, 'update-cleared', 'fam-cleared'>`) help for the high-traffic shapes; a global alias layer is overkill.
- **Phantom parameters are load-bearing but invisible.** Without the `declare readonly __updateCompat: U;` and `__findAndModifyCompat: F;` fields, a reader staring at `PipelineChain<_, _, 'update-cleared', 'fam-ok'>` in an error message has no way to know what positions 3 and 4 encode. The hover-visibility trick is a small amount of ceremony that materially improves error legibility.

## When to use this pattern

Reach for this pattern when all of the following hold:

1. **The builder has multiple terminals.** A one-terminal builder (everything ends in `.build()`) gets no leverage from the marker mechanism.
2. **The chain has identifiable phases with qualitatively different vocabularies.** If every method is available at every point, a single class is fine.
3. **Some chain methods make some terminals *semantically* illegal**, not just unusual. The bar is "this combination cannot be lowered to a valid wire command / SQL statement / target operation", not "you can do it but it does nothing useful".
4. **Illegal combinations are enumerable at build time.** If legality depends on runtime values (a flag loaded from a config file, a dialect detected at connect time), the type system can't speak to it.

A plausible future user is a typed SQL query builder. It has the same ingredients: `SELECT` vs. `INSERT` vs. `UPDATE` are phases with distinct vocabularies (three classes); within a `SELECT`, adding `GROUP BY` makes `RETURNING` and non-aggregated columns in the projection illegal (a marker); within an `UPDATE`, the `FROM`/join clause availability depends on dialect rules (potentially another marker). The three-class + phantom-markers split should translate with mostly-mechanical changes to the phases and markers.

A poor fit is a builder whose chain is just progressive configuration of a single plan — for example, an HTTP client builder (`.timeout(...)`, `.header(...)`, `.retry(...)`) where any method can be called in any order and every terminal is universally legal. Use regular fluent chaining there.

## Alternatives considered

### Accept everything, validate at runtime

Have a single `PipelineBuilder` class with every method on it. Invalid combinations throw from `.build()` when they're detected. This is where the Mongo builder started — as `@prisma-next/mongo-pipeline-builder`, since renamed to [`@prisma-next/mongo-query-builder`](../../../packages/2-mongo-family/5-query-builders/query-builder/README.md) — before it was unified into the CRUD surface.

**Why we rejected it.** The type system contributes nothing — every illegal combination has to be caught by hand-rolled validation code inside each terminal. The list of illegal combinations grows with every new stage and every new terminal, each pair needing its own check. Error messages are runtime strings instead of compile-time structural errors, and the author finds out about the mistake at execution time rather than in the editor.

### Overload-based state faking

Keep the single-class design, but use method overloads with conditional types to make some terminals disappear when the prior chain is "wrong". For example, `.findOneAndUpdate(...)` would have one overload returning `MongoQueryPlan` when the chain's internal state-parameter is "fam-ok" and another returning `never` otherwise.

**Why we rejected it.** Works for one or two conditional terminals. Collapses under the real surface: overload resolution messages become illegible (TypeScript reports every rejected overload), conditional types balloon, and the rule "when is `findOneAndUpdate` legal?" gets smeared across every chain method's signature instead of being written down once in a marker table. The worst failure mode is the silent one — a conditional-type bug that causes a terminal to resolve to `never` even for legal chains, and the user gets a cryptic "this expression is not callable" error far from the real cause.

### One concrete subclass per chain shape

Make the whole builder a concrete-class state machine with no phantom parameters at all: `CollectionHandle`, `FilteredCollection`, `UnsortedPipeline`, `SortedPipeline`, `LimitedPipeline`, `GroupedPipeline`, `SortedLimitedPipeline`, `SortedGroupedPipeline`, …

**Why we rejected it.** Combinatorial class explosion. Two markers with two states each is already four `PipelineChain` specialisations; add a third marker (we have real candidates for one, tracking write-concern-compatible vs. not) and you're at eight classes that all share 90 % of their implementation. Phantom parameters collapse the same state space into one class with a parameter per dimension — linear growth instead of exponential.

## Related

- [ADR 180 — Dot-path field accessor](ADR%20180%20-%20Dot-path%20field%20accessor.md) — the unified `FieldAccessor` callback type that stage methods accept (`.match(f => …)`, `.updateMany(f => …)`, etc.).
- [ADR 183 — Aggregation pipeline only, never find API](ADR%20183%20-%20Aggregation%20pipeline%20only%2C%20never%20find%20API.md) — the upstream constraint that made a unified read builder coherent (everything is a pipeline; `find()` is not a parallel surface).
- [MongoDB Family subsystem](../subsystems/10.%20MongoDB%20Family.md) — conceptual summary of the query builder inside the wider Mongo stack.
- `@prisma-next/mongo-query-builder` [package README](../../../packages/2-mongo-family/5-query-builders/query-builder/README.md) — user-facing surface documentation.
