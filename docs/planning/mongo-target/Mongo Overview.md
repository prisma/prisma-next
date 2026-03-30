# MongoDB in Prisma Next

> **Reference archive.** The PoC is complete. The durable architecture docs are in [10. MongoDB Family.md](../../architecture%20docs/subsystems/10.%20MongoDB%20Family.md) and [ADRs 172-175](../../architecture%20docs/adrs/). The April plan is in [april-milestone.md](../april-milestone.md) WS4. This directory is retained as detailed reference material.

## Why MongoDB?

Prisma Next's architecture was built for SQL. Every interface a consumer touches today — contracts, query plans, plugins, the ORM client — assumes a relational database with SQL as its query language. But PN's ambition is broader: a contract-first data layer that works across database families.

MongoDB is the test case. If PN can support MongoDB without breaking its core abstractions, the architecture generalizes. If it can't, we'd rather discover that now — before stabilizing interfaces for external contributors — than after.

MongoDB is also a strategic target. The [feature gap analysis](../../reference/mongodb-feature-support-priorities.md) and [user journey](../../reference/mongodb-user-journey.md) show that Prisma ORM's current Mongo support has significant gaps: no embedded document support, polymorphic fields fall back to untyped `Json`, no change streams, no aggregation pipeline access, and no data migrations. PN has an opportunity to offer a genuinely Mongo-native experience.

## What makes MongoDB different

MongoDB's data model is fundamentally different from SQL in ways that stress every layer of the PN stack:

**Embedded documents replace joins.** The idiomatic MongoDB pattern is to store related data inside the parent document — a User contains an Address, a Post contains its Comments. There's no SQL equivalent. This blurs the line between "relation" and "field" in PN's contract model, and changes how the ORM loads and mutates related data. See [MongoDB primitives reference](../../reference/mongodb-primitives-reference.md) and [MongoDB idioms](../../reference/mongodb-idioms.md).

**No schema enforcement by default.** MongoDB doesn't enforce types at the storage level. A field declared as `number` in the contract might contain a string in the database. PN's contract guarantees are aspirational, not structurally enforced — the runtime must decide what to do when reality doesn't match the contract.

**Mutations use operators, not assignment.** SQL mutations assign values to columns. MongoDB mutations use operators (`$set`, `$inc`, `$push`, `$pull`, `$addToSet`) that express fine-grained, atomic patches — increment a counter, append to an array, remove matching elements. The ORM's mutation surface needs to accommodate both the shared pattern (plain data updates, compiled to `$set`) and these Mongo-native atomic operations.

**No referential integrity.** MongoDB has no foreign keys, no cascading deletes, no database-level guarantees about cross-collection references. Application code that relies on cascade deletes, restrict constraints, or consistent references gets none of that for free. An ORM offering a symmetric experience across SQL and Mongo must provide configurable referential integrity guarantees in application code — taking on responsibility that the database handles in SQL.

**Polymorphism is idiomatic.** Storing different document shapes in the same collection is a standard MongoDB pattern — a `tasks` collection might contain Bug, Feature, and Chore documents distinguished by a `type` field. SQL handles this with single-table inheritance (one table, nullable columns), but it's uncommon. In MongoDB it's everywhere. The contract, emitter, and ORM all need to represent discriminated unions as a first-class concept.

**Aggregation pipelines are the native query language.** Simple CRUD uses `find()` and `updateOne()`, but anything beyond basic filtering — joins (`$lookup`), computed fields (`$project`), grouping (`$group`), reshaping — uses aggregation pipelines. These are MongoDB's equivalent of complex SQL queries, and they need a native PN representation to offer a Mongo-native developer experience.

**Real-time streaming is a first-class primitive.** MongoDB change streams (built on the oplog) let applications subscribe to data changes as they happen. In SQL, real-time is an add-on (logical replication, `LISTEN/NOTIFY`, third-party tools like Supabase). In MongoDB it's built in. The PN runtime must accommodate streaming subscriptions alongside request-response queries — they have fundamentally different lifecycles.

## What we're building

PN offers MongoDB users three things they can't get elsewhere:

