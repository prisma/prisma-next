# MongoDB in Prisma Next

## Why MongoDB?

Prisma Next's architecture was built for SQL. Every interface a consumer touches today — contracts, query plans, plugins, the ORM client — assumes a relational database with SQL as its query language. But PN's ambition is broader: a contract-first data layer that works across database families.

MongoDB is the test case. If PN can support MongoDB without breaking its core abstractions, the architecture generalizes. If it can't, we'd rather discover that now — before stabilizing interfaces for external contributors — than after.

MongoDB is also a strategic target. The [MongoDB engineering team's feature gap analysis](9-references/Prisma_MongoDB_%20Feature%20support%20priority%20list%20-%20Sheet1.csv) and [user journey](9-references/MongoDB-Prisma_%20User%20journey%20&%20Feature%20gaps.md) show that Prisma ORM's current Mongo support has significant gaps: no embedded document support, polymorphic fields fall back to untyped `Json`, no change streams, no aggregation pipeline access, and no data migrations. PN has an opportunity to offer a genuinely Mongo-native experience.

## What makes MongoDB different

MongoDB's data model is fundamentally different from SQL in ways that stress every layer of the PN stack:

**Embedded documents replace joins.** The idiomatic MongoDB pattern is to store related data inside the parent document — a User contains an Address, a Post contains its Comments. There's no SQL equivalent. This blurs the line between "relation" and "field" in PN's contract model, and changes how the ORM loads and mutates related data. See [mongodb-primitives-reference.md](9-references/mongodb-primitives-reference.md) and [mongo-idioms.md](9-references/mongo-idioms.md).

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

**A shared contract base requires a new abstraction, not a mechanical extraction.** The M2 implementation proved that `MongoContract` and `SqlContract` diverge meaningfully in how they store field information. A useful shared base should be rooted in common domain modeling concepts — aggregate roots, entities, value types, and references — rather than in the implementation details of either family. See [cross-cutting-learnings.md](cross-cutting-learnings.md) for the full domain model analysis.

**Streaming subscriptions are a separate operation type, not a variant of `execute()`.** Both Mongo change streams and SQL logical replication have real-time streaming models, but subscriptions don't complete — they run until closed. This is a different lifecycle from request-response queries and needs its own operation type with its own plugin hooks. The Mongo PoC doesn't implement subscriptions but must not prevent them. Streaming is validated in the SQL runtime workstream via Supabase Realtime ([VP5](../april-milestone.md#3-runtime-pipeline-orm-query-builders-middleware-framework-integration)); the patterns established there will inform Mongo change stream support later.

## What we don't know yet

The open design questions are tracked in [design-questions.md](1-design-docs/design-questions.md). The most consequential ones:

**How do embedded documents appear in the contract?** This is the foundational question — the answer ripples through every layer. Options: relations with a storage strategy (keeps the domain model clean but blurs query semantics), nested field types (simpler but loses queryability), or a distinct concept (most flexible but adds a new abstraction). M2 confirmed this is a **cross-family concern**: SQL typed JSON columns have the same problem. The solution must distinguish entities (have identity) from value types (no identity), and work for both families. See [design question #1](1-design-docs/design-questions.md#1-embedded-documents-relation-field-or-distinct-concept-cross-family-concern) and [cross-cutting-learnings.md](cross-cutting-learnings.md).

**What belongs in `ContractBase`?** Today, `ContractBase` doesn't include models or relations — `SqlContract` adds them. If `MongoContract` adds its own incompatible version, consumer libraries can't be family-agnostic. M2 proved that mechanical extraction from the two existing contracts won't work — a new abstraction is needed, informed by common domain modeling concepts. See [design question #10](1-design-docs/design-questions.md#10-shared-contract-surface-what-goes-in-contractbase-informed-by-m2) and [cross-cutting-learnings.md](cross-cutting-learnings.md).

**How does the contract represent polymorphism?** Discriminated unions (a `tasks` collection containing Bug, Feature, and Chore documents distinguished by a `type` field) are common in MongoDB and also needed for SQL single-table inheritance. This is a cross-family concern that must be validated in April. See [design question #6](1-design-docs/design-questions.md#6-polymorphism-and-discriminated-unions-validate-in-april).

**How does the ORM mutation surface accommodate Mongo's update operators?** `$inc`, `$push`, `$pull` have no SQL equivalent. The shared ORM `update()` can handle plain data (compiled to `$set`), but atomic operators need either family-specific extensions to the shared interface or separate methods. See [design question #4](1-design-docs/design-questions.md#4-update-operators-shared-orm-surface-vs-mongo-native-operations).

**How does `include` work for referenced relations?** SQL uses joins. Mongo uses application-level stitching or `$lookup` in an aggregation pipeline. Embedded relations don't need loading at all — they're always present. See [design question #7](1-design-docs/design-questions.md#7-relation-loading-application-level-joining-vs-lookup).

**What does the aggregation pipeline lane look like?** In the SQL family, the SQL query builder is the escape hatch — when the ORM can't express a query, you drop into `db.sql.from(...)`. Aggregation pipelines fill the same architectural role for Mongo. The pattern is symmetric: each family has a high-level ORM client and a lower-level query builder lane for everything the ORM can't express, both sharing a session/transaction. The lane interface isn't shared across families (SQL lanes compile to SQL strings, Mongo lanes compile to pipeline stage arrays), but the architectural role and interop guarantees are the same. See [design question #8](1-design-docs/design-questions.md#8-aggregation-pipeline-dsl-scope-and-timing).

**How does contract verification work without DDL?** The SQL runtime verifies contract hashes against a `_prisma_next_marker` table — a DDL artifact managed by migrations. MongoDB has no DDL in the same sense. The Mongo runtime would need a marker collection, but: who creates it? How is it managed without a migration runner? This is a cross-cutting concern — the verification system assumes SQL-style migrations exist to manage the marker. See [mongo-execution-components.md § MongoRuntimeCore](1-design-docs/mongo-execution-components.md#3-mongoruntimecore).

Additional open questions cover [referential integrity enforcement](1-design-docs/design-questions.md#2-referential-integrity-enforcement) and [read-time schema validation](1-design-docs/design-questions.md#5-schema-validation-and-read-time-guarantees). Deferred questions (not PoC scope) include [introspection](1-design-docs/design-questions.md#11-introspection-generating-a-contract-from-an-existing-database), [extension packs](1-design-docs/design-questions.md#12-mongodb-specific-extension-packs), [field-level encryption](1-design-docs/design-questions.md#13-client-side-field-level-encryption-csfle-and-queryable-encryption), and [schema evolution via data invariants](1-design-docs/design-questions.md#14-schema-evolution-as-data-migration-cross-workstream).

## How we're finding answers

**Consumption-first.** Start from importing and querying a contract, not from authoring or emission. The contract shape is driven by what the query client needs, because querying is the primary user interaction. Authoring and emission are machines that produce artifacts — build them once you know the target shape.

**Spike then extract.** Build all Mongo packages completely independent of their SQL equivalents — no shared base class, no imports from SQL packages, no predicted abstractions. After both families have working implementations, compare them and extract common interfaces. The abstraction is discovered from two concrete implementations, not predicted from one.

**Execution first, ORM later.** The first phase builds execution machinery (query plan, driver, runtime) against a real MongoDB instance, then works backwards to contract types and a basic typed query surface. The ORM client (`findMany`/`create`/`update`/`include`) is deferred — in the SQL family, the query builder lane and runtime existed long before the ORM client was designed. Follow-on phases broaden the query surface, test embedded document operations, validate cross-family reuse, and spike polymorphism.

The full step-by-step plan, including architectural risks mapped to design questions, is in [mongo-poc-plan.md](1-design-docs/mongo-poc-plan.md).

### Scope and status

This work stream is [workstream 4](../april-milestone.md#4-mongodb-poc--validate-the-second-database-family) of the [April milestone](../april-milestone.md). The PoC plan currently covers the first phase (consumption-first vertical slice). The following are in-scope for April but not yet planned in detail — they will be added as project specs when the first phase answers the foundational questions:

- **Emitter pipeline generalization** — the authoring surfaces and emission process are coupled to SQL; this must be proven for Mongo before end of April
- **ORM client** — the full `findMany`/`create`/`update`/`include` surface, built on top of the proven execution path and contract
- **Shared ORM interface extraction** — extracted after both ORM clients work independently
- **Cross-family consumer validation** — a consumer library working against both SQL and Mongo contracts without family-specific code

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

**Cross-cutting learnings** — insights that affect the framework core:
- [cross-cutting-learnings.md](cross-cutting-learnings.md) — domain model concepts, shared contract base design, entity/value type distinctions

**Reference material** — context, read as needed:
- [mongodb-primitives-reference.md](9-references/mongodb-primitives-reference.md) — MongoDB's data model, type system, query language, and transactions
- [mongo-idioms.md](9-references/mongo-idioms.md) — patterns experienced MongoDB developers use and expect
- [example-schemas.md](1-design-docs/example-schemas.md) — three concrete schemas with speculative PSL and query patterns
- [9-references/](9-references/) — external documents from the MongoDB engineering team

**Plan** — sequencing and risks:
- [mongo-poc-plan.md](1-design-docs/mongo-poc-plan.md) — PoC steps, follow-on steps, and architectural risks

## Maintaining these docs

This overview is the source of truth for "what do we know and what don't we know." Keep it current as the work stream progresses.

- **Design question resolved**: Update the narrative in "What we know so far" (or remove from "What we don't know yet"), update the full analysis in [design-questions.md](1-design-docs/design-questions.md) with the resolution and rationale, and link any new analysis document (as was done for [mongo-execution-components.md](1-design-docs/mongo-execution-components.md) when question #3 was resolved).
- **Design question added**: Add to [design-questions.md](1-design-docs/design-questions.md) first, then mention in "What we don't know yet" if it's consequential.
- **Plan scope changes**: Update [mongo-poc-plan.md](1-design-docs/mongo-poc-plan.md) and the "Scope and status" section above to match.
- **Implementation begins**: Create a Drive project spec under `projects/`. These research docs are the design reference, not task trackers.
- **Cross-cutting insight discovered**: If a milestone reveals something that affects the framework core or another family (not just Mongo), add it to [cross-cutting-learnings.md](cross-cutting-learnings.md). Cross-reference from the relevant design doc so readers discover the insight in context. Remove entries from cross-cutting-learnings when the learning has been fully applied (code landed, docs updated across all affected domains).
- **Milestone completed**: Review what was learned during implementation. Update the relevant design docs (this overview, design questions, execution components, contract symmetry) with resolved questions, new constraints, and refined understanding. Add any cross-cutting learnings per the rule above.
- **Reference material** (files under `9-references/`, plus `1-design-docs/example-schemas.md`) is stable context and rarely needs updates.
