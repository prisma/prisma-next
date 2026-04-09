# M2: Full Index Vocabulary, Validators, and Collection Options

## Summary

Extend every layer of the MongoDB migration pipeline — contract types, schema IR, Arktype validation, DDL commands, planner, runner, serializer, CLI formatter, and PSL authoring — to cover the full breadth of MongoDB server-side configuration: all index types and options, `$jsonSchema` validators, and collection options. M1 proved the architecture works for a single ascending index; M2 fills in the vocabulary.

## Grounding example

A Prisma schema declares a `users` collection with a unique email index, a text index on `bio` with weights and language, a TTL index on `lastSeen`, and a `$jsonSchema` validator derived from model fields:

```prisma
model User {
  id        String   @id @map("_id")
  email     String   @unique
  bio       String
  lastSeen  DateTime

  @@index([bio], type: "text", weights: { bio: 10 }, defaultLanguage: "english")
  @@index([lastSeen], expireAfterSeconds: 2592000)
}
```

The contract's `storage.collections.users` carries:

```json
{
  "indexes": [
    { "keys": [{ "field": "email", "direction": 1 }], "unique": true },
    {
      "keys": [{ "field": "bio", "direction": "text" }],
      "weights": { "bio": 10 },
      "default_language": "english"
    },
    { "keys": [{ "field": "lastSeen", "direction": 1 }], "expireAfterSeconds": 2592000 }
  ],
  "validator": {
    "jsonSchema": {
      "bsonType": "object",
      "required": ["email", "bio", "lastSeen"],
      "properties": {
        "email": { "bsonType": "string" },
        "bio": { "bsonType": "string" },
        "lastSeen": { "bsonType": "date" }
      }
    },
    "validationLevel": "strict",
    "validationAction": "error"
  }
}
```

The planner diffs this against the prior contract's schema IR and emits `createIndex`, `dropIndex`, and `collMod` operations as needed. The runner applies them against a live MongoDB instance.

## What M2 adds (layer by layer)

### 1. Index options

M1 established the contract type `MongoStorageIndex` with `keys`, `unique`, `sparse`, `expireAfterSeconds`, and `partialFilterExpression`. The direction type `MongoIndexKeyDirection` already covers `1 | -1 | 'text' | '2dsphere' | '2d' | 'hashed'`.

M2 adds these index options to complete the vocabulary:

| Option | Type | Used by | Notes |
|---|---|---|---|
| `wildcardProjection` | `Record<string, 0 \| 1>` | Wildcard indexes (`$**`) | Include/exclude fields from wildcard index |
| `collation` | `Record<string, unknown>` | Any index | Per-index collation for case-insensitive matching |
| `weights` | `Record<string, number>` | Text indexes | Field weight assignment |
| `default_language` | `string` | Text indexes | Default language for text analysis |
| `language_override` | `string` | Text indexes | Per-document language override field name |

These options affect index behavior and must be part of the index lookup key for structural matching.

#### Wildcard indexes

Wildcard indexes use `$**` (or `path.$**`) as the **field name**, not as a direction value. Examples:

```typescript
// All fields
{ field: '$**', direction: 1 }

// Path-specific
{ field: 'attributes.$**', direction: 1 }

// Compound wildcard (MongoDB 7.0+)
[
  { field: 'tenantId', direction: 1 },
  { field: '$**', direction: 1 },
]
```

The `wildcardProjection` option only applies when the wildcard key is `$**` (not path-specific). `wildcardProjection` is part of the wildcard index's identity (it changes which fields are indexed).

#### Index options NOT modeled

These are excluded as legacy, debugging, or internal metadata:

- `hidden` — debugging tool (hide index from query planner without dropping)
- `textIndexVersion`, `2dsphereIndexVersion` — internal version metadata
- `min` / `max` / `bits` — legacy 2d index coordinate bounds
- `storageEngine` — per-index storage engine config (niche)

### 2. Validators

MongoDB supports `$jsonSchema` validators that reject documents not matching a schema. The validator is set at collection creation or modified via `collMod`.