1. **A contract as the source of truth.** Describe your domain once — models, fields, types, relations, and the explicit choice of embed vs. reference. Everything downstream (types, queries, validation) derives from this contract. See [user-promise.md](1-design-docs/user-promise.md).

2. **Type-safe, Mongo-native queries.** Operations checked against the contract at compile time. Filter on embedded fields with dot notation. Use `$inc` and `$push` through the ORM. Get the same `findMany`/`create`/`update`/`where` patterns as SQL-PN, with Mongo-specific extensions where the semantics differ.

3. **Guardrails MongoDB doesn't provide.** Configurable referential integrity (cascade, restrict, setNull). Schema validation on writes and configurable validation on reads. Runtime plugins for budgets, linting, and telemetry.

See [example-schemas.md](1-design-docs/example-schemas.md) for three concrete MongoDB schemas with speculative PSL and query patterns. These are starting points — they should be refined and updated as the PoC validates (or invalidates) assumptions about contract representation and query surface.

## What we know so far

Several key architectural questions have been answered through analysis of the existing codebase:

**Mongo is its own family, not a target under "document."** The SQL family abstraction works because SQL databases share a common query language. There is no equivalent shared interface for document databases — MongoDB and Firestore have different query languages, different data organization models, and different capabilities. A "document family" would contain very little that isn't trivially generic or actually MongoDB-specific. The contract hierarchy is `ContractBase` → `SqlContract` / `MongoContract`, with each family owning its own targets. Splitting family from target (even with only one Mongo target) forces us to keep extension points and seams explicit — the interface/concretion boundary stays clean rather than collapsing into a monolith.

**The model IS the schema in Mongo.** In SQL, the source of truth for data structure is the database schema (tables, columns, constraints). The model layer is a mapping *onto* that schema. In Mongo, there is no enforced schema — the source of truth for document structure is the application's domain models. This means the Mongo contract's model fields carry `codecId` and `nullable` directly, with no column indirection. SQL's field-to-column indirection pattern cannot be mechanically applied to Mongo. See [contract-symmetry.md](1-design-docs/contract-symmetry.md) for a detailed comparison.

**The execution pipeline is family-specific; the lifecycle is shared.** Plugins like the linter need to inspect query-specific structure — SQL AST nodes for the SQL linter, Mongo command fields for a Mongo linter. You can't abstract over these payloads without either making the abstraction useless or forcing every plugin to branch on family. Each family gets its own plan type (`MongoQueryPlan`), plugin interface (`MongoPlugin`), and runtime (`MongoRuntimeCore`). What IS shared is the plugin lifecycle pattern (`beforeExecute → onRow → afterExecute`) and the metadata (`PlanMeta`). See [mongo-execution-components.md](1-design-docs/mongo-execution-components.md).

**The contract redesign separates domain from persistence.** The M2 implementation proved that `MongoContract` and `SqlContract` diverge in how they store field information. The contract redesign resolved this by separating domain-level structure (`roots`, `models` with `fields`/`discriminator`/`variants`, `relations`) from persistence (`model.storage` as the family-specific bridge, top-level `storage` for the database schema). The domain level is identical between families; only `model.storage` differs. Aggregate roots are explicit via a `roots` section. Polymorphism uses `discriminator` + `variants` with persistence strategy emergent from storage mappings. Embedding is a relation property. See [cross-cutting-learnings.md](cross-cutting-learnings.md) for the design principles and full proposal, and [contract-symmetry.md](1-design-docs/contract-symmetry.md) for the convergence/divergence analysis.

