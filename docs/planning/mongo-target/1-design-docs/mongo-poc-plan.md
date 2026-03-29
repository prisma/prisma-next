# MongoDB PoC — Plan

## Goal

Validate that the Prisma Next architecture can accommodate a non-SQL database family. The primary deliverable is a working ORM client that reads data from MongoDB with type inference, relationship traversal (both referenced and embedded), and polymorphic queries — all driven by a contract structure that follows the domain/storage separation design ([ADR 1](../adrs/ADR%201%20-%20Contract%20domain-storage%20separation.md), [ADR 2](../adrs/ADR%202%20-%20Polymorphism%20via%20discriminator%20and%20variants.md), [ADR 3](../adrs/ADR%203%20-%20Aggregate%20roots%20and%20relation%20strategies.md)).

## Approach

### Consumption-first, execution-inward

Start from the **consumer end** — not the authoring/emission end. Build the execution path first (runtime, driver), then the contract, then the ORM client.

The existing runtime (`RuntimeCoreImpl`) is hardcoded to SQL. The first thing needed was a Mongo-specific execution pipeline: `MongoQueryPlan`, `MongoDriver`, `MongoRuntimeCore`. This is now **complete** (see [mongo-execution-poc](../../../../projects/mongo-execution-poc/spec.md)).

With the execution path proven, the contract redesign discussion ([ADRs](../adrs/)) established the contract structure. The next step is to implement that structure and build a minimal ORM client that consumes it — proving the contract carries enough information for the ORM to do its job.

**Deferred from the PoC, but in-scope for April:**
- Emitter pipeline generalization — the authoring surfaces and emission process are coupled to SQL; this must be proven for Mongo before end of April
- Shared ORM interface extraction — extracted after both ORM clients work independently
- Cross-family consumer validation — a consumer library working against both SQL and Mongo contracts

**Deferred beyond April:**
- PSL authoring for document schemas
- TypeScript authoring API
- Production-quality driver, connection pooling, error handling
- Aggregation pipeline DSL
- Migrations / schema diffing

### "Mongo" is its own family, not a target under "document"

**Decision: `familyId: 'mongo'`, not `familyId: 'document'`.**

The SQL family abstraction earns its keep because SQL databases genuinely share a common interface: the SQL query language, the relational model, and query semantics. There is no equivalent shared interface for "document databases" — MongoDB and Firestore don't share a query language, data organization model, or query capabilities. If Firestore came later, it would be its own family.

The contract hierarchy follows the domain/storage separation from [ADR 1](../adrs/ADR%201%20-%20Contract%20domain-storage%20separation.md):
```
ContractBase (shared domain: roots, models with fields/discriminator/variants, relations)
├── SqlContract (model.storage: field → column; top-level storage: tables, columns, indexes)
│   └── Targets: Postgres, MySQL, SQLite...
└── MongoContract (model.storage: field → codecId; top-level storage: collections)
    └── Target: MongoDB
```

### Spike then extract

Build all Mongo packages **completely independent** of their SQL equivalents. Own query plan type, own driver, own runtime, own ORM client. After both families have working implementations, extract common interfaces.

The contract types are the exception — the domain level (`roots`, `models`, `relations`) should converge to a shared `ContractBase`, informed by both implementations. See [contract-symmetry.md](../1-design-docs/contract-symmetry.md).

## Completed work

### Phase 1: Execution pipeline *(done — [mongo-execution-poc](../../../../projects/mongo-execution-poc/spec.md))*

Built the minimal execution path from hardcoded queries to rows returned from a real MongoDB instance.

Deliverables:
- **`MongoQueryPlan`** — pairs a `MongoCommand` (discriminated union: `FindCommand`, `InsertOneCommand`, `UpdateOneCommand`, `DeleteOneCommand`, `AggregateCommand`) with `PlanMeta`.
- **`MongoDriver`** — wraps the `mongodb` Node.js driver, dispatches commands to the correct driver method, returns `AsyncIterable<Document>`.
- **`MongoRuntimeCore`** — validates the plan, calls the driver, wraps results in `AsyncIterableResult<Row>`.
- **`MongoCodecRegistry`** — base codecs (`objectId`, `string`, `int32`, `boolean`, `date`) following the SQL registry shape.
- **`MongoContract`** (initial version) — independent of `SqlContract`, structurally parallel. Proved that contract-driven type inference works.
- **Test infrastructure** — `mongodb-memory-server` for a real `mongod` in tests.

