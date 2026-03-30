# Summary

Build the minimal Mongo execution pipeline (query plan, driver, runtime) and prove that PN's architecture can execute queries against MongoDB end-to-end with type inference from a hand-crafted contract.

> **Status: M1 and M2 complete. Close-out in progress.** The original M3 (typed query surface) was superseded by the contract redesign discussion. The next step is a new project (minimal ORM client with redesigned contract structure) — see [mongo-poc-plan.md Phase 3](../../docs/planning/mongo-target/1-design-docs/mongo-poc-plan.md).

# Description

Prisma Next's runtime is hardcoded to SQL. The `Queryable` interface takes `{ sql: string, params: unknown[] }`, `ExecutionPlan` has a `sql: string` field, and every plugin inspects SQL-specific payloads. Before we can build a Mongo ORM client, query builder, or emitter, the execution path itself needs to exist.

This project built that path: a `MongoQueryPlan` type, a `MongoDriver` wrapping the `mongodb` Node.js driver, a `MongoRuntimeCore` orchestrating the execution lifecycle, and hand-crafted Mongo contract types with type inference. The M2 implementation revealed that the contract structure needed a redesign (see [ADRs](../../docs/planning/mongo-target/adrs/)), which shifted the most valuable next step from "typed query surface" to "minimal ORM client validating the redesigned contract." That work is a separate project.

