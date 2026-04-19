# Query Builder Unification — Plan

## Summary

Rename `@prisma-next/mongo-pipeline-builder` to `@prisma-next/mongo-query-builder` and grow it from a read-only pipeline builder into a typed builder for all MongoDB CRUD wire commands. The work splits the existing single `PipelineBuilder` runtime class into a three-state machine (`CollectionHandle` → `FilteredCollection` → `PipelineChain`), unifies the field/filter proxies into one ADR-180 accessor, and adds typed terminals for inserts, updates, deletes, upserts, find-and-modify, update-with-pipeline, and `$merge`/`$out`. Six milestones, each independently mergeable.

**Spec:** [`projects/mongo-pipeline-builder/specs/query-builder-unification.spec.md`](../specs/query-builder-unification.spec.md)

**Linear:** [TML-2267](https://linear.app/prisma-company/issue/TML-2267/query-builder-unification)

## Collaborators

| Role         | Person/Team | Context                                                                |
| ------------ | ----------- | ---------------------------------------------------------------------- |
| Maker        | Will        | Drives execution.                                                      |
| Reviewer     | TBD         | Architectural review — particularly the state-machine + marker types.  |
| Collaborator | PR [#349](https://github.com/prisma/prisma-next/pull/349) author | Migration-authoring consumer; coordinate retail-store example conversion. |

## Branching strategy

- All milestones land directly on `main`. **Not** stacked on PR [#349](https://github.com/prisma/prisma-next/pull/349) (`tml-2219-data-migrations-for-mongodb`); the unification work has no hard dependency on `dataTransform()`.
- M0 ships as its own PR (rename only). M1–M5 may ship as separate PRs or combined; the boundary that matters is M0 vs M1+ because the rename is mechanical and reviewable in isolation.
- Retail-store example conversion happens in a follow-up PR after both this branch and PR [#349](https://github.com/prisma/prisma-next/pull/349) merge to `main`.

---

## Milestones

### Milestone 0 — Rename package and entry point

Mechanical rename. No surface change. Lands first as a small standalone PR.

**Tasks:**

- [x] 0.1 — Move `packages/2-mongo-family/5-query-builders/pipeline-builder/` → `packages/2-mongo-family/5-query-builders/query-builder/`. Update `package.json#name` to `@prisma-next/mongo-query-builder`.
- [x] 0.2 — Rename the `mongoPipeline` export to `mongoQuery` and the `PipelineRoot` interface to `QueryRoot`. Rename the file `src/pipeline.ts` → `src/query.ts` and update internal imports.
- [x] 0.3 — Update all in-repo callers (runtime tests, integration tests, `@prisma-next/mongo` extension, examples, migration-authoring docs) to the new names. Renamed the extension's `pipeline:` field to `query:`.
- [x] 0.4 — `pnpm lint:deps` passes (no architecture-config changes needed; layering rules use globs by layer index, not package name).
- [x] 0.5 — Update repo-wide doc references: `docs/architecture docs/Package-Layering.md`, `docs/Architecture Overview.md`, `docs/reference/Package Naming Conventions.md`, READMEs. The historical `projects/mongo-pipeline-builder/{spec.md,plan.md}` are left intact; the new design lives under `projects/mongo-pipeline-builder/specs/query-builder-unification.spec.md` and the corresponding plan.
- [x] 0.6 — Verified: `mongo-query-builder` typecheck + tests green (271 tests), `mongo-runtime` typecheck + tests green (51 tests), `lint:deps` clean, `lint` clean for touched packages.

### Milestone 1 — State split + unified accessor (read-side parity)

Split the single `PipelineBuilder` into three concrete classes; unify `FieldProxy` + `FilterProxy` into the ADR-180 accessor; preserve all existing read-side behaviour and tests.

**Validation:** all existing read-side tests pass with the new class topology. Type tests assert the method-set per state.

**Tasks:**

- [ ] 1.1 — Define phantom marker types: `type UpdateCompat = 'compat' | 'cleared'`; `type FindAndModifyCompat = 'compat' | 'cleared'`. Helper conditional types `Preserve<M>`, `Clear<M>` for chaining.
- [ ] 1.2 — Implement `FieldAccessor<Shape>` per [ADR 180](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md): property-access for scalars, callable form for value-object dot-paths via recursive `ResolvePath` template-literal type. Returned `Expression<F>` carries the trait-gated filter operators (initially: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `exists`). Unit tests + `.test-d.ts` for path resolution and operator gating against the existing contract test fixtures.
- [ ] 1.3 — Migrate the existing `match`, `addFields`, `project`, `group`, `sortByCount`, `replaceRoot`, `redact` callbacks from `FieldProxy`/`FilterProxy` to `FieldAccessor`. Delete `field-proxy.ts` and `filter-proxy.ts`. Existing tests and type tests must continue to pass.
- [ ] 1.4 — Implement `CollectionHandle<TContract, ModelName>`. Constructor takes `(contract, collection, storageHash, modelName)`. Methods initially: `match` → `FilteredCollection`, plus the pipeline-stage methods that exist on the current builder (returning `PipelineChain<…, 'compat', 'compat'>` after a single stage). No write terminals yet.
- [ ] 1.5 — Implement `FilteredCollection<TContract, ModelName>`. Holds an accumulated `MongoFilterExpr` (or `ReadonlyArray<MongoFilterExpr>`). `match` returns `FilteredCollection`. Pipeline-stage methods emit a leading `$match` stage and return `PipelineChain`. No write terminals yet.
- [ ] 1.6 — Implement `PipelineChain<TContract, Shape, U, F>`. Holds the stage list, contract, collection, storage hash, and prior accumulated filter (if any). Each pipeline-stage method preserves/clears markers per the spec's marker table. `build()` and `aggregate()` return a `MongoQueryPlan` (parity with current builder).
- [ ] 1.7 — Wire entry point: `mongoQuery<TContract>(opts).from(name)` returns `CollectionHandle`. `mongoQuery<TContract>(opts).rawCommand(cmd)` stub (full implementation in M5 — minimal placeholder ok for now, or defer fully to M5).
- [ ] 1.8 — Type tests in `test/state-machine.test-d.ts` asserting the method-set of each state per the spec's [State machine acceptance criteria](../specs/query-builder-unification.spec.md#state-machine-m1).
- [ ] 1.9 — Adapt all existing read-side integration tests to the new entry shape. They should require minimal changes (`mongoQuery` instead of `mongoPipeline`, otherwise identical chains).

### Milestone 2 — Inserts, unqualified writes, filtered writes

Add the typed CRUD write surface for inserts, deletes, and updates (with the traditional update-operators form).

**Validation:** integration tests against `mongo-memory-server` for each terminal.

**Tasks:**

- [ ] 2.1 — Extend `FieldAccessor`'s returned `Expression<F>` with the Mongo update operators: `set`, `unset`, `inc`, `mul`, `min`, `max`, `rename`, `push`, `addToSet`, `pop`, `pull`, `pullAll`, `currentDate`, `setOnInsert`. Trait-gate where cheap (numeric ops on numeric codecs, array ops on array codecs). Type tests for each operator's input type.
- [ ] 2.2 — Define `UpdateOp` type (a discriminated union for emitted operator records) and a fold helper that turns `ReadonlyArray<UpdateOp>` into a `Record<string, MongoValue>` (`{ $set: {...}, $inc: {...}, ... }`).
- [ ] 2.3 — Implement `CollectionHandle.insertOne(doc)` and `.insertMany(docs)`. Type `doc` against the contract's input row type (`ExtractMongoFieldInputTypes<TContract>[ModelName]`). Produce `InsertOneCommand` / `InsertManyCommand`.
- [ ] 2.4 — Implement `CollectionHandle.updateAll(updaterFn)` and `.deleteAll()`. Decide tautological filter representation (see Open Item #2 in the spec); reuse across the two methods.
- [ ] 2.5 — Implement `FilteredCollection.updateMany(updaterFn)`, `.updateOne(updaterFn)`, `.deleteMany()`, `.deleteOne()`. AND-fold the accumulated filters via `MongoAndExpr`. Use the M2.2 fold helper for updaters.
- [ ] 2.6 — Type tests asserting the negative cases: `CollectionHandle` does not expose `updateMany`/`updateOne`/`deleteMany`/`deleteOne`/`findOneAndUpdate`/`findOneAndDelete`; `FilteredCollection` does not expose `insertOne`/`insertMany`/`updateAll`/`deleteAll`. (Use `// @ts-expect-error` in negative-type tests.)
- [ ] 2.7 — Integration tests (`mongo-memory-server`): (a) insertOne + read back, (b) match → updateMany + verify affected docs, (c) match → deleteOne + verify, (d) updateAll on a small collection + verify.

### Milestone 3 — Find-and-modify and upserts

Add `findOneAndUpdate`, `findOneAndDelete`, `upsertOne`, `upsertMany`. Resolve the upsert AST extension from spec Open Item #1.

**Validation:** integration tests for each terminal; type tests for the marker-gated forms on `PipelineChain`.

**Tasks:**

- [ ] 3.1 — Decide AST shape for upserts (extend `UpdateOneCommand`/`UpdateManyCommand` with an `upsert: boolean` field, vs. introduce sibling commands). Implement the chosen shape in `packages/2-mongo-family/4-query/query-ast/src/commands.ts`. Update visitors and the adapter lowering.
- [ ] 3.2 — Implement `FilteredCollection.findOneAndUpdate(updaterFn, opts?)` and `.findOneAndDelete(opts?)`. Options: `returnDocument` ('after' default), `upsert` (false default for `findOneAndUpdate`).
- [ ] 3.3 — Implement `PipelineChain<…, _, 'compat'>.findOneAndUpdate(updaterFn, opts?)` and `.findOneAndDelete(opts?)`. Deconstruct the leading `$match`/`$sort`/`$skip` stages into the wire-command slots; throw at build-time if any other stage is present (defensive — the type system should prevent this).
- [ ] 3.4 — Implement `CollectionHandle.upsertOne(filterFn, updaterFn)`, `.upsertMany(filterFn, updaterFn)`, `FilteredCollection.upsertOne(updaterFn)`, `.upsertMany(updaterFn)`. They produce the M3.1 AST shape with upsert=true.
- [ ] 3.5 — Type tests: `findOneAndUpdate` is unavailable after a `.group(...)` and after a `.limit(...)`; available after only `.match`/`.sort`/`.skip`.
- [ ] 3.6 — Integration tests (`mongo-memory-server`): (a) `findOneAndUpdate` returns the updated doc with `returnDocument: 'after'`, (b) `findOneAndDelete` returns the deleted doc, (c) upsert against a missing doc inserts, (d) upsert against an existing doc updates.

### Milestone 4 — Update-with-pipeline + `$merge`/`$out` write terminals

Support the array-form updater (update-with-pipeline) and the `PipelineChain` no-arg `updateMany()`/`updateOne()` form. Wire `.merge` and `.out` as `WriteTerminal`s.

**Validation:** integration tests for pipeline-style updates with cross-field references and conditional logic.

**Tasks:**

- [ ] 4.1 — Extend `FieldAccessor` with the pipeline-stage emitters used in update-with-pipeline: `f.set(name, expr)`, `f.unset(name)`, `f.replaceRoot(expr)`, `f.replaceWith(expr)`, `f.redact(expr)`. These return `MongoUpdatePipelineStage` nodes (vs. the `UpdateOp` nodes returned by the traditional operators).
- [ ] 4.2 — Update the M2 updater fold helper to dispatch on the returned shape: array of `UpdateOp` → traditional `Record<string, MongoValue>`; array of `MongoUpdatePipelineStage` → array form. Mixed arrays are a type error.
- [ ] 4.3 — Implement `PipelineChain<…, 'compat', _>.updateMany()` and `.updateOne()` (no-arg form): split the chain at the trailing `.match`-only prefix, lower the prefix to a folded filter, lower the rest to `MongoUpdatePipelineStage[]`, produce `UpdateManyCommand` / `UpdateOneCommand`.
- [ ] 4.4 — Implement `PipelineChain.merge(opts)` and `.out(coll)` as `WriteTerminal`s — produce `AggregateCommand` plans whose final stage is `MongoMergeStage` / `MongoOutStage`. (Methods exist today on the current builder; this is a relocation + return-type change.)
- [ ] 4.5 — Type tests: pipeline-style update is unavailable after `.group(...)` or `.lookup(...)`; available after `.addFields(...)` / `.project(...)` / `.replaceRoot(...)`.
- [ ] 4.6 — Integration tests (`mongo-memory-server`): (a) `updateMany(f => [f.set('total', fn.multiply(...))])` (array form, traditional terminal), (b) `addFields(...).updateMany()` (form 2), (c) `merge` into a sibling collection, (d) `out` to a fresh collection, (e) backward compat: traditional operator updates still work.

### Milestone 5 — Raw escape hatch + close-out

Wire the `q.rawCommand(...)` escape hatch and close out the project.

**Validation:** raw escape hatch round-trips through the runtime; all spec acceptance criteria are met; long-lived docs migrated; `projects/mongo-pipeline-builder/` removed.

**Tasks:**

- [ ] 5.1 — Implement `mongoQuery<TContract>(opts).rawCommand(cmd: AnyMongoCommand): MongoQueryPlan<unknown>`. Carry contract `storageHash` in `meta`; emit `lane: 'mongo-raw'`.
- [ ] 5.2 — Verify all spec acceptance criteria. Add any missed coverage as targeted tests.
- [ ] 5.3 — Migrate long-lived design content into the MongoDB Family subsystem doc (or new ADR if any decision in this work warrants one — leading candidates: state-machine pattern; unified accessor consolidation as a tightening of ADR 180).
- [ ] 5.4 — Update `projects/mongo-pipeline-builder/spec.md` and `plan.md` to mark this work as completed and superseding the original read-side scope.
- [ ] 5.5 — Strip repo-wide references to `projects/mongo-pipeline-builder/**`; replace with canonical `docs/` links where appropriate.
- [ ] 5.6 — Delete `projects/mongo-pipeline-builder/` (close-out PR).

### Close-out

- [ ] Verify all acceptance criteria in [`specs/query-builder-unification.spec.md`](../specs/query-builder-unification.spec.md) and the original [`spec.md`](../spec.md).
- [ ] Convert `examples/retail-store/migrations/20260416_backfill-product-status` to use `mongoQuery` (after this branch + PR [#349](https://github.com/prisma/prisma-next/pull/349) both merge to `main`). Track as either the final task in M5 or a small follow-up PR depending on merge order.
- [ ] Confirm the migration-authoring `dataTransform.run` consumes new builder plans without changes — the `{ collection, command, meta }` shape is unchanged.

---

## Test Coverage

| Acceptance Criterion (spec)                                                                | Test Type        | Task        | Notes                                                |
| ------------------------------------------------------------------------------------------ | ---------------- | ----------- | ---------------------------------------------------- |
| Package directory + name renamed                                                           | Compilation      | 0.1, 0.6    | `pnpm lint:deps` enforces                            |
| Entry point `mongoQuery(...).from(...)` typechecks                                         | Type             | 0.2, 1.7    |                                                      |
| No occurrences of `mongoPipeline`/old package name                                         | Lint (rg)        | 0.3         |                                                      |
| `CollectionHandle` exposes correct method-set                                              | Type (`.test-d`) | 1.8, 2.6    |                                                      |
| `FilteredCollection` exposes correct method-set                                            | Type (`.test-d`) | 1.8, 2.6    |                                                      |
| `PipelineChain<S, 'compat', 'compat'>` exposes update + findOneAndUpdate terminals         | Type (`.test-d`) | 1.8         |                                                      |
| `PipelineChain<S, 'cleared', 'cleared'>` (post-group) hides update + findOneAnd terminals  | Type (`.test-d`) | 1.8, 3.5, 4.5 |                                                    |
| `PipelineChain<S, 'preserve', 'cleared'>` (post-addFields) keeps update, hides findOneAnd  | Type (`.test-d`) | 3.5, 4.5    |                                                      |
| `PipelineChain<S, 'cleared', 'preserve'>` (post-sort) keeps findOneAnd, hides update       | Type (`.test-d`) | 3.5         |                                                      |
| Multiple `.match` calls AND-fold at the terminal                                           | Unit             | 1.5, 2.5    | Inspect produced `command.filter`                    |
| `FieldAccessor` property access typechecks against scalar codecs                           | Type (`.test-d`) | 1.2         |                                                      |
| `FieldAccessor` callable dot-path resolves through `ContractValueObject`                   | Type (`.test-d`) | 1.2         | Uses existing test fixtures with value objects       |
| All read-side tests pass with the unified accessor                                         | Unit + Type      | 1.3, 1.9    |                                                      |
| `insertOne`/`insertMany` typecheck `doc` against input row type                            | Type + Integration | 2.3, 2.7   |                                                      |
| `updateAll` / `deleteAll` produce tautological-filter commands                             | Unit + Integration | 2.4, 2.7   |                                                      |
| `updateMany`/`updateOne`/`deleteMany`/`deleteOne` produce filtered commands                | Unit + Integration | 2.5, 2.7   |                                                      |
| `match → updateAll` is a type error                                                        | Negative type    | 2.6         |                                                      |
| `findOneAndUpdate` deconstructs chain into wire-command slots                              | Unit + Integration | 3.2–3.3, 3.6 |                                                    |
| `findOneAndDelete` returns deleted doc                                                     | Integration      | 3.6         |                                                      |
| Upsert behaviours (insert if missing, update if present)                                   | Integration      | 3.4, 3.6    |                                                      |
| Pipeline-style update with cross-field reference                                           | Integration      | 4.6         | Form 1                                               |
| Pipeline-style update via chain consumption                                                | Integration      | 4.6         | Form 2                                               |
| `.merge`/`.out` produce `AggregateCommand` plans with the right terminal stage             | Unit + Integration | 4.4, 4.6   |                                                      |
| Traditional updates still work (backward compat)                                           | Integration      | 4.6         |                                                      |
| `q.rawCommand(...)` packages a command into a plan with `lane: 'mongo-raw'`                | Unit             | 5.1         |                                                      |
| `dataTransform.run` consumes new builder plans unchanged                                   | Manual           | Close-out   | Verified post-merge of PR [#349](https://github.com/prisma/prisma-next/pull/349) |

---

## Open Items

Carried forward from the spec; resolve during the milestone they're scoped to.

1. **Upsert AST shape** (M3) — extend `UpdateOneCommand`/`UpdateManyCommand` with `upsert: boolean`, vs. add sibling `UpsertOneCommand`/`UpsertManyCommand` classes. Lean: extend existing.
2. **Tautological filter representation** (M2) — empty `MongoAndExpr` vs. new `MongoMatchAllExpr` node. Decide based on what the adapter's lowering produces today for an empty conjunction.
3. **`AnyMongoCommand` for `rawCommand`** (M5) — keep narrow (typed CRUD + `RawMongoCommand`), or widen to a `Document`-typed escape. Lean: widen — escape hatch is escape hatch.
4. **Trait-gating strictness for update operators** (M2) — strict gating on every codec vs. permit some over-acceptance. Lean: cheap gating only (numeric/array distinction); accept some over-permission elsewhere.
5. **Retail-store example conversion timing** (close-out) — depends on PR [#349](https://github.com/prisma/prisma-next/pull/349) merge order. Convert in this branch's close-out if [#349](https://github.com/prisma/prisma-next/pull/349) merges first; otherwise small follow-up PR after [#349](https://github.com/prisma/prisma-next/pull/349) lands.
6. **ADR for state-machine pattern** (M5) — decide whether the three-class state machine (with phantom marker types) warrants a new ADR documenting the pattern for reuse (e.g. SQL builder eventually adopting the same shape). Lean: yes, brief ADR.
