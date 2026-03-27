# MongoDB Work Stream — Open Design Questions

Design questions surfaced during the exploration of MongoDB primitives and their mapping to Prisma Next's architecture. These are questions where the answer is non-obvious, involves real trade-offs, or requires spiking to resolve. Grouped by theme.

See also: [mongodb-primitives-reference.md](mongodb-primitives-reference.md), [mongo-poc-plan.md](mongo-poc-plan.md)

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

## 3. Execution plan generalization

The runtime's `ExecutionPlan` currently has `sql: string` and `params: unknown[]`. The runtime core passes `{ sql: plan.sql, params: plan.params }` to the driver's `execute` method.

**The question**: How does the execution plan generalize to accommodate non-SQL query shapes?

Options:
- **Union type**: `ExecutionPlan` gets `sql?: string` + `command?: MongoCommand` (or similar). The driver inspects which field is populated.
- **Generic type parameter**: `ExecutionPlan<TQuery>` where SQL plans have `TQuery = { sql: string; params: unknown[] }` and Mongo plans have `TQuery = { collection: string; operation: string; pipeline?: object[]; filter?: object }`.
- **Family-specific plan types**: `SqlExecutionPlan` and `DocumentExecutionPlan` are separate types. The runtime is generic over the plan type. The plugin pipeline accepts a base `ExecutionPlan` with only the family-agnostic fields (operation name, model name, metadata).

Tensions:
- Plugins need to inspect plans for logging, caching, budgets, etc. If the plan shape is family-specific, every plugin needs family-specific branches — or the plan must expose family-agnostic metadata (operation name, model, timing) separately from the family-specific query payload.
- The current plugin interface (`beforeExecute(plan)`, `onRow(row, plan)`, `afterExecute(plan, result)`) should ideally work unchanged for both families. This pushes toward a base plan type with family-specific extensions.

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

## 6. Array types and type unions

MongoDB arrays can contain mixed types: `[1, "two", { three: true }]`. The contract type system currently assumes homogeneous types (every value in a field has the same type).

**The question**: Does the contract type system need to support union types or discriminated unions?

Where this comes up:
- **Mixed-type arrays**: An `events` array containing `{ type: "click", x: number, y: number }` and `{ type: "scroll", offset: number }`. Common in event-sourcing patterns.
- **Polymorphic collections**: A single collection holding documents with different shapes distinguished by a discriminator field (single-table inheritance pattern). Common in MongoDB.
- **Optional/missing fields**: Mongo documents may omit fields entirely. `null` (field present, value null) is different from "field missing." The contract needs to express both.

For the PoC:
- Homogeneous arrays (`string[]`, `Comment[]`) cover the majority of use cases.
- Union types are a significant type system extension. Defer to post-PoC.
- **But note the gap**: if we defer this, the contract cannot express some common Mongo patterns. This is acceptable for architecture validation but would be a DX gap for real users.

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

## 8. Aggregation pipeline DSL: scope and timing

Aggregation pipelines are MongoDB's primary mechanism for complex queries — they replace SQL's `SELECT`, `JOIN`, `GROUP BY`, `HAVING`, subqueries, and window functions. They're both the ORM's internal compilation target (for complex queries) and a user-facing escape hatch (the Mongo equivalent of the SQL DSL).

**The question**: What is the right scope for aggregation pipeline support in the PoC vs. later?

Sub-questions:
- **As ORM compilation target**: The ORM needs to compile to *something*. For basic CRUD, `find()` / `insertOne()` / `updateOne()` / `deleteOne()` suffice. For includes via `$lookup`, the ORM would need to compile to aggregation pipelines. What's the minimum pipeline compilation needed for the PoC?
- **As user-facing DSL**: The SQL work stream has a SQL DSL (`db.sql.from(table).select(...)`) as the escape hatch for queries the ORM can't express. The Mongo equivalent would be a type-safe pipeline builder. This is a large surface area (20+ stages, dozens of operators) and nobody in the ecosystem has solved type-safe pipelines well. When does this ship?
- **Raw pipeline escape hatch**: As a minimum, let users pass a raw pipeline array (untyped) through the runtime. This validates that the execution plan and plugin pipeline accommodate non-SQL queries, without building a full DSL.

For the PoC: Compile to `find()` / `insertOne()` / `updateOne()` / `deleteOne()` for basic CRUD. Provide a raw pipeline escape hatch. Defer the type-safe pipeline DSL.

---

## 9. Change streams and the runtime's execution model

MongoDB change streams are resumable, ordered, real-time event streams. They're a core part of the Mongo-native experience (reactive UIs, event-driven architectures, CDC).

**The question**: Does PN's runtime model accommodate unbounded streaming queries?

The runtime currently produces `AsyncIterableResult<Row>` from queries. Change streams are a natural fit — they're async iterables of change events. But:
- The plugin pipeline has `afterExecute` semantics (called when the query completes). Change streams don't complete — they run indefinitely until closed.
- `beforeExecute` → `onRow` → `afterExecute` assumes a request-response lifecycle. Streaming subscriptions don't have a natural "after."
- Resume tokens (for reconnection after disconnects) need to be surfaced somehow.

For the PoC: Out of scope. But the architecture should not bake in assumptions that prevent streaming queries (e.g., "every query has a finite result set").

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