#### Contract type

```typescript
interface MongoStorageValidator {
  readonly jsonSchema: Record<string, unknown>;
  readonly validationLevel: 'strict' | 'moderate';
  readonly validationAction: 'error' | 'warn';
}
```

Added as an optional field on `MongoStorageCollection`:

```typescript
interface MongoStorageCollection {
  readonly indexes?: ReadonlyArray<MongoStorageIndex>;
  readonly validator?: MongoStorageValidator;
  readonly options?: MongoStorageCollectionOptions;
}
```

#### Schema IR

`MongoSchemaValidator` is a new concrete class extending `MongoSchemaNode`:

```typescript
class MongoSchemaValidator extends MongoSchemaNode {
  readonly kind = 'validator' as const;
  readonly jsonSchema: Record<string, unknown>;
  readonly validationLevel: 'strict' | 'moderate';
  readonly validationAction: 'error' | 'warn';
}
```

The existing `MongoSchemaVisitor` already has a `validator(node)` method (typed as `unknown` in M1). M2 changes this to `validator(node: MongoSchemaValidator)`.

#### Validator diff classification

The planner classifies validator changes:

| Change | Classification | Rationale |
|---|---|---|
| No validator → validator added | `destructive` | New validation may reject existing documents |
| Validator removed | `widening` | Removes constraints |
| `validationAction` error → warn | `widening` | Relaxes enforcement |
| `validationAction` warn → error | `destructive` | Tightens enforcement |
| `validationLevel` strict → moderate | `widening` | Relaxes scope |
| `validationLevel` moderate → strict | `destructive` | Tightens scope |
| `$jsonSchema` body changed | `destructive` (default) | Conservative: any structural change to the schema body is treated as destructive |

The conservative default for `$jsonSchema` body changes is intentional. Proper JSON Schema subset detection is complex and out of scope for M2. The architecture validates that the migration system can handle validator operations; comprehensive diff classification can be refined later.

#### DDL command

A single `CollModCommand` handles both validator and collection option changes, matching how MongoDB's `collMod` command works:

```typescript
class CollModCommand extends MongoAstNode {
  readonly kind = 'collMod' as const;
  readonly collection: string;
  readonly validator?: Record<string, unknown>;
  readonly validationLevel?: 'strict' | 'moderate';
  readonly validationAction?: 'error' | 'warn';
  readonly changeStreamPreAndPostImages?: { enabled: boolean };
}
```

#### Operation structure

Validator operations use `listCollections` for checks (querying `options.validator`):

```typescript
const op: MongoMigrationPlanOperation = {
  id: 'validator.users.update',
  label: 'Update validator on users',
  operationClass: 'destructive',
  precheck: [{
    description: 'collection exists',
    source: new ListCollectionsCommand(),
    filter: MongoFieldFilter.eq('name', 'users'),
    expect: 'exists',
  }],
  execute: [{
    description: 'update validator on users',
    command: new CollModCommand('users', {
      validator: { $jsonSchema: { ... } },
      validationLevel: 'strict',
      validationAction: 'error',
    }),
  }],
  postcheck: [{
    description: 'validator applied',
    source: new ListCollectionsCommand(),
    filter: MongoAndExpr.of([
      MongoFieldFilter.eq('name', 'users'),
      MongoFieldFilter.eq('options.validationLevel', 'strict'),
    ]),
    expect: 'exists',
  }],
};
```

### 3. Collection options

MongoDB collections can be created with options that affect storage and behavior. Some options are immutable after creation; others can be modified via `collMod`.

#### Contract type

```typescript
interface MongoStorageCollectionOptions {
  readonly capped?: { size: number; max?: number };
  readonly timeseries?: {
    timeField: string;
    metaField?: string;
    granularity?: 'seconds' | 'minutes' | 'hours';
  };
  readonly collation?: Record<string, unknown>;
  readonly changeStreamPreAndPostImages?: { enabled: boolean };
  readonly clusteredIndex?: { name?: string };
}
```