Key learnings from this phase led to the contract redesign discussion, documented in [ADRs](../adrs/) and [cross-cutting-learnings.md](../cross-cutting-learnings.md).

### Phase 2: Contract redesign *(done — design only)*

The contract structure was redesigned through design discussion, informed by what the execution pipeline and initial contract revealed. The result is documented in three ADRs:

- [ADR 1 — Contract domain-storage separation](../adrs/ADR%201%20-%20Contract%20domain-storage%20separation.md) — `model.fields` (domain) vs `model.storage` (family-specific bridge)
- [ADR 2 — Polymorphism via discriminator and variants](../adrs/ADR%202%20-%20Polymorphism%20via%20discriminator%20and%20variants.md) — emergent persistence strategy
- [ADR 3 — Aggregate roots and relation strategies](../adrs/ADR%203%20-%20Aggregate%20roots%20and%20relation%20strategies.md) — explicit `roots`, embedding as a relation property

## Next: Phase 3 — Minimal ORM client with contract validation

Implement the redesigned contract structure and build a minimal ORM client that consumes it. The ORM client is scoped to **reads only** — enough to validate that the contract carries the right information for polymorphism, embedded documents, referenced relations, and type inference.

This phase folds together what was previously steps 3 (query surface), 5 (embedded documents), 7 (polymorphism spike), and the beginning of step 8 (ORM client).

### Contract implementation

Restructure `MongoContract` to follow ADRs 1-3:
- Add `roots` section (ORM entry points → model names)
- Change `model.fields` to records of `{ nullable, codecId }` (domain metadata)
- Restructure `model.storage` as the family-specific bridge (collection name + field → codec mappings)
- Add `discriminator` + `variants` on base models; `base` on variant models
- Add relation `strategy` (`"reference"` | `"embed"`)

