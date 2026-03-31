# MongoDB PoC — Plan

## Goal

Validate that the Prisma Next architecture can accommodate a non-SQL database family. The primary deliverable is a working ORM client that reads data from MongoDB with type inference, relationship traversal (both referenced and embedded), and polymorphic queries — all driven by a contract structure that follows the domain/storage separation design ([ADR 172](../../../architecture%20docs/adrs/ADR%20172%20-%20Contract%20domain-storage%20separation.md), [ADR 173](../../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md), [ADR 174](../../../architecture%20docs/adrs/ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md)).

## Approach

### Consumption-first, execution-inward

Start from the **consumer end** — not the authoring/emission end. Build the execution path first (runtime, driver), then the contract, then the ORM client.

The existing runtime (`RuntimeCoreImpl`) is hardcoded to SQL. The first thing needed was a Mongo-specific execution pipeline: `MongoQueryPlan`, `MongoDriver`, `MongoRuntimeCore`. This is now **complete** (Phase 1).

With the execution path proven, the contract redesign discussion ([ADRs](../../../architecture%20docs/adrs/)) established the contract structure. The next step is to implement that structure and build a minimal ORM client that consumes it — proving the contract carries enough information for the ORM to do its job.

**Deferred from the PoC, but in-scope for April:**
- Emitter pipeline generalization — the authoring surfaces and emission process are coupled to SQL; this must be proven for Mongo before end of April
- Shared ORM interface extraction — extracted after both ORM clients use the shared Collection chaining API. See [ADR 175](../../../architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md).
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

The contract hierarchy follows the domain/storage separation from [ADR 172](../../../architecture%20docs/adrs/ADR%20172%20-%20Contract%20domain-storage%20separation.md):
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

### Phase 1: Execution pipeline *(done)*

Built the minimal execution path from hardcoded queries to rows returned from a real MongoDB instance.

Deliverables:
- **`MongoQueryPlan`** — pairs a `MongoCommand` (discriminated union: `FindCommand`, `InsertOneCommand`, `UpdateOneCommand`, `DeleteOneCommand`, `AggregateCommand`) with `PlanMeta`.
- **`MongoDriver`** — wraps the `mongodb` Node.js driver, dispatches commands to the correct driver method, returns `AsyncIterable<Document>`.
- **`MongoRuntimeCore`** — validates the plan, calls the driver, wraps results in `AsyncIterableResult<Row>`.
- **`MongoCodecRegistry`** — base codecs (`objectId`, `string`, `int32`, `boolean`, `date`) following the SQL registry shape.
- **`MongoContract`** (initial version) — independent of `SqlContract`, structurally parallel. Proved that contract-driven type inference works.
- **Test infrastructure** — `mongodb-memory-server` for a real `mongod` in tests.

Key learnings from this phase led to the contract redesign discussion, documented in [ADRs](../../../architecture%20docs/adrs/) and [cross-cutting-learnings.md](../cross-cutting-learnings.md).

### Phase 2: Contract redesign *(done — design only)*

The contract structure was redesigned through design discussion, informed by what the execution pipeline and initial contract revealed. The result is documented in three ADRs:

- [ADR 172 — Contract domain-storage separation](../../../architecture%20docs/adrs/ADR%20172%20-%20Contract%20domain-storage%20separation.md) — `model.fields` (domain) vs `model.storage` (family-specific bridge)
- [ADR 173 — Polymorphism via discriminator and variants](../../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md) — emergent persistence strategy
- [ADR 174 — Aggregate roots and relation strategies](../../../architecture%20docs/adrs/ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md) — explicit `roots`, embedding as a relation property

### Phase 3: Minimal ORM client with contract validation *(done)*

Implemented the redesigned contract structure and built a minimal ORM client proving the contract carries enough information for polymorphism, embedded documents, referenced relations, and type inference.

Deliverables:
- **`validateMongoContract()`** — three-layer validation: structural (Arktype), domain (family-agnostic), storage (Mongo-specific). Produces computed indices (variant-to-base, model-to-variants). Reusable domain validation for SQL.
- **`mongoOrm()`** — ORM client with root-based accessors derived from `roots` section, typed `findMany` with equality filters, `$lookup` includes for referenced relations, auto-projected embedded documents, polymorphic return types with discriminator narrowing.
- **Contract restructure** — `MongoContract` follows ADRs 1-3: `roots`, `model.fields` as `{ nullable, codecId }`, `model.storage` with collection name, `discriminator`/`variants`/`base`, relation `strategy` (`reference`/`embed`).
- **7 integration tests** covering findMany, filters, includes, embeds, polymorphism, and end-to-end flow against `mongodb-memory-server`.
- All acceptance criteria met.