`clusteredIndex` is modeled minimally — the key is always `{ _id: 1 }` and unique is always `true`, so only the optional name needs storing.

#### Schema IR

`MongoSchemaCollectionOptions` is a new concrete class extending `MongoSchemaNode`:

```typescript
class MongoSchemaCollectionOptions extends MongoSchemaNode {
  readonly kind = 'collectionOptions' as const;
  readonly capped?: { size: number; max?: number };
  readonly timeseries?: { timeField: string; metaField?: string; granularity?: 'seconds' | 'minutes' | 'hours' };
  readonly collation?: Record<string, unknown>;
  readonly changeStreamPreAndPostImages?: { enabled: boolean };
  readonly clusteredIndex?: { name?: string };
}
```

The `MongoSchemaVisitor`'s existing `collectionOptions(node)` method (typed as `unknown` in M1) is updated to `collectionOptions(node: MongoSchemaCollectionOptions)`.

#### Mutability rules

| Option | Set at creation | Modifiable via `collMod` | Planner behavior |
|---|---|---|---|
| `capped` | Yes | No | Conflict if changed on existing collection |
| `timeseries` | Yes | No | Conflict if changed on existing collection |
| `collation` | Yes | No | Conflict if changed on existing collection |
| `changeStreamPreAndPostImages` | Yes | Yes | `collMod` operation (widening or destructive) |
| `clusteredIndex` | Yes | No | Conflict if changed on existing collection |

For immutable options, the planner emits a `MigrationPlannerConflict` with guidance suggesting a manual migration (drop + recreate with new options).

#### DDL commands

```typescript
class CreateCollectionCommand extends MongoAstNode {
  readonly kind = 'createCollection' as const;
  readonly collection: string;
  readonly validator?: Record<string, unknown>;
  readonly validationLevel?: 'strict' | 'moderate';
  readonly validationAction?: 'error' | 'warn';
  readonly capped?: boolean;
  readonly size?: number;
  readonly max?: number;
  readonly timeseries?: { timeField: string; metaField?: string; granularity?: 'seconds' | 'minutes' | 'hours' };
  readonly collation?: Record<string, unknown>;
  readonly changeStreamPreAndPostImages?: { enabled: boolean };
  readonly clusteredIndex?: { key: Record<string, number>; unique: boolean; name?: string };
}

class DropCollectionCommand extends MongoAstNode {
  readonly kind = 'dropCollection' as const;
  readonly collection: string;
}
```

`CollModCommand` (defined above under Validators) also handles the mutable collection options (`changeStreamPreAndPostImages`).

#### Operation ordering

The planner emits operations in this deterministic order:

1. **Collection creates** (additive) — new collections first, so indexes on them can be created
2. **Index drops** (destructive) — drop obsolete indexes before creating replacements
3. **Index creates** (additive) — new indexes
4. **Validator updates** — after structural changes
5. **Collection option updates** — after structural changes
6. **Collection drops** (destructive) — last, most destructive

Within each category, operations are ordered lexicographically by collection name, then by index key spec.

### 4. PSL authoring

The Mongo PSL interpreter (`@prisma-next/mongo-contract-psl`) currently fills `storage.collections[name] = {}` — empty objects with no indexes, validators, or options. M2 adds:

#### Index attributes

Following the SQL PSL interpreter's pattern (`modelAttribute.name === 'index' | 'unique'`):

- **`@@index([field1, field2], ...options)`** — compound index on named fields
- **`@@unique([field1, field2], ...options)`** — same with `unique: true`
- **`@unique`** (field-level) — single-field unique index

Named arguments for Mongo-specific options:

```prisma
model User {
  email    String  @unique
  bio      String
  lastSeen DateTime

  @@index([bio], type: "text", weights: { bio: 10 }, defaultLanguage: "english")
  @@index([lastSeen], expireAfterSeconds: 2592000)
  @@index([email, tenantId], sparse: true)
}
```

The interpreter maps these to `MongoStorageIndex` entries in `storage.collections[collectionName].indexes`.

#### Validator derivation

The emitter auto-derives a `$jsonSchema` validator from model field definitions. The derivation maps contract field types to BSON types:

