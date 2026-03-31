# MongoDB Work Stream — Open Design Questions

Design questions surfaced during the exploration of MongoDB primitives and their mapping to Prisma Next's architecture. These are questions where the answer is non-obvious, involves real trade-offs, or requires spiking to resolve. Grouped by theme.

See also: [MongoDB primitives reference](../../../reference/mongodb-primitives-reference.md), [mongo-poc-plan.md](mongo-poc-plan.md), [user-promise.md](../../../reference/mongodb-user-promise.md)

**External input**: The MongoDB Node.js Driver team provided a [feature gap analysis](../../../reference/mongodb-feature-support-priorities.md) and a [user journey narrative](../../../reference/mongodb-user-journey.md). Where their priorities or observations surface new tensions, they're noted inline.

---

## 1. Embedded documents *(resolved — cross-family concern)*

**Answer**: Embedding is expressed via model ownership. An owned model declares `"owner": "ParentModel"` — a domain-level fact stating that the model belongs to the parent's aggregate. The owned model appears as a sibling in `models` with its own `fields` block. Its `storage` block is empty (`{}`), because it doesn't own a storage unit. The parent's `storage.relations` section maps the relation to its physical storage location (e.g., `"addresses": { "field": "addresses" }` for Mongo, `"addresses": { "column": "address_data" }` for SQL JSONB).

Relations to owned models are plain graph edges: `{ "to": "Address", "cardinality": "1:N" }` — no `strategy`, no storage annotation. The `owner` property on the target model distinguishes owned relations from referenced ones.

This is a cross-family concern: SQL typed JSON/JSONB columns are the same contract-level problem (structured data nested in a parent entity). Both families need type-safe dot-notation queries, TypeScript type generation, and reusability across models. The difference is convention (Mongo: embedding is idiomatic; SQL: JSON columns are an escape hatch), not capability.

Value objects (Address, GeoPoint) without identity are a separate concept — they belong in a dedicated `valueObjects` section, not `models`. See [ADR 178 — Value objects in the contract](../../../architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md) for the full design and [cross-cutting-learnings.md](../cross-cutting-learnings.md) for the entity vs value object distinction.

See [ADR 177 — Ownership replaces relation strategy](../../../architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md) for the full rationale.

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

## 4. Update operators: shared ORM surface vs. Mongo-native operations *(resolved)*

**Answer**: The dot-path field accessor provides type-safe access to Mongo-native update operators through a shared mutation API. Three mutation forms cover the spectrum from simple to Mongo-native:

```typescript
// Plain object — partial update (shared surface)
db.users.where({ id }).update({ name: "Bob" })
// Compiles to: $set: { name: "Bob" }

// Field accessor — per-field Mongo-native operations
db.users.where({ id }).update(u => [
  u("stats.views").inc(1),
  u("tags").push("featured"),
])
// Compiles to: { $inc: { "stats.views": 1 }, $push: { "tags": "featured" } }
```

The key design principle is that **the verb determines the behaviour**: `create()` applies defaults for omitted fields; `update()` with a plain object is always partial (omitted fields untouched); field accessor operations are explicit per-field mutations.

Mutation operators are **capability-gated by target**: Mongo gets the full suite (`inc`, `push`, `pull`, `addToSet`, `pop`, etc.); SQL is limited to `set` and `unset` for JSONB paths.

This resolved the original tension: the shared ORM interface (`update()` with plain objects) remains truly shared, while Mongo-native atomic operators are exposed through the field accessor pattern — which is itself a shared mechanism (it works for SQL JSONB too, just with fewer operators).

See [ADR 180 — Dot-path field accessor](../../../architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md) for the full rationale and backend translation tables.

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

## 6. Polymorphism and discriminated unions *(resolved — validate implementation in April)*

**Answer**: `discriminator` + `variants` on the base model, `base` on each variant, with all models as siblings in `models`.

```json
{
  "Task": {
    "fields": {
      "id": { "nullable": false, "codecId": "pg/int4@1" },
      "title": { "nullable": false, "codecId": "pg/text@1" },
      "type": { "nullable": false, "codecId": "pg/text@1" }
    },
    "discriminator": { "field": "type" },
    "variants": { "Bug": { "value": "bug" }, "Feature": { "value": "feature" } },
    "storage": { "table": "tasks", "fields": { ... } }
  },
  "Bug": {
    "base": "Task",
    "fields": { "severity": { "nullable": false, "codecId": "pg/text@1" } },
    "storage": { "table": "tasks", "fields": { ... } }
  }
}
```