Hand-craft `contract.json` + `contract.d.ts` for the [SaaS task management schema](example-schemas.md#3-saas-task-management-with-polymorphism) — Task (polymorphic: Bug/Feature) with User, including at least one embedded relation.

### Minimal ORM client

**In scope:**
- **Root-based accessors** — `db.tasks`, `db.users` derived from the `roots` section
- **`findMany`** with basic equality filters — consistent with the SQL ORM's query interface (structured filter objects, not Mongo dot notation)
- **`include` for referenced relations** — proves relations with `"strategy": "reference"` carry enough info for `$lookup` or multi-query stitching
- **`include` for embedded relations** — proves relations with `"strategy": "embed"` work with embedded documents that have no collection of their own
- **Polymorphic queries** — querying `db.tasks` returns a union of Task | Bug | Feature, narrowed by discriminator

**Out of scope:**
- Writes (`create`, `update`, `delete`)
- Complex filters (`$gt`, `$in`, logical operators)
- `orderBy`, pagination (`take`/`skip`), `select` (field projection)
- Custom collection classes or methods
- Aggregation pipeline DSL

### Cross-family contract symmetry

Hand-craft the same domain model as both a Mongo contract and a SQL contract using the new structure. Prove that the domain level (`roots`, `models`, `relations`) is identical — only `model.storage` and top-level `storage` differ.

### Done when

- A Mongo ORM client presents root-based accessors derived from the contract's `roots` section
- `findMany` returns correctly-typed rows with types inferred from the contract
- `include` traverses both referenced and embedded relations
- Querying a polymorphic collection returns a discriminated union, narrowable by the discriminator field
- The same domain model compiles as both a Mongo contract and a SQL contract with identical `roots`, `models`, and `relations`

## Later: Phase 4 — Full ORM client

Build the full `findMany`/`create`/`update`/`where`/`include` surface. This is where the hard ORM design questions get answered:
- [Design question #4](design-questions.md#4-update-operators-shared-orm-surface-vs-mongo-native-operations): What mutation surface does the ORM expose for `$inc`, `$push`, `$pull`?
- [Design question #7](design-questions.md#7-relation-loading-application-level-joining-vs-lookup): Detailed `include` strategy — when to use `$lookup` vs application stitching?
- Where do current SQL-oriented assumptions in `Collection` break?
- What would a shared `Collection` interface look like?

## Later: Phase 5 — Emitter and authoring

Generalize the emission pipeline for Mongo. Prove that PSL or TypeScript authoring surfaces can produce the redesigned contract structure.

---

## Architectural risks

The [design questions](design-questions.md) document has the full analysis and [ADRs](../adrs/) document the resolved decisions. Summary:

### Resolved

- **[#10 — Shared contract surface](design-questions.md#10-shared-contract-surface-what-goes-in-contractbase)**: **Resolved** via [ADR 1](../adrs/ADR%201%20-%20Contract%20domain-storage%20separation.md). The domain level (`roots`, `models`, `relations`) is the shared surface. Divergence is scoped to `model.storage`.
- **[#1 — Embedded documents](design-questions.md#1-embedded-documents-relation-field-or-distinct-concept)**: **Resolved** via [ADR 3](../adrs/ADR%203%20-%20Aggregate%20roots%20and%20relation%20strategies.md). Embedding is a relation property (`"strategy": "embed"`). Remaining detail: relation storage specifics for embedding.
- **[#6 — Polymorphism](design-questions.md#6-polymorphism-and-discriminated-unions-validate-in-april)**: **Resolved** via [ADR 2](../adrs/ADR%202%20-%20Polymorphism%20via%20discriminator%20and%20variants.md). `discriminator` + `variants` on base models, `base` on variants (bidirectional navigation), emergent persistence strategy. Uses specialization/generalization terminology. Remaining: polymorphic associations. **Implementation validation in Phase 3.**
- **[#3 — ExecutionPlan generalization](design-questions.md#3-execution-plan-generalization)**: **Resolved.** Each family gets its own plan type, plugin interface, and runtime. See [mongo-execution-components.md](mongo-execution-components.md).

### Open — addressed in Phase 3

- **[#7 — Relation loading](design-questions.md#7-relation-loading-application-level-joining-vs-lookup)**: How does `include` work for referenced vs embedded relations? Phase 3's minimal ORM client will prove at least one approach for each.

### Open — deferred to Phase 4+

- **[#4 — Update operators](design-questions.md#4-update-operators-shared-orm-surface-vs-mongo-native-operations)**: Mutation surface for `$inc`, `$push`, `$pull`. Deferred to Phase 4 (writes).
- **[#8 — Aggregation pipeline](design-questions.md#8-aggregation-pipeline-dsl-scope-and-timing)**: Compilation target for complex queries. Deferred beyond PoC.
- **[#9 — Change streams](design-questions.md#9-change-streams-and-the-runtimes-execution-model)**: Streaming lifecycle. Validated in SQL runtime workstream ([VP5](../../april-milestone.md#3-runtime-pipeline-orm-query-builders-middleware-framework-integration)).
- **[#2 — Referential integrity](design-questions.md#2-referential-integrity-enforcement)**: Application-level enforcement. Deferred to Phase 4.
- **[#5 — Read-time validation](design-questions.md#5-schema-validation-and-read-time-guarantees)**: Schema mismatch handling. Deferred.
- **[#11 — Introspection](design-questions.md#11-introspection-generating-a-contract-from-an-existing-database)**: Table-stakes for adoption but out of scope.
- **[#12 — Extension packs](design-questions.md#12-mongodb-specific-extension-packs)**: Extension pack interface for Mongo features. Deferred.
- **[#14 — Schema evolution](design-questions.md#14-schema-evolution-as-data-migration-cross-workstream)**: Cross-workstream dependency. Deferred.

---

## Reference material

- [ADRs](../adrs/) — contract redesign decisions with full reasoning
- [Execution components](mongo-execution-components.md) — execution pipeline components
- [Contract symmetry](contract-symmetry.md) — where Mongo and SQL contracts converge and diverge
- [Cross-cutting learnings](../cross-cutting-learnings.md) — design principles and insights affecting the framework core
- [Example schemas](example-schemas.md) — concrete MongoDB schemas with speculative PSL and query patterns
- [Design questions](design-questions.md) — open architectural questions
- [User promise](user-promise.md) — what we're promising Mongo users
- [MongoDB idioms](../9-references/mongo-idioms.md) — patterns the PoC should accommodate
- [MongoDB primitives reference](../9-references/mongodb-primitives-reference.md) — data model and query semantics
