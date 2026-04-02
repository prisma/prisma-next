# MongoDB Schema Migrations

Working document exploring what "schema migrations" means for MongoDB and how the migration system can manage server-side configuration.

## The earlier assumption was overstated

The MongoDB Family subsystem doc states that the migration runner is a non-goal because "MongoDB collections don't have DDL-level schemas." This is true for document *content* — MongoDB doesn't enforce field types or require columns to be declared — but it understates the amount of server-side configuration that needs to be managed in production.

MongoDB has a meaningful set of DDL-equivalent operations. These need to be versioned, applied in order, and coordinated with data migrations — exactly what a migration system does.

## What lives on the MongoDB server

### Indexes (highest value)

Indexes are created with `createIndex()` and dropped with `dropIndex()`. They are fully server-side, persistent, and affect query performance and data integrity. MongoDB supports many index types:

| Index type | Example | Notes |
|---|---|---|
| **Single field** | `{ email: 1 }` | Basic ascending/descending |
| **Compound** | `{ lastName: 1, firstName: 1 }` | Order matters for query optimization |
| **Unique** | `{ email: 1 }, { unique: true }` | Enforces uniqueness — creating on duplicated data fails |
| **Text** | `{ content: "text" }` | Full-text search |
| **Geospatial** | `{ location: "2dsphere" }` | Geo queries |
| **TTL** | `{ createdAt: 1 }, { expireAfterSeconds: 3600 }` | Auto-delete old documents |
| **Partial** | `{ email: 1 }, { partialFilterExpression: { active: true } }` | Index only matching documents |
| **Wildcard** | `{ "metadata.$**": 1 }` | Dynamic/unknown field shapes |
| **Vector search** (Atlas) | Atlas Search index definition | Separate API, Atlas-specific |

Index management is the most common and highest-value migration operation for MongoDB. Adding a unique index on a collection with duplicate values will fail — the kind of thing a migration system should handle (deduplicate first, then create index).

### JSON Schema validators

Collections can have server-enforced validation rules via `$jsonSchema`:

```javascript
db.createCollection("users", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["email", "name"],
      properties: {
        email: { bsonType: "string" },
        name: { bsonType: "string" },
        age: { bsonType: "int", minimum: 0 }
      }
    }
  }
})
```

Updated via `collMod`:

```javascript
db.runCommand({ collMod: "users", validator: { $jsonSchema: { ... } } })
```

