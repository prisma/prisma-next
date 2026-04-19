# Query Builder Unification — Follow-ups Plan

## Summary

Pick up everything the [original unification plan](./query-builder-unification-plan.md) deferred during the M0–M5 implementation pass. The deferred work falls into three buckets:

1. **Capability gaps in the typed builder** — pipeline-style updates (M4.1–M4.3, M4.5) and the marker-gated find-and-modify form on `PipelineChain` (M3.3). Both require additive changes to the AST + wire commands; neither is a redesign.
2. **Test coverage gap** — the `mongo-memory-server` integration sweep that was bundled out of M2.7/M3.6/M4.6 to amortise harness setup.
3. **Project close-out** — docs migration, retiring `projects/mongo-pipeline-builder/`, and the retail-store example conversion.

Six independently-mergeable follow-up milestones (F1–F6), ordered so that downstream milestones can build on upstream AST/wire extensions without churn.

**Parent plan:** [`projects/mongo-pipeline-builder/plans/query-builder-unification-plan.md`](./query-builder-unification-plan.md)

**Spec:** [`projects/mongo-pipeline-builder/specs/query-builder-unification.spec.md`](../specs/query-builder-unification.spec.md)

**Linear:** [TML-2267](https://linear.app/prisma-company/issue/TML-2267/query-builder-unification)

## Collaborators

| Role         | Person/Team | Context                                                                |
| ------------ | ----------- | ---------------------------------------------------------------------- |
| Maker        | Will        | Drives execution.                                                      |
| Reviewer     | TBD         | Same reviewer as the parent plan (state-machine + marker types).       |
| Collaborator | PR [#349](https://github.com/prisma/prisma-next/pull/349) author | Coordinates the retail-store example conversion landing window. |

## Branching strategy

- F1–F5 land on `main` as independent PRs. F6 (close-out) lands last because it deletes `projects/mongo-pipeline-builder/`, which the earlier milestones reference.
- F2 (find-and-modify on `PipelineChain`) depends on F1 (AST/wire extensions). F3 (pipeline-style updates) is independent of F1/F2; can land in either order.
- F4 (integration sweep) depends on F1–F3 in the sense that it tests their behaviour, but the harness setup can land first as a small standalone PR if useful.
- F5 (retail-store example) lands only after PR [#349](https://github.com/prisma/prisma-next/pull/349) is merged. If [#349](https://github.com/prisma/prisma-next/pull/349) merges before F5 is ready, F5 stays a separate PR; if it merges after F1–F4 do, F5 can be folded into F6.

---

## Milestones

### F1 — AST + wire extensions for find-and-modify slots

Carry `sort`/`skip`/`returnDocument` through the find-and-modify command chain so the marker-gated `PipelineChain` form (F2) and the caller-controllable `returnDocument` option both have somewhere to land. Pure additive change — defaulted fields preserve every existing constructor call site.

**Validation:** existing M2/M3 tests pass with the extended constructors; new unit tests cover the new fields' default values.

**Tasks:**

- [x] F1.1 — Extend `FindOneAndUpdateCommand` and `FindOneAndDeleteCommand` in `packages/2-mongo-family/4-query/query-ast/src/commands.ts` with optional `sort?: Record<string, 1 | -1>` and `skip?: number`. Add `returnDocument: 'before' | 'after'` to `FindOneAndUpdateCommand` (default `'after'`). Same shape on the matching `RawFindOneAndUpdate`/`RawFindOneAndDelete` commands in `raw-commands.ts` for parity.
- [x] F1.2 — Mirror the new fields on `FindOneAndUpdateWireCommand` and `FindOneAndDeleteWireCommand` in `packages/2-mongo-family/6-transport/mongo-wire/src/wire-commands.ts`. Same defaults so existing call sites are untouched.
- [x] F1.3 — Update the adapter lowering in `packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts` to thread `sort`/`skip`/`returnDocument` from the AST command into the wire command.
- [x] F1.4 — Update the driver in `packages/3-mongo-target/3-mongo-driver/src/mongo-driver.ts` to pass `sort`/`skip`/`returnDocument` to the underlying `findOneAndUpdate`/`findOneAndDelete` calls. Drop the hardcoded `returnDocument: 'after'`; the AST default carries that semantics now.
- [x] F1.5 — Surface `returnDocument: 'before' | 'after'` on the existing `FilteredCollection.findOneAndUpdate(updaterFn, opts?)` API in `packages/2-mongo-family/5-query-builders/query-builder/src/state-classes.ts`. Default `'after'` matches the prior driver behaviour. Update the M3 unit test to assert the round-trip.
- [x] F1.6 — Verify: `pnpm -F '@prisma-next/mongo*...' typecheck` and `pnpm -F @prisma-next/mongo-query-builder test` green. Lint the touched packages.

### F2 — `PipelineChain` find-and-modify terminals (M3.3)

Implement the marker-gated `PipelineChain<…, _, 'compat'>.findOneAndUpdate(updaterFn, opts?)` and `.findOneAndDelete()` terminals on top of the F1 slots. The marker types already gate availability correctly; this milestone wires the runtime side.

**Validation:** unit tests assert the leading `$match`/`$sort`/`$skip` stages are deconstructed into the wire-command slots; type tests assert availability after `.match`/`.sort`/`.skip` and unavailability after marker-clearing stages.

**Tasks:**

- [x] F2.1 — Add `findOneAndUpdate` and `findOneAndDelete` methods to `PipelineChain` in `packages/2-mongo-family/5-query-builders/query-builder/src/builder.ts`. Use the `this:`-parameter idiom to constrain `F` to `'compat'` so the methods don't appear on chains where the marker has been cleared.
- [x] F2.2 — Implement chain deconstruction: walk `this.#state.stages`, validate that every stage is a `MongoMatchStage` / `MongoSortStage` / `MongoSkipStage`, AND-fold the matches into a single filter, fold the sort specs (last writer wins per key, matching Mongo's own semantics), and pick the largest skip. Throw at build-time if any other stage is present (defensive — the type system should prevent this).
- [x] F2.3 — Type tests in `test/state-machine.test-d.ts`: `findOneAndUpdate` available after `.match`/`.sort`/`.skip` chains, unavailable after `.group(...)`, `.limit(...)`, `.addFields(...)`, `.lookup(...)`, `.project(...)`, `.unwind(...)`. Same matrix for `findOneAndDelete`.
- [x] F2.4 — Unit tests in `test/find-and-modify.test.ts`: chain → wire-command slot mapping, defensive throw on a stale `MongoLimitStage` (forced via runtime cast for the test).

### F3 — Pipeline-style updates (M4.1–M4.3, M4.5)

Add the update-with-pipeline form. Two surfaces: the `FieldAccessor` pipeline-stage emitters (F3.1) and the no-arg `PipelineChain` terminal (F3.3). Either surface alone is useful; together they cover the spec's full update-with-pipeline story.

**Validation:** unit tests for each emitter and for the chain-consumption terminal; type tests for marker semantics.

**Tasks:**

- [x] F3.1 — Extend `FieldAccessor` in `packages/2-mongo-family/5-query-builders/query-builder/src/field-accessor.ts` with pipeline-stage emitters under a sibling namespace to avoid colliding with the per-field operators: `f.stage.set(name, expr)`, `f.stage.unset(name)`, `f.stage.replaceRoot(expr)`, `f.stage.replaceWith(expr)`, `f.stage.redact(expr)`. Each returns a `MongoUpdatePipelineStage` node (vs. the `TypedUpdateOp` nodes returned by the per-field operators). Trait-gate where cheap (matches the M2 trait-gating depth).
- [x] F3.2 — Update `foldUpdateOps` (or introduce a sibling `resolveUpdaterResult`) in `packages/2-mongo-family/5-query-builders/query-builder/src/update-ops.ts` to dispatch on the returned shape: array of `TypedUpdateOp` → traditional `Record<string, MongoValue>`; array of `MongoUpdatePipelineStage` → array form. Mixed arrays are a runtime + type error. Discriminator field on each op, asserted homogeneous after the first element.
- [x] F3.3 — Add no-arg `updateMany()` and `updateOne()` to `PipelineChain<…, 'compat', _>` in `builder.ts`. Use the `this:`-parameter idiom to gate on `U = 'compat'`. Walk `this.#state.stages`, split at the boundary between leading `MongoMatchStage`s and the rest, AND-fold the matches into a filter, cast the remainder to `MongoUpdatePipelineStage[]`, produce `Update{One,Many}Command`. Throw at build time if any non-pipeline-update-compatible stage somehow snuck through.
- [x] F3.4 — Update the existing `FilteredCollection.updateMany(updaterFn)` / `updateOne(updaterFn)` and `CollectionHandle.updateAll(updaterFn)` / `upsertOne(...)` to dispatch through the F3.2 fold helper, so the same callbacks accept either op shape uniformly.
- [x] F3.5 — Type tests in `test/state-machine.test-d.ts`: pipeline-style update is unavailable after `.group(...)` or `.lookup(...)`; available after `.addFields(...)` / `.project(...)` / `.replaceRoot(...)`. Mixed-shape updater arrays are a type error.
- [x] F3.6 — Unit tests for each new emitter (single-emitter and combined-with-traditional cases); unit tests for the no-arg terminals (chain split, emitted command shape).

### F4 — Integration sweep (M2.7 + M3.6 + M4.6)

`mongo-memory-server`-backed end-to-end coverage for every write terminal. Single test harness; one PR even if the test files split per-milestone.

**Validation:** all integration tests pass against `mongo-memory-server` 6.x (or whatever is current at the time).

**Tasks:**

- [x] F4.1 — Stand up the `mongo-memory-server` harness in `examples/mongo-demo/test/query-builder-writes.test.ts`. Reused the existing `mongo-memory-server` harness infrastructure from `examples/mongo-demo` rather than creating a new one in the query-builder package.
- [x] F4.2 — M2 coverage: (a) `insertOne` + read back, (b) `match → updateMany` + verify affected docs, (c) `match → deleteOne` + verify, (d) `updateAll` on a small collection + verify, (e) `insertMany` ordered insert + verify ids.
- [x] F4.3 — M3 coverage: (a) `findOneAndUpdate` returns the updated doc with `returnDocument: 'after'` and the pre-image with `'before'`, (b) `findOneAndDelete` returns the deleted doc, (c) `upsertOne` against a missing doc inserts and surfaces `upsertedId`, (d) `upsertOne` against an existing doc updates without inserting.
- [x] F4.4 — M4 coverage: (a) `updateMany` with `f.stage.set` (pipeline-form), (b) backward compat: traditional operator `updateOne` still works end-to-end, (c) `merge` into a sibling collection round-trips, (d) `out` to a fresh collection round-trips.
- [x] F4.5 — Acceptance-criteria sweep: all write terminals covered by F4.2–F4.4; 14 integration tests pass against `mongo-memory-server`.

### F5 — Retail-store example conversion

Convert the migration in `examples/retail-store/migrations/20260416_backfill-product-status` to use `mongoQuery`. Lands only after PR [#349](https://github.com/prisma/prisma-next/pull/349) is merged (the migration framework it ports onto comes from that branch).

**Validation:** the example's existing tests pass against the converted migration.

**Tasks:**

- [ ] F5.1 — Confirm PR [#349](https://github.com/prisma/prisma-next/pull/349) is merged to `main` and the example's `dataTransform` API is in place. If not yet merged, defer this milestone.
- [ ] F5.2 — Convert the migration to call `mongoQuery(...).from(...).match(...).updateMany(...)` (or whatever shape the migration's intent maps to). Verify the resulting `MongoQueryPlan` shape is consumed unchanged by `dataTransform.run` (this is the close-out verification from the parent plan).
- [ ] F5.3 — Update any inline docs in the example to reference `mongoQuery` instead of the old `mongoPipeline` helper.

### F6 — Close-out (M5.2–M5.6)

Migrate the long-lived design content out of the project folder, mark the project as superseded, scrub inbound references, and delete the folder.

**Validation:** no inbound references to `projects/mongo-pipeline-builder/**` remain in the repo (except the deleted folder itself); the long-lived design content is reachable from `docs/`.

**Tasks:**

- [ ] F6.1 — Migrate the design content from `projects/mongo-pipeline-builder/specs/query-builder-unification.spec.md` (and the original `spec.md` where still relevant) into the MongoDB Family subsystem doc under `docs/architecture docs/`. Decide whether the state-machine pattern + unified accessor warrant a new ADR (leading candidates: an ADR documenting the three-class state-machine pattern for reuse by the SQL builder; a tightening of [ADR 180](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md) reflecting the consolidated accessor). Lean: yes to both, brief.
- [ ] F6.2 — Update `projects/mongo-pipeline-builder/spec.md` and `plan.md` to mark this work as completed and superseding the original read-side scope. (These files get deleted in F6.4 — F6.2 is for the historical record up to that point.)
- [ ] F6.3 — Strip repo-wide references to `projects/mongo-pipeline-builder/**`: search with `rg -n 'projects/mongo-pipeline-builder' .`, replace each hit with the canonical `docs/` link from F6.1, or delete the reference if it's no longer load-bearing.
- [ ] F6.4 — Delete `projects/mongo-pipeline-builder/`. Verify `rg -n 'mongo-pipeline-builder' .` returns no results except in lockfiles or generated artefacts that will rebuild on next install.
- [ ] F6.5 — Final check: `pnpm lint:deps`, `pnpm -r typecheck`, and the full `pnpm -r test` sweep all pass.

### Close-out checks

- [ ] All deferred items from the [parent plan](./query-builder-unification-plan.md) tracked in F1–F6 are closed.
- [ ] No `// TODO` / `// DEFERRED` markers referencing F1–F6 remain in the query-builder source.
- [ ] `dataTransform.run` consumes new builder plans unchanged (verified by F5.2).

---

## Test Coverage

| Acceptance Criterion (spec)                                                                | Test Type        | Task        | Notes                                                |
| ------------------------------------------------------------------------------------------ | ---------------- | ----------- | ---------------------------------------------------- |
| `findOneAndUpdate` honours caller-supplied `returnDocument`                                | Unit + Integration | F1.5, F4.3 |                                                      |
| `findOneAndUpdate`/`findOneAndDelete` accept `sort`/`skip` slots                           | Unit             | F1.1–F1.4   |                                                      |
| `PipelineChain<S, _, 'compat'>.findOneAndUpdate` deconstructs leading `$match`/`$sort`/`$skip` | Unit + Integration | F2.2, F4.3 |                                                      |
| `PipelineChain<S, _, 'compat'>` exposes find-and-modify terminals                          | Type (`.test-d`) | F2.3        | Matches parent plan's M1.8 row                       |
| `PipelineChain<S, _, 'cleared'>` hides find-and-modify terminals                           | Type (`.test-d`) | F2.3        |                                                      |
| `f.stage.set(...)` / `f.stage.unset(...)` / `f.stage.replaceRoot(...)` / etc. typecheck     | Type + Unit      | F3.1, F3.6  |                                                      |
| `PipelineChain<S, 'compat', _>.updateMany()` / `.updateOne()` consume the chain            | Unit + Integration | F3.3, F4.4 | Form 2 from the parent plan's M4.6 row              |
| Mixed `TypedUpdateOp` + `MongoUpdatePipelineStage` arrays are a type error                 | Negative type    | F3.5        |                                                      |
| `addFields(...).updateMany()` round-trips against `mongo-memory-server`                    | Integration      | F4.4        |                                                      |
| `merge` / `out` round-trip against `mongo-memory-server`                                   | Integration      | F4.4        |                                                      |
| Traditional operator updates still work (backward compat)                                  | Integration      | F4.4        |                                                      |
| `dataTransform.run` consumes new builder plans unchanged                                   | Manual           | F5.2        |                                                      |
| State-machine pattern + unified accessor documented as long-lived design content           | Manual           | F6.1        |                                                      |
| `projects/mongo-pipeline-builder/` removed; no dangling inbound references                 | Lint (rg)        | F6.3, F6.4  |                                                      |

---

## Open Items

1. **`upsertMany`** — explicitly **not** in this plan. Confirmed deferred indefinitely in the parent plan's design discussion: Mongo's multi-doc upsert semantics are a footgun (at most one doc inserts when nothing matches; the rest become regular updates), so we keep the unsafety loud at the call site by routing callers through `rawCommand`. Re-open only on concrete consumer demand.
2. **`PipelineChain.findOneAndUpdate` sort-fold semantics** (F2.2) — when the chain has multiple `$sort` stages, fold last-writer-wins per key (matching Mongo's pipeline semantics) vs. throw. Lean: fold; fold-throw on conflict is a footgun for callers building chains incrementally.
3. **Pipeline-stage emitter namespace** (F3.1) — `f.stage.set(...)` vs. `f.set(...)` directly on the accessor. Lean: nested namespace, since putting `set`/`unset`/`replaceRoot`/etc. directly on `f` collides with the per-field-operator namespace (`f.amount.set(0)` vs. `f.set('amount', 0)`).
4. **`mongo-memory-server` harness location** (F4.1) — vendor in `mongo-query-builder/test/integration/` vs. share with `@prisma-next/mongo-runtime`'s harness. Lean: vendor first, refactor to share once the second consumer materialises.
5. **ADR scope for the state-machine pattern** (F6.1) — narrow ADR documenting just the three-class + phantom-marker pattern used here, vs. a wider ADR positioning the pattern as the recommended approach for any future builder (SQL, etc.). Lean: narrow now, widen if/when the SQL builder picks it up.
6. **F6 ordering vs. F5** — if PR [#349](https://github.com/prisma/prisma-next/pull/349) is still unmerged when F1–F4 are ready, F6 may need to ship before F5 to avoid blocking the rest of the close-out. In that case, F5 becomes a tiny standalone PR after [#349](https://github.com/prisma/prisma-next/pull/349) lands.
