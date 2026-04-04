# Code Review — Phase 1.5: Mongo Write Operations

**Branch:** `tml-2194-ws4-2-mongo-orm-write-operations-create-update-delete`
**Base:** `origin/main`
**Spec:** [projects/orm-consolidation/spec.md](../spec.md)
**Plan:** [projects/orm-consolidation/plans/phase-1.5-write-operations.md](../plans/phase-1.5-write-operations.md)
**Commit range:** `origin/main...HEAD` (10 commits)

---

## Summary

Adds 10 write methods (`create`, `createAll`, `createCount`, `update`, `updateAll`, `updateCount`, `delete`, `deleteAll`, `deleteCount`, `upsert`) to `MongoCollection`, with supporting infrastructure across 5 packages: command AST nodes in `mongo-query-ast`, wire commands/result types in `mongo-core`, adapter lowering, driver execution, and CRUD lifecycle tests. Also moves existing command classes from `mongo-core` to `mongo-query-ast` as proper `MongoAstNode` subclasses with typed `MongoFilterExpr` filter fields.

## What looks solid

- **Clean exhaustive switch patterns** in the adapter and driver — every command kind is handled, with a `never` default branch ensuring compile-time exhaustiveness.
- **Immutable command objects** — all command classes call `this.freeze()` in their constructor, consistent with the existing AST node pattern.
- **Filter lowering centralization** — the adapter's `lowerFilter()` function is reused for both read pipeline `$match` stages and write command filters. Single source of truth for filter compilation.
- **Runtime guards** — `#requireFilters()` throws eagerly (not lazily inside generators), giving immediate feedback when `.where()` is missing.
- **Test coverage breadth** — unit tests for ORM methods with mock executor, adapter lowering tests for each command kind, driver integration tests against mongodb-memory-server, and full CRUD lifecycle tests in the demo. Good separation of concerns across test levels.
- **Demo migration** — the demo now seeds via ORM writes (`createAll`) instead of raw `MongoClient`, which is both a good integration test and a better developer experience showcase.
---

## Blocking issues

### F00: Bifurcated execution interface (`execute` + `executeCommand`)

**Location:** [packages/2-mongo-family/4-orm/src/executor.ts](packages/2-mongo-family/4-orm/src/executor.ts) — `executeCommand` added to `MongoQueryExecutor`

**Issue:** This branch adds `executeCommand` to the ORM executor interface, propagating a dual-interface pattern (`execute` for reads, `executeCommand` for writes) through the entire stack: executor, runtime, adapter, and core types. The SQL domain has a single plan type (`SqlQueryPlan`) and a single `execute(plan)` method for all queries — reads and writes alike. The Mongo domain should work the same way. The adapter/driver internally dispatching on command kind is an implementation detail that should not be visible to the executor, runtime, or ORM.

**Suggestion:** Introduce a unified `MongoQueryPlan` (wrapping `AnyMongoCommand + PlanMeta`), collapse to a single `execute(plan)` at every layer, and collapse the adapter to a single `lower(plan)` method. See the [design doc](../plans/unified-mongo-query-plan.md) and [system design review SD-00](system-design-review.md).

---

## Non-blocking concerns

### F01: `updateAll` returns wrong/empty results when filter field is updated

