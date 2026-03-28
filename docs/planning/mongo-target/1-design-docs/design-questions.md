# MongoDB Work Stream — Open Design Questions

Design questions surfaced during the exploration of MongoDB primitives and their mapping to Prisma Next's architecture. These are questions where the answer is non-obvious, involves real trade-offs, or requires spiking to resolve. Grouped by theme.

See also: [mongodb-primitives-reference.md](../9-references/mongodb-primitives-reference.md), [mongo-poc-plan.md](mongo-poc-plan.md), [user-promise.md](user-promise.md)

**External input**: The MongoDB Node.js Driver team provided a [feature gap analysis](../9-references/Prisma_MongoDB_%20Feature%20support%20priority%20list%20-%20Sheet1.csv) and a [user journey narrative](../9-references/MongoDB-Prisma_%20User%20journey%20&%20Feature%20gaps.md). Where their priorities or observations surface new tensions, they're noted inline.

---

## 1. Embedded documents: relation, field, or distinct concept?

MongoDB's idiomatic data model puts related data *inside* the parent document — either as a single subdocument (1:1) or an array of subdocuments (1:N). This has no SQL equivalent.

**The question**: How does the PN contract model represent embedded documents?

Options:
- **As relations with a storage strategy.** The contract declares a `User → Address` relation (just like SQL), and the storage layer says "this relation is embedded, not referenced." The ORM then knows whether to embed in one query or `$lookup` / multi-query. This keeps the domain model (relations) separate from the storage decision (embed vs. reference).
- **As nested field types.** `Address` is a structured field type on `User`, not a separate model. No relation exists — it's just a complex field. Simpler, but loses the ability to query `Address` independently or change the storage strategy later.
- **As a distinct concept.** Neither a relation nor a plain field — something new in the contract schema. Most flexible but adds a new concept that consumer libraries must understand.

Tensions:
- If embedded documents are relations, then a `User` model with an embedded `Address` and a referenced `Post` both appear in the relation graph — but they have profoundly different query and atomicity semantics. Consumer libraries traversing relations would need to know which are embedded.
- If embedded documents are *not* relations, then the shared model/relation surface (the cross-family contract) can't express the full document structure. A consumer library generating a JSON Schema would miss embedded types.
- Embedded subdocument arrays blur the line: `comments: Comment[]` embedded in a `Post` looks like a 1:N relation, but `Comment` doesn't have its own collection, can't be queried independently, and has no `_id` (unless the app adds one).

**What we need to decide before implementing**: Whether `ContractBase`'s relation graph includes embedded documents. This affects every layer downstream — authoring, emitter, ORM client, and consumer libraries.

---

## 2. Referential integrity enforcement

MongoDB provides **no foreign key constraints, no cascading deletes, no referential integrity guarantees**. Every reference is a manual link that the application must maintain.

**The question**: What level of referential integrity does PN enforce for document databases, and where in the stack?

Sub-questions:
- **Cascading deletes**: When the user deletes a `User`, should PN automatically delete or nullify their `Post` references? The SQL ORM already orchestrates multi-statement cascades in `mutation-executor.ts` — the Mongo equivalent would issue `deleteMany` / `updateMany` on related collections. But Mongo's single-document atomicity means embedded deletes are atomic (no cascade needed), while cross-collection cascades are not atomic without a multi-document transaction.
- **Orphan prevention**: Should PN reject a delete if it would create dangling references (the SQL `RESTRICT` equivalent)? This requires a read-before-delete check.
- **Relation semantics in the contract**: The contract can declare `onDelete: cascade | restrict | setNull | noAction`. For SQL, the database enforces these. For Mongo, PN must enforce them. Does the contract express the same semantics for both families, with enforcement location being an implementation detail?

Tensions:
- Enforcement adds real value (this is one of the strongest reasons to use PN with Mongo). But it also means PN mutations become multi-step (read references → delete/update → delete target), which is slower and requires multi-document transactions for atomicity on cross-collection operations.
- Users who chose Mongo for its flexibility may not want PN enforcing constraints they didn't ask for. This suggests the enforcement level should be configurable (per-relation or globally).

---

## 3. Execution plan generalization *(resolved)*

The runtime's `ExecutionPlan` currently has `sql: string` and `params: unknown[]`. The runtime core passes `{ sql: plan.sql, params: plan.params }` to the driver's `execute` method.

