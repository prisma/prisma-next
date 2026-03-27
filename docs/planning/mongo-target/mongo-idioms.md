# MongoDB Idioms

What patterns do experienced MongoDB developers use, expect their tools to support, and consider "the right way to do things"? This doc catalogs the idioms — not the primitives (see [mongodb-primitives-reference.md](mongodb-primitives-reference.md)) but the practices and patterns built on top of them.

For each idiom: what the developer does, a concrete example, and what it means for PN.

---

## Data modeling idioms

### Embed what you read together

The defining MongoDB idiom. If two pieces of data are always accessed together, store them in the same document. This eliminates joins and makes reads a single operation.

```javascript
// A blog post with its comments embedded
{
  _id: ObjectId("..."),
  title: "Why MongoDB",
  author: { name: "Alice", bio: "Engineer" },   // 1:1 embedded
  comments: [                                     // 1:N embedded
    { user: "Bob", text: "Great post!", createdAt: ISODate("...") },
    { user: "Carol", text: "Very helpful", createdAt: ISODate("...") }
  ]
}
```

**PN implication**: The contract must express embed vs. reference as a first-class choice. The ORM must handle embedded data differently from referenced data (no join needed, atomic writes, always loaded). See [design question #1](design-questions.md#1-embedded-documents-relation-field-or-distinct-concept).

### Reference what grows unboundedly or is accessed independently

When an embedded array would grow without limit, or when the related data needs to be queried on its own, store it in a separate collection with a reference.

```javascript
// users collection
{ _id: ObjectId("aaa"), name: "Alice" }

// orders collection — references user, queried independently
{ _id: ObjectId("bbb"), userId: ObjectId("aaa"), total: 99.99, items: [...] }
```

**PN implication**: The ORM must resolve references — either via application-level joining or `$lookup`. The contract's relation declarations drive this. See [design question #7](design-questions.md#7-relation-loading-application-level-joining-vs-lookup).

### Extended reference (partial denormalization)

Embed a subset of a referenced document's frequently-accessed fields to avoid a join for common reads, while keeping the full document in its own collection.

```javascript
// orders collection
{
  _id: ObjectId("..."),
  total: 99.99,
  customer: {
    _id: ObjectId("aaa"),    // the reference
    name: "Alice",            // denormalized subset
    email: "alice@example.com"
  }
}
```

The full `customer` document lives in the `customers` collection. The order embeds just the fields needed for display. The application maintains consistency when the customer's name or email changes.

**PN implication**: This pattern blurs the line between embedding and referencing. The contract would need to express "this embedded subdocument is a partial copy of a referenced model." PN could automate the denormalization (update the embedded copy when the source changes) or leave it to the user. This is a post-PoC concern but worth tracking — it's a very common Mongo pattern.

### Subset pattern

Embed only a bounded subset of a large related dataset to keep documents small, with the full dataset in a separate collection.

```javascript
// movie document — embeds only the 10 most recent reviews
{
  _id: ObjectId("..."),
  title: "Inception",
  recentReviews: [/* last 10 */],       // embedded subset
  reviewCount: 1247
}

// reviews collection — full dataset
{ _id: ObjectId("..."), movieId: ObjectId("..."), text: "Amazing!", rating: 5, ... }
```

**PN implication**: Similar to extended reference — partial data embedded, full data referenced. The ORM would need to know the relationship between the embedded subset and the full collection. This is an advanced pattern; out of scope for PoC.

### Polymorphic collection (single-collection inheritance)

Store documents of different "types" in one collection, distinguished by a discriminator field. Query them together or filter by type.

```javascript
// notifications collection
{ _id: ..., type: "email", recipient: "alice@...", subject: "Welcome", body: "..." }
{ _id: ..., type: "sms", recipient: "+1234567890", message: "Your code is 1234" }
{ _id: ..., type: "push", deviceId: "xyz", title: "New message", payload: {...} }
```

All three share some fields (`_id`, `type`, `recipient`-ish) but have type-specific fields. Queries like "find all notifications for user X" run against one collection.

**PN implication**: The contract needs discriminated unions — a base model with shared fields and variant models with type-specific fields. This is promoted to April validation scope. See [design question #6](design-questions.md#6-polymorphism-and-discriminated-unions-validate-in-april).

### Schema versioning

Add a `schemaVersion` field to documents. When the schema evolves, new documents get the new version; old documents are migrated lazily (on read) or in batch.

```javascript
// v1
{ _id: ..., schemaVersion: 1, name: "Alice Smith" }

// v2 — name split into firstName + lastName
{ _id: ..., schemaVersion: 2, firstName: "Alice", lastName: "Smith" }
```

The application code handles both versions, typically with a migration function that upgrades v1 → v2 on read.

**PN implication**: This is a data migration / schema evolution pattern. The migration workstream's data invariant model may provide a foundation. The contract's strict/permissive validation mode is relevant — strict mode would reject v1 documents if the contract describes v2. For Mongo users, permissive mode with lazy coercion may be more practical.

### Bucket pattern

Group time-series or sequential data into fixed-size "buckets" to avoid one document per event (too many small documents) or one unbounded array (document too large).

```javascript
// sensor_readings collection — one document per hour
{
  sensorId: "temp-1",
  bucket: ISODate("2025-03-27T14:00:00Z"),
  readings: [
    { ts: ISODate("...T14:01:00Z"), value: 22.3 },
    { ts: ISODate("...T14:02:00Z"), value: 22.4 },
    // ... up to 60 readings per bucket
  ],
  count: 42
}
```

**PN implication**: This is an advanced pattern used in IoT, metrics, and logging. The contract would describe the bucket document shape, including the bounded array. Out of scope for PoC, but the contract's array type support needs to accommodate it.

### Tree patterns

Represent hierarchical data (categories, org charts, file systems) using one of several strategies:

- **Parent reference**: Each node stores its parent's `_id`
- **Child reference**: Each node stores an array of children `_id`s
- **Materialized path**: Each node stores its full ancestry as a string (`"/"`, `"/electronics/"`, `"/electronics/phones/"`)
- **Nested sets**: Each node stores `left` and `right` values for efficient subtree queries

```javascript
// materialized path
{ _id: ..., name: "Phones", path: "/electronics/phones/" }
```

**PN implication**: These are application-level patterns on top of basic fields and references. PN doesn't need special support — the contract expresses the fields, and the ORM queries them normally. `$graphLookup` (recursive traversal) is the Mongo-native way to traverse trees and could be a future aggregation pipeline DSL feature.

---

## Query idioms

### Filter with dot notation on nested fields

Query embedded subdocuments using dot-separated paths. This is fundamental to how Mongo users think about querying nested data.

```javascript
db.users.find({ "address.city": "Springfield" })
db.posts.find({ "comments.user": "Bob" })
```

**PN implication**: The ORM's filter/where clause must support type-safe dot-notation for embedded fields. `user.address.city.eq("Springfield")` should typecheck that `address` exists on `User`, `city` exists on `Address`, and `city` is a string.

### Array element matching

Query documents where an array contains a specific value, all specified values, or an element matching complex criteria.

```javascript
db.posts.find({ tags: "mongodb" })                          // array contains value
db.posts.find({ tags: { $all: ["mongodb", "typescript"] } }) // contains all
db.posts.find({
  comments: { $elemMatch: { user: "Bob", rating: { $gte: 4 } } }  // element matches compound condition
})
```

**PN implication**: The ORM needs array-specific filter operators (`has`, `hasAll`, `hasSome`, `elemMatch`). These are trait-gated in PN's codec system — array fields get array operators, scalar fields don't.

### Projection (field selection)

Select only the fields you need, reducing data transfer and improving performance.

```javascript
db.users.find({}, { name: 1, email: 1, _id: 0 })
```

**PN implication**: The ORM's `select()` method maps directly. For embedded documents, projection can also select nested fields: `{ "address.city": 1 }`. This is more granular than SQL's column selection and may need special handling.

### Cursor-based pagination

Paginate using a field value (typically `_id` or an indexed field) rather than `skip`/`limit`, which degrades on large collections.

```javascript
// First page
db.users.find().sort({ _id: 1 }).limit(20)

// Next page — use the last _id from previous page
db.users.find({ _id: { $gt: lastId } }).sort({ _id: 1 }).limit(20)
```

**PN implication**: The SQL ORM already supports cursor-based pagination. The Mongo ORM should too — using `_id` or any indexed field as the cursor. The pattern is the same; the implementation differs (no `OFFSET`, use a range filter instead).

### Aggregation pipeline for analytics

Build multi-stage pipelines for grouping, joining, reshaping, and computing. This is how Mongo users think about anything beyond simple CRUD.

```javascript
db.orders.aggregate([
  { $match: { status: "completed" } },
  { $group: { _id: "$customerId", total: { $sum: "$amount" }, count: { $sum: 1 } } },
  { $sort: { total: -1 } },
  { $limit: 10 }
])
```

**PN implication**: The ORM covers basic CRUD. Aggregation pipelines are the escape hatch for everything else. A raw pipeline API is the PoC minimum; a type-safe pipeline builder is a future goal. See [design question #8](design-questions.md#8-aggregation-pipeline-dsl-scope-and-timing).

### Distinct values

Get unique values for a field, often for populating filter dropdowns or faceted search.

```javascript
db.products.distinct("category")
db.products.distinct("category", { inStock: true })
```

**PN implication**: A `distinct()` method on the ORM collection. Straightforward to support.

---

## Mutation idioms

### Atomic field-level updates

Update specific fields without reading or replacing the entire document. This is a defining Mongo mutation idiom — it avoids read-modify-write cycles and reduces contention.

```javascript
db.posts.updateOne(
  { _id: postId },
  {
    $set: { title: "New Title" },
    $inc: { views: 1 },
    $currentDate: { updatedAt: true }
  }
)
```

**PN implication**: The ORM's `update()` should support `$set` (implicit for plain data) and expose `$inc`, `$currentDate` as Mongo-native extensions. See [design question #4](design-questions.md#4-update-operators-shared-orm-surface-vs-mongo-native-operations).

### Atomic array mutations

Modify arrays in place without reading the document first.

```javascript
db.posts.updateOne({ _id: postId }, { $push: { tags: "new-tag" } })
db.posts.updateOne({ _id: postId }, { $pull: { tags: "old-tag" } })
db.posts.updateOne({ _id: postId }, { $addToSet: { tags: "unique-tag" } })
db.posts.updateOne({ _id: postId }, { $pop: { tags: 1 } })  // remove last element
```

Advanced: `$push` with `$each`, `$sort`, `$slice` for bounded sorted arrays:

```javascript
// Push a new review and keep only the 10 most recent
db.movies.updateOne(
  { _id: movieId },
  { $push: { recentReviews: { $each: [newReview], $sort: { createdAt: -1 }, $slice: 10 } } }
)
```

**PN implication**: Array mutation operators are a major Mongo-native capability. At minimum, `$push`, `$pull`, `$addToSet` should be exposed through the ORM. The advanced `$push` with modifiers is a later concern.

### Upsert (insert or update)

Insert a document if it doesn't exist, update it if it does. A single atomic operation.

```javascript
db.users.updateOne(
  { email: "alice@example.com" },
  { $set: { name: "Alice", lastLogin: new Date() }, $setOnInsert: { createdAt: new Date() } },
  { upsert: true }
)
```

`$setOnInsert` only applies if the document is being inserted (not updated). This is idiomatic for "ensure this document exists with these defaults."

**PN implication**: The SQL ORM already has `upsert()`. The Mongo version needs to support `$setOnInsert` for insert-only defaults.

### Bulk writes

Perform multiple write operations in a single request for efficiency.

```javascript
db.orders.bulkWrite([
  { insertOne: { document: { ... } } },
  { updateOne: { filter: { _id: id1 }, update: { $set: { status: "shipped" } } } },
  { deleteOne: { filter: { _id: id2 } } },
])
```

**PN implication**: `createMany`, `updateMany`, `deleteMany` are standard ORM operations. MongoDB's `bulkWrite` (mixed operation types in one call) is more expressive — potentially a future Mongo-specific ORM method.

### findOneAndUpdate / findOneAndDelete

Atomically find a document and modify it, returning either the original or modified version. Used for queue processing, distributed locks, and compare-and-swap patterns.

```javascript
// Process the next pending job atomically
const job = await db.jobs.findOneAndUpdate(
  { status: "pending" },
  { $set: { status: "processing", startedAt: new Date() } },
  { returnDocument: "after", sort: { priority: -1 } }
)
```

**PN implication**: These compound operations are important for concurrent workloads. They could map to an ORM method like `db.Jobs.where({ status: "pending" }).updateAndReturn(...)` or be available through the raw escape hatch initially.

---

## Operational idioms

### Change streams for reactivity

Subscribe to real-time data changes. Used for reactive UIs, event-driven architectures, cache invalidation, and cross-service synchronization.

```javascript
const stream = db.orders.watch([
  { $match: { "fullDocument.status": "completed" } }
]);

for await (const change of stream) {
  await notifyCustomer(change.fullDocument);
}
```

**PN implication**: Out of scope for PoC. The runtime's async iterable model is a natural fit, but the plugin pipeline's lifecycle semantics need to accommodate unbounded streams. See [design question #9](design-questions.md#9-change-streams-and-the-runtimes-execution-model).

### TTL for automatic expiration

Set a TTL index on a date field to automatically delete documents after a specified time. Used for sessions, temporary data, audit logs.

```javascript
db.sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 })
```

**PN implication**: A TTL index is a contract-level concern — the authoring surface needs to express it, and the contract captures it. This is a Mongo-specific index property with behavioral semantics (auto-deletion), not just query optimization.

### Read/write concern tuning

Control the durability and consistency guarantees per operation.

```javascript
// Strong consistency
db.accounts.find({ userId }).readConcern("majority")

// Fast writes, eventual durability
db.logs.insertOne(logEntry, { writeConcern: { w: 0 } })
```

**PN implication**: These are driver-level options that PN would pass through to the MongoDB driver. The adapter could expose them as per-operation options or as runtime configuration.

### Connection string options and replica set awareness

MongoDB developers are accustomed to configuring behavior via connection string parameters: replica set name, read preference, auth mechanism, TLS, etc.

**PN implication**: The adapter/driver layer passes these through. PN doesn't abstract over MongoDB's connection model.

---

## Patterns that challenge the ORM model

Some Mongo idioms don't fit neatly into the "models and relations" ORM paradigm:

- **Schemaless collections** — Collections used as key-value stores or log sinks where every document has a different shape. PN's contract model assumes a defined schema; these use cases are better served by the raw escape hatch.
- **MapReduce** — Legacy pattern replaced by aggregation pipelines. Not relevant for new development.
- **Capped collections** — Fixed-size collections that automatically overwrite oldest documents. A specialized storage type that the contract could express but the ORM doesn't need special support for.
- **GridFS** — Large file storage split across chunks. Not an ORM concern — use the MongoDB driver directly.
- **Server-side JavaScript** — Deprecated. Not relevant.
