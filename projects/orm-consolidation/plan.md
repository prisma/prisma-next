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

### Phase 2: Shared interface extraction (coordinate with Alexey)

Extract `Collection<C, M>` base class, `CollectionState`, `InferModelRow`, and include interface from the two concrete implementations into the framework layer.

**Detailed plan:** [plans/phase-2-shared-interface-extraction.md](plans/phase-2-shared-interface-extraction.md)

**Milestones:**

1. Extract `CollectionState` and chaining base
2. Extract `InferModelRow` utility type
3. Extract shared include interface
4. Verify custom collection subclasses
5. Client shape extraction

**Proof:** Both SQL and Mongo Collections extend a shared base class. Custom collection subclasses work identically for both families. All existing tests pass.

## Dependencies

- **No dependency on M5 (unified contract) or M6 (SQL emitter migration)** from the contract domain extraction project — the ORM query surface is independent.
- **Phase 2 depends on Phase 1** — can't extract a shared interface without two concrete implementations.
- **Phase 2 requires coordination with Alexey** — extraction changes the SQL Collection's inheritance hierarchy.
- **WS4-3 (polymorphic models) depends on Phase 2** — polymorphic models extend the shared Collection interface.

## Follow-ups

### Restructure Mongo family directories to match layering design

The current `packages/2-mongo-family/` has most numbered directories acting as the package itself rather than as layer directories containing packages. Restructure to match the target layering: each numbered directory is a layer containing one or more packages (e.g., `1-core/mongo-core/`, `4-orm/mongo-orm/`). Only `2-query/` follows the correct convention from the start.

**Design:** [plans/mongo-family-layering.md](plans/mongo-family-layering.md)

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/orm-consolidation/spec.md`
- [ ] Migrate long-lived docs into `docs/`
- [ ] Strip repo-wide references to `projects/orm-consolidation/**` (replace with canonical `docs/` links or remove)
- [ ] Delete `projects/orm-consolidation/`