**The question**: How does the execution plan generalize to accommodate non-SQL query shapes?

**Answer: it doesn't generalize at the query level. Each family has its own plan type, plugin interface, and runtime.** The shared surface is the plugin lifecycle (beforeExecute → onRow → afterExecute) and metadata (`PlanMeta`), not the query payload.

Analysis of the existing SQL plugins proves that generalization is impractical:
- The **budgets plugin** reads `plan.sql`, calls `driver.explain({ sql, params })`, and parses the SQL string to detect SELECT statements.
- The **lints plugin** checks `plan.ast instanceof QueryAst` and pattern-matches on SQL AST node types (`DeleteAst`, `UpdateAst`, `SelectAst`).

Any generalization of `ExecutionPlan` (union type, generic type parameter, or base type) either forces every plugin to branch on family, strips the plan to useless metadata, or adds complexity without enabling reuse. Plugins do useful work by inspecting family-specific query payloads — that work is inherently family-specific.

The Mongo PoC will build its own `MongoQueryPlan`, `MongoRuntimeCore`, `MongoPlugin`, and `MongoDriver`. Cross-family plugins that only need timing/metadata can be extracted after both runtimes exist.

See [mongo-execution-components.md](mongo-execution-components.md) for the component breakdown and rationale.

---

## 4. Update operators: shared ORM surface vs. Mongo-native operations

SQL updates are "set field = value" operations. MongoDB updates use operators (`$set`, `$inc`, `$push`, `$pull`, `$addToSet`, etc.) that express field-level mutations.

**The question**: How does the ORM mutation surface accommodate Mongo's update operators?

Layers:
- **Basic updates map naturally.** `db.users.where({ id }).update({ name: "Bob" })` → `{ $set: { name: "Bob" } }`. This works today with the shared ORM interface.
- **Atomic operators are Mongo-native.** `$inc` (increment without read-modify-write), `$push` (append to array), `$pull` (remove from array), `$addToSet` (append unique) — these have no SQL equivalent and express operations that are fundamentally different from "set field = value."

Options:
- **Shared ORM surface only**: The ORM's `update()` method always takes a plain data object. The Mongo adapter translates `{ views: 1 }` into `{ $set: { views: 1 } }`. Atomic operators are not exposed — users who want `$inc` must use a lower-level escape hatch (raw commands or a document query DSL).
- **Family-specific ORM extensions**: The document ORM client's `update()` accepts an extended input type with operator helpers: `{ views: { $inc: 1 }, tags: { $push: "new" } }`. The shared interface still accepts plain data; the extensions are additive.
- **Separate mutation methods**: `db.users.where({ id }).increment({ views: 1 })`, `db.users.where({ id }).push("tags", "new")`. Mongo-native operations become explicit ORM methods.

Tensions:
- Atomic operators are a major part of the Mongo-native experience. `$inc` avoids a read-modify-write cycle and is one of Mongo's key advantages for high-contention data. Not exposing these through the ORM would be a significant DX gap.
- But extending the shared ORM interface with Mongo-specific operators means the interface is no longer truly shared. Consumer libraries that generate mutations would need to know about document-specific update shapes.
- The SQL ORM already has family-specific behavior (e.g. `RETURNING` clause, upsert conflict resolution). Update operators may be another case of "shared interface, family-specific extensions."

---

## 5. Schema validation and read-time guarantees

MongoDB doesn't enforce types — a field declared as `number` in the contract might contain a string in the database. Documents may not match the contract for many reasons: pre-existing data, direct writes bypassing PN, schema evolution.

**The question**: What does PN guarantee about data returned from reads?

Options:
- **Validate on read, error on mismatch (strict)**: Reject documents that don't match the contract. Consistent with the runtime's existing `mode: 'strict'`. Risk: breaks reads on legacy data.
- **Validate on read, warn on mismatch (permissive)**: Return the data but emit a diagnostic. The user sees their data, but gets notified of schema drift. The diagnostic channel is the runtime's log infrastructure — whether it pipes to error monitoring is the user's concern.
- **Validate on write only**: Trust reads, validate writes. PN guarantees what it writes is correct; existing data is the user's problem. Lightest approach.
- **Coerce where possible**: If the contract says `age: Int` and the doc has `age: "30"`, coerce it. This is what Mongoose does.

