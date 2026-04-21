# Query Builder Unification — Plan

## Summary

Rename `@prisma-next/mongo-pipeline-builder` to `@prisma-next/mongo-query-builder` and grow it from a read-only pipeline builder into a typed builder for all MongoDB CRUD wire commands. The work splits the existing single `PipelineBuilder` runtime class into a three-state machine (`CollectionHandle` → `FilteredCollection` → `PipelineChain`), unifies the field/filter proxies into one ADR-180 accessor, and adds typed terminals for inserts, updates, deletes, upserts, find-and-modify, update-with-pipeline, and `$merge`/`$out`.

This file is the single consolidated plan for the project. It covers the original M0–M5 milestones plus the follow-up milestones (F1–F6) that picked up items deferred during the first pass, and it absorbs the PR-355 code-review close-out.

**Spec:** [`projects/mongo-pipeline-builder/specs/query-builder-unification.spec.md`](../specs/query-builder-unification.spec.md)

**Linear:** [TML-2267](https://linear.app/prisma-company/issue/TML-2267/query-builder-unification)

## Status at a glance

| Bucket | State |
| ------ | ----- |
| M0 — Package rename | Done |
| M1 — State split + unified accessor | Done |
| M2 — Inserts / unqualified / filtered writes | Done (integration sweep moved to F4) |
| M3 — Find-and-modify + upserts | Done (PipelineChain form moved to F2, integration sweep to F4) |
| M4 — Pipeline-style updates + `$merge`/`$out` terminals | Done (capability work moved to F3, integration sweep to F4) |
| M5 — Raw escape hatch + close-out | `rawCommand` done; close-out lives in F6 below |
| F1 — AST/wire extensions (sort/skip/returnDocument) | Done |
| F2 — `PipelineChain` find-and-modify terminals | Done |
| F3 — Pipeline-style updates | Done |
| F4 — `mongo-memory-server` integration sweep | Done |
| F5 — Retail-store example conversion | **Outstanding** — PR [#349](https://github.com/prisma/prisma-next/pull/349) has merged; ready to execute |
| F6 — Close-out (docs migration + retire project folder) | F6.1 + F6.2 done; F6.3–F6.5 outstanding (awaiting project-folder deletion) |
| PR-355 code-review items #1–13 | Done |
| PR-355 code-review item #14 (close-out) | Rolled into F6 |

**Follow-up Linear tickets spun off during the review:**

- [TML-2281](https://linear.app/prisma-company/issue/TML-2281) — Type-safe dot-path validation for query-builder callable field accessor (`f("dot.path")`).
- [TML-2259](https://linear.app/prisma-company/issue/TML-2259) — Trait-gated operators, scope extended (task 5) to cover the query-builder's `Expression<F>`.

## Collaborators

| Role         | Person/Team | Context                                                                |
| ------------ | ----------- | ---------------------------------------------------------------------- |
| Maker        | Will        | Drives execution.                                                      |
| Reviewer     | TBD         | Architectural review — particularly the state-machine + marker types.  |
| Collaborator | PR [#349](https://github.com/prisma/prisma-next/pull/349) author | Migration-authoring consumer; coordinates retail-store example conversion. |

## Branching strategy

- M0–M5 and F1–F4 have landed on `main` (or on the current PR [#355](https://github.com/prisma/prisma-next/pull/355) branch awaiting merge). F5 and F6 are the only unmerged work.
- PR [#349](https://github.com/prisma/prisma-next/pull/349) has merged to `main`; this branch was rebased on top of it. F5 is now unblocked.
- Both F5 and F6 land on the same `tml-2267-query-builder-unification` branch in three sequential commits (one per milestone slice) so the entire project ships in one PR.
- F6 (close-out) lands last because it deletes `projects/mongo-pipeline-builder/`, which the earlier milestones reference.

**Commit shape:**

1. `feat(retail-store): convert backfill-product-status migration to typed mongoQuery` (F5)
2. `docs(mongo-family): incorporate query-builder design into subsystem doc + ADRs` (F6.1 + F6.2)
3. `chore(projects): retire mongo-pipeline-builder project folder` (F6.3 + F6.4 + F6.5)

---

## Milestones

### Milestone 0 — Rename package and entry point ✅

Mechanical rename. No surface change. Landed first as a small standalone PR.

**Tasks:**

- [x] 0.1 — Move `packages/2-mongo-family/5-query-builders/pipeline-builder/` → `packages/2-mongo-family/5-query-builders/query-builder/`. Update `package.json#name` to `@prisma-next/mongo-query-builder`.
- [x] 0.2 — Rename `mongoPipeline` → `mongoQuery` and `PipelineRoot` → `QueryRoot`. Rename `src/pipeline.ts` → `src/query.ts`.
- [x] 0.3 — Update all in-repo callers (runtime tests, integration tests, `@prisma-next/mongo` extension, examples, migration-authoring docs). Renamed the extension's `pipeline:` field to `query:`.
- [x] 0.4 — `pnpm lint:deps` passes.
- [x] 0.5 — Updated repo-wide doc references. Historical `projects/mongo-pipeline-builder/{spec.md,plan.md}` left intact; the new design lives under `projects/mongo-pipeline-builder/specs/query-builder-unification.spec.md` and this plan.
- [x] 0.6 — Verified: `mongo-query-builder` typecheck + tests green, `mongo-runtime` typecheck + tests green, `lint:deps` clean, `lint` clean for touched packages.

### Milestone 1 — State split + unified accessor (read-side parity) ✅

Split the single `PipelineBuilder` into three concrete classes; unify `FieldProxy` + `FilterProxy` into the ADR-180 accessor; preserve all existing read-side behaviour and tests.

- [x] 1.1 — Phantom marker types (renamed during review to `UpdateEnabled` / `FindAndModifyEnabled`) and `Preserve<M>` / `Clear<M>` helpers.
- [x] 1.2 — `FieldAccessor<Shape>` per [ADR 180](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md). Property-access for scalars + callable form for value-object dot-paths. Initial filter operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `exists`.
- [x] 1.3 — Migrated `match`, `addFields`, `project`, `group`, `sortByCount`, `replaceRoot`, `redact` callbacks to `FieldAccessor`; deleted `field-proxy.ts` and `filter-proxy.ts`.
- [x] 1.4 — `CollectionHandle<TContract, ModelName>` implemented.
- [x] 1.5 — `FilteredCollection<TContract, ModelName>` implemented with AND-folding of accumulated filters.
- [x] 1.6 — `PipelineChain<TContract, Shape, U, F>` implemented with marker preservation/clearing and `build()` / `aggregate()`.
- [x] 1.7 — Entry point `mongoQuery(...).from(...)` wired.
- [x] 1.8 — State-machine type tests in `test/state-machine.test-d.ts`.
- [x] 1.9 — Read-side integration tests adapted to the new entry shape.

### Milestone 2 — Inserts, unqualified writes, filtered writes ✅

Typed CRUD write surface for inserts, deletes, and updates (traditional update-operators form).

- [x] 2.1 — `Expression<F>` extended with Mongo update operators (`set`, `unset`, `inc`, `mul`, `min`, `max`, `rename`, `push`, `addToSet`, `pop`, `pull`, `pullAll`, `currentDate`, `setOnInsert`).
- [x] 2.2 — `TypedUpdateOp` union + `foldUpdateOps` helper.
- [x] 2.3 — `CollectionHandle.insertOne` / `.insertMany` typed against the contract's input row type.
- [x] 2.4 — `CollectionHandle.updateAll(updaterFn)` / `.deleteAll()`. Tautological filter represented as empty `MongoAndExpr`.
- [x] 2.5 — `FilteredCollection.updateMany` / `.updateOne` / `.deleteMany` / `.deleteOne`.
- [x] 2.6 — Negative-type tests for method availability per state.
- [x] 2.7 — Integration tests: **rolled forward into F4**.

### Milestone 3 — Find-and-modify and upserts ✅

- [x] 3.1 — Extended `UpdateOneCommand` / `UpdateManyCommand` with `upsert: boolean`. Results carry optional `upsertedCount` / `upsertedId`.
- [x] 3.2 — `FilteredCollection.findOneAndUpdate(updaterFn, opts?)` and `.findOneAndDelete()` implemented. `returnDocument` plumbed through in F1.
- [x] 3.3 — `PipelineChain<…, _, 'compat'>.findOneAndUpdate` / `.findOneAndDelete`: **delivered in F2** on top of F1's AST/wire slots.
- [x] 3.4 — `CollectionHandle.upsertOne(filterFn, updaterFn)` and `FilteredCollection.upsertOne(updaterFn)` produce `UpdateOneCommand` with `upsert: true`. `upsertMany` intentionally not shipped (Mongo multi-doc upsert footgun — route callers through `rawCommand`).
- [x] 3.5 — Type tests for per-state method availability.
- [x] 3.6 — Integration tests: **rolled forward into F4**.

### Milestone 4 — Update-with-pipeline + `$merge`/`$out` write terminals ✅

- [x] 4.1 — `FieldAccessor` pipeline-stage emitters (`f.stage.set`/`unset`/`replaceRoot`/`replaceWith`): **delivered in F3**.
- [x] 4.2 — `resolveUpdaterResult` dispatch: **delivered in F3**.
- [x] 4.3 — No-arg `PipelineChain.updateMany()` / `.updateOne()`: **delivered in F3**.
- [x] 4.4 — `PipelineChain.merge(opts)` / `.out(coll)` as write terminals returning `MongoQueryPlan<unknown>`.
- [x] 4.5 — Type tests.
- [x] 4.6 — Integration tests: **rolled forward into F4**.

### Milestone 5 — Raw escape hatch ✅ (close-out moved to F6)

- [x] 5.1 — `mongoQuery<TContract>(opts).rawCommand(cmd)` accepts any `AnyMongoCommand`, carries `storageHash` and `lane: 'mongo-raw'`. Validates the contract eagerly inside the `rawCommand` body.
- [x] 5.2 — Integration sweep delivered in F4.
- [ ] 5.3–5.6 — Close-out work folded into F6 below.

---

### F1 — AST + wire extensions for find-and-modify slots ✅

Carry `sort` / `skip` / `returnDocument` through the find-and-modify command chain.

- [x] F1.1 — Extend `FindOneAndUpdateCommand` / `FindOneAndDeleteCommand` with optional `sort` / `skip`; add `returnDocument: 'before' | 'after'` (default `'after'`) to `FindOneAndUpdateCommand`. Same shape on the corresponding raw commands.
- [x] F1.2 — Mirror on `FindOneAndUpdateWireCommand` / `FindOneAndDeleteWireCommand`.
- [x] F1.3 — Adapter lowering threads fields through.
- [x] F1.4 — Driver passes fields to underlying `findOneAndUpdate` / `findOneAndDelete`. Hardcoded `returnDocument: 'after'` dropped — AST default carries that semantics now.
- [x] F1.5 — `FilteredCollection.findOneAndUpdate(updaterFn, opts?)` surfaces `returnDocument`.
- [x] F1.6 — Typecheck + tests green on touched packages.

### F2 — `PipelineChain` find-and-modify terminals ✅

- [x] F2.1 — `findOneAndUpdate` / `findOneAndDelete` added to `PipelineChain` via `this:`-parameter gating on `F = 'compat'`.
- [x] F2.2 — Chain deconstruction via `deconstructFindAndModifyChain`: validate `MongoMatchStage` / `MongoSortStage` / `MongoSkipStage` only, AND-fold matches, fold sorts last-writer-wins, pick largest skip, defensive throw on other stages.
- [x] F2.3 — Type tests in `test/state-machine.test-d.ts` covering availability after `.match` / `.sort` / `.skip` and unavailability after marker-clearing stages.
- [x] F2.4 — Unit tests in `test/find-and-modify.test.ts` covering chain → wire-command slot mapping plus defensive throw.

### F3 — Pipeline-style updates ✅

- [x] F3.1 — `FieldAccessor.stage.{set,unset,replaceRoot,replaceWith,redact}` emitters returning `MongoUpdatePipelineStage`.
- [x] F3.2 — `resolveUpdaterResult` dispatches between `TypedUpdateOp[]` and `MongoUpdatePipelineStage[]`; mixed arrays throw.
- [x] F3.3 — No-arg `PipelineChain.updateMany()` / `.updateOne()` gated on `U = 'compat'`, consuming the chain via `deconstructUpdateChain`.
- [x] F3.4 — Existing `FilteredCollection.updateMany` / `.updateOne` / `CollectionHandle.updateAll` / `.upsertOne` dispatch through the fold helper.
- [x] F3.5 — Type tests for pipeline-style update availability + mixed-shape rejection.
- [x] F3.6 — Unit tests for each emitter + no-arg terminals.

### F4 — Integration sweep ✅

`mongo-memory-server`-backed end-to-end coverage for every write terminal.

- [x] F4.1 — Harness reused from the existing `mongo-memory-server` setup in `examples/mongo-demo`.
- [x] F4.2 — M2 coverage (insert, filtered update, filtered delete, `updateAll`, ordered `insertMany`).
- [x] F4.3 — M3 coverage (`findOneAndUpdate` before/after, `findOneAndDelete`, upsert insert + update paths).
- [x] F4.4 — M4 coverage (`f.stage.set` pipeline update, traditional-operator update, `$merge`, `$out`).
- [x] F4.5 — 14 integration tests pass in `examples/mongo-demo/test/query-builder-writes.test.ts`.

### F5 — Retail-store example conversion — **DONE** ✅

Convert `examples/retail-store/migrations/20260416_backfill-product-status` end-to-end onto the typed query builder. Both the `check` source (currently typed) and the `run` body (currently a hand-built `RawUpdateManyCommand`) move to `mongoQuery`, so the example becomes a showcase of the unified surface rather than a half-converted artefact.

After the rebase, the migration's current import of `mongoPipeline` from `@prisma-next/mongo-pipeline-builder` is **broken** (the package was renamed in M0). F5 fixes that by converting rather than just renaming.

**Today's shape (broken after rebase):**

```typescript
const pipeline = mongoPipeline<Contract>({ contractJson });
// check.source: pipeline.from('products').match(MongoExistsExpr.notExists('status')).limit(1)
// run: { collection, command: new RawUpdateManyCommand('products', { status: { $exists: false } }, { $set: { status: 'active' } }), meta }
```

**Target shape:**

```typescript
const query = mongoQuery<Contract>({ contractJson });
// check.source: query.from('products').match(f => f.status.exists(false)).limit(1)
// run: query.from('products').match(f => f.status.exists(false)).updateMany(f => [f.status.set('active')])
```

- [x] F5.1 — Confirm PR [#349](https://github.com/prisma/prisma-next/pull/349) merged and the branch is rebased. (Done.)
- [x] F5.2 — Converted `migration.ts`:
  - Swapped `mongoPipeline` → `mongoQuery` and renamed the local from `pipeline` to `query`.
  - Replaced the `check.source` `match(MongoExistsExpr.notExists('status'))` with the unified accessor: `match((f) => f('status').exists(false))`. Used the **callable form** `f('status')` rather than the property form `f.status` because `status` is the field being backfilled and is not present on the typed `Product` shape — strict path validation is tracked on TML-2281 (per ADR 180).
  - Replaced the `run` body's `RawUpdateManyCommand` with `query.from('products').match((f) => f('status').exists(false)).updateMany((f) => [f('status').set('active')])`. The terminal returns a `MongoQueryPlan` whose `{ collection, command, meta }` shape `dataTransform.run` consumes directly — no adapter needed.
  - Dropped the now-unused imports (`mongoPipeline`, `MongoExistsExpr`, `RawUpdateManyCommand`) and the `validateMongoContract` import (no longer needed since `meta` is no longer hand-built).
  - Dropped the hand-built `meta` block; the plans returned by `mongoQuery` carry their own `meta` with `lane: 'mongo-query'` (post-PR-355 lane collapse).
- [x] F5.3 — Re-emitted `ops.json` and `migration.json` via `pnpm exec tsx migrations/20260416_backfill-product-status/migration.ts` (the `Migration.run` self-emit shebang). `migrationId` re-hashed from `sha256:8fac97a3…` → `sha256:70ba2c21…`; `ops.json` now records `kind: 'updateMany'` (typed) and `meta.lane: 'mongo-query'` everywhere.
- [x] F5.4 — `rg -n 'mongoPipeline' examples/retail-store/` returns no matches; nothing in comments or docs to update.
- [x] F5.5 — `pnpm -C examples/retail-store test` — 12 files, 54 tests pass against the converted migration.

### F6 — Close-out — **OUTSTANDING** 🟡

Migrate the long-lived design content out of the project folder, draft the supporting ADRs, scrub inbound references, and delete the folder. Absorbs PR-355 code-review item #14.

**Skipped:** the original F6.2 (mark `spec.md` / `plan.md` as superseded) is dropped — it's busywork for state we delete two tasks later. Git history preserves the project's evolution.

**All inbound references to `projects/mongo-pipeline-builder/**` already live inside the folder itself**, so F6.3 is essentially a verification step rather than a substantive scrub. (The only external mentions are in `wip/reviews/...`, which is `.gitignore`d.)

#### F6.1 — Migrate design content into the MongoDB Family subsystem doc

Target file: [`docs/architecture docs/subsystems/10. MongoDB Family.md`](../../../docs/architecture%20docs/subsystems/10.%20MongoDB%20Family.md).

The 430-line spec is mostly project-history (problem, milestone-by-milestone requirements, security/cost/observability sections). The long-lived content to migrate is conceptual:

- The three-state machine (CollectionHandle → FilteredCollection → PipelineChain) and per-state method-sets.
- The marker table (which pipeline stages clear/preserve `UpdateEnabled` / `FindAndModifyEnabled`).
- The terminals taxonomy (insert / unqualified / filtered / find-and-modify / upsert / pipeline-update / `$merge`-`$out` / raw).
- The relationship between the unified field accessor and ADR 180.

- [x] F6.1.1 — Update the `Aggregation pipelines` section: dropped the stale "*A type-safe pipeline builder ... is a future goal*" sentence; replaced with a paragraph noting the typed builder shipped and linking to `## Query builder` below.
- [x] F6.1.2 — Update the `Package layout` block: `5-query-builders/` now lists `query-builder/` and `orm/` as peer surfaces, each with a one-line description.
- [x] F6.1.3 — Added a top-level `## Query builder` section (between `## ORM` and `## Execution pipeline`) — conceptual summary of the three-state machine, marker pattern (with the full marker table), terminals taxonomy, and the `FieldAccessor` callback shape. Links out to the package README for usage.
- [x] F6.1.4 — References section links ADR 201 and the `@prisma-next/mongo-query-builder` package README. The `## Open questions` section was deleted; its only unique entry (discriminator values as untyped strings) was dropped as adequately covered elsewhere, and the "resolved"-annotated bullets were removed.

#### F6.2 — ADRs

- [x] F6.2.1 — **ADR 201 — State-machine pattern for typed DSL builders** drafted. Status: Accepted. Documents the three-class pattern with phantom marker types as used in `mongo-query-builder`, includes a worked example (`.limit(...).findOneAndUpdate(...)` rejected at compile time), and spells out the preconditions for reuse in other typed DSL builders.
- [x] F6.2.2 — ADR 180 gained a top-of-doc "Implementation update" blockquote noting the consolidated `FieldAccessor` replaced `FieldProxy` / `FilterProxy` and that the callable `f("dot.path")` is permissive (TML-2281 tracks tightening).
- [x] F6.2.3 — `docs/architecture docs/ADR-INDEX.md` gained entries for ADR 180 (previously missing), ADR 201, and ADR 202. ADR 202 is the duplicate-numbered "Codec trait system" ADR renumbered from its collision with the "Pack-provided type constructors" ADR (also 170 on disk); all inbound references updated.

#### F6.3 — Verify external references

- [ ] F6.3.1 — `rg -n 'projects/mongo-pipeline-builder' .` and confirm all hits are inside `projects/mongo-pipeline-builder/` (gets deleted in F6.4) or under `wip/` (gitignored). If any external hit appears, replace with the canonical `docs/` link from F6.1 or delete the reference if no longer load-bearing.

#### F6.4 — Delete the project folder

- [ ] F6.4.1 — `rm -rf projects/mongo-pipeline-builder/`.
- [ ] F6.4.2 — `rg -n 'mongo-pipeline-builder' .` and confirm no results remain except lockfiles or generated artefacts that rebuild on next install.

#### F6.5 — Final verification

- [ ] F6.5.1 — `pnpm lint:deps` clean.
- [ ] F6.5.2 — `pnpm -r typecheck` clean.
- [ ] F6.5.3 — `pnpm -r test` clean.

### Close-out checks

- [ ] All deferred items from the earlier milestones (M0–M5, F1–F5) are either closed or tracked on a Linear ticket (TML-2281, TML-2259).
- [ ] No `// TODO` / `// DEFERRED` markers referencing M0–M5 or F1–F6 remain in the query-builder source.
- [ ] `dataTransform.run` consumes new builder plans unchanged (verified by F5.2).

---

## Test Coverage

| Acceptance Criterion (spec)                                                                | Test Type        | Task        | Notes                                                |
| ------------------------------------------------------------------------------------------ | ---------------- | ----------- | ---------------------------------------------------- |
| Package directory + name renamed                                                           | Compilation      | 0.1, 0.6    | `pnpm lint:deps` enforces                            |
| Entry point `mongoQuery(...).from(...)` typechecks                                         | Type             | 0.2, 1.7    |                                                      |
| No occurrences of `mongoPipeline` / old package name                                       | Lint (rg)        | 0.3         |                                                      |
| `CollectionHandle` exposes correct method-set                                              | Type (`.test-d`) | 1.8, 2.6    |                                                      |
| `FilteredCollection` exposes correct method-set                                            | Type (`.test-d`) | 1.8, 2.6    |                                                      |
| `PipelineChain<S, 'compat', 'compat'>` exposes update + findOneAndUpdate terminals         | Type (`.test-d`) | 1.8         |                                                      |
| `PipelineChain<S, 'cleared', 'cleared'>` (post-group) hides update + findOneAnd terminals  | Type (`.test-d`) | 1.8, 3.5, 4.5 |                                                    |
| `PipelineChain<S, 'preserve', 'cleared'>` (post-addFields) keeps update, hides findOneAnd  | Type (`.test-d`) | 3.5, 4.5    |                                                      |
| `PipelineChain<S, 'cleared', 'preserve'>` (post-sort) keeps findOneAnd, hides update       | Type (`.test-d`) | 3.5, F2.3   |                                                      |
| Multiple `.match` calls AND-fold at the terminal                                           | Unit             | 1.5, 2.5    |                                                      |
| `FieldAccessor` property access typechecks against scalar codecs                           | Type (`.test-d`) | 1.2         |                                                      |
| `FieldAccessor` callable dot-path resolves through `ContractValueObject`                   | Type (`.test-d`) | 1.2         | Permissive today; type-safe variant tracked on TML-2281 |
| All read-side tests pass with the unified accessor                                         | Unit + Type      | 1.3, 1.9    |                                                      |
| `insertOne` / `insertMany` typecheck `doc` against input row type                          | Type + Integration | 2.3, F4.2 |                                                      |
| `updateAll` / `deleteAll` produce tautological-filter commands                             | Unit + Integration | 2.4, F4.2 |                                                      |
| `updateMany` / `updateOne` / `deleteMany` / `deleteOne` produce filtered commands          | Unit + Integration | 2.5, F4.2 |                                                      |
| `match → updateAll` is a type error                                                        | Negative type    | 2.6         |                                                      |
| `findOneAndUpdate` honours caller-supplied `returnDocument`                                | Unit + Integration | F1.5, F4.3 |                                                      |
| `findOneAndUpdate` / `findOneAndDelete` accept `sort` / `skip` slots                       | Unit             | F1.1–F1.4   |                                                      |
| `PipelineChain<S, _, 'compat'>.findOneAndUpdate` deconstructs leading `$match`/`$sort`/`$skip` | Unit + Integration | F2.2, F4.3 |                                                    |
| `findOneAndDelete` returns deleted doc                                                     | Integration      | F4.3        |                                                      |
| Upsert behaviours (insert if missing, update if present)                                   | Integration      | 3.4, F4.3   |                                                      |
| `f.stage.{set,unset,replaceRoot,...}` typecheck                                            | Type + Unit      | F3.1, F3.6  |                                                      |
| `PipelineChain<S, 'compat', _>.updateMany()` / `.updateOne()` consume the chain            | Unit + Integration | F3.3, F4.4 |                                                      |
| Mixed `TypedUpdateOp` + `MongoUpdatePipelineStage` arrays are a type error                 | Negative type    | F3.5        |                                                      |
| `addFields(...).updateMany()` round-trips against `mongo-memory-server`                    | Integration      | F4.4        |                                                      |
| `.merge` / `.out` produce `AggregateCommand` plans with the right terminal stage           | Unit + Integration | 4.4, F4.4  |                                                      |
| Traditional updates still work (backward compat)                                           | Integration      | F4.4        |                                                      |
| `q.rawCommand(...)` packages a command into a plan with `lane: 'mongo-raw'`                | Unit             | 5.1         |                                                      |
| `dataTransform.run` consumes new builder plans unchanged                                   | Manual           | F5.2        |                                                      |
| State-machine pattern + unified accessor documented as long-lived design content           | Manual           | F6.1        |                                                      |
| `projects/mongo-pipeline-builder/` removed; no dangling inbound references                 | Lint (rg)        | F6.3, F6.4  |                                                      |

---

## Open Items

All open items have been resolved. See the resolved list below.

### Resolved

- **ADR scope for the state-machine pattern** (F6.2) — narrow ADR (ADR 201) documenting the three-class + phantom-marker pattern as used in `mongo-query-builder`, with an explicit "candidate for reuse" note for the future SQL query builder.
- **ADR 180 scope** (F6.2) — addendum on ADR 180 noting the consolidated accessor and the TML-2281 callable-form follow-up, rather than a separate ADR.
- **F5 ↔ F6 ordering** — PR [#349](https://github.com/prisma/prisma-next/pull/349) merged before this branch was ready for F5/F6, so both ship sequentially on this branch in one PR (F5 commit → F6 docs commit → F6 deletion commit).
- **F5 conversion depth** — full conversion: both `check.source` and `run` move to `mongoQuery`, so the example showcases the unified surface end-to-end.
- **F6.2 (mark as superseded)** — skipped; busywork for state deleted in F6.4. Git history preserves the project's evolution.

### Resolved during M0–M5 + F1–F4

- Upsert AST shape (extended `UpdateOneCommand` / `UpdateManyCommand` with defaulted `upsert: boolean`).
- Tautological filter representation (empty `MongoAndExpr`).
- `AnyMongoCommand` for `rawCommand` (kept inclusive, threaded through a `Command` type parameter on `MongoQueryPlan`).
- Trait-gating strictness for update operators (cheap numeric/array gating; full trait-gating tracked on TML-2259 task 5).
- `upsertMany` — explicitly non-goal; callers with real multi-doc upsert needs route through `rawCommand`.
- `PipelineChain.findOneAndUpdate` sort-fold semantics — fold last-writer-wins per key.
- Pipeline-stage emitter namespace — nested `f.stage.*` to avoid collisions with per-field operators.
- `mongo-memory-server` harness location — reused `examples/mongo-demo`'s harness.
- Retail-store example timing — deferred to F5 behind PR [#349](https://github.com/prisma/prisma-next/pull/349).
