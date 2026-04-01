# MongoDB in Prisma Next — Status Update

## Starting point: your input shaped this

The [user journey](../../reference/mongodb-user-journey.md) you provided (the Lucas narrative) and the [feature priority list](../../reference/mongodb-feature-support-priorities.md) directly drove the design work. Every friction point Lucas hit — polymorphic fields falling back to `Json`, manual relationship definition, no data migration support, advanced features requiring raw queries — has a designed response in Prisma Next.

The full developer experience narrative is in [The User Promise](../../reference/mongodb-user-promise.md). This document is a status update: where we are on each of your priorities, what the experience looks like, and what the foundation provides for your engineers to build on.

---

## Your priorities → what we've done

| Your priority | Prisma ORM | PN status | What we did |
|---|---|---|---|
| **Inheritance & Polymorphism** (high #1) | Unsupported — `Json` fallback | **Designed** | [`discriminator`/`variants`/`base`](../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md) in the contract. Type-safe discriminated unions with TypeScript narrowing. Works for both models and [value objects](../../architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md). Same mechanism for SQL STI/MTI. |
| **Representing Relationships** (high #2) | Partial — no introspection | **Designed** | Embedding via [model ownership](../../architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md) (`owner` property). References via `on` with local/target fields. Contract makes embed vs. reference an explicit, first-class decision — not hidden, because it affects atomicity and performance. |
| **Performance Standards** (high #3) | Unknown | **In progress** | Plugin pipeline with [budget enforcement](../../architecture%20docs/subsystems/4.%20Runtime%20%26%20Plugin%20Framework.md) (query limits, execution time). Same pipeline for SQL and Mongo. |
| **Change Streams** (medium) | Unsupported | **Planned** | Async iterable model — natural fit for PN's runtime. Not yet designed. |
| **Vector Search** (medium) | Unsupported | **Planned** | [Extension pack](../../architecture%20docs/adrs/ADR%20170%20-%20Codec%20trait%20system.md) architecture — same system that delivers pgvector for Postgres. Vector field type, similarity operators, vector index definitions. |
| **CSFLE / Queryable Encryption** (medium) | Unsupported | **Designed** | Config lives in contract [`execution` section](1-design-docs/design-questions.md#13-client-side-field-level-encryption-csfle-and-queryable-encryption). Key insight: encryption algorithm constrains queryability — deterministic allows equality queries, random allows none. This feeds into the [trait system](../../architecture%20docs/adrs/ADR%20170%20-%20Codec%20trait%20system.md) so the query builder enforces it at compile time. |
| **Geospatial** (medium) | Unsupported | **Planned** | Extension pack candidate — GeoJSON field types, spatial operators, `2dsphere` indexes. |
| **Atlas Search** (medium) | Unsupported | **Planned** | Extension pack candidate — search index definitions, `$search` operators. |
| **Time Series** (medium) | Unsupported | **Planned** | Collection option in the contract's `storage.collections` section, managed via [schema migrations](1-design-docs/mongo-schema-migrations.md). |
| **BSON Data Type Support** (low) | Partial | **Implemented** | Codec registry with BSON codecs (ObjectId, Decimal128, etc.). Each codec declares [traits](../../architecture%20docs/adrs/ADR%20170%20-%20Codec%20trait%20system.md) (`equality`, `order`, `textual`, `numeric`) that gate which query operators are available. |
| **Polymorphic Array/Embedded Fields** (low) | `Json` fallback | **Designed** | [Value objects](../../architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md) for structured embedded data and [union field types](../../architecture%20docs/adrs/ADR%20179%20-%20Union%20field%20types.md) for mixed-type fields. Both type-safe. |
| **Index Creation** (low) | `@unique` and `@@index` only | **Designed** | [Schema migrations](1-design-docs/mongo-schema-migrations.md) for MongoDB — contract diffs generate `createIndex`/`dropIndex`. Supports all index types (unique, compound, text, geo, TTL, partial, wildcard). Includes automatic [partial indexes for polymorphic collections](../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md#indexes-on-variant-specific-fields). |

---

## The developer experience

The full narrative with all code examples is in [The User Promise](../../reference/mongodb-user-promise.md). Here are the highlights — the capabilities that don't exist in any other TypeScript MongoDB tool today.

### Type-safe polymorphic collections

Your #1 priority. A `tasks` collection with Bug and Feature variants, fully typed:

```typescript
const tasks = await db.tasks
  .where(t => t.assigneeId.eq(userId))
  .all();
// tasks: (Bug | Feature)[]

for (const task of tasks) {
  if (task.type === 'bug') {
    console.log(task.severity);  // Bug-specific field, fully typed
  }
}
```

The contract declares the polymorphic structure — `discriminator` field, variant models, discriminator values. TypeScript produces a discriminated union. The ORM queries one collection with automatic narrowing. Same mechanism works for SQL single-table inheritance. [ADR 173](../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)

### First-class embedded documents and value objects

Embedding is explicit and type-safe. Value objects (structured data with no identity — Address, GeoPoint) are distinct from entities:

```typescript
// Embedded data is always present — no include/populate needed
const user = await db.users.first();
console.log(user.homeAddress.city);     // typed as string
console.log(user.homeAddress.location); // typed as GeoPoint | null

// Query through nested structures with dot-path accessor
const nycUsers = await db.users
  .where(u => u("homeAddress.city").eq("NYC"))
  .all();
```

The dot-path accessor (`u("homeAddress.city")`) navigates into nested value objects with full type safety — autocomplete, type checking, and the correct operators for the leaf field's type. [ADR 178](../../architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md), [ADR 180](../../architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)

### Mongo-native update operators

Not a SQL-shaped update surface with `$set` bolted on — these are native Mongo operations with type-safe field access:

```typescript
await db.posts.where({ id: postId }).update(u => [
  u("stats.views").inc(1),             // $inc — atomic, no read-modify-write
  u("tags").push("featured"),          // $push — atomic array append
  u("metadata.lastEdited").set(now),   // $set on nested field
]);
```

The operators available depend on the field type — `inc` requires a numeric codec trait, `push`/`pull` require an array. The same trait system that gates SQL query operators gates Mongo mutation operators. [ADR 180](../../architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)

### Relation loading via `$lookup`

Referenced relations (data in separate collections) are loaded via `$lookup` in aggregation pipelines — not application-level stitching:

```typescript
const usersWithPosts = await db.users
  .include('posts', posts =>
    posts.where(p => p.title.ilike('%mongo%')).take(5)
  )
  .take(10)
  .all();
```

Same `.include()` API as SQL. The ORM compiles this to an aggregation pipeline with `$lookup` stages. Embedded relations (value objects, owned entities) come for free — they're always present in the parent document.

### Schema migrations for MongoDB

MongoDB has server-side configuration that needs to be managed: indexes, JSON Schema validators, collection options (capped, time series, collation). PN's migration system diffs two contracts and generates the operations:

- `createIndex` / `dropIndex` for index changes
- `collMod` for validator and collection option updates
- Automatic partial indexes for variant-specific fields in polymorphic collections
- Ordering with data migrations (deduplicate before creating unique index)

[Schema migrations design doc](1-design-docs/mongo-schema-migrations.md)

---

## What's built, what's designed, what's next

| Status | What |
|---|---|
| **Implemented (PoC)** | Mongo contract types and validation, ORM client (basic CRUD with fluent chaining), execution pipeline (MongoQueryPlan → MongoDriver), codec registry (BSON codecs with trait-gated operators), integration tests against real MongoDB |
| **Designed (ADRs written)** | Domain/storage separation ([172](../../architecture%20docs/adrs/ADR%20172%20-%20Contract%20domain-storage%20separation.md)), Polymorphism ([173](../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)), Aggregate roots ([174](../../architecture%20docs/adrs/ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md)), Shared ORM Collection ([175](../../architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md)), Data migrations ([176](../../architecture%20docs/adrs/ADR%20176%20-%20Data%20migrations%20as%20invariant-guarded%20transitions.md)), Model ownership ([177](../../architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md)), Value objects ([178](../../architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md)), Union types ([179](../../architecture%20docs/adrs/ADR%20179%20-%20Union%20field%20types.md)), Dot-path accessor ([180](../../architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)) |
| **Design doc stage** | [Schema migrations](1-design-docs/mongo-schema-migrations.md) (indexes, validators, collection options), [read validation policy](1-design-docs/design-questions.md#5-schema-validation-and-read-time-guarantees), [CSFLE/encryption](1-design-docs/design-questions.md#13-client-side-field-level-encryption-csfle-and-queryable-encryption), [$lookup relation loading](1-design-docs/design-questions.md#7-relation-loading-application-level-joining-vs-lookup) |
| **Future** | Introspection (generate contract from existing DB), change streams, extension packs (Vector Search, Atlas Search, Geospatial), typed aggregation pipeline builder |

---

## The foundation and the handoff

The architecture separates concerns cleanly:

- **Contract representation** — the domain model (models, fields, relations, value objects, polymorphism) is family-agnostic. The same contract structure works for SQL and MongoDB. Family-specific details are scoped to `model.storage` and the top-level `storage` section.
- **Shared ORM interface** — the `Collection` class with fluent chaining (`.where().include().orderBy().take().all()`) is the same for both families. What differs is internal compilation: SQL compiles to SQL AST, Mongo compiles to find commands or aggregation pipelines.
- **Codec + trait system** — codecs declare which operations a field type supports (`equality`, `order`, `textual`, `numeric`). The query builder and mutation builder use traits to gate operators at compile time. New BSON types are added by registering codecs — no ORM changes needed.
- **Extension pack architecture** — the same system that delivers pgvector for Postgres delivers Vector Search, Atlas Search, and Geospatial for MongoDB. An extension pack contributes codecs, operators, and index types.

What your engineers would build on this foundation:

- **Adapter refinements** — connection pooling, driver configuration, Atlas-specific options
- **Extension packs** — Vector Search, Atlas Search, Geospatial, Time Series
- **Change stream support** — surfacing the driver's change stream as an async iterable through PN's runtime
- **Introspection** — sampling documents to infer field types, detecting embedded subdocuments, convention-based relationship suggestions

The ADRs and design docs serve as the specification. Each one explains the problem, the alternatives considered, the decision, and the consequences — your engineers can read them and understand *why* each design choice was made, not just *what* was chosen.

---

## Open design questions

A few decisions are still open and may benefit from your team's input. The full list is in [design-questions.md](1-design-docs/design-questions.md); here are the ones most relevant to you:

- **Introspection strategy** ([Q11](1-design-docs/design-questions.md#11-introspection-generating-a-contract-from-an-existing-database)) — how to infer schemas from existing databases (document sampling, type inference, relationship detection)
- **Extension pack design for Atlas features** ([Q12](1-design-docs/design-questions.md#12-mongodb-specific-extension-packs)) — Vector Search, Atlas Search, Geospatial as extension packs
- **Schema evolution patterns** ([Q14](1-design-docs/design-questions.md#14-schema-evolution-as-data-migration-cross-workstream)) — embed-to-reference transitions, field renames, type changes as data migrations
