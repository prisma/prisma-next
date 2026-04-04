# ORM Consolidation — Execution Plan

## Summary

Consolidate the SQL and Mongo ORM clients onto a shared `Collection` interface with fluent chaining, following [ADR 175](../../docs/architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md). Phase 1 builds a Mongo `Collection` independently (spike). Phase 2 extracts the shared interface from the two concrete implementations. Success means Mongo users get the same chaining API as SQL, custom collection subclasses work across both families, and a shared `Collection` base class lives in the framework layer.

**Spec:** [projects/orm-consolidation/spec.md](spec.md)

**Linear:** [TML-2189](https://linear.app/prisma-company/issue/TML-2189) — project [WS4: MongoDB & Cross-Family Architecture](https://linear.app/prisma-company/project/ws4-mongodb-and-cross-family-architecture-89d4dcdbcd9a)

## Collaborators

| Role         | Person | Context                                              |
| ------------ | ------ | ---------------------------------------------------- |
| Maker        | Will   | Drives execution                                     |
| Collaborator | Alexey | SQL ORM owner — Phase 2 changes SQL Collection       |

## Phases

### Phase 1: Mongo Collection spike (isolated)

Build `MongoCollection` with the same fluent chaining API as SQL, compiling to `MongoQueryPlan` at terminal methods. No changes to the SQL ORM or framework layer.

**Detailed plan:** [plans/phase-1-mongo-collection-spike.md](plans/phase-1-mongo-collection-spike.md)

**Milestones:**

1. Query AST (`@prisma-next/mongo-query-ast`) — filter expressions, read stages, visitors, lowering, extension operator proof
2. ORM Collection with chaining + compilation (CollectionState → MongoQueryPlan)
3. Wire `mongoOrm()` + update demo + integration tests

**Proof:** Mongo demo uses `.where().select().include().orderBy().take().all()` chaining, executing against `mongodb-memory-server`.

### Phase 1.5: Mongo write operations

**Linear:** [TML-2194](https://linear.app/prisma-company/issue/TML-2194)

**Detailed plan:** [plans/phase-1.5-write-operations.md](plans/phase-1.5-write-operations.md)

Phase 1 is read-only. The SQL ORM already has `create()`, `createAll()`, `createCount()`, `update()`, `updateAll()`, `updateCount()`, `delete()`, `deleteAll()`, `deleteCount()`, and `upsert()`. We can't extract a meaningful shared `Collection` interface until the Mongo ORM covers the same surface area — otherwise we'd extract only the read portion and have to refactor the base class again when writes land.

**Milestones:**

1. Command types + driver + adapter — add `InsertManyCommand`, `UpdateManyCommand`, `DeleteManyCommand`, `FindOneAndUpdateCommand`, `FindOneAndDeleteCommand` with wire commands, result types, adapter lowering, and driver execution
2. ORM write methods — add `create`, `createAll`, `createCount`, `update`, `updateAll`, `updateCount`, `delete`, `deleteAll`, `deleteCount`, `upsert` to `MongoCollection`
3. Demo + integration tests — replace raw `MongoClient` seeding with ORM writes, full CRUD lifecycle tests
4. Dot-path field accessor mutations ([ADR 180](../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)) — add targeted mutation operators (`set`, `inc`, `push`, etc.) via the callable string accessor `u("field.path")`. Maps to MongoDB's native `$set`/`$inc`/`$push` with dot-notation. Depends on value objects landing in the contract ([ADR 178](../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md)); can be sequenced after milestones 1–3 or deferred to the value objects project.

**Proof:** Mongo demo seeds data via ORM write methods. Integration tests verify create/update/delete round-trip against `mongodb-memory-server`.

### Phase 2: Shared interface extraction (coordinate with Alexey)

Extract `Collection<C, M>` base class, `CollectionState`, `InferModelRow`, and include interface from the two concrete implementations into the framework layer. Both SQL and Mongo now have complete read + write surfaces to compare.

**Detailed plan:** [plans/phase-2-shared-interface-extraction.md](plans/phase-2-shared-interface-extraction.md)

**Milestones:**

1. Extract `CollectionState` and chaining base
2. Extract `InferModelRow` utility type
3. Extract shared include interface
4. Extract shared mutation interface (`create`, `update`, `delete`)
5. Verify custom collection subclasses
6. Client shape extraction

**Proof:** Both SQL and Mongo Collections extend a shared base class. Custom collection subclasses work identically for both families. All existing tests pass.

## Dependencies

- **No dependency on M5 (unified contract) or M6 (SQL emitter migration)** from the contract domain extraction project — the ORM query surface is independent.
- **Phase 1.5 depends on Phase 1** — write operations build on the collection class and adapter interface established in Phase 1.
- **Phase 2 depends on Phase 1.5** — can't extract a shared interface until both implementations cover reads and writes.
- **Phase 2 requires coordination with Alexey** — extraction changes the SQL Collection's inheritance hierarchy.
- **WS4-3 (polymorphic models) depends on Phase 2** — polymorphic models extend the shared Collection interface.

## Follow-ups

### Remove legacy command types from mongo-core

Once all consumers produce `MongoReadPlan` (typed AST stages) instead of command-based `MongoQueryPlan`, delete the legacy command infrastructure from `mongo-core`: `FindCommand`, `AggregateCommand`, `InsertOneCommand`, `UpdateOneCommand`, `DeleteOneCommand`, `MongoQueryPlan`, wire command classes, and the adapter's `lower()` method. These are the untyped predecessors of the query AST; removing them eliminates the old core↔query dependency and simplifies the adapter to a thin driver bridge.

### Restructure Mongo family directories to match layering design

The current `packages/2-mongo-family/` has most numbered directories acting as the package itself rather than as layer directories containing packages. Restructure to match the target layering: each numbered directory is a layer containing one or more packages (e.g., `1-core/mongo-core/`, `4-orm/mongo-orm/`). Only `2-query/` follows the correct convention from the start.

**Design:** [plans/mongo-family-layering.md](plans/mongo-family-layering.md)

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/orm-consolidation/spec.md`
- [ ] Migrate long-lived docs into `docs/`
- [ ] Strip repo-wide references to `projects/orm-consolidation/**` (replace with canonical `docs/` links or remove)
- [ ] Delete `projects/orm-consolidation/`