Key learning: a comparative analysis with the SQL ORM client revealed the `Collection` chaining API is a shared architectural pattern across families. This led to [ADR 175](../../../architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md) — the Mongo ORM will adopt the same fluent chaining API (`.where().select().include().take().all()`) as the SQL ORM, with family-specific compilation at terminal methods.

## PoC conclusion

The PoC has achieved its goal: **validating that the Prisma Next architecture can accommodate a non-SQL database family.** The architecture generalizes. The remaining work is integration — landing the learnings into the shared codebase — not further architectural validation.

### What was validated

**The execution pipeline generalizes (Phase 1).** Each family gets its own plan type, driver, and runtime. The plugin lifecycle (`beforeExecute → onRow → afterExecute`) and metadata (`PlanMeta`) are shared; the plan content and driver dispatch are family-specific. No changes to the framework layer were needed.

**The contract structure generalizes (Phase 2 + 3).** The domain/storage separation works: `roots`, `models` (with `fields`/`discriminator`/`variants`/`base`), and `relations` are structurally identical across families. Only `model.storage` differs — and the divergence is narrow and justified (SQL has field-to-column indirection; Mongo doesn't). Placing `codecId` and `nullable` on `model.fields` makes the domain section self-describing. This is documented in ADRs 1-3.

**The ORM consumer surface is a shared pattern (Phase 3 + analysis).** The `Collection` class with fluent chaining, `CollectionState` as accumulated query state, row type inference from `model.fields[f].codecId`, `include` with cardinality-aware coercion, and custom collection subclasses — all shared patterns. Family-specific concerns are cleanly bounded to terminal method compilation and include resolution strategy. Documented in ADR 4.

**Contract validation works with redundancy (Phase 3).** `validateMongoContract()` proved that three-layer validation (structural, domain, storage) handles the intentional redundancy in the contract. The domain validation layer is family-agnostic and reusable for SQL.

**Polymorphism works end-to-end (Phase 3).** `discriminator` + `variants` + `base` in the contract, polymorphic return types as discriminated unions with literal narrowing, and STI enforcement in Mongo storage validation — all validated with type-level and integration tests.

**Embedded documents work without loading (Phase 3).** Relations with `"strategy": "embed"` auto-project into the parent row. No `include` needed, no separate query, correct type inference.

### What remains — open design questions

These are design refinement, not existential risks:

- **[#4 — Update operators](design-questions.md#4-update-operators-shared-orm-surface-vs-mongo-native-operations)**: How the ORM mutation surface accommodates `$inc`, `$push`, `$pull`. No SQL equivalent — needs family-specific extensions or separate methods.
- **[#2 — Referential integrity](design-questions.md#2-referential-integrity-enforcement)**: Application-level enforcement of cascading deletes, restrict constraints. Mongo has no DB-level support.
- **[#5 — Read-time validation](design-questions.md#5-schema-validation-and-read-time-guarantees)**: What happens when a document doesn't match the contract.
- **[#8 — Aggregation pipeline](design-questions.md#8-aggregation-pipeline-dsl-scope-and-timing)**: The escape-hatch query surface for Mongo (symmetric to the SQL query builder).
- **[#9 — Change streams](design-questions.md#9-change-streams-and-the-runtimes-execution-model)**: Streaming lifecycle. Being validated in the SQL runtime workstream via Supabase Realtime.
- **Value objects**: `Address` currently sits in `models` with `storage: {}`. Needs a dedicated value objects section. See [cross-cutting-learnings.md § 5](../cross-cutting-learnings.md).
- **Polymorphic associations**: Polymorphism on relations (a Comment belonging to Post or Video). No contract representation yet.
- **Discriminator values are untyped strings**: The contract stores discriminator values as strings, but something must convert them to native DB values. Affects column defaults too. See [ADR 173 open questions](../../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md).
- **Row type naming**: `InferFullRow` (Mongo) vs `DefaultModelRow` (SQL). Needs resolution when extracting the shared contract base. See [cross-cutting-learnings.md open questions](../cross-cutting-learnings.md).

### What comes next — integration, not more PoC

The remaining risks are **integration risks**, not architectural ones:

1. **Contract shape transition.** The emitter and `validateContract()` can be updated to produce the new contract shape — this is mechanical, not risky. But the longer the current SQL-centric shape hardens in consumers (ORM client, query builder, demo app), the more call sites need updating.

2. **Authoring surface alignment.** The PSL/TS contract DSL workstream is actively shaping what users write. If the authoring surface stabilizes around SQL idioms (no `roots`, no `discriminator`/`variants`, no embed/reference strategy on relations), it will be expensive to retrofit. The emitter can always transform what the DSL produces, but the gap between DSL concepts and contract concepts should be small, not a translation layer. This requires coordination with the authoring workstream.

3. **ORM client structure.** The SQL ORM client is actively being refined. It currently consumes the existing `SqlContract` shape (with `mappings`, model-to-table indirection). Moving it to the new contract shape (where `model.fields` carries `codecId` and `nullable` directly) has high value — it pins the ORM to the right structure — but requires coordination with the ORM workstream to avoid conflicts.

4. **`ContractBase` extraction.** The domain level is proven to be structurally identical across families, but the actual `ContractBase` type hasn't been extracted. This is a prerequisite for cross-family consumer validation and for the emitter to produce a family-agnostic domain section.

These are coordination problems, not technical unknowns. The PoC's job — proving the architecture generalizes — is done.

---

## Architectural risks

The [design questions](design-questions.md) document has the full analysis and [ADRs](../../../architecture%20docs/adrs/) document the resolved decisions. Summary:

### Resolved

- **[#10 — Shared contract surface](design-questions.md#10-shared-contract-surface-what-goes-in-contractbase)**: **Resolved** via [ADR 172](../../../architecture%20docs/adrs/ADR%20172%20-%20Contract%20domain-storage%20separation.md). The domain level (`roots`, `models`, `relations`) is the shared surface. Divergence is scoped to `model.storage`.
- **[#1 — Embedded documents](design-questions.md#1-embedded-documents-relation-field-or-distinct-concept)**: **Resolved** via [ADR 174](../../../architecture%20docs/adrs/ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md). Embedding is a relation property (`"strategy": "embed"`). Remaining detail: relation storage specifics for embedding.
- **[#6 — Polymorphism](design-questions.md#6-polymorphism-and-discriminated-unions-validate-in-april)**: **Resolved** via [ADR 173](../../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md). `discriminator` + `variants` on base models, `base` on variants (bidirectional navigation), emergent persistence strategy. Uses specialization/generalization terminology. Remaining: polymorphic associations. **Validated in Phase 3** — discriminator narrowing, polymorphic return types, and STI constraint all proven.
- **[#3 — ExecutionPlan generalization](design-questions.md#3-execution-plan-generalization)**: **Resolved.** Each family gets its own plan type, plugin interface, and runtime. See [mongo-execution-components.md](mongo-execution-components.md).
- **[#7 — Relation loading](design-questions.md#7-relation-loading-application-level-joining-vs-lookup)**: **Resolved in Phase 3.** Referenced relations use `$lookup` aggregation pipeline stages with `$unwind` for to-one cardinalities. Embedded relations are auto-projected — they're always present in the document, so no loading is needed. The `include` interface is shared across families; the resolution strategy differs (SQL: lateral joins / correlated subqueries; Mongo: `$lookup`).

### Open — deferred beyond PoC

- **[#4 — Update operators](design-questions.md#4-update-operators-shared-orm-surface-vs-mongo-native-operations)**: Mutation surface for `$inc`, `$push`, `$pull`.
- **[#8 — Aggregation pipeline](design-questions.md#8-aggregation-pipeline-dsl-scope-and-timing)**: Compilation target for complex queries.
- **[#9 — Change streams](design-questions.md#9-change-streams-and-the-runtimes-execution-model)**: Streaming lifecycle. Validated in SQL runtime workstream ([VP5](../../april-milestone.md#3-runtime-pipeline-orm-query-builders-middleware-framework-integration)).
- **[#2 — Referential integrity](design-questions.md#2-referential-integrity-enforcement)**: Application-level enforcement.
- **[#5 — Read-time validation](design-questions.md#5-schema-validation-and-read-time-guarantees)**: Schema mismatch handling.
- **[#11 — Introspection](design-questions.md#11-introspection-generating-a-contract-from-an-existing-database)**: Table-stakes for adoption but out of scope.
- **[#12 — Extension packs](design-questions.md#12-mongodb-specific-extension-packs)**: Extension pack interface for Mongo features.
- **[#14 — Schema evolution](design-questions.md#14-schema-evolution-as-data-migration-cross-workstream)**: Cross-workstream dependency.

---

## Reference material

- [ADRs](../../../architecture%20docs/adrs/) — contract redesign decisions with full reasoning
- [Execution components](mongo-execution-components.md) — execution pipeline components
- [Contract symmetry](contract-symmetry.md) — where Mongo and SQL contracts converge and diverge
- [Cross-cutting learnings](../cross-cutting-learnings.md) — design principles and insights affecting the framework core
- [Example schemas](example-schemas.md) — concrete MongoDB schemas with speculative PSL and query patterns
- [Design questions](design-questions.md) — open architectural questions
- [User promise](../../../reference/mongodb-user-promise.md) — what we're promising Mongo users
- [MongoDB idioms](../../../reference/mongodb-idioms.md) — patterns the PoC should accommodate
- [MongoDB primitives reference](../../../reference/mongodb-primitives-reference.md) — data model and query semantics
