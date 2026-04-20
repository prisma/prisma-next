# MongoDB in Prisma Next — Status Update

## Starting point: your input shaped this

The [user journey](../../reference/mongodb-user-journey.md) you provided (the Lucas narrative) and the [feature priority list](../../reference/mongodb-feature-support-priorities.md) directly drove the design work. Every friction point Lucas hit — polymorphic fields falling back to `Json`, manual relationship definition, no data migration support, advanced features requiring raw queries — has a designed response in Prisma Next.

The full developer experience narrative is in [The User Promise](../../reference/mongodb-user-promise.md). This document is a status update: where we are on each of your priorities, what the experience looks like, and what the foundation provides for your engineers to build on.

---

## Your priorities → what we've done


| Your priority                               | Prisma ORM                    | PN status                       | What we did                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ----------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inheritance & Polymorphism** (high #1)    | Unsupported — `Json` fallback | **PoC proven**                  | `[discriminator`/`variants`/`base](../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)` in the contract. Proven end-to-end in the [demo app](../../examples/mongo-demo/test/blog.test.ts) — polymorphic task collection with Bug/Feature variants, variant-specific fields returned correctly. Emitter generates typed contract with discriminator/variants/base. Same mechanism for SQL STI/MTI. |
| **Representing Relationships** (high #2)    | Partial — no introspection    | **PoC proven**                  | Embedding via [model ownership](../../architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md) (`owner`). References via `on`. Both proven in the [demo app](../../examples/mongo-demo/test/blog.test.ts) — embedded Address/Comment via `owner`, referenced User→Task via `$lookup`. Contract makes embed vs. reference an explicit, first-class decision.                                                           |
| **Performance Standards** (high #3)         | Unknown                       | **In progress**                 | Plugin pipeline with [budget enforcement](../../architecture%20docs/subsystems/4.%20Runtime%20%26%20Plugin%20Framework.md) (query limits, execution time). Same pipeline for SQL and Mongo.                                                                                                                                                                                                                                                          |
| **Change Streams** (medium)                 | Unsupported                   | **Designed, building in April** | The runtime's unified execution surface is `[AsyncIterable<Row>](../../architecture%20docs/adrs/ADR%20124%20-%20Unified%20Async%20Iterable%20Execution%20Surface.md)` — change streams fit as a subscription sibling to the existing request/response interface. Building Mongo adapter plumbing in April.                                                                                                                                           |
| **Vector Search** (medium)                  | Unsupported                   | **Building in April**           | [Extension pack](../../architecture%20docs/adrs/ADR%20170%20-%20Codec%20trait%20system.md) architecture — same system that delivers pgvector for Postgres. Vector field type, similarity operators, vector index definitions. Targeted for April workstream.                                                                                                                                                                                         |
| **CSFLE / Queryable Encryption** (medium)   | Unsupported                   | **Designed**                    | Config lives in contract `[execution` section](1-design-docs/design-questions.md#13-client-side-field-level-encryption-csfle-and-queryable-encryption). Key insight: encryption algorithm constrains queryability — deterministic allows equality queries, random allows none. This feeds into the [trait system](../../architecture%20docs/adrs/ADR%20170%20-%20Codec%20trait%20system.md) so the query builder enforces it at compile time.        |
| **Geospatial** (medium)                     | Unsupported                   | **Planned**                     | Extension pack candidate — GeoJSON field types, spatial operators, `2dsphere` indexes.                                                                                                                                                                                                                                                                                                                                                               |
| **Atlas Search** (medium)                   | Unsupported                   | **Planned**                     | Extension pack candidate — search index definitions, `$search` operators.                                                                                                                                                                                                                                                                                                                                                                            |
| **Time Series** (medium)                    | Unsupported                   | **Planned**                     | Collection option in the contract's `storage.collections` section, managed via [schema migrations](1-design-docs/mongo-schema-migrations.md).                                                                                                                                                                                                                                                                                                        |
| **BSON Data Type Support** (low)            | Partial                       | **Implemented**                 | Codec registry with BSON codecs (ObjectId, Decimal128, etc.). Each codec declares [traits](../../architecture%20docs/adrs/ADR%20170%20-%20Codec%20trait%20system.md) (`equality`, `order`, `textual`, `numeric`) that gate which query operators are available.                                                                                                                                                                                      |
| **Polymorphic Array/Embedded Fields** (low) | `Json` fallback               | **Designed**                    | [Value objects](../../architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md) for structured embedded data and [union field types](../../architecture%20docs/adrs/ADR%20179%20-%20Union%20field%20types.md) for mixed-type fields. Both type-safe.                                                                                                                                                                        |
| **Index Creation** (low)                    | `@unique` and `@@index` only  | **Designed**                    | [Schema migrations](1-design-docs/mongo-schema-migrations.md) for MongoDB — contract diffs generate `createIndex`/`dropIndex`. Supports all index types (unique, compound, text, geo, TTL, partial, wildcard). Includes automatic [partial indexes for polymorphic collections](../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md#indexes-on-variant-specific-fields).                           |


---

## The developer experience

The full narrative with all code examples is in [The User Promise](../../reference/mongodb-user-promise.md). Here are the highlights — the capabilities that don't exist in any other TypeScript MongoDB tool today.

### Type-safe polymorphic collections

> **Status: PoC proven** — contract representation specified in [ADR 173](../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md). Emitter generates typed contract with discriminator/variants/base. Proven end-to-end in the [demo app](../../examples/mongo-demo/test/blog.test.ts) — polymorphic queries return variant-specific fields.

Your #1 priority. The contract declares the polymorphic structure — which field discriminates, which models are variants, and what discriminator value each uses:

```json
{
  "roots": { "tasks": "Task" },
  "models": {
    "Task": {
      "fields": {
        "id":    { "nullable": false, "codecId": "mongo/objectId@1" },
        "title": { "nullable": false, "codecId": "mongo/string@1" },
        "type":  { "nullable": false, "codecId": "mongo/string@1" }
      },
      "discriminator": { "field": "type" },
      "variants": {
        "Bug":     { "value": "bug" },
        "Feature": { "value": "feature" }
      },
      "storage": { "collection": "tasks" }
    },
    "Bug": {
      "base": "Task",
      "fields": {
        "severity": { "nullable": false, "codecId": "mongo/string@1" }
      }
    },
    "Feature": {
      "base": "Task",
      "fields": {
        "priority": { "nullable": false, "codecId": "mongo/int32@1" }
      }
    }
  }
}
```

Variants list only their own fields — they inherit the base's fields via the `base` reference. The persistence strategy is emergent: all variants share one collection (STI), the only option in Mongo. TypeScript produces a discriminated union with full narrowing:

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

Same mechanism works for SQL single-table inheritance — the domain declaration is identical, only the storage mappings change.

### First-class embedded documents and value objects

> **Status: Embedded entities via `owner` are PoC proven** — Address and Comment are embedded in User and Task respectively in the [demo app](../../examples/mongo-demo/test/blog.test.ts), returned automatically without `.include()`. **Value objects as a distinct contract concept** ([ADR 178](../../architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md)) and the **dot-path accessor** ([ADR 180](../../architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)) are designed but not yet implemented.

The contract makes the embed vs. reference decision explicit. Embedded entities use `owner` (proven in PoC). Value objects — structured data with no identity — will live in a dedicated `valueObjects` section, separate from `models` (entities with identity):

```json
{
  "roots": { "users": "User" },
  "models": {
    "User": {
      "fields": {
        "_id":               { "nullable": false, "codecId": "mongo/objectId@1" },
        "email":             { "nullable": false, "codecId": "mongo/string@1" },
        "homeAddress":       { "nullable": true,  "type": "Address" },
        "previousAddresses": { "nullable": false, "type": "Address", "many": true }
      },
      "storage": { "collection": "users" }
    }
  },
  "valueObjects": {
    "Address": {
      "fields": {
        "street":   { "nullable": false, "codecId": "mongo/string@1" },
        "city":     { "nullable": false, "codecId": "mongo/string@1" },
        "location": { "nullable": true,  "type": "GeoPoint" }
      }
    },
    "GeoPoint": {
      "fields": {
        "lat": { "nullable": false, "codecId": "mongo/double@1" },
        "lng": { "nullable": false, "codecId": "mongo/double@1" }
      }
    }
  }
}
```

Fields referencing value objects use `type` (pointing to a value object name) instead of `codecId` (pointing to a BSON codec). `many: true` means an array. Value objects can nest — Address contains an optional GeoPoint.

Embedded data is always present in query results (no `.include()` needed). The dot-path accessor navigates into nested structures with full type safety:

```typescript
const user = await db.users.first();
console.log(user.homeAddress.city);     // typed as string
console.log(user.homeAddress.location); // typed as GeoPoint | null

const nycUsers = await db.users
  .where(u => u("homeAddress.city").eq("NYC"))
  .all();
```

The accessor `u("homeAddress.city")` checks at compile time that `homeAddress` exists on User, `city` exists on Address, and `city` is a string — so `.eq()` is available but `.gt()` would require a numeric trait.

### Mongo-native update operators

> **Status: Designed** — field accessor and mutation semantics specified in [ADR 180](../../architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md). Basic `$set` updates proven in PoC ([update integration tests](../../packages/2-mongo-family/5-runtime/test/update.test.ts)). Trait-gated operators (`inc`, `push`, `pull`) not yet implemented.

Not a SQL-shaped update surface with `$set` bolted on — these are native Mongo operations with type-safe field access:

```typescript
await db.posts.where({ id: postId }).update(u => [
  u("stats.views").inc(1),             // $inc — atomic, no read-modify-write
  u("tags").push("featured"),          // $push — atomic array append
  u("metadata.lastEdited").set(now),   // $set on nested field
]);
```

The operators available depend on the field type — `inc` requires a numeric codec trait, `push`/`pull` require an array. The same trait system that gates SQL query operators gates Mongo mutation operators.

### Relation loading via `$lookup`

> **Status: PoC proven** — the ORM compiles `.include()` to `$lookup` aggregation pipelines ([ORM implementation](../../packages/2-mongo-family/4-orm/src/mongo-orm.ts)). Proven end-to-end in the [demo app](../../examples/mongo-demo/test/blog.test.ts) — tasks include their assigned user via `$lookup`. Refinement callbacks (nested `where`, `take`) not yet implemented.

Referenced relations are declared in the contract with `on` specifying the join fields:

```json
"User": {
  "fields": { ... },
  "relations": {
    "posts": {
      "to": "Post", "cardinality": "1:N",
      "on": { "localFields": ["_id"], "targetFields": ["authorId"] }
    }
  },
  "storage": { "collection": "users" }
}
```

The ORM compiles `.include()` to a `$lookup` aggregation pipeline — not N+1 application-level stitching:

```typescript
const usersWithPosts = await db.users
  .include('posts', posts =>
    posts.where(p => p.title.ilike('%mongo%')).take(5)
  )
  .take(10)
  .all();
```

Same `.include()` API as SQL. Embedded relations (value objects, owned entities) come for free — they're always present in the parent document, no include needed.

### Schema migrations for MongoDB

> **Status: Designed** — index, validator, and collection option management specified in the [schema migrations design doc](1-design-docs/mongo-schema-migrations.md). Cross-family partial index concern documented in [ADR 173](../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md#indexes-on-variant-specific-fields). Not yet implemented.

MongoDB has server-side configuration that needs to be managed. The contract's `storage.collections` section declares it:

```json
"storage": {
  "collections": {
    "users": {
      "indexes": [
        { "fields": { "email": 1 }, "options": { "unique": true } },
        { "fields": { "location": "2dsphere" } },
        { "fields": { "createdAt": 1 }, "options": { "expireAfterSeconds": 86400 } }
      ],
      "validator": { "validationLevel": "moderate", "validationAction": "error" }
    }
  }
}
```

The migration system diffs two contract versions and generates the operations:

- `createIndex` / `dropIndex` for index changes
- `collMod` for validator and collection option updates
- Automatic partial indexes for variant-specific fields in [polymorphic collections](../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md#indexes-on-variant-specific-fields) (scoped to the variant's discriminator value)
- Ordering with data migrations (deduplicate before creating unique index)

Schema migrations and data migrations use the **same graph-based migration system** as SQL. The migration graph interleaves schema nodes (index operations, validator updates) and data nodes (field renames, type coercions, embed-to-reference transitions) with dependency ordering. The only difference is the primitives: SQL emits DDL statements, Mongo emits `createIndex`/`collMod`/`updateMany`. The graph, ordering, and invariant-checking machinery is shared. See [ADR 176](../../architecture%20docs/adrs/ADR%20176%20-%20Data%20migrations%20as%20invariant-guarded%20transitions.md).

### Configurable read validation

> **Status: Designed** — resolution documented in [design-questions.md Q5](1-design-docs/design-questions.md#5-schema-validation-and-read-time-guarantees). Not yet implemented.

MongoDB is schemaless — documents returned from the database may not match the contract. PN makes this configurable in the contract's `execution` section:

```json
"execution": {
  "readValidation": "reject",
  "models": {
    "LegacyEvent": { "readValidation": "warn" }
  },
  "codecs": {
    "mongo/legacy_date@1": { "readValidation": "warn" }
  }
}
```

Three strategies: `reject` (throw on mismatch — greenfield default), `warn` (log and continue — incremental migration), `passthrough` (skip validation — performance-critical reads). Configurable at contract level, per-model, and per-codec. Write validation is always on — a non-configurable framework guarantee.

### Query surface: ORM → aggregation pipeline builder → raw

> **Status: ORM PoC proven. Aggregation pipeline builder planned. Raw escape hatch implemented.**

The query surface mirrors SQL's layered design:


| Layer                | SQL                                                | MongoDB                                               | Coverage                              |
| -------------------- | -------------------------------------------------- | ----------------------------------------------------- | ------------------------------------- |
| **ORM client**       | Fluent `.where().include().orderBy()` → SQL AST    | Same fluent API → find commands / `$lookup` pipelines | 90% of queries                        |
| **Query builder**    | Type-safe SQL DSL (`sql().from().select().join()`) | Type-safe aggregation pipeline builder (planned)      | Complex queries the ORM can't express |
| **Raw escape hatch** | Raw SQL strings                                    | Raw MongoDB commands / pipelines                      | Full database power, no type safety   |


The ORM handles the common case. When you need a `$group`, `$unwind`, or a multi-stage pipeline the ORM doesn't support, drop to the aggregation pipeline builder — still type-safe, still checked against the contract. When even that isn't enough, drop to raw commands through the runtime.

### Family-agnostic middleware and plugins

> **Status: Implemented** — plugin pipeline proven for SQL, same pipeline available for Mongo. See [Runtime & Middleware Framework](../../architecture%20docs/subsystems/4.%20Runtime%20%26%20Middleware%20Framework.md).

The runtime's plugin pipeline is family-agnostic. Any middleware that doesn't inspect the query AST works identically for SQL and Mongo:

- **Telemetry** — query timing, operation counts, latency histograms
- **Logging** — structured query logs with collection/table, operation type, duration
- **Authentication / access control** — check permissions before execution
- **Rate limiting** — throttle operations per tenant/user
- **Budget enforcement** — reject queries exceeding row/time limits

A plugin written for SQL works for Mongo without modification. Plugins that *do* inspect query structure (query rewriting, cost estimation) are family-specific, but they use the same registration and lifecycle API.

### Client-side field-level encryption (CSFLE)

> **Status: Designed** — configuration model resolved in [design-questions.md Q13](1-design-docs/design-questions.md#13-client-side-field-level-encryption-csfle-and-queryable-encryption). Not yet implemented.

CSFLE configuration (policy, not key material) lives in the contract's `execution` section:

```json
"execution": {
  "encryption": {
    "keyVaultNamespace": "encryption.__keyVault",
    "fields": {
      "User.ssn":            { "keyAltName": "ssn-key",     "algorithm": "AEAD_AES_256_CBC_HMAC_SHA_512-Deterministic" },
      "User.medicalRecords": { "keyAltName": "medical-key", "algorithm": "AEAD_AES_256_CBC_HMAC_SHA_512-Random" }
    }
  }
}
```

The key insight: encryption algorithm constrains queryability. Deterministic encryption allows equality queries (`eq`, `ne`). Random encryption allows no queries at all. This feeds into the [trait system](../../architecture%20docs/adrs/ADR%20170%20-%20Codec%20trait%20system.md) — the field's effective query operators are the intersection of its codec traits and its encryption constraints. The query builder enforces this at compile time.

### BSON data types via codecs

> **Status: Implemented** — core BSON codecs (ObjectId, String, Int32, Boolean, Date) shipped with the [Mongo adapter](../../packages/3-mongo-target/2-mongo-adapter/src/core/codecs.ts). Extensible via target codecs and custom extension packs.

Every BSON type is represented as a codec that declares its traits and encode/decode behavior. The core Mongo target ships with the essential codecs. Additional types are added without changing the ORM or query builder:

- **Target codecs** — the Mongo target can ship additional built-in codecs (Decimal128, Binary, Timestamp, etc.)
- **Extension pack codecs** — an extension pack contributes its own codecs with custom traits (e.g., a vector codec with a `cosineDistance` trait, a GeoJSON codec with a `nearSphere` trait)
- **Custom codecs** — users register their own codecs for application-specific BSON representations

The codec registry is the single point of extensibility for data types. Adding a new BSON type means registering a codec — the ORM, query builder, and trait system pick it up automatically.

---

## What's built, what's designed, what's next


| Status                      | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Implemented (PoC)**       | Mongo contract types and validation (including ADR 177 ownership, ADR 173 polymorphism validation), ORM client (basic CRUD, `$lookup` includes, embedded data), [Mongo emitter hook](../../packages/2-mongo-family/3-tooling/emitter/src/index.ts) (generates typed `contract.d.ts` with discriminator/variants/base/owner), shared domain-level type generation extracted to framework emitter, execution pipeline (MongoQueryPlan → adapter → driver → real MongoDB), codec registry (BSON codecs with trait-gated operators), [demo app](../../examples/mongo-demo/) wiring the full stack end-to-end with integration tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Designed (ADRs written)** | Domain/storage separation ([172](../../architecture%20docs/adrs/ADR%20172%20-%20Contract%20domain-storage%20separation.md)), Polymorphism ([173](../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)), Aggregate roots ([174](../../architecture%20docs/adrs/ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md)), Shared ORM Collection ([175](../../architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md)), Data migrations ([176](../../architecture%20docs/adrs/ADR%20176%20-%20Data%20migrations%20as%20invariant-guarded%20transitions.md)), Model ownership ([177](../../architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md) — implemented), Value objects ([178](../../architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md)), Union types ([179](../../architecture%20docs/adrs/ADR%20179%20-%20Union%20field%20types.md)), Dot-path accessor ([180](../../architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)) |
| **Design doc stage**        | [Schema migrations](1-design-docs/mongo-schema-migrations.md) (indexes, validators, collection options), [read validation policy](1-design-docs/design-questions.md#5-schema-validation-and-read-time-guarantees), [CSFLE/encryption](1-design-docs/design-questions.md#13-client-side-field-level-encryption-csfle-and-queryable-encryption)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **April workstream**        | Adapter, driver, and runtime hardening; schema migrations (indexes, validators, collection options); data migrations via invariant-guarded transitions; Vector Search extension pack; change stream support; introspection; typed aggregation pipeline builder                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |


---

## The foundation and what's next

The architecture separates concerns cleanly:

- **Contract representation** — the domain model (models, fields, relations, value objects, polymorphism) is family-agnostic. The same contract structure works for SQL and MongoDB. Family-specific details are scoped to `model.storage` and the top-level `storage` section.
- **Emitter** — the [Mongo emitter hook](../../packages/2-mongo-family/3-tooling/emitter/src/index.ts) validates Mongo-specific contract IR (collection references, ownership, variant storage) and generates typed `contract.d.ts` artifacts. Domain-level type generation (roots, models, relations, fields) is shared with the SQL emitter via [framework-level utilities](../../packages/1-framework/3-tooling/emitter/src/domain-type-generation.ts).
- **Shared ORM interface** — the `Collection` class with fluent chaining (`.where().include().orderBy().take().all()`) is the same for both families. What differs is internal compilation: SQL compiles to SQL AST, Mongo compiles to find commands or aggregation pipelines.
- **Codec + trait system** — codecs declare which operations a field type supports (`equality`, `order`, `textual`, `numeric`). The query builder and mutation builder use traits to gate operators at compile time. New BSON types are added by registering codecs — no ORM changes needed.
- **Extension pack architecture** — the same system that delivers pgvector for Postgres delivers Vector Search, Atlas Search, and Geospatial for MongoDB. An extension pack contributes codecs, operators, and index types.

### April workstream

Our team is building the key remaining components in April:

- **Schema migrations** — the same graph-based migration system used for SQL DDL handles MongoDB's DDL-equivalent operations: index creation/deletion, JSON Schema validator management, and collection options. Contract diffs produce the correct `createIndex`/`dropIndex`/`createCollection` operations. Partial indexes for polymorphic collections are generated automatically with discriminator-scoped `partialFilterExpression`.
- **Data migrations** — since MongoDB schema evolution *is* data migration, the invariant-guarded transition model ([ADR 176](../../architecture%20docs/adrs/ADR%20176%20-%20Data%20migrations%20as%20invariant-guarded%20transitions.md)) applies directly. Postconditions are Mongo queries, transformations are Mongo update operations, and the migration graph handles both SQL and Mongo migrations.
- **Adapter and driver** — production-quality adapter (proxying config to the MongoDB driver), driver implementation, connection management
- **Vector Search extension pack** — vector field type, similarity search operators, vector index definitions via the extension pack architecture
- **Change stream support** — surfacing the driver's change stream as an async iterable through the runtime's unified `AsyncIterable<Row>` execution surface
- **Introspection** — sampling documents to infer field types, detecting embedded subdocuments, convention-based relationship suggestions, generating a contract from an existing MongoDB database

### Where your engineers can contribute

The foundation is designed so your engineers can extend it without modifying core framework code:

- **Additional extension packs** — Atlas Search, Geospatial, Time Series — each contributes codecs, operators, and index types through the same extension pack architecture
- **Adapter refinements** — Atlas-specific configuration, advanced connection options (the adapter itself is a thin proxy to the driver)
- **BSON codec coverage** — adding codecs for remaining BSON types (Decimal128, Binary, Timestamp, etc.) is self-contained: register a codec, declare its traits, done
- **Driver-level features** — any MongoDB driver capability can be surfaced through the adapter/driver layer without touching the ORM or contract

The ADRs and design docs serve as the specification. Each one explains the problem, the alternatives considered, the decision, and the consequences — your engineers can read them and understand *why* each design choice was made, not just *what* was chosen.

---

## Open design questions

A few decisions are still open and may benefit from your team's input. The full list is in [design-questions.md](1-design-docs/design-questions.md); here are the ones most relevant to you:

- **Extension pack design for Atlas features** ([Q12](1-design-docs/design-questions.md#12-mongodb-specific-extension-packs)) — Vector Search, Atlas Search, Geospatial as extension packs. We're building Vector Search in April; your team's input on the Atlas Search and Geospatial pack design would be valuable.
- **Schema evolution patterns** ([Q14](1-design-docs/design-questions.md#14-schema-evolution-as-data-migration-cross-workstream)) — embed-to-reference transitions, field renames, type changes expressed as data migrations with machine-checkable postconditions
- **Introspection conventions** ([Q11](1-design-docs/design-questions.md#11-introspection-generating-a-contract-from-an-existing-database)) — we're building introspection in April. Input on common collection naming conventions, relationship detection heuristics, and polymorphic field inference would help us get this right.