**Location:** [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — lines 243–257

**Issue:** `updateAll()` executes `UpdateManyCommand` then re-reads via `self.#execute()`, which re-uses the collection's original filters. If the update changes a field used in the filter (e.g., `where(status = 'active').updateAll({ status: 'archived' })`), the re-read finds zero documents because the updated rows no longer match. This is not a race condition — it's a deterministic mismatch.

**Suggestion:** Document this as a known limitation. A future fix could capture matched document IDs from the update result and re-read by `_id`. For Phase 1.5, this is acceptable since the plan acknowledges the two-step approach's limitations.

### F02: No model-to-storage field name mapping in write methods

**Location:** [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — lines 339–344

**Issue:** `#toDocument()` passes model field names directly to commands without mapping to storage field names. The plan task 2.3 explicitly calls for `mapModelFieldsToStorageFields()`. If any contract exercises domain/storage field name separation (per ADR 172), writes would use the wrong field names in the database.

**Suggestion:** If no current contract exercises field name mapping for Mongo, this is safe for now. Add a TODO or follow-up to implement field mapping before Phase 2, when the shared interface should handle it consistently.

### F03: `CreateInput` type uses intersection that may not narrow correctly

**Location:** [packages/2-mongo-family/4-orm/src/types.ts](packages/2-mongo-family/4-orm/src/types.ts) — lines 160–166

**Issue:** The `CreateInput` type is:
```typescript
Omit<InferModelRow<TContract, ModelName>, '_id'> &
  Partial<Pick<InferModelRow<TContract, ModelName>, '_id' & keyof InferModelRow<TContract, ModelName>>>
```
The intersection `'_id' & keyof InferModelRow<...>` evaluates to `'_id'` when `_id` is a key of the model row (which it always is for Mongo). This makes `_id` optional while requiring all other fields. The intent is correct, but the `& keyof InferModelRow<...>` part is redundant and adds complexity without benefit.

**Suggestion:** Simplify to:
```typescript
Omit<InferModelRow<TContract, ModelName>, '_id'> &
  Partial<Pick<InferModelRow<TContract, ModelName>, '_id'>>
```

### F04: `as unknown as` casts on write return types

**Location:** [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — lines 198–202, 215–220

**Issue:** `create()` and `createAll()` return `{ _id: insertedId, ...(data as object) } as unknown as IncludedRow<...>`. The `as unknown as` double-cast bypasses type checking entirely. The returned object is a plain data object — it won't have include relation fields even though `IncludedRow` claims it does.

For writes this is pragmatically fine (you wouldn't expect includes on a create return), but the type is misleading. The SQL ORM has the same pattern, so this is an inherited design choice.

**Suggestion:** Consider using a write-specific return type (e.g., `InferRootRow` instead of `IncludedRow`) for create methods, or accept this as a known type-level imprecision to be addressed in Phase 2 when the shared interface standardizes return types.

### F05: Upsert semantics — `$set` overrides `create` fields on insert

**Location:** [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — lines 300–323

**Issue:** Fields present in both `input.create` and `input.update` are placed in `$set` (from `update`), not `$setOnInsert` (from `create`). On insert, `$set` runs first, so the `update` value wins. A user calling `upsert({ create: { name: 'Alice' }, update: { name: 'Updated' } })` might expect `name: 'Alice'` on insert, but gets `name: 'Updated'`.

The integration test explicitly documents this behavior, which is good. But the API semantics differ from what many ORM users expect from an "upsert" pattern.

**Suggestion:** Document this in the plan's follow-ups or open items. Consider whether Phase 2's shared interface should normalize upsert semantics (SQL and Mongo have different underlying mechanisms).

### F06: `_id as string` cast in demo and tests

**Location:** [examples/mongo-demo/src/server.ts](examples/mongo-demo/src/server.ts) — lines 49, 57, 64, 68

**Issue:** `alice._id as string` — the `_id` field from MongoDB is an `ObjectId`, and it's cast to `string` to satisfy the `authorId` field type. This works at runtime (MongoDB driver's ObjectId has a `toString()` representation that's used in comparisons), but it's a type-level lie.

**Suggestion:** This is a pre-existing issue (the contract doesn't encode the ObjectId → string relationship), not introduced by this branch. Low priority, but track as a follow-up for contract codec improvements.

### F07: No codec encoding on write path

**Location:** [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — lines 339–344

**Issue:** `#toDocument()` wraps values in `MongoParamRef` without codec encoding. The read path presumably decodes values via codecs. If any codec performs non-identity transformation (e.g., serializing a custom type), writes would store raw JS values that the read path cannot decode back.

**Suggestion:** Verify all current Mongo codecs are identity-encoding for writes. Track codec encoding for the write path as a follow-up before stabilizing.

---

## Nits

### F08: Redundant `as const` on `kind` literals

**Location:** [packages/2-mongo-family/2-query/query-ast/src/commands.ts](packages/2-mongo-family/2-query/query-ast/src/commands.ts) — throughout

All command classes use `readonly kind = 'insertOne' as const`. The `as const` is redundant when a `readonly` property is initialized with a string literal — TypeScript already infers the narrow literal type. Consistent with existing codebase style though, so not worth changing.

### F09: `Object.keys(setFields).length > 0` could use a helper

**Location:** [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — lines 315–320

The `Object.keys(...).length > 0` pattern appears twice in `upsert()`. A tiny `isNonEmpty()` helper would reduce visual noise, but this is very minor.

---

## Acceptance-criteria traceability

| Acceptance criterion | Implementation | Evidence |
|---|---|---|
| `create()` returns row with `_id` | [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — `create()` method, lines 191–203 | [packages/2-mongo-family/4-orm/test/collection.test.ts](packages/2-mongo-family/4-orm/test/collection.test.ts) — "returns created row with _id from insertedId"; [examples/mongo-demo/test/crud-lifecycle.test.ts](examples/mongo-demo/test/crud-lifecycle.test.ts) — "create → read → update → read → delete → read" |
| `createAll()` returns all rows with `_id`s | [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — `createAll()` method, lines 205–222 | [packages/2-mongo-family/4-orm/test/collection.test.ts](packages/2-mongo-family/4-orm/test/collection.test.ts) — "returns all created rows with _ids"; [examples/mongo-demo/test/crud-lifecycle.test.ts](examples/mongo-demo/test/crud-lifecycle.test.ts) — batch create lifecycle |
| `createCount()` returns count | [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — `createCount()`, lines 225–230 | [packages/2-mongo-family/4-orm/test/collection.test.ts](packages/2-mongo-family/4-orm/test/collection.test.ts) — "returns the count of inserted documents"; [examples/mongo-demo/test/crud-lifecycle.test.ts](examples/mongo-demo/test/crud-lifecycle.test.ts) — "createCount returns inserted count" |
| `update()` requires `.where()` | [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — `#requireFilters()`, lines 368–374 | [packages/2-mongo-family/4-orm/test/collection.test.ts](packages/2-mongo-family/4-orm/test/collection.test.ts) — "throws without .where()" |
| `update()` returns updated row | [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — `update()`, lines 232–241 | [packages/2-mongo-family/4-orm/test/collection.test.ts](packages/2-mongo-family/4-orm/test/collection.test.ts) — "returns updated row via findOneAndUpdate"; [examples/mongo-demo/test/crud-lifecycle.test.ts](examples/mongo-demo/test/crud-lifecycle.test.ts) — update lifecycle |
| `updateAll()` returns all updated rows | [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — `updateAll()`, lines 243–257 | [examples/mongo-demo/test/crud-lifecycle.test.ts](examples/mongo-demo/test/crud-lifecycle.test.ts) — "createAll → read → updateAll → read → deleteAll → read" |
| `updateCount()` returns count | [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — `updateCount()`, lines 259–266 | [packages/2-mongo-family/4-orm/test/collection.test.ts](packages/2-mongo-family/4-orm/test/collection.test.ts) — "returns the modified count"; [examples/mongo-demo/test/crud-lifecycle.test.ts](examples/mongo-demo/test/crud-lifecycle.test.ts) — "updateCount returns modified count" |
| `delete()` requires `.where()` | [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — `#requireFilters()`, lines 368–374 | [packages/2-mongo-family/4-orm/test/collection.test.ts](packages/2-mongo-family/4-orm/test/collection.test.ts) — "throws without .where()" |
| `delete()` returns deleted row | [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — `delete()`, lines 268–274 | [packages/2-mongo-family/4-orm/test/collection.test.ts](packages/2-mongo-family/4-orm/test/collection.test.ts) — "returns deleted row via findOneAndDelete"; [examples/mongo-demo/test/crud-lifecycle.test.ts](examples/mongo-demo/test/crud-lifecycle.test.ts) — delete lifecycle |
| `deleteAll()` returns all deleted rows | [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — `deleteAll()`, lines 276–290 | [examples/mongo-demo/test/crud-lifecycle.test.ts](examples/mongo-demo/test/crud-lifecycle.test.ts) — batch delete lifecycle |
| `deleteCount()` returns count | [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — `deleteCount()`, lines 292–298 | [packages/2-mongo-family/4-orm/test/collection.test.ts](packages/2-mongo-family/4-orm/test/collection.test.ts) — "returns the deleted count"; [examples/mongo-demo/test/crud-lifecycle.test.ts](examples/mongo-demo/test/crud-lifecycle.test.ts) — "deleteCount returns deleted count" |
| `upsert()` creates when no match | [packages/2-mongo-family/4-orm/src/collection.ts](packages/2-mongo-family/4-orm/src/collection.ts) — `upsert()`, lines 300–323 | [examples/mongo-demo/test/crud-lifecycle.test.ts](examples/mongo-demo/test/crud-lifecycle.test.ts) — "upsert inserts when no match" |
| `upsert()` updates when match exists | Same as above | [examples/mongo-demo/test/crud-lifecycle.test.ts](examples/mongo-demo/test/crud-lifecycle.test.ts) — "upsert updates when match exists" |
| Write methods don't mutate collection state | Immutable `#clone()` pattern | [packages/2-mongo-family/4-orm/test/collection.test.ts](packages/2-mongo-family/4-orm/test/collection.test.ts) — "write methods do not mutate collection state" |
| CRUD lifecycle end-to-end | Full demo + test | [examples/mongo-demo/test/crud-lifecycle.test.ts](examples/mongo-demo/test/crud-lifecycle.test.ts) — multiple lifecycle tests |
| Demo seeds via ORM writes | [examples/mongo-demo/src/server.ts](examples/mongo-demo/src/server.ts) — `seed()` uses `orm.users.createAll()` / `orm.posts.createAll()` | [examples/mongo-demo/test/blog.test.ts](examples/mongo-demo/test/blog.test.ts) — all tests now seed via ORM |
| Adapter lowers each new command kind | [packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts](packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts) — `lowerCommand()` switch cases | [packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts](packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts) — one test per command kind |
| Driver executes each new wire command | [packages/3-mongo-target/3-mongo-driver/src/mongo-driver.ts](packages/3-mongo-target/3-mongo-driver/src/mongo-driver.ts) — execute switch cases | [packages/3-mongo-target/3-mongo-driver/test/mongo-driver.test.ts](packages/3-mongo-target/3-mongo-driver/test/mongo-driver.test.ts) — integration tests per wire command |
| `findOneAndUpdate` returns updated doc | [packages/3-mongo-target/3-mongo-driver/src/mongo-driver.ts](packages/3-mongo-target/3-mongo-driver/src/mongo-driver.ts) — `returnDocument: 'after'` | [packages/3-mongo-target/3-mongo-driver/test/mongo-driver.test.ts](packages/3-mongo-target/3-mongo-driver/test/mongo-driver.test.ts) — "updates and returns the modified document" |
| `findOneAndDelete` returns deleted doc | [packages/3-mongo-target/3-mongo-driver/src/mongo-driver.ts](packages/3-mongo-target/3-mongo-driver/src/mongo-driver.ts) — `findOneAndDelete` | [packages/3-mongo-target/3-mongo-driver/test/mongo-driver.test.ts](packages/3-mongo-target/3-mongo-driver/test/mongo-driver.test.ts) — "deletes and returns the removed document" |