The contract already describes the expected document shape (model fields with `nullable` and `codecId`). Generating a `$jsonSchema` validator from the contract is mechanical. This provides database-level write enforcement — complementing the application-level read validation resolved in [Q5](design-questions.md#5-schema-validation-and-read-time-guarantees).

Validation action can be `error` (reject) or `warn` (allow but log). Validation level can be `strict` (all documents) or `moderate` (only new/modified documents). These are useful migration knobs — `moderate` lets you tighten validation without breaking reads of legacy documents.

### Collection options

Collections carry server-side configuration:

- **Capped collections**: fixed-size, FIFO eviction (`{ capped: true, size: 1048576, max: 1000 }`)
- **Time series**: `{ timeseries: { timeField: "timestamp", metaField: "source", granularity: "minutes" } }`
- **Change stream pre/post images**: `{ changeStreamPreAndPostImages: { enabled: true } }`
- **Collation**: `{ collation: { locale: "en", strength: 2 } }` — affects sorting and comparison

### What is NOT server-side (but still lives in the contract)

- **Client-side field-level encryption (CSFLE)**: the encryption schema map (which fields to encrypt, with which keys/algorithms) is a client-side driver configuration (`AutoEncryptionOpts`). The key vault collection is stored in MongoDB, but the per-field encryption policy is passed to the driver at connection time. This is an adapter/driver concern, not a migration concern — it lives in the contract's `execution` section, not `storage`. See [Q13](design-questions.md#13-client-side-field-level-encryption-csfle-and-queryable-encryption) for the full analysis, including the insight that encryption algorithm constrains which query operators are available on a field (via trait intersection with the codec trait system).
- **Queryable Encryption** (MongoDB 6.0+): has some server-side encrypted collection metadata, but the configuration is primarily client-side. Also lives in the `execution` section.

## Contract representation

The contract's `storage.collections` section already has a placeholder for indexes. It could be extended to carry validators and collection options:

```json
"storage": {
  "collections": {
    "users": {
      "indexes": [
        {
          "fields": { "email": 1 },
          "options": { "unique": true }
        },
        {
          "fields": { "location": "2dsphere" }
        },
        {
          "fields": { "createdAt": 1 },
          "options": { "expireAfterSeconds": 86400 }
        }
      ],
      "validator": {
        "validationLevel": "moderate",
        "validationAction": "error"
      },
      "options": {
        "collation": { "locale": "en", "strength": 2 }
      }
    }
  }
}
```

The `$jsonSchema` validator content itself could be generated from the contract's model definitions rather than stored explicitly — the emitter knows the field types and nullability. The `validator` section in the contract would just carry the validation *policy* (level and action), not the schema content.

## Migration system implications

### What the migration system would do

1. **Diff two contracts** — compare `storage.collections` between the old and new contract
2. **Generate index operations** — `createIndex`, `dropIndex` for added/removed indexes
3. **Generate validator updates** — `collMod` with new `$jsonSchema` derived from the new contract's models
4. **Order operations** — data migrations before unique index creation (deduplicate first), index drops before data migrations that would violate them
5. **Handle index builds** — MongoDB builds indexes in the background by default (4.2+), but unique index creation on large collections can be slow. The migration system should handle this gracefully.

### Relationship to data migrations (ADR 176)

Schema migrations and data migrations are complementary, not competing:

- **Schema migrations** manage server-side configuration: indexes, validators, collection options. These are analogous to SQL DDL changes.
- **Data migrations** (ADR 176) manage document content: field renames, type changes, denormalization. These use the invariant-guarded transition model.

A typical migration sequence might be:

1. Data migration: deduplicate emails → postcondition: `db.users.aggregate([{ $group: { _id: "$email", count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }]).length === 0`
2. Schema migration: `createIndex({ email: 1 }, { unique: true })`
3. Schema migration: update `$jsonSchema` validator to match new contract

The migration graph from the SQL system can accommodate both — data migration nodes and schema migration nodes interleaved as needed.

### Indexes on polymorphic collections

When a collection holds multiple variants (STI — the only option in Mongo), variant-specific fields are absent from documents of other variants. An index on a variant-specific field must use a `partialFilterExpression` scoped to that variant's discriminator value, otherwise:

- Unique indexes fail (multiple documents missing the field all index as `null`)
- Non-unique indexes waste space indexing irrelevant documents

The migration system should derive the partial filter automatically: the contract already knows which model owns the field (`base` relationship) and the discriminator condition (`discriminator` + `variants`). No user intervention needed.

This is a cross-family concern — the same problem applies to SQL STI with Postgres partial indexes. See [ADR 173 § Indexes on variant-specific fields](../../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md#indexes-on-variant-specific-fields).

## Open questions

- **Validator generation**: Should the emitter generate `$jsonSchema` from the contract model definitions, or should users author validators independently? Automatic generation is more convenient; manual authoring is more flexible (you can validate things the contract doesn't express, like cross-field constraints).
- **Index identity**: How does the migration system identify "the same index" across contract versions? By name? By field set? If the user reorders compound index fields, is that a drop-and-recreate or a no-op?
- **Atlas-specific operations**: Atlas Search indexes and Vector Search indexes use a different API (Atlas Admin API, not `createIndex()`). Should the migration system handle these, or are they extension pack territory?
- **Rolling index builds**: For large collections, index creation can take minutes or hours. Should the migration system support async index builds with progress monitoring?

## Related

- [ADR 176 — Data migrations as invariant-guarded transitions](../../../architecture%20docs/adrs/ADR%20176%20-%20Data%20migrations%20as%20invariant-guarded%20transitions.md) — data migration model (complementary to schema migrations)
- [Q5 — Schema validation and read-time guarantees](design-questions.md#5-schema-validation-and-read-time-guarantees) — read validation policy in the execution section
- [Q14 — Schema evolution as data migration](design-questions.md#14-schema-evolution-as-data-migration-cross-workstream) — relationship between schema and data migrations
- [MongoDB Family subsystem doc](../../../architecture%20docs/subsystems/10.%20MongoDB%20Family.md) — current non-goals statement to be updated