The relationship is bidirectional: `Task.variants` lists its specializations, `Bug.base` names the model it specializes. We use specialization/generalization terminology — `base` describes a structural fact without OOP inheritance baggage.

The persistence strategy is **emergent**: if Bug's storage points to the same table/collection as Task → STI. If it points to a different one → MTI. The domain declaration doesn't change; only the storage mappings do. The contract describes facts ("Bug is a specialization of Task, discriminated by `type`") — the ORM decides how to represent it at runtime.

All persistence-level polymorphism reduces to "multiple shapes, distinguished by a field." This is fundamental enough to be a contract primitive. See [cross-cutting-learnings.md § learning #4](../cross-cutting-learnings.md) for the full design.

This is a cross-family concern — both SQL and MongoDB need discriminated unions. The MongoDB team rates "Inheritance and Polymorphism" as **High priority** ([user journey](../../../reference/mongodb-user-journey.md)).

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

Rough edges are acceptable — exhaustive pattern matching, complex nested unions, and multi-table inheritance can wait.

### Still open: polymorphic associations

A `Comment` that can belong to either a `Post` or a `Video` (distinguished by `commentable_type`) is polymorphism on the *relation*, not the model. The `relations` section would need to express "this relation can point to one of several models." Not yet designed.

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

## 10. Shared contract surface: what goes in `ContractBase`? *(resolved — not yet implemented)*

**Answer**: The domain level is the shared surface. `roots`, `models` (with `fields`, `discriminator`, `variants`), and `relations` are structurally identical between families. The divergence is scoped entirely to `model.storage` — the family-specific bridge from domain fields to persistence. See [contract-symmetry.md](contract-symmetry.md) for the convergence/divergence analysis.

`ContractBase` should capture the domain-level structure:
- **`roots`** — maps ORM accessor names to model names
- **`models`** — all entities with `fields` (records of `{ nullable, codecId }`), optional `discriminator` + `variants`, and `relations`
- **`model.storage`** — family-specific extension point (SQL: field → column; Mongo: field → codec)
- **`relations`** — with cardinality and optional join details (`on`)
- **`owner`** — model-level declaration of aggregate membership (see [ADR 177](../../../architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md))
- **value objects** — named field structures without identity, defined in a top-level `valueObjects` section (see [ADR 178](../../../architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md))

This is not a mechanical extraction from either contract — it's a new abstraction rooted in domain modeling concepts:

| Concept | Contract representation |
|---|---|
| **Aggregate root** | Entry in `roots`, model with storage containing table/collection |
| **Entity** | Entry in `models` |
| **Value object** | Top-level `valueObjects` section ([ADR 178](../../../architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md)) |
| **Owned model** | Model with `"owner": "ParentModel"` — co-located storage |
| **Reference** | Relation with `on` join details to an independent model |
| **Polymorphism** | `discriminator` + `variants` on any model |

See [cross-cutting-learnings.md](../cross-cutting-learnings.md) for the full design principles, examples, and remaining open questions.

---

## 11. Introspection: generating a contract from an existing database

PN's contract flow assumes authoring-first — the user writes a schema, and the contract is emitted. But MongoDB users typically have existing databases with existing data and no formal schema.

**The question**: Can PN generate a contract by introspecting an existing MongoDB database?

The [user journey](../../../reference/mongodb-user-journey.md) highlights this as an early pain point. Lucas ran `prisma db pull` and hit friction: plural collection names weren't normalized, relationships had to be defined manually (MongoDB has no foreign keys to introspect), and polymorphic fields were typed as `Json`.

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

Candidates (from the [MongoDB feature support priorities](../../../reference/mongodb-feature-support-priorities.md)):
- **Vector Search** (`$vectorSearch`) — Medium priority. Analogous to pgvector for Postgres. Contributes a vector field type, a similarity search operator, and vector search index definitions.
- **Atlas Search** (`$search`) — Medium priority. Full-text search capabilities specific to MongoDB Atlas. Contributes search index definitions and search query operators.
- **Geospatial** (`$near`, `$geoWithin`, `2dsphere` indexes) — Medium priority. Contributes GeoJSON field types, geospatial query operators, and geospatial index types.
- **Time Series** — Medium priority. A specialized collection type for time-stamped data. Contributes a collection-level configuration rather than field-level types.

Tensions:
- The extension pack interface (ADR 170) was designed with SQL extensions in mind (pgvector, PostGIS). Do document-family extensions need different hooks? For example, Vector Search and Atlas Search operate through aggregation pipeline stages, not SQL operators.
- Extension-contributed **index types** are a new surface. The current extension pack model contributes type constructors and field presets, but not index types. Mongo's specialized indexes (text, geospatial, TTL, vector search, Atlas search) would need index-type contributions from extension packs.
- Extension-contributed **pipeline stages** may be needed for Vector Search and Atlas Search, since `$vectorSearch` and `$search` are aggregation pipeline stages, not standard query operators.

For the PoC: Out of scope. But the architecture should anticipate that MongoDB's most differentiating features (Vector Search, Atlas Search, geospatial) will be delivered as extension packs. The extension pack interface needs to accommodate document-family contributions.

**Budgets plugin opportunity**: A Mongo-specific budgeting plugin could warn when documents approach MongoDB's 16 MB document size limit. This is especially relevant for models with embedded arrays of sub-documents (e.g., a Post with embedded Comments) where the array grows over time. The plugin could estimate document size from the query plan and warn preemptively — similar to how the SQL budgets plugin uses `EXPLAIN` to estimate query cost.

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

**The question**: Does the data invariant model from the migration workstream (see [ADR 176 — Data migrations as invariant-guarded transitions](../../../architecture%20docs/adrs/ADR%20176%20-%20Data%20migrations%20as%20invariant-guarded%20transitions.md)) serve as the foundation for MongoDB schema evolution?

The fit is strong:
- **"Done" = contract hash + invariants.** For Mongo, the contract hash captures the expected document shape, and the invariant captures "all documents conform to that shape." This is exactly the data invariant model's definition of desired state.
- **Postcondition = a Mongo query.** "All users migrated to v2" is checkable: `db.users.countDocuments({ schemaVersion: { $ne: 2 } }) === 0`. This satisfies the invariant model's requirement for machine-checkable postconditions.
- **Transformation = a Mongo update.** `db.users.updateMany({ schemaVersion: 1 }, [{ $set: { firstName: { $first: { $split: ["$name", " "] } } } }])`. This is idempotent by construction — it only touches documents that still need it.
- **Schema versioning pattern is native.** Mongo developers already use `schemaVersion` fields and lazy migration (see [MongoDB idioms](../../../reference/mongodb-idioms.md#schema-versioning)). The invariant model formalizes what they already do informally.

The [user journey](../../../reference/mongodb-user-journey.md) from the MongoDB team explicitly calls out the lack of automated data migrations as a disappointment — the developer had to manually write a migration script to move data from embedded to referenced.

Sub-questions:
- **Structural vs. data migration for Mongo**: In the migration workstream's graph model, Mongo "migrations" are almost exclusively data migrations (no DDL). Does the graph model still make sense when there's no structural migration? Or is the invariant model sufficient on its own?
- **Compatibility checks**: The data migration solutions doc describes schema-based compatibility checks ("is the database schema compatible with the migration's requirements?"). For Mongo, this becomes "does the collection have the fields the migration expects?" — which is a document-sampling question, not a DDL introspection.
- **Runner integration**: The migration runner needs to execute Mongo update commands, not SQL. Does the runner use the same adapter interface the ORM uses, or does it need its own execution path?

For the PoC: Out of scope for the Mongo workstream, but the april-milestone doc already notes the cross-workstream connection: "If the data invariant model from workstream 1 works well, it may become the foundation for document schema evolution." The Mongo workstream should validate that the invariant model's assumptions hold for a schemaless database — the main risk is that "postcondition = query" becomes expensive when you have to sample documents rather than inspect DDL.

---

## 15. Polymorphic associations

ADR 173 covers polymorphic *models* (a model that has specializations via `discriminator`/`variants`/`base`). Polymorphic *associations* are a different concept: a relation that can point to one of several different model types, distinguished by a type discriminator on the relation itself.

Classic example: a `Comment` that can belong to either a `Post` or a `Video`:

```text
Comment → commentable → Post | Video
```

This is not a polymorphic model — `Comment` is always a `Comment`. It's the *relation target* that varies.

**The question**: How does the contract express a relation that can target one of N models?

### SQL representations

| Pattern | How it works | Trade-offs |
|---|---|---|
| **Type + ID pair** (Rails-style) | `commentable_type: string` + `commentable_id: int` | Widely used. No FK constraint possible — the database can't enforce referential integrity across multiple tables. |
| **Multiple nullable FKs** | `post_id: int?` + `video_id: int?` with a check constraint that exactly one is non-null | FK constraints work. Gets unwieldy with many targets. |
| **Join table per target** | `comment_posts(comment_id, post_id)` + `comment_videos(comment_id, video_id)` | Clean relational design. More tables, more joins. |

### MongoDB representations

| Pattern | How it works | Trade-offs |
|---|---|---|
| **DBRef-like** | `{ ref: ObjectId, refType: "Post" }` | Idiomatic. No database enforcement. |
| **Convention field** | `commentableId: ObjectId` + `commentableType: "Post" \| "Video"` | Same as SQL type+ID pair. |

### Contract considerations

The current relation shape is:

```json
{
  "to": "Post", "cardinality": "1:N",
  "on": { "localFields": ["authorId"], "targetFields": ["id"] }
}
```

A polymorphic association would need something like:

```json
{
  "commentable": {
    "cardinality": "N:1",
    "polymorphic": true,
    "discriminator": "commentableType",
    "targets": {
      "Post": { "on": { "localFields": ["commentableId"], "targetFields": ["id"] } },
      "Video": { "on": { "localFields": ["commentableId"], "targetFields": ["id"] } }
    }
  }
}
```

Sub-questions:
- **Is `polymorphic` a relation-level property, or does this decompose into multiple relations?** An alternative representation: the contract declares separate `commentablePost` and `commentableVideo` relations, and the ORM provides a union accessor `commentable` that dispatches based on `commentableType`. This avoids adding polymorphism to the relation model — the complexity lives in the ORM layer.
- **How does this interact with `model.relations` vs top-level relations?** If relations are on the model (per ADR 172), the polymorphic association lives on `Comment.relations`.
- **Type inference**: The ORM's return type for `comment.commentable` must be `Post | Video`. The discriminator field `commentableType` must narrow the type — same pattern as model polymorphism but on a relation.
- **Referential integrity**: SQL can't enforce FK constraints on type+ID polymorphic associations. Should the contract express this limitation, or is it an implementation detail?

### Relationship to ADR 173

ADR 173's polymorphic models and polymorphic associations are orthogonal concepts — you can have one without the other. But they share the pattern of "discriminated union resolved by a type field." It's worth considering whether a unified mechanism serves both, or whether the concepts are different enough to warrant separate representations.

Not yet designed. Not blocking for April — but should be designed before the contract shape stabilises.

---

## 16. Union field types (mixed-type fields) *(resolved)*

**Answer**: The `union` property on fields — a third mutually exclusive field type descriptor alongside `codecId` (scalar) and `type` (value object). Each union member carries either `codecId` or `type`:

```json
{
  "score": {
    "nullable": false,
    "union": [
      { "codecId": "mongo/int32@1" },
      { "codecId": "mongo/string@1" }
    ]
  },
  "location": {
    "nullable": false,
    "union": [
      { "type": "Address" },
      { "type": "GeoPoint" }
    ]
  }
}
```

This was Option C from the original analysis. It extends the field shape with a `union` property while keeping `codecId` as a single string on non-union fields. The field type system is now: `codecId` (one scalar), `type` (one value object), `union` (multiple types — any mix of scalars and value objects). All three are mutually exclusive.

Polymorphic value objects ([ADR 173](../../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)) handle *structured* unions with a discriminator and shared base. `union` handles *unstructured* unions with no discriminator.

See [ADR 179 — Union field types](../../../architecture%20docs/adrs/ADR%20179%20-%20Union%20field%20types.md) for the full rationale.

---

## 17. Many-to-many relationships

Many-to-many (M:N) relationships are common in both SQL and MongoDB, but they're modeled very differently.

**The question**: How does the contract represent M:N relationships, and how does the ORM surface them?

### SQL representations

In SQL, M:N requires a join table:

```text
User ←→ user_roles ←→ Role
```

The join table (`user_roles`) has foreign keys to both sides. Two 1:N relations compose into one logical M:N. Prisma ORM calls these "implicit many-to-many" (the join table is managed for you) or "explicit many-to-many" (the join table is a model you manage).

| Pattern | How it works | Trade-offs |
|---|---|---|
| **Implicit join table** | ORM manages the join table transparently. User sees `user.roles` and `role.users`. | Clean API. Join table has no payload — can't add attributes like `assignedAt` to the relationship. |
| **Explicit join model** | `UserRole` is a model with `userId`, `roleId`, and optional payload fields. Two 1:N relations. | Flexible — join model can carry data. But the user manages three models instead of a logical two. |

### MongoDB representations

MongoDB has more options because documents can contain arrays:

| Pattern | How it works | Trade-offs |
|---|---|---|
| **Array of references** | `User.roleIds: [ObjectId]` — each user stores an array of role IDs | Simple. No join collection. But getting all users for a role requires scanning all users. Bidirectional traversal is expensive unless both sides store arrays. |
| **Embedded array** | `User.roles: [{ name, permissions }]` — each user embeds the full role data | No joins needed. But denormalised — updating a role means updating every user. |
| **Join collection** | A `user_roles` collection, same as SQL | Normalised. Needs `$lookup` or multi-query. Less idiomatic for Mongo. |

### Contract considerations

The current relation model has `cardinality: "1:N" | "N:1"`. Adding `"M:N"` is a new cardinality, and it needs to be paired with storage details:

**Option A: M:N as a contract primitive**

```json
{
  "roles": {
    "to": "Role",
    "cardinality": "M:N",
    "via": "user_roles"
  }
}
```

The contract expresses the logical M:N. The `via` property names the join table/collection. The ORM manages traversal.

**Option B: M:N decomposes into two 1:N relations**

```json
"UserRole": {
  "fields": { "userId": { ... }, "roleId": { ... } },
  "relations": {
    "user": { "to": "User", "cardinality": "N:1", ... },
    "role": { "to": "Role", "cardinality": "N:1", ... }
  }
}
```

No new cardinality. The user explicitly models the join entity. The ORM can provide a convenience accessor (`user.roles`) that traverses `user → userRoles → role`, but the contract only knows about 1:N relations. This is Prisma ORM's "explicit many-to-many" approach.

**Option C: Array-of-references (Mongo-specific)**

For MongoDB, an array of ObjectIds in the parent document is a common M:N pattern without a join collection:

```json
{
  "roleIds": { "nullable": false, "codecId": "mongo/array@1" },
  "roles": {
    "to": "Role",
    "cardinality": "M:N",
    "on": { "localFields": ["roleIds"], "targetFields": ["id"] }
  }
}
```

The relation is backed by an array field on the model, not a join table. This is a Mongo-specific storage detail — the domain relation is still M:N, but the persistence mechanism is different from SQL's join table.

### Sub-questions

- **Implicit vs explicit**: Should the contract support implicit M:N (managed join table) or only explicit (user models the join entity)? Implicit is more ergonomic but hides structure; explicit is more honest but more verbose.
- **Array-of-references storage**: For Mongo, should M:N via arrays-of-references be a first-class storage strategy, or is it expressed differently?
- **Join entity payload**: If the relationship itself carries data (e.g., `assignedAt` on a user-role assignment), implicit M:N can't express this. Does the contract need to support both implicit (no payload) and explicit (with payload)?
- **Bidirectional traversal**: In the array-of-references pattern, only one side stores the array. Traversal from the other side requires a query. Should the contract express both directions, and how does the ORM handle the asymmetry?

Note: the SQL contract currently has no way to record M:N relationships either. Join tables exist in `storage.tables` and the foreign keys are declared, but there's no contract-level concept that says "these two models have an M:N relationship via this join table." The relation model only knows `1:N` / `N:1`. This is a gap for both families, not just Mongo.

Not yet designed. M:N was explicitly deferred for the SQL ORM. Now that we're modeling contract relations across families, it's worth designing — particularly because MongoDB's array-of-references pattern doesn't decompose naturally into two 1:N relations the way SQL's join table does.

---

## 18. Relation `strategy` naming: fact or instruction? *(resolved)*

**Answer**: `strategy` has been replaced entirely by model-level `owner`. The core insight was that "Address is a component of User" is a domain fact about the model, not a property of the relation edge. Putting `strategy: "embed"` on the relation mixed domain and storage concerns and read as an instruction rather than a fact.

The resolution:
- **`owner: "ModelName"`** on the owned model (domain fact): "Address belongs to User's aggregate"
- **`storage.relations`** on the parent model (storage mapping): maps the relation to a physical location (`"field": "addresses"` in Mongo, `"column": "address_data"` in SQL)
- **Relations become plain graph edges**: `{ "to": "Address", "cardinality": "1:N" }` — no `strategy`

The pattern mirrors `base` for polymorphism: just as a variant says `"base": "Task"`, an owned model says `"owner": "User"`.

See [ADR 177 — Ownership replaces relation strategy](../../../architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md) for the full rationale and examples.

---

## 19. Self-referential models

A model that has a relation to itself — a tree, a hierarchy, a threaded comment chain. Three cases arise, each testing the contract design differently.

### Case 1: Self-referential reference

An Employee whose manager is also an Employee. This is a plain FK to self:

```json
"Employee": {
  "fields": {
    "id": { "nullable": false, "codecId": "pg/int4@1" },
    "name": { "nullable": false, "codecId": "pg/text@1" },
    "managerId": { "nullable": true, "codecId": "pg/int4@1" }
  },
  "relations": {
    "manager": {
      "to": "Employee", "cardinality": "N:1",
      "on": { "localFields": ["managerId"], "targetFields": ["id"] }
    },
    "directReports": {
      "to": "Employee", "cardinality": "1:N",
      "on": { "localFields": ["id"], "targetFields": ["managerId"] }
    }
  },
  "storage": { "table": "employees", "fields": { ... } }
}
```

No issues. Both sides of the relation point to Employee. The model is an aggregate root with its own table/collection. Works identically in SQL and Mongo.

### Case 2: Self-referential embedding (recursive nesting)

Threaded comments in Mongo, where replies are embedded subdocuments inside their parent comment, recursively:

```json
{ "_id": ..., "text": "Top-level", "replies": [
  { "_id": ..., "text": "Reply", "replies": [
    { "_id": ..., "text": "Nested reply", "replies": [] }
  ] }
] }
```

Can Comment have `owner: "Comment"`? No — that's circular. If Comment is owned by Comment, it has no independent storage, but the root of the chain needs to live somewhere. There's no anchor.

The way this works: Comment is owned by the *parent entity* (e.g., Post), and the self-referential `replies` relation is just a graph edge that happens to point to the same model type:

```json
"Post": {
  "fields": { "_id": { ... }, "title": { ... } },
  "relations": {
    "comments": { "to": "Comment", "cardinality": "1:N" }
  },
  "storage": {
    "collection": "posts",
    "relations": { "comments": { "field": "comments" } }
  }
},
"Comment": {
  "owner": "Post",
  "fields": { "_id": { ... }, "text": { ... } },
  "relations": {
    "replies": { "to": "Comment", "cardinality": "1:N" }
  },
  "storage": {
    "relations": { "replies": { "field": "replies" } }
  }
}
```

The model appears once in the contract, but the physical structure is arbitrarily deep. Each Comment subdocument has its own `replies` field, and each reply is also a Comment with the same structure. The ORM would need to detect the cycle in the model graph to handle type projections and stop infinite recursion.

Note that the owned Comment has a non-empty `storage` block — it needs `storage.relations` to describe where *its* owned children go within its own subdocument. This extends the pattern from ADR 177 where owned models had `"storage": {}`.

**Status**: Logically sound but unvalidated. Needs implementation to confirm the ORM can untangle recursive self-referential embedding. Practical contracts will almost certainly use references (Case 1) for tree structures.

### Case 3: Mixed root/embedded for the same model

A Category tree where top-level categories own their collection but subcategories are embedded inside their parent.

This violates design principle #5 (one canonical storage location). A Category can't be both an aggregate root with `storage.collection: "categories"` AND an embedded model with `owner: "Category"`. The contract correctly prevents this — `owner` is mutually exclusive with being an aggregate root.

Resolutions:
- **All categories are roots** with a `parentId` reference (Case 1). Most common in practice.
- **Two models**: `Category` (root, has collection) and `Subcategory` (owned by Category, embedded). Honest about the structural difference, but forces a modeling decision about hierarchy depth.

### Summary

| Case | Pattern | Works? | Notes |
|---|---|---|---|
| Self-referential reference | FK to self | Yes | Trivial. Employee → manager. |
| Self-referential embedding | Owned model with relation to self | In theory | Needs a non-self owner as anchor. Unvalidated in ORM. |
| Mixed root/embedded | Same model as both root and owned | No | Correctly prevented by design principle #5. |
