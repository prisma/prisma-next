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
- Shared ORM interface extraction — extracted after both ORM clients use the shared Collection chaining API. See [ADR 4](../adrs/ADR%204%20-%20Shared%20ORM%20Collection%20interface.md).
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

### Phase 3: Minimal ORM client with contract validation *(done — [mongo-orm-poc](../../../../projects/mongo-orm-poc/spec.md))*

Implemented the redesigned contract structure and built a minimal ORM client proving the contract carries enough information for polymorphism, embedded documents, referenced relations, and type inference.

Deliverables:
- **`validateMongoContract()`** — three-layer validation: structural (Arktype), domain (family-agnostic), storage (Mongo-specific). Produces computed indices (variant-to-base, model-to-variants). Reusable domain validation for SQL.
- **`mongoOrm()`** — ORM client with root-based accessors derived from `roots` section, typed `findMany` with equality filters, `$lookup` includes for referenced relations, auto-projected embedded documents, polymorphic return types with discriminator narrowing.
- **Contract restructure** — `MongoContract` follows ADRs 1-3: `roots`, `model.fields` as `{ nullable, codecId }`, `model.storage` with collection name, `discriminator`/`variants`/`base`, relation `strategy` (`reference`/`embed`).
- **7 integration tests** covering findMany, filters, includes, embeds, polymorphism, and end-to-end flow against `mongodb-memory-server`.
- All acceptance criteria met. See [code review](../../../../projects/mongo-orm-poc/reviews/code-review.md).

Key learning: a comparative analysis with the SQL ORM client revealed the `Collection` chaining API is a shared architectural pattern across families. This led to [ADR 4](../adrs/ADR%204%20-%20Shared%20ORM%20Collection%20interface.md) — the Mongo ORM will adopt the same fluent chaining API (`.where().select().include().take().all()`) as the SQL ORM, with family-specific compilation at terminal methods.

## Next: Phase 4 — ORM client with shared Collection interface

Reimplement the Mongo ORM client with the SQL ORM's fluent chaining API pattern, following [ADR 4](../adrs/ADR%204%20-%20Shared%20ORM%20Collection%20interface.md). The Phase 3 options-bag API (`findMany({ where, include })`) proved the contract shape works; Phase 4 adopts the target API design.

### Goal

A Mongo `Collection` class that mirrors the SQL ORM's chaining surface: `.where().select().include().orderBy().take().skip().all().first()`. The implementation uses `CollectionState` to accumulate query state through immutable method chaining, compiling to `MongoQueryPlan` at terminal methods (`.all()`, `.first()`).

### In scope

- **Chaining Collection class** — immutable method chaining with `CollectionState` accumulation. Terminal methods compile state → `MongoQueryPlan` (FindCommand or AggregateCommand).
- **`where`** — callback DSL (`(task) => task.assigneeId.eq('u1')`) and shorthand equality objects. Common comparison operators (eq, neq, gt, lt, gte, lte, in, isNull).
- **`select`** — field projection, narrowing the return type.
- **`include`** — referenced relations via `$lookup`, with refinement callbacks. Embedded relations remain auto-projected.
- **`orderBy`** — callback DSL with asc/desc.
- **`take`/`skip`** — pagination.
- **`all`/`first`** — terminal methods returning `AsyncIterableResult<Row>` / `Promise<Row | null>`.
- **Custom collection subclasses** — `class UserCollection extends Collection<Contract, 'User'>` with domain methods.
- **Polymorphic return types** — discriminated union narrowing, same as Phase 3.

### Out of scope

- Writes (`create`, `update`, `delete`, `upsert`)
- Mongo-specific operators (`$regex`, `$elemMatch`, `$exists`)
- `groupBy`, `aggregate`, `distinct`, `cursor`
- Shared interface extraction into `1-framework` (deferred to spike-then-extract)
- Aggregation pipeline DSL

### Design questions addressed

- [Design question #4](design-questions.md#4-update-operators-shared-orm-surface-vs-mongo-native-operations): What mutation surface does the ORM expose for `$inc`, `$push`, `$pull`? *(deferred — Phase 4 is reads only)*
- Where comparison DSL generalizes: which operators are shared (eq, neq, gt, lt) vs family-specific (ilike, $regex)?
- How does `CollectionState` → `MongoQueryPlan` compilation work? (FindCommand for simple queries, AggregateCommand when includes or complex operations are needed)

### Done when

- A Mongo `Collection` class with fluent chaining API matching the SQL ORM's method vocabulary
- `where` with callback DSL and shorthand equality objects
- `select` with field projection narrowing the return type
- `include` for referenced relations with refinement callbacks
- `orderBy`, `take`, `skip` with correct compilation
- `all` and `first` terminal methods
- Custom collection subclasses work (domain methods that chain via `this.where()`)
- Polymorphic return types with discriminator narrowing

## Later: Phase 5 — Emitter and authoring

Generalize the emission pipeline for Mongo. Prove that PSL or TypeScript authoring surfaces can produce the redesigned contract structure.

---

## Architectural risks

The [design questions](design-questions.md) document has the full analysis and [ADRs](../adrs/) document the resolved decisions. Summary:

### Resolved

- **[#10 — Shared contract surface](design-questions.md#10-shared-contract-surface-what-goes-in-contractbase)**: **Resolved** via [ADR 1](../adrs/ADR%201%20-%20Contract%20domain-storage%20separation.md). The domain level (`roots`, `models`, `relations`) is the shared surface. Divergence is scoped to `model.storage`.
- **[#1 — Embedded documents](design-questions.md#1-embedded-documents-relation-field-or-distinct-concept)**: **Resolved** via [ADR 3](../adrs/ADR%203%20-%20Aggregate%20roots%20and%20relation%20strategies.md). Embedding is a relation property (`"strategy": "embed"`). Remaining detail: relation storage specifics for embedding.
- **[#6 — Polymorphism](design-questions.md#6-polymorphism-and-discriminated-unions-validate-in-april)**: **Resolved** via [ADR 2](../adrs/ADR%202%20-%20Polymorphism%20via%20discriminator%20and%20variants.md). `discriminator` + `variants` on base models, `base` on variants (bidirectional navigation), emergent persistence strategy. Uses specialization/generalization terminology. Remaining: polymorphic associations. **Validated in Phase 3** — discriminator narrowing, polymorphic return types, and STI constraint all proven.
- **[#3 — ExecutionPlan generalization](design-questions.md#3-execution-plan-generalization)**: **Resolved.** Each family gets its own plan type, plugin interface, and runtime. See [mongo-execution-components.md](mongo-execution-components.md).
- **[#7 — Relation loading](design-questions.md#7-relation-loading-application-level-joining-vs-lookup)**: **Resolved in Phase 3.** Referenced relations use `$lookup` aggregation pipeline stages with `$unwind` for to-one cardinalities. Embedded relations are auto-projected — they're always present in the document, so no loading is needed. The `include` interface is shared across families; the resolution strategy differs (SQL: lateral joins / correlated subqueries; Mongo: `$lookup`).

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
