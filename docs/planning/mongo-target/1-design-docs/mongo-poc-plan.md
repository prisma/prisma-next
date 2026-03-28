# MongoDB PoC — Plan

## Goal

Validate that the Prisma Next architecture can accommodate a non-SQL database family. The primary deliverable is a working end-to-end path: hand-crafted contract → ORM client → query execution against a real MongoDB instance.

## Approach

### Consumption-first, execution-inward

Start from the **consumer end** — not the authoring/emission end. But within the consumer side, start from **execution** (the runtime and driver), not the contract.

Why: the existing runtime (`RuntimeCoreImpl`) is hardcoded to SQL. It calls `queryable.execute({ sql: plan.sql, params })` — the `Queryable` interface takes `{ sql: string, params: unknown[] }`, `ExecutionPlan` has a `sql: string` field, and the `MarkerReader` SPI returns SQL statements. You can't hand-craft a Mongo contract and plug it into the existing execution machinery. The first thing that needs to exist is a `MongoQueryPlan`, a `MongoDriver` wrapping the `mongodb` Node.js driver, and enough runtime glue to execute a query and get rows back. Once that works, the contract shape is informed by what the runtime and ORM client actually need — not guessed in advance.

The contract shape is still driven by what the query client needs (not what the authoring layer produces), but the query client's needs are discovered by building the execution path first.

**Deferred from the initial PoC steps** (steps 1–3), but in-scope for April:
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

The framework requires a `familyId` on every component (family, target, adapter, driver, extension). The question is whether MongoDB sits under a "document" family (analogous to how Postgres sits under "sql") or whether "mongo" IS the family.

**Decision: `familyId: 'mongo'`, not `familyId: 'document'`.**

The SQL family abstraction earns its keep because SQL databases genuinely share a common interface: the SQL query language, the relational model, and query semantics (joins, GROUP BY, WHERE). You can build a SQL query builder and swap Postgres for MySQL with a dialect adapter.

There is no equivalent shared interface for "document databases." MongoDB and Firestore don't share a query language, don't share a data organization model (flat collections + embedded docs vs. hierarchical subcollections), and don't share query capabilities (aggregation pipeline vs. constrained queries). A "document family" abstraction would contain very little that isn't either trivially generic or actually MongoDB-specific. If Firestore came later, it would be its own family — `familyId: 'firestore'` — not a sibling target under `familyId: 'document'`.

The contract hierarchy is:
```
ContractBase (shared: models, fields, relations, capabilities)
├── SqlContract (SQL storage: tables, columns, mappings)
│   └── Targets: Postgres, MySQL, SQLite...
└── MongoContract (Mongo storage: collections, embedded docs, mappings)
    └── Target: MongoDB
```

### Spike then extract

Build a `mongo-orm-client` package that is **completely independent** of `sql-orm-client`. No shared base class, no imports from the SQL ORM, no predicted abstractions. Own `Collection` class, own query compilation, own mutation handling, own type plumbing.

After the PoC produces a working Mongo ORM, compare the two implementations and extract the common interface. The abstraction should be discovered from two concrete implementations, not predicted from one.

The one area where full independence isn't practical is the **contract types**. The contract is the input to both ORM clients — both need to consume `ContractBase` at minimum. The Mongo contract types may start inside the new package and be promoted later.

## Steps

### 1. Minimal executable slice

Build the thinnest possible path from a hardcoded query to rows returned from a real MongoDB instance. No contract, no ORM — just execution machinery.

Concrete deliverables:
- **`MongoQueryPlan`** — the Mongo equivalent of `ExecutionPlan`. Instead of `{ sql: string, params: unknown[] }`, this carries a Mongo command (collection name, operation type, filter/projection/pipeline). Shares `PlanMeta` with the SQL family.
- **`MongoDriver`** — wraps the `mongodb` Node.js driver. Implements a Mongo-specific `execute()` that takes a `MongoQueryPlan` and returns `AsyncIterable<Row>`.
- **`MongoRuntimeCore`** — a standalone runtime (not the SQL `RuntimeCoreImpl`) that runs the `beforeExecute → onRow → afterExecute` lifecycle against Mongo plans and the Mongo driver. May start as a thin wrapper that just calls the driver directly.
- **Test infrastructure** — [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server) for a real `mongod` in tests.