| Contract field type | BSON type |
|---|---|
| `String` | `"string"` |
| `Int` | `"int"` |
| `Float` | `"double"` |
| `Boolean` | `"bool"` |
| `DateTime` | `"date"` |
| `ObjectId` | `"objectId"` |
| Value object | `"object"` with nested properties |

Non-nullable fields are added to the `required` array. Nullable fields use `bsonType: ["<type>", "null"]`. Array fields (`many: true`) use `bsonType: "array"` with `items`.

The depth of derivation is bounded by the contract's expressiveness — the contract carries field types, nullability, and cardinality, which maps directly to a `$jsonSchema`. Features beyond contract expressiveness (enums, pattern validation, min/max constraints) are not auto-derived.

### 5. Canonical serialization for structural matching

M1's `buildIndexLookupKey` uses `JSON.stringify` for `partialFilterExpression`, which is key-order dependent. M2 adds new object-valued options (`wildcardProjection`, `collation`, `weights`) that have the same issue. The lookup key computation must use a canonical serialization that produces the same string regardless of key order.

```typescript
function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return String(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonicalize).join(',')}]`;
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  const entries = sorted.map(k => `${JSON.stringify(k)}:${canonicalize((obj as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}
```

The lookup key for M2 includes all identity-significant options:

```typescript
function buildIndexLookupKey(index: MongoSchemaIndex): string {
  const keys = index.keys.map(k => `${k.field}:${k.direction}`).join(',');
  const opts = [
    index.unique ? 'unique' : '',
    index.sparse ? 'sparse' : '',
    index.expireAfterSeconds != null ? `ttl:${index.expireAfterSeconds}` : '',
    index.partialFilterExpression ? `pfe:${canonicalize(index.partialFilterExpression)}` : '',
    index.wildcardProjection ? `wp:${canonicalize(index.wildcardProjection)}` : '',
    index.collation ? `col:${canonicalize(index.collation)}` : '',
    index.weights ? `wt:${canonicalize(index.weights)}` : '',
    index.default_language ? `lang:${index.default_language}` : '',
    index.language_override ? `lo:${index.language_override}` : '',
  ].filter(Boolean).join(';');
  return opts ? `${keys}|${opts}` : keys;
}
```

### 6. Updated DDL visitor and command executor

The `MongoDdlCommandVisitor<R>` interface gains methods for the new DDL commands:

```typescript
interface MongoDdlCommandVisitor<R> {
  createIndex(command: CreateIndexCommand): R;
  dropIndex(command: DropIndexCommand): R;
  createCollection(command: CreateCollectionCommand): R;
  dropCollection(command: DropCollectionCommand): R;
  collMod(command: CollModCommand): R;
}
```

Adding these methods forces compile-time updates to:
- `MongoCommandExecutor` (runner — maps to MongoDB driver calls)
- `MongoDdlCommandFormatter` (CLI — produces display strings)
- `mongo-ops-serializer` (serialization/deserialization)

#### Command executor mappings

| Visitor method | MongoDB driver call |
|---|---|
| `createIndex` | `collection.createIndex(keySpec, options)` |
| `dropIndex` | `collection.dropIndex(name)` |
| `createCollection` | `db.createCollection(name, options)` |
| `dropCollection` | `collection.drop()` |
| `collMod` | `db.command({ collMod: name, validator: ..., ... })` |

#### CLI formatter output

```
db.users.createIndex({ "bio": "text" }, { weights: { "bio": 10 }, default_language: "english" })
db.users.createIndex({ "lastSeen": 1 }, { expireAfterSeconds: 2592000 })
db.createCollection("events", { capped: true, size: 1048576 })
db.runCommand({ collMod: "users", validator: { $jsonSchema: { ... } }, validationLevel: "strict" })
db.orders.drop()
```

## Acceptance criteria

### Index vocabulary
- [ ] All index key types tested through full pipeline: ascending, descending, compound, text, geospatial (2d, 2dsphere), hashed, wildcard (`$**`, `path.$**`), compound wildcard
- [ ] All index options supported and tested: `unique`, `sparse`, `expireAfterSeconds`, `partialFilterExpression`, `wildcardProjection`, `collation`, `weights`, `default_language`, `language_override`
- [ ] Index lookup key uses canonical serialization (key-order independent) for object-valued options
- [ ] DDL formatter renders all index types and options correctly

### Validators
- [ ] `MongoStorageValidator` type in contract with `jsonSchema`, `validationLevel`, `validationAction`
- [ ] `MongoSchemaValidator` node in schema IR
- [ ] Arktype validation accepts validator definitions
- [ ] Planner generates `collMod` operations for validator changes
- [ ] Validator changes classified as widening or destructive
- [ ] Runner executes `collMod` with validator against real MongoDB
- [ ] `contractToSchema` converts validator from contract to IR

### Collection options
- [ ] `MongoStorageCollectionOptions` type with capped, timeseries, collation, changeStreamPreAndPostImages, clusteredIndex
- [ ] `MongoSchemaCollectionOptions` node in schema IR
- [ ] Arktype validation accepts collection option definitions
- [ ] `CreateCollectionCommand` DDL class with all options
- [ ] `DropCollectionCommand` DDL class
- [ ] `CollModCommand` DDL class for mutable options and validators
- [ ] Planner generates `createCollection` with options for new collections
- [ ] Planner emits conflicts for unsupported transitions (capped changes, timeseries changes, collation changes, clustered changes)
- [ ] Runner executes collection commands against real MongoDB

### PSL authoring
- [ ] Mongo PSL interpreter handles `@@index`, `@@unique`, `@unique`
- [ ] Mongo-specific index options parsed as named arguments (sparse, expireAfterSeconds, collation, type, weights, etc.)
- [ ] Emitter populates `storage.collections[].indexes` from PSL annotations
- [ ] Emitter auto-derives `$jsonSchema` validator from model field definitions
- [ ] Round-trip: PSL → contract → `contractToSchema` → planner produces correct operations

### Serialization
- [ ] New DDL commands (`CreateCollectionCommand`, `DropCollectionCommand`, `CollModCommand`) serialize/deserialize correctly
- [ ] All new index options serialize/deserialize in `CreateIndexCommand`
- [ ] Arktype validation schemas for all new command kinds

### End-to-end
- [ ] Integration test: compound indexes, TTL indexes, partial indexes, text indexes with weights, wildcard indexes → plan → apply → verify on `mongodb-memory-server`
- [ ] Integration test: validator added → `collMod` applied → verify validator on `mongodb-memory-server`
- [ ] Integration test: collection created with options (capped, collation, clusteredIndex) → verify options on `mongodb-memory-server`
- [ ] Integration test: second contract modifying validators and removing indexes → correct `collMod`/`dropIndex` operations → apply succeeds

## Alternatives considered

### Full JSON Schema subset detection for validator diffs

We could implement proper JSON Schema containment checking to classify validator changes as widening vs destructive more precisely (e.g., adding an optional field is widening, adding a required field is destructive). This is algorithmically complex (JSON Schema subsumption is co-NP-hard in the general case) and not needed for the architecture validation goals of M2. The conservative approach (any body change = destructive) is safe and can be refined later.

### Separate DDL commands per concern

We could have `UpdateValidatorCommand`, `UpdateCollectionOptionsCommand` as separate DDL classes instead of a single `CollModCommand`. MongoDB's `collMod` is one command that handles both, and splitting it would mean the command model diverges from MongoDB's actual API. A single `CollModCommand` is simpler, matches the database, and carries optional fields for each concern.

### Skip PSL authoring for M2

We could defer PSL authoring to a later milestone and continue using hand-crafted contracts. The authoring infrastructure already exists (`@prisma-next/mongo-contract-psl` with a working interpreter) and the SQL pattern for `@@index` / `@@unique` is proven. Adding Mongo index support is incremental work on existing infrastructure, and it's needed to prove the full contract-first flow (PSL → contract → migration) for MongoDB.