Tensions:
- Strict validation on reads is the most correct behavior but may be impractical for users migrating from untyped Mongo usage — their existing data won't match the contract.
- The runtime already has `mode: 'strict' | 'permissive'`. This is a natural place to control read validation behavior.
- Coercion is convenient but lossy — it silently changes semantics. A string `"30"` and an integer `30` behave differently in comparisons, sorting, and aggregation.

Related: Should PN optionally push `$jsonSchema` validation rules to MongoDB collections? This would give database-level write enforcement, complementing application-level validation.

---

## 6. Polymorphism and discriminated unions *(validate in April)*

**This is a cross-family concern.** Both SQL and MongoDB need discriminated unions in the contract type system — they just surface differently at the storage layer.

**The question**: How does the contract type system represent discriminated unions / model inheritance, and how does each family store them?

**Priority signal**: The MongoDB team rates "Inheritance and Polymorphism" as **High priority** — their highest tier. The [user journey](../9-references/MongoDB-Prisma_%20User%20journey%20&%20Feature%20gaps.md) describes this as an early pain point: a user's `ratings` field had different structures depending on the rating engine, and Prisma ORM typed it as `Json`, losing all type safety. The MongoDB team also lists "Support for Polymorphic Array/Embedded Field" (Low priority) and notes that Prisma ORM's workarounds involve untyped `Json` fields or multiple optional fields.

### Where this comes up

**In MongoDB:**
- **Polymorphic collections**: A single collection holding documents with different shapes distinguished by a discriminator field (single-table inheritance). The MongoDB team specifically calls out "defining base models and extending them into specialized sub models" as a key use case.
- **Polymorphic embedded fields**: A field like `ratings` whose structure varies per document, currently typed as `Json` in Prisma ORM.
- **Mixed-type arrays**: An `events` array containing `{ type: "click", x: number, y: number }` and `{ type: "scroll", offset: number }`. Common in event-sourcing patterns.
- **Optional/missing fields**: Mongo documents may omit fields entirely. `null` (field present, value null) is different from "field missing." The contract needs to express both.

**In SQL:**
- **Single-table inheritance (STI)**: One table holds multiple model types, distinguished by a discriminator column (e.g. `type = 'admin' | 'viewer'`). Shared fields are on the table; type-specific fields are nullable. Common in Rails, Django, and many TS codebases.
- **Multi-table inheritance**: A base table with shared fields, plus extension tables joined by FK for type-specific fields. More normalized but more complex to query.
- **Enum-discriminated rows**: A pattern where a row's behavior changes based on a discriminator field, even if the schema is the same. The ORM needs to narrow the type based on the discriminator value.

### Contract-level representation

Options:
- **Discriminated union in the model graph.** The contract declares a base model (`Notification`) and variant models (`EmailNotification`, `SmsNotification`) with a discriminator field (`type`). Each variant extends the base with additional fields. Consumer libraries traverse the model graph and see both the base and variants.
- **Union field type.** A field's type is declared as a union: `ratings: ImdbRating | RottenTomatoesRating`. The contract type system gains a union type constructor. Simpler than model inheritance but limited to field-level polymorphism.
- **Both.** Model-level inheritance (base + variants) for polymorphic collections/tables, and field-level unions for polymorphic embedded fields and arrays. These serve different use cases.

### Storage-level mapping