This forces concrete answers to:
- What does a Mongo query plan look like? What fields does it carry?
- Does `PlanMeta` work unchanged, or does it need family-specific extensions?
- What does the Mongo driver interface look like? How different is it from the SQL `Queryable`?

**Done when:** a test constructs a hardcoded `MongoQueryPlan` for `findMany` on a `users` collection, executes it through `MongoRuntimeCore` and `MongoDriver` against `mongodb-memory-server`, and gets correct rows back.

### 2. Contract types — work backwards from execution

Now that the execution path exists, design the contract types that the ORM client will need to produce query plans. Hand-craft `contract.json` + `contract.d.ts` for the [blog platform example schema](example-schemas.md#1-blog-platform).

This forces concrete answers to:
- [Design question #1](design-questions.md#1-embedded-documents-relation-field-or-distinct-concept): How do embedded documents appear in the contract?
- [Design question #10](design-questions.md#10-shared-contract-surface-what-goes-in-contractbase): What goes in `ContractBase` vs. family-specific extensions?
- What contract information does the ORM client need to construct `MongoQueryPlan` objects? (Now you know the plan shape from step 1.)

**Done when:** a `contract.json` and `contract.d.ts` exist that describe Users, Posts, and Comments with both embedded and referenced relationships, and the type structure contains the information needed to build `MongoQueryPlan` objects.

### 3. Scaffold the ORM client

Build a `mongo-orm-client` that reads the contract types from step 2 and produces `MongoQueryPlan` objects that execute via the runtime from step 1.

This forces concrete answers to:
- [Design question #4](design-questions.md#4-update-operators-shared-orm-surface-vs-mongo-native-operations): What mutation surface does the ORM expose?
- [Design question #7](design-questions.md#7-relation-loading-application-level-joining-vs-lookup): How does `include` work for embedded vs. referenced?
- Where do current SQL-oriented assumptions in `Collection` break? What would a shared `Collection` interface need to look like?

**Done when:** `findMany` on the blog schema's `users` collection works end-to-end: ORM client reads contract types, builds a `MongoQueryPlan`, executes it through `MongoRuntimeCore`, and returns typed results.

### 4. Broaden the query surface

Add `findFirst`, `create`, `update`, `delete`. Each tests a different part of the pipeline (mutations vs. reads, return values vs. void). This is where you discover whether the mutation executor generalizes.

### 5. Embedded document operations

Query *into* embedded documents (`where: { address: { city: "Springfield" } }`), update embedded fields, create documents with embedded data. This is the Mongo-specific surface that SQL doesn't have — where the ORM client diverges most.

### 6. Referenced relation loading

`include` across collections. Forces an answer to [design question #7](design-questions.md#7-relation-loading-application-level-joining-vs-lookup) (application-level joining vs. `$lookup`), and tests whether the relation loading machinery can work without SQL joins.

### 7. Cross-family validation

Take one existing consumer library or plugin that works with SQL contracts and run it against the document contract. Does it work? Does it typecheck? This is the actual deliverable the PoC exists to validate — that the shared surface works.

### 8. Polymorphism spike

Flagged as an [April must-prove](design-questions.md#6-polymorphism-and-discriminated-unions-validate-in-april). Take the [SaaS task management example schema](example-schemas.md#3-saas-task-management-with-polymorphism) (Bug/Feature/Chore) and get discriminated union queries working. Tests whether the contract can express it and whether the ORM can narrow types. This is a cross-family concern — the solution must work for SQL STI too.

---

## Architectural risks

The [design questions](design-questions.md) document has the full analysis. Below is a summary organized by what each risk threatens, and which ones the PoC must answer.

### Contract generalization (can the type system span both families?)

- **[#10 — Shared contract surface](design-questions.md#10-shared-contract-surface-what-goes-in-contractbase)**: `ContractBase` doesn't include models or relations today — `SqlContract` adds them. If `DocumentContract` adds its own incompatible version, consumer libraries can't be family-agnostic. This is the foundational risk. **PoC must answer.**
- **[#1 — Embedded documents](design-questions.md#1-embedded-documents-relation-field-or-distinct-concept)**: No SQL equivalent. Whatever we pick (relation with storage strategy, nested field type, or new concept) ripples through every layer. Get the contract shape wrong and everything downstream is wrong. **PoC must answer.**
- **[#6 — Polymorphism / discriminated unions](design-questions.md#6-polymorphism-and-discriminated-unions-validate-in-april)**: Cross-family concern. The contract type system needs to express it, the emitter needs to produce narrowing types, the ORM needs to query it. Neither family has this today. **PoC must answer.**

### Execution pipeline generalization (can queries flow through the same runtime?)

- **[#3 — ExecutionPlan generalization](design-questions.md#3-execution-plan-generalization)**: ~~**PoC must answer.**~~ **Resolved.** The execution plan doesn't generalize at the query level. Each family gets its own plan type, plugin interface, and runtime. Plugins are family-specific because they inspect family-specific query payloads (SQL string/AST vs. Mongo commands). The shared surface is the lifecycle pattern and metadata, not the query payload. See [execution-architecture.md](execution-architecture.md).
- **[#9 — Change streams vs. request-response lifecycle](design-questions.md#9-change-streams-and-the-runtimes-execution-model)**: The plugin pipeline assumes `beforeExecute → onRow → afterExecute`. Change streams never complete. Deferred for the Mongo PoC, but the architecture must not prevent it. Streaming is validated in the SQL runtime workstream via Supabase Realtime ([VP5](../../april-milestone.md#3-runtime-pipeline-orm-query-builders-middleware-framework-integration)); the patterns established there will inform Mongo change stream support.

### ORM surface generalization (can the query/mutation API span both families?)

- **[#4 — Update operators](design-questions.md#4-update-operators-shared-orm-surface-vs-mongo-native-operations)**: SQL is "set field = value". Mongo has `$inc`, `$push`, `$pull` — fundamentally different mutation semantics. How does the shared ORM `update()` surface accommodate both without becoming family-specific? **PoC must answer.**
- **[#7 — Relation loading](design-questions.md#7-relation-loading-application-level-joining-vs-lookup)**: SQL uses joins. Mongo uses application-level stitching or `$lookup`. The ORM's `include` needs to work for both, but the implementation is completely different. **PoC must answer.**
- **[#8 — Aggregation pipeline as compilation target](design-questions.md#8-aggregation-pipeline-dsl-scope-and-timing)**: The SQL ORM compiles to SQL strings. The Mongo ORM compiles to... what? `find()` for simple CRUD, but `$lookup` for includes, and pipelines for anything complex. The compilation target question is open.

### Data integrity in a schemaless world

- **[#2 — Referential integrity](design-questions.md#2-referential-integrity-enforcement)**: Mongo has no foreign keys. PN enforces cascades/restricts in application code — multi-step mutations, transactions for atomicity, real performance costs.
- **[#5 — Read-time validation](design-questions.md#5-schema-validation-and-read-time-guarantees)**: Documents may not match the contract. Strict mode breaks on legacy data. Permissive mode returns unvalidated data. Neither is obviously right.

### Deferred but load-bearing

- **[#11 — Introspection](design-questions.md#11-introspection-generating-a-contract-from-an-existing-database)**: Table-stakes for real Mongo adoption but out of scope. Risk: the contract model we choose now makes introspection harder later.
- **[#12 — Extension packs](design-questions.md#12-mongodb-specific-extension-packs)**: ADR 170 was designed for SQL. Mongo's differentiating features (Vector Search, Atlas Search, geo) need pipeline stages and index types the extension pack interface doesn't support yet.
- **[#14 — Schema evolution](design-questions.md#14-schema-evolution-as-data-migration-cross-workstream)**: Cross-workstream dependency. If the invariant model doesn't fit schemaless databases, the migration story for Mongo is back to square one.

---

## Reference material

- [Execution architecture](execution-architecture.md) — why the execution pipeline (plans, plugins, runtime) is family-specific
- [Example schemas](example-schemas.md) — concrete MongoDB schemas with speculative PSL and query patterns
- [Design questions](design-questions.md) — open architectural questions this PoC must answer
- [User promise](user-promise.md) — what we're promising Mongo users
- [MongoDB idioms](../9-references/mongo-idioms.md) — patterns the PoC should accommodate
- [MongoDB primitives reference](../9-references/mongodb-primitives-reference.md) — data model and query semantics