**Streaming subscriptions are a separate operation type, not a variant of `execute()`.** Both Mongo change streams and SQL logical replication have real-time streaming models, but subscriptions don't complete — they run until closed. This is a different lifecycle from request-response queries and needs its own operation type with its own plugin hooks. The Mongo PoC doesn't implement subscriptions but must not prevent them. Streaming is validated in the SQL runtime workstream via Supabase Realtime ([VP5](../april-milestone.md#3-runtime-pipeline-orm-query-builders-middleware-framework-integration)); the patterns established there will inform Mongo change stream support later.

**The ORM Collection chaining API is a shared pattern across families.** The Phase 3 Mongo ORM client proved the contract carries enough information for typed queries, polymorphism, embedded documents, and referenced relations. A comparative analysis with the SQL ORM revealed that the consumer-facing surface — `Collection` class with fluent chaining (`.where().select().include().take().all()`), `CollectionState` as the accumulated query state, row type inference from `model.fields[f].codecId`, custom collection subclasses — is fundamentally the same pattern. Family-specific concerns are cleanly bounded to terminal method compilation (`CollectionState` → `SqlQueryPlan` vs `MongoQueryPlan`) and include resolution strategy (lateral joins vs `$lookup`). The Mongo ORM will adopt the same chaining API as the SQL ORM, with shared interface extraction following the "spike then extract" approach. See [ADR 175](../../architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md) and [cross-cutting-learnings.md § 6](cross-cutting-learnings.md).

## What we don't know yet

The open design questions are tracked in [design-questions.md](1-design-docs/design-questions.md). The most consequential ones:

**How do embedded documents appear in the contract?** *(direction established)* Embedding is a relation property: the parent's relation declares `"strategy": "embed"`. The embedded model appears as a sibling in `models` with its own fields but no storage unit. Value types (no identity) belong in a separate `types`/`composites` section. Remaining work: designing the relation storage details for embedding. See [design question #1](1-design-docs/design-questions.md#1-embedded-documents-relation-field-or-distinct-concept-cross-family-concern).

**What belongs in `ContractBase`?** *(concrete proposal)* The domain level is the shared surface: `roots`, `models` (with `fields`, `discriminator`, `variants`), and `relations`. The divergence is scoped to `model.storage`. See [design question #10](1-design-docs/design-questions.md#10-shared-contract-surface-what-goes-in-contractbase-contract-redesign-proposal) and [contract-symmetry.md](1-design-docs/contract-symmetry.md).

**How does the contract represent polymorphism?** *(design proposal)* `discriminator` + `variants` on the base model, with variants as sibling models. Persistence strategy (STI vs MTI) is emergent from whether variants share the base's storage unit. Remaining: polymorphic associations (relation-level polymorphism). See [design question #6](1-design-docs/design-questions.md#6-polymorphism-and-discriminated-unions-validate-in-april).

**How does the ORM mutation surface accommodate Mongo's update operators?** `$inc`, `$push`, `$pull` have no SQL equivalent. The shared ORM `update()` can handle plain data (compiled to `$set`), but atomic operators need either family-specific extensions to the shared interface or separate methods. See [design question #4](1-design-docs/design-questions.md#4-update-operators-shared-orm-surface-vs-mongo-native-operations).

**How does `include` work for referenced relations?** *(resolved)* Phase 3 proved the approach: referenced relations use `$lookup` aggregation pipeline stages, with `$unwind` for to-one cardinalities. Embedded relations are auto-projected — they're always present in the document, so no loading is needed. The `include` interface is shared across families; the resolution strategy differs (SQL: lateral joins / correlated subqueries / multi-query stitching; Mongo: `$lookup` pipeline). See [design question #7](1-design-docs/design-questions.md#7-relation-loading-application-level-joining-vs-lookup).

**What does the aggregation pipeline lane look like?** In the SQL family, the SQL query builder is the escape hatch — when the ORM can't express a query, you drop into `db.sql.from(...)`. Aggregation pipelines fill the same architectural role for Mongo. The pattern is symmetric: each family has a high-level ORM client and a lower-level query builder lane for everything the ORM can't express, both sharing a session/transaction. The lane interface isn't shared across families (SQL lanes compile to SQL strings, Mongo lanes compile to pipeline stage arrays), but the architectural role and interop guarantees are the same. See [design question #8](1-design-docs/design-questions.md#8-aggregation-pipeline-dsl-scope-and-timing).

**How does contract verification work without DDL?** The SQL runtime verifies contract hashes against a `_prisma_next_marker` table — a DDL artifact managed by migrations. MongoDB has no DDL in the same sense. The Mongo runtime would need a marker collection, but: who creates it? How is it managed without a migration runner? This is a cross-cutting concern — the verification system assumes SQL-style migrations exist to manage the marker. See [mongo-execution-components.md § MongoRuntimeCore](1-design-docs/mongo-execution-components.md#3-mongoruntimecore).

Additional open questions cover [referential integrity enforcement](1-design-docs/design-questions.md#2-referential-integrity-enforcement) and [read-time schema validation](1-design-docs/design-questions.md#5-schema-validation-and-read-time-guarantees). Deferred questions (not PoC scope) include [introspection](1-design-docs/design-questions.md#11-introspection-generating-a-contract-from-an-existing-database), [extension packs](1-design-docs/design-questions.md#12-mongodb-specific-extension-packs), [field-level encryption](1-design-docs/design-questions.md#13-client-side-field-level-encryption-csfle-and-queryable-encryption), and [schema evolution via data invariants](1-design-docs/design-questions.md#14-schema-evolution-as-data-migration-cross-workstream).

## How we're finding answers

**Consumption-first.** Start from importing and querying a contract, not from authoring or emission. The contract shape is driven by what the query client needs, because querying is the primary user interaction. Authoring and emission are machines that produce artifacts — build them once you know the target shape.

**Spike then extract.** Build all Mongo packages completely independent of their SQL equivalents — no shared base class, no imports from SQL packages, no predicted abstractions. After both families have working implementations, compare them and extract common interfaces. The abstraction is discovered from two concrete implementations, not predicted from one.

**Execution first, ORM later.** The first phase builds execution machinery (query plan, driver, runtime) against a real MongoDB instance, then works backwards to contract types and a basic typed query surface. The ORM client (`findMany`/`create`/`update`/`include`) is deferred — in the SQL family, the query builder lane and runtime existed long before the ORM client was designed. Follow-on phases broaden the query surface, test embedded document operations, validate cross-family reuse, and spike polymorphism.

The full step-by-step plan, including architectural risks mapped to design questions, is in [mongo-poc-plan.md](1-design-docs/mongo-poc-plan.md).

### Scope and status

This work stream is [workstream 4](../april-milestone.md#4-mongodb-poc--validate-the-second-database-family) of the [April milestone](../april-milestone.md). **The PoC is complete.** The architecture generalizes; remaining work is integration. See [mongo-poc-plan.md § PoC conclusion](1-design-docs/mongo-poc-plan.md#poc-conclusion) for the full assessment.

Completed:

- **Phase 1** (execution pipeline): `MongoQueryPlan`, `MongoDriver`, `MongoRuntimeCore`, codecs, test infrastructure.
- **Phase 2** (contract redesign): Domain/storage separation, polymorphism, aggregate roots. See [ADRs](../../architecture%20docs/adrs/).
- **Phase 3** (minimal ORM client + contract validation): `validateMongoContract()`, `mongoOrm()` with typed `findMany`, equality filters, `$lookup` includes, embedded document projection, polymorphic queries. All acceptance criteria met.

Next steps are integration, not further PoC phases:

- **Contract shape transition** — update the emitter and `validateContract()` to produce the new contract shape. Mechanical, not risky.
- **Authoring surface alignment** — coordinate with the PSL/TS DSL workstream so authoring concepts (`roots`, `discriminator`/`variants`, embed/reference strategy) align with the contract. Not a synchronous dependency, but the longer the gap grows the more expensive it becomes.
- **ORM client structure** — pin the SQL ORM to the new contract shape (where `model.fields` carries `codecId` and `nullable` directly). Requires coordination with the ORM workstream.
- **`ContractBase` extraction** — extract the shared domain-level contract type from the two family-specific implementations. Prerequisite for cross-family consumer validation.

## Testing strategy

The PoC requires integration tests against a real MongoDB instance.

- **Provisioning**: [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server) — downloads and runs a real `mongod` binary in-process, no container orchestration needed. Configured as a replica set (required for change streams and transactions).
- **Type-level tests**: Contract design and ORM client API are validated with type-level tests — TypeScript files that must typecheck against the hand-crafted contract types. No running database needed.
- **Integration tests**: Query execution requires a running MongoDB instance. Tests use the real `mongodb` Node.js driver under the adapter.
- **Conventions**: Follow the repo's existing patterns — vitest, `pnpm test`, package-local test config. See the [Testing Guide](../../Testing%20Guide.md).

## Package layout

Mongo packages are split across two domains — family (abstractions) and target (concretions):

```
packages/2-mongo-family/
  1-core/            -- MongoContract types, MongoQueryPlan, MongoCodec interfaces
  4-orm/             -- Mongo ORM client (findMany, include, polymorphic queries)
  5-runtime/         -- MongoRuntime, MongoPlugin interface

packages/3-mongo-target/
  1-mongo-target/    -- Target pack definition
  2-mongo-adapter/   -- Concrete codecs (objectId, string, int32, boolean, date)
  3-mongo-driver/    -- MongoDriver (wraps the mongodb Node.js driver)
```

This separation follows the architectural rule: family packages define abstractions, target packages provide concretions. The family/target split keeps extension points explicit — even with a single Mongo target, the boundary prevents the interface and implementation from collapsing into a monolith.

Package boundaries are enforced by `pnpm lint:deps` — layering enforcement must prohibit `2-mongo-family` and `3-mongo-target` packages from importing `2-sql` or `3-extensions` packages.

## Further reading

**Analysis docs** — design decisions and rationale:
- [user-promise.md](1-design-docs/user-promise.md) — the full value proposition for Mongo users
- [mongo-execution-components.md](1-design-docs/mongo-execution-components.md) — execution pipeline components, what's shared, and what's open
- [contract-symmetry.md](1-design-docs/contract-symmetry.md) — where Mongo and SQL contracts converge and diverge
- [design-questions.md](1-design-docs/design-questions.md) — all 14 open architectural questions with full analysis

**ADRs** — architectural decisions with full reasoning and rejected alternatives:
- [ADR 172 — Contract domain-storage separation](../../architecture%20docs/adrs/ADR%20172%20-%20Contract%20domain-storage%20separation.md) — separating `model.fields` (domain) from `model.storage` (family-specific bridge)
- [ADR 173 — Polymorphism via discriminator and variants](../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md) — emergent persistence strategy, rejected alternatives (`extends`, strategy labels)
- [ADR 174 — Aggregate roots and relation strategies](../../architecture%20docs/adrs/ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md) — explicit `roots` section, embedding as a relation property
- [ADR 175 — Shared ORM Collection interface](../../architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md) — fluent chaining as the shared ORM API, family-specific compilation at terminal methods

**Cross-cutting learnings** — insights that affect the framework core:
- [cross-cutting-learnings.md](cross-cutting-learnings.md) — design principles, domain model concepts, open contract design questions

**Reference material** — context, read as needed:
- [MongoDB primitives reference](../../reference/mongodb-primitives-reference.md) — MongoDB's data model, type system, query language, and transactions
- [MongoDB idioms](../../reference/mongodb-idioms.md) — patterns experienced MongoDB developers use and expect
- [example-schemas.md](1-design-docs/example-schemas.md) — three concrete schemas with speculative PSL and query patterns
- [MongoDB user journey](../../reference/mongodb-user-journey.md) — typical developer experience and friction points
- [MongoDB feature support priorities](../../reference/mongodb-feature-support-priorities.md) — prioritized feature inventory

**Plan** — sequencing and risks:
- [mongo-poc-plan.md](1-design-docs/mongo-poc-plan.md) — PoC steps, follow-on steps, and architectural risks

## Maintaining these docs

This directory is a **reference archive** for the Mongo PoC. Active planning now happens in:

- [april-milestone.md](../april-milestone.md) WS4 — current priorities and scope
- [10. MongoDB Family.md](../../architecture%20docs/subsystems/10.%20MongoDB%20Family.md) — durable subsystem doc
- [ADRs 172-175](../../architecture%20docs/adrs/) — promoted architectural decisions
- `projects/` — implementation specs and plans (transient, per the Drive workflow)

If new design questions arise during implementation, add them to [design-questions.md](1-design-docs/design-questions.md) and update the subsystem doc. New architectural decisions should be recorded as ADRs in `docs/architecture docs/adrs/` directly (not under this directory).