The project is part of the [MongoDB PoC](../../docs/planning/mongo-target/1-design-docs/mongo-poc-plan.md) (Phase 1), [workstream 4](../../docs/planning/april-milestone.md#4-mongodb-poc--validate-the-second-database-family) of the April milestone.

# Requirements

## Functional Requirements

**Execution pipeline:**

- A `MongoQueryPlan` type that pairs a `MongoCommand` (discriminated union — `FindCommand`, `InsertOneCommand`, etc., each with exactly the fields it needs) with `PlanMeta` metadata.
- A `MongoDriver` that wraps `MongoClient` from the `mongodb` package, dispatches commands based on operation type, and returns `AsyncIterable<Document>`.
- A `MongoRuntimeCore` that validates a plan, calls the driver, and wraps results in `AsyncIterableResult<Row>`.
- Supported operations: `find`, `insertOne`, `updateOne`, `deleteOne`, `aggregate` (raw pipeline).

**Codecs:**

- A Mongo codec registry following the same shape as SQL (`typeId → encode/decode/types`), with base codecs for `ObjectId`, `String`, `Int32`, `Boolean`, `Date`.

**Contract types:**

- Hand-crafted `contract.json` and `contract.d.ts` for a simplified blog platform schema (Users, Posts with flat fields and a referenced User→Posts relationship). Embedded documents are deferred — they are a cross-family concern shared with SQL's typed JSON columns.
- A `MongoContract` type that is independent of `SqlContract` but structurally symmetric — same patterns for models referencing fields, fields referencing codec IDs, and mappings connecting domain names to storage names. Do NOT modify `ContractBase`; build the Mongo equivalent independently so the common elements can be extracted later.
- A `CodecTypes` map for Mongo base types referencing the codec registry above.

**Typed query surface:**

- A thin typed layer that reads contract types and constructs `MongoQueryPlan` objects with correct `Row` phantom types.
- Return types inferred from the contract — not manually specified by the caller.
- No relation loading, no `include`, no shared ORM interface.
- Scope is limited to what's achievable with flat-field contracts. Implement as much as possible; document what's blocked by the absence of embedded document support.

**Test infrastructure:**

- `mongodb-memory-server` for running a real `mongod` in tests, configured as a replica set.
- Integration tests using vitest, following existing repo conventions.

## Non-Functional Requirements

- All Mongo packages live under `packages/2-mongo/` and are independent of SQL packages. No imports from `2-sql/`* or `3-extensions/*`. `3-extensions` will be renumbered (e.g. to `9-extensions`) later to make the dependency direction clear. **Assumption:** layering enforcement via `pnpm lint:deps` covers this.
- The interface designs must not prevent future addition of: session/transaction support, plugin hooks, `explain()`, streaming subscriptions.

## Non-goals

- **ORM client** — `findMany`/`create`/`update`/`where`/`include` and the shared ORM interface are a separate, later project.
- **Plugin pipeline** — the lifecycle is well-understood; skip hooks initially.
- **Emitter** — no PSL or TypeScript authoring surfaces. Contract artifacts are hand-crafted.
- **Verification / markers** — tests use known-good contracts; marker collection management is deferred.
- **Referential integrity enforcement** — application-level cascades/restricts are an ORM concern.
- **Streaming / change streams** — validated in the SQL runtime workstream ([VP5](../../docs/planning/april-milestone.md#3-runtime-pipeline-orm-query-builders-middleware-framework-integration)); Mongo streaming is a later concern.
- **Aggregation pipeline DSL** — raw pipeline passthrough is in scope; a typed builder is not.
- **Polymorphism** — discriminated unions are a separate spike (PoC step 7).
- **Cross-family consumer validation** — proving a consumer library works against both SQL and Mongo contracts is a follow-on.

# Acceptance Criteria

**Execution pipeline:**

- A test constructs a `MongoQueryPlan` for `find` on a `users` collection, executes it through `MongoRuntimeCore` and `MongoDriver` against `mongodb-memory-server`, and gets correct rows back.
- `insertOne`, `updateOne`, `deleteOne` execute through the same pipeline and return correct results (inserted ID, matched/modified counts, etc.).
- `aggregate` with a raw pipeline executes and returns results.
- The driver dispatches to the correct `mongodb` driver method for each operation type.

**Codecs:**

- A Mongo codec registry exists with base codecs (`objectId`, `string`, `int32`, `boolean`, `date`) following the same registry shape as SQL.

**Contract types:**

- `contract.json` and `contract.d.ts` exist for the blog platform schema with Users, Posts (flat fields), and referenced User→Posts relationship.
- `MongoContract` is structurally symmetric with `SqlContract`: same patterns for models, fields, codec references, and mappings. Convergence and divergence points are documented.
- A hand-built `MongoQueryPlan` using contract type information executes through the M1 pipeline with `Row` inferred from the contract (not manually specified), proving the contract carries enough information for row type inference.

**Typed query surface:**

- The query surface constructs a `MongoQueryPlan` for `find` on `users` with the `Row` type inferred from the contract (not manually specified).
- A test exercises the full flow: query surface → plan → runtime → driver → `mongodb-memory-server` → typed results.

**Architecture:**

- No `2-mongo` package imports from `2-sql/`* or `3-extensions/*`.
- `PlanMeta` is reused or a clear decision is documented about what needs to change.
- Convergence/divergence between `MongoContract` and `SqlContract` is documented, preparing for future `ContractBase` extraction.

# Other Considerations

## Security

Not applicable — this is internal infrastructure with no user-facing surface.

## Cost

No additional infrastructure cost. `mongodb-memory-server` downloads a `mongod` binary at test time (~100MB, cached).

## Observability

Not applicable at this stage. Telemetry and logging are plugin concerns, deferred with the plugin pipeline.

## Data Protection

Not applicable — no production data, no PII.

## Analytics

Not applicable.

# References

- [Mongo PoC (Linear)](https://linear.app/prisma-company/project/mongo-poc-89d4dcdbcd9a) — keep Linear in sync as tasks progress, scope changes, or milestones complete
- [Mongo execution pipeline components](../../docs/planning/mongo-target/1-design-docs/mongo-execution-components.md) — the design reference for MongoQueryPlan, MongoDriver, MongoRuntimeCore
- [Mongo PoC plan](../../docs/planning/mongo-target/1-design-docs/mongo-poc-plan.md) — full PoC sequencing (this project covers steps 1–3)
- [Design questions](../../docs/planning/mongo-target/1-design-docs/design-questions.md) — open architectural questions, especially #1 (embedded documents), #10 (ContractBase), #3 (resolved: execution plan generalization)
- [Example schemas](../../docs/planning/mongo-target/1-design-docs/example-schemas.md) — the blog platform schema used for the hand-crafted contract
- [Mongo Overview](../../docs/planning/mongo-target/Mongo%20Overview.md) — entrypoint for all Mongo workstream docs
- [April milestone](../../docs/planning/april-milestone.md) — workstream 4

# Decisions

1. **Codecs first** — build the Mongo codec registry before the contract type, since `CodecTypes` form the foundation of the contract's type system.
2. **Independent `MongoContract`** — build `MongoContract` as an independent type, structurally parallel to `SqlContract`. Do not modify `ContractBase`. Extract common elements to the framework domain in a follow-on step. This follows the "spike then extract" approach.
3. **Structural symmetry is a functional requirement** — `MongoContract` must mirror `SqlContract`'s patterns (models → fields → codec IDs → CodecTypes, storage mappings). Divergence points (embedded documents, collections vs. tables, etc.) must be documented.

# Open Questions

1. **Does `PlanMeta` work as-is for Mongo?** Several fields assume SQL: `paramDescriptors` (positional params — Mongo values are inline), `refs.tables`/`refs.columns` (SQL naming), `projection`/`projectionTypes` (SQL column aliases vs. Mongo inclusion/exclusion). **Decision: reuse with empty/unused SQL fields initially, split into shared + family-specific later if the mismatch is more than cosmetic.**
2. **What does `ObjectId` look like to the user?** Normalize to `string` (simpler, consistent with JSON serialization) or preserve the driver's `ObjectId` class (richer, preserves BSON identity)? This decision affects every Mongo contract's type map.