| Pattern | SQL storage | MongoDB storage |
|---|---|---|
| Model inheritance (STI) | One table, discriminator column, nullable type-specific columns | One collection, discriminator field, variant-specific fields present/absent |
| Model inheritance (multi-table) | Base table + extension tables with FK | N/A (Mongo doesn't have joins built-in; embed instead) |
| Polymorphic embedded field | `Json` column (loses type safety) or separate tables | Embedded subdocument with discriminator field |
| Mixed-type array | Not idiomatic (junction table + discriminator) | Native — array of variant subdocuments |

### What to validate in April

At minimum:
- The contract can express a discriminated union (base model + variants with a discriminator field).
- The emitter produces TypeScript types that narrow correctly based on the discriminator.
- The ORM client can query a polymorphic collection/table and return narrowed types.
- The storage mapping works for at least STI (one table/collection, discriminator column/field).

Rough edges are acceptable — exhaustive pattern matching, complex nested unions, and multi-table inheritance can wait. But the contract type system must handle the basic discriminated-union shape, and it must work for both families.

---

## 7. Relation loading: application-level joining vs. `$lookup`

When the user asks to load a `User` and include their `Posts` (a referenced 1:N relation), there are two strategies.

**The question**: Which strategy does the PN document ORM use, and when?

Options:
- **Application-level joining**: Issue `find()` for users, then `find()` for posts where `authorId` is in the user ID set, stitch in JS. This is what the SQL ORM already does for includes, and what Prisma ORM does for Mongo.
- **`$lookup` in aggregation pipeline**: Build a pipeline with a `$lookup` stage that joins users and posts server-side. More efficient for large result sets, but requires the ORM to compile to aggregation pipelines rather than simple `find()` calls.

Tensions:
- Application-level joining is simpler to implement and reuses existing patterns. But it requires N+1 queries (or 2 queries with an `$in` batch) and moves data over the wire that `$lookup` would handle server-side.
- `$lookup` is more efficient but forces the ORM's query compilation to target aggregation pipelines for any query involving includes. This is a bigger implementation surface.
- For embedded relations, neither approach is needed — the data comes back in the parent document's `find()` result. The ORM needs to know which relations are embedded and which are referenced to choose the right strategy.

For the PoC: application-level joining is sufficient. But the architecture should not *prevent* `$lookup` optimization later.

---

## 8. Aggregation pipeline as the Mongo query builder lane

Aggregation pipelines are MongoDB's primary mechanism for complex queries — they replace SQL's `SELECT`, `JOIN`, `GROUP BY`, `HAVING`, subqueries, and window functions. They're both the ORM's internal compilation target (for complex queries) and the user-facing escape hatch when the ORM can't express a query.

This is architecturally symmetric with the SQL family: the SQL query builder (`db.sql.from(table).select(...)`) is the escape hatch for the SQL ORM. An aggregation pipeline builder fills the same role for the Mongo ORM. Each family has a high-level ORM client and a lower-level query builder lane, both sharing a session/transaction context (the same interop pattern validated by [workstream 3, VP1](../../april-milestone.md#3-runtime-pipeline-orm-query-builders-middleware-framework-integration)). The lane interface is family-specific (SQL lanes compile to SQL strings, Mongo lanes compile to pipeline stage arrays), but the architectural role and interop guarantees are the same shared pattern.

**The question**: What does this lane look like, and what's the right scope for the PoC vs. later?

Sub-questions:
- **As ORM compilation target**: The ORM needs to compile to *something*. For basic CRUD, `find()` / `insertOne()` / `updateOne()` / `deleteOne()` suffice. For includes via `$lookup`, the ORM would need to compile to aggregation pipelines. What's the minimum pipeline compilation needed for the PoC?
- **As user-facing lane**: A type-safe pipeline builder is the full vision — but it's a large surface area (20+ stages, dozens of operators) and nobody in the ecosystem has solved type-safe pipelines well. When does this ship?
- **Raw pipeline escape hatch**: As a minimum, let users pass a raw pipeline array (untyped) through the runtime. This validates that the execution plan and plugin pipeline accommodate non-SQL queries, without building a full DSL.

For the PoC: Compile to `find()` / `insertOne()` / `updateOne()` / `deleteOne()` for basic CRUD. Provide a raw pipeline escape hatch. Defer the type-safe pipeline lane.

---

## 9. Change streams and the runtime's execution model *(analysis complete, deferred)*

MongoDB change streams are resumable, ordered, real-time event streams. They're a core part of the Mongo-native experience (reactive UIs, event-driven architectures, CDC). This is a cross-family concern — Postgres has logical replication (used by Supabase Realtime) and LISTEN/NOTIFY.

**The question**: Does PN's runtime model accommodate unbounded streaming subscriptions?

**Analysis**: Subscriptions are a **separate operation type**, not a variant of `execute()`. The runtime has two axes of variation:
- **Family** (SQL vs. Mongo) determines the query payload shape
- **Operation type** (request vs. subscribe) determines the output shape and lifecycle

The query input is shared across both modes within a family — "users where age > 25" is the same interest whether you want a snapshot or a stream. But subscriptions add subscription-specific options (resume tokens, event type filters, full-document mode) and have a fundamentally different lifecycle (`onSubscribe → onEvent → onError → onUnsubscribe` rather than `beforeExecute → onRow → afterExecute`).

Change events may be more standardizable across families than query plans are, since every CDC system expresses the same fundamental thing: "entity X was inserted/updated/deleted, here's the before/after state."

Streaming is validated in the SQL runtime workstream via Supabase Realtime ([VP5](../../april-milestone.md#3-runtime-pipeline-orm-query-builders-middleware-framework-integration)); the patterns established there will inform Mongo change stream support.

For the PoC: Out of scope. The architecture constraints are:
- Don't assume `execute()` is the only operation on the runtime
- Don't assume all `AsyncIterableResult` streams are finite
- Keep the ORM client's query builder terminal-agnostic (compilable to both request and subscription)

---

## 10. Shared contract surface: what goes in `ContractBase`?

The PoC plan identifies this as the most important architectural question. Today, `ContractBase` does not include models or relations — these are added by `SqlContract`.

**The question**: What belongs in the shared contract surface that both SQL and document contracts extend?

Candidates for `ContractBase`:
- Models (name, fields, field types)
- Relations (cardinality, related model, storage strategy is family-specific)
- Mappings (model → storage name, field → storage path) — both families need this, but the shapes differ (SQL: table/column, document: collection/field path)
- Capabilities (what operations the target supports)
- Codecs / type registry

The tension: too little in `ContractBase` and consumer libraries can't do anything without family-specific code. Too much and `ContractBase` becomes a leaky abstraction that doesn't fit either family well.

Related question: Is `ContractBase` a concrete type that consumer libraries accept, or an interface that both families implement? The answer affects how extensions declare compatibility.

---

## 11. Introspection: generating a contract from an existing database

PN's contract flow assumes authoring-first — the user writes a schema, and the contract is emitted. But MongoDB users typically have existing databases with existing data and no formal schema.

**The question**: Can PN generate a contract by introspecting an existing MongoDB database?

The [user journey](../9-references/MongoDB-Prisma_%20User%20journey%20&%20Feature%20gaps.md) highlights this as an early pain point. Lucas ran `prisma db pull` and hit friction: plural collection names weren't normalized, relationships had to be defined manually (MongoDB has no foreign keys to introspect), and polymorphic fields were typed as `Json`.

Sub-questions:
- **Field type inference**: MongoDB fields have per-document types. Introspection would need to sample documents and infer the most common type for each field. What happens when a field has mixed types across documents? (Report it as a union? Pick the majority type and warn?)
- **Relationship inference**: Without foreign keys, relationships can only be inferred by convention (field names ending in `Id`, arrays of `ObjectId`) or not at all. Should introspection attempt this, or just generate models with no relations and let the user add them?
- **Embedded document detection**: Subdocuments and arrays of subdocuments are structurally visible. Introspection could detect these and generate embedded types automatically.
- **Collection → model naming**: Should introspection normalize plural collection names to singular model names (as the user journey suggests)?

For the PoC: Out of scope — we author contracts manually. But introspection is table-stakes for real Mongo adoption. Worth noting the constraints so the contract model doesn't make introspection harder than necessary.

---

## 12. MongoDB-specific extension packs

PN's extension pack architecture (ADR 170) allows targets and extensions to contribute type constructors, query operators, and authoring helpers. Several MongoDB-specific capabilities are natural candidates for extension packs rather than core ORM features.

**The question**: Which MongoDB capabilities become extension packs, and what does that require from the extension pack interface?

Candidates (from the [MongoDB team's feature priority list](../9-references/Prisma_MongoDB_%20Feature%20support%20priority%20list%20-%20Sheet1.csv)):
- **Vector Search** (`$vectorSearch`) — Medium priority. Analogous to pgvector for Postgres. Contributes a vector field type, a similarity search operator, and vector search index definitions.
- **Atlas Search** (`$search`) — Medium priority. Full-text search capabilities specific to MongoDB Atlas. Contributes search index definitions and search query operators.
- **Geospatial** (`$near`, `$geoWithin`, `2dsphere` indexes) — Medium priority. Contributes GeoJSON field types, geospatial query operators, and geospatial index types.
- **Time Series** — Medium priority. A specialized collection type for time-stamped data. Contributes a collection-level configuration rather than field-level types.

Tensions:
- The extension pack interface (ADR 170) was designed with SQL extensions in mind (pgvector, PostGIS). Do document-family extensions need different hooks? For example, Vector Search and Atlas Search operate through aggregation pipeline stages, not SQL operators.
- Extension-contributed **index types** are a new surface. The current extension pack model contributes type constructors and field presets, but not index types. Mongo's specialized indexes (text, geospatial, TTL, vector search, Atlas search) would need index-type contributions from extension packs.
- Extension-contributed **pipeline stages** may be needed for Vector Search and Atlas Search, since `$vectorSearch` and `$search` are aggregation pipeline stages, not standard query operators.

For the PoC: Out of scope. But the architecture should anticipate that MongoDB's most differentiating features (Vector Search, Atlas Search, geospatial) will be delivered as extension packs. The extension pack interface needs to accommodate document-family contributions.

---

## 13. Client-side field-level encryption (CSFLE) and queryable encryption

MongoDB offers client-side field-level encryption (CSFLE) and queryable encryption (QE) — features that encrypt sensitive fields before they leave the application, so the database server never sees plaintext values.

**The question**: How does PN surface encryption configuration for MongoDB?

The MongoDB team rates this as **Medium priority**. It's a driver-level concern — the `mongodb` Node.js driver handles encryption/decryption transparently when configured. PN's involvement would be:
- **Contract-level**: Declaring which fields are encrypted and their encryption metadata (key ID, algorithm, query type for QE).
- **Adapter-level**: Passing encryption configuration to the MongoDB driver when establishing connections.
- **ORM-level**: Ensuring that encrypted fields participate correctly in queries (QE allows equality queries on encrypted data; CSFLE does not).

For the PoC: Out of scope. This is a production-readiness concern, not an architecture validation concern. But worth noting because it has no SQL equivalent — SQL databases handle encryption at the storage layer (TDE) or connection layer (TLS), not at the field level.

---

## 14. Schema evolution as data migration *(cross-workstream)*

In SQL, schema evolution has two parts: structural migrations (DDL changes) and data migrations (content transforms). In MongoDB, **that distinction collapses**. There is no DDL — collections don't have enforced schemas. Adding a field, splitting a field, or changing a storage strategy (embedded → referenced) are all pure data transforms. In Mongo, schema evolution IS data migration.

**The question**: Does the data invariant model from the migration workstream (see [data-migrations.md](../../0-references/data-migrations.md), [data-migrations-solutions.md](../../0-references/data-migrations-solutions.md)) serve as the foundation for MongoDB schema evolution?

The fit is strong:
- **"Done" = contract hash + invariants.** For Mongo, the contract hash captures the expected document shape, and the invariant captures "all documents conform to that shape." This is exactly the data invariant model's definition of desired state.
- **Postcondition = a Mongo query.** "All users migrated to v2" is checkable: `db.users.countDocuments({ schemaVersion: { $ne: 2 } }) === 0`. This satisfies the invariant model's requirement for machine-checkable postconditions.
- **Transformation = a Mongo update.** `db.users.updateMany({ schemaVersion: 1 }, [{ $set: { firstName: { $first: { $split: ["$name", " "] } } } }])`. This is idempotent by construction — it only touches documents that still need it.
- **Schema versioning pattern is native.** Mongo developers already use `schemaVersion` fields and lazy migration (see [mongo-idioms.md](../9-references/mongo-idioms.md#schema-versioning)). The invariant model formalizes what they already do informally.

The [user journey](../9-references/MongoDB-Prisma_%20User%20journey%20&%20Feature%20gaps.md) from the MongoDB team explicitly calls out the lack of automated data migrations as a disappointment — the developer had to manually write a migration script to move data from embedded to referenced.

Sub-questions:
- **Structural vs. data migration for Mongo**: In the migration workstream's graph model, Mongo "migrations" are almost exclusively data migrations (no DDL). Does the graph model still make sense when there's no structural migration? Or is the invariant model sufficient on its own?
- **Compatibility checks**: The data migration solutions doc describes schema-based compatibility checks ("is the database schema compatible with the migration's requirements?"). For Mongo, this becomes "does the collection have the fields the migration expects?" — which is a document-sampling question, not a DDL introspection.
- **Runner integration**: The migration runner needs to execute Mongo update commands, not SQL. Does the runner use the same adapter interface the ORM uses, or does it need its own execution path?

For the PoC: Out of scope for the Mongo workstream, but the april-milestone doc already notes the cross-workstream connection: "If the data invariant model from workstream 1 works well, it may become the foundation for document schema evolution." The Mongo workstream should validate that the invariant model's assumptions hold for a schemaless database — the main risk is that "postcondition = query" becomes expensive when you have to sample documents rather than inspect DDL.
