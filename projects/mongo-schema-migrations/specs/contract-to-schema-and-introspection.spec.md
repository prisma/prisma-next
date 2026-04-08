# Contract-to-Schema + Introspection Design

## Grounding example

A contract describes a `users` collection with one compound index:

```json
{
  "storage": {
    "collections": {
      "users": {
        "indexes": [
          {
            "keys": [
              { "field": "email", "direction": 1 },
              { "field": "tenantId", "direction": 1 }
            ],
            "unique": true
          }
        ]
      }
    }
  }
}
```

`contractToSchema` converts this into a `MongoSchemaIR` — the AST the planner diffs against:

```typescript
const ir: MongoSchemaIR = {
  collections: {
    users: new MongoSchemaCollection({
      name: 'users',
      indexes: [
        new MongoSchemaIndex({
          keys: [
            { field: 'email', direction: 1 },
            { field: 'tenantId', direction: 1 },
          ],
          unique: true,
        }),
      ],
    }),
  },
};
```

The contract carries plain JSON; the IR carries frozen AST nodes ready for structural comparison. Everything in this doc is about how we get from one to the other — and how we extend the contract to carry enough server-side state to make that conversion complete.

## Decision

The contract carries the full server-side state (indexes, validators, collection options) in `storage.collections`. A target-specific `contractToSchema` function converts this into a `MongoSchemaIR` for the planner. Both the contract and introspection (future) produce the same IR, so the planner is source-agnostic.

```
fromContract (prior contract, or null for new project)
    ↓ contractToSchema(fromContract)
MongoSchemaIR (origin state)  ←  also producible by live introspection (future)
    ↓ passed to planner as schema
Planner diffs origin vs destination contract
```

## Contract type extensions

This is the core change — enriching `MongoStorageCollection` from an empty placeholder to a full description of server-side state.

### Before / after

Currently:

```typescript
type MongoStorageCollection = Record<string, never>;  // empty
```

After this project:

```typescript
interface MongoStorageCollection {
  readonly indexes?: ReadonlyArray<MongoStorageIndex>;
  readonly validator?: MongoStorageValidator;
  readonly options?: MongoStorageCollectionOptions;
}
```

### New types

**`MongoStorageIndex`** — a single index definition as it appears in `contract.json`:

```typescript
interface MongoStorageIndex {
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly unique?: boolean;
  readonly sparse?: boolean;
  readonly expireAfterSeconds?: number;
  readonly partialFilterExpression?: Record<string, unknown>;
}
```

**`MongoStorageValidator`** — the `$jsonSchema` validator and its policy:

```typescript
interface MongoStorageValidator {
  readonly jsonSchema: Record<string, unknown>;
  readonly validationLevel: 'strict' | 'moderate';
  readonly validationAction: 'error' | 'warn';
}
```

**`MongoStorageCollectionOptions`** — collection-level configuration:

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
}
```

These are **contract types** — plain interfaces, JSON-serializable, part of `contract.json`. They live in `@prisma-next/mongo-contract`. They are distinct from the **IR types** (AST classes, immutable, used for diffing) which live in `@prisma-next/mongo-schema-ir`. The emitter populates these contract types from authoring annotations (PSL `@@index`, `@@unique`, model field definitions), and the result flows into `contract.json`.

### Arktype validation

`MongoContractSchema` must be updated to validate the new structure. Currently `StorageCollectionSchema = type({ '+': 'reject' })` rejects all properties. After:

```typescript
const MongoIndexKeySchema = type({
  '+': 'reject',
  field: 'string',
  direction: "1 | -1 | 'text' | '2dsphere' | '2d' | 'hashed'",
});

const MongoStorageIndexSchema = type({
  '+': 'reject',
  keys: MongoIndexKeySchema.array(),
  'unique?': 'boolean',
  'sparse?': 'boolean',
  'expireAfterSeconds?': 'number',
  'partialFilterExpression?': 'Record<string, unknown>',
});

const MongoStorageValidatorSchema = type({
  '+': 'reject',
  jsonSchema: 'Record<string, unknown>',
  validationLevel: "'strict' | 'moderate'",
  validationAction: "'error' | 'warn'",
});

const StorageCollectionSchema = type({
  '+': 'reject',
  'indexes?': MongoStorageIndexSchema.array(),
  'validator?': MongoStorageValidatorSchema,
  'options?': MongoCollectionOptionsSchema,
});
```

## `contractToSchema` implementation

### Role

`contractToSchema` is part of the `TargetMigrationsCapability` interface. The CLI calls it during `migration plan` to produce the "from" state (the origin `MongoSchemaIR` that the planner diffs against the destination contract).

### Conversion logic

```typescript
function contractToMongoSchemaIR(contract: MongoContract | null): MongoSchemaIR {
  if (!contract) {
    return { collections: {} };
  }

  const collections: Record<string, MongoSchemaCollection> = {};

  for (const [collectionName, collectionDef] of Object.entries(contract.storage.collections)) {
    collections[collectionName] = convertCollection(collectionName, collectionDef);
  }

  return { collections };
}
```

### Collection conversion

Each `MongoStorageCollection` in the contract maps to a `MongoSchemaCollection` in the IR:

```typescript
function convertCollection(
  name: string,
  def: MongoStorageCollection,
): MongoSchemaCollection {
  return new MongoSchemaCollection({
    name,
    indexes: (def.indexes ?? []).map(convertIndex),
    validator: def.validator ? convertValidator(def.validator) : undefined,
    options: def.options ? convertOptions(def.options) : undefined,
  });
}

function convertIndex(index: MongoStorageIndex): MongoSchemaIndex {
  return new MongoSchemaIndex({
    keys: index.keys,
    unique: index.unique,
    sparse: index.sparse,
    expireAfterSeconds: index.expireAfterSeconds,
    partialFilterExpression: index.partialFilterExpression,
  });
}

function convertValidator(v: MongoStorageValidator): MongoSchemaValidator {
  return new MongoSchemaValidator({
    jsonSchema: v.jsonSchema,
    validationLevel: v.validationLevel,
    validationAction: v.validationAction,
  });
}
```

The conversion is a structural copy — contract types map 1:1 onto IR classes. This is intentionally simpler than the SQL equivalent (`contractToSchemaIR()` in `@prisma-next/family-sql/control`), which must handle column-to-field mapping, native type expansion, FK-backing index synthesis, and dependency resolution. MongoDB needs none of these because document fields match domain fields directly and there are no foreign keys or parameterized column types.

### Package placement

Lives in `packages/3-mongo-target/` alongside the planner and runner, since it's target-specific (only the Mongo target needs it). Exposed via `TargetMigrationsCapability.contractToSchema`.

## The `_id` index

MongoDB automatically creates a unique index on `_id` for every collection. This index cannot be dropped and is not modeled in the contract or schema IR. Both `contractToSchema` and live introspection (future) filter it out. In the introspection code, this manifests as `filter(idx => idx.name !== '_id_')`.

The `_id` index is invisible to the planner — it never appears in a diff, is never created or dropped by a migration, and is never reported as "missing" or "extra" by schema verification.

## Future: Introspection and Verification

The `MongoSchemaIR` is designed to have two producers: `contractToSchema` (offline, implemented now) and live introspection (from a running MongoDB instance, future). This section sketches how live introspection and schema verification would work. Neither is in scope for this project.

### Live introspection

Live introspection reads the current server-side state from a running MongoDB instance and produces a `MongoSchemaIR`:

```typescript
async function introspectMongo(db: Db): Promise<MongoSchemaIR> {
  const collections: Record<string, MongoSchemaCollection> = {};

  const collectionInfos = await db.listCollections().toArray();
  for (const info of collectionInfos) {
    if (info.name.startsWith('system.') || info.name === '_prisma_migrations') {
      continue;
    }

    const indexes = await introspectIndexes(db, info.name);
    const validator = introspectValidator(info);
    const options = introspectCollectionOptions(info);

    collections[info.name] = new MongoSchemaCollection({
      name: info.name,
      indexes,
      validator,
      options,
    });
  }

  return { collections };
}
```

Index introspection maps `listIndexes()` output into `MongoSchemaIndex` nodes, filtering out the default `_id` index:

```typescript
async function introspectIndexes(db: Db, collectionName: string): Promise<MongoSchemaIndex[]> {
  const rawIndexes = await db.collection(collectionName).listIndexes().toArray();

  return rawIndexes
    .filter(idx => idx.name !== '_id_')
    .map(idx => {
      const keys: MongoIndexKey[] = Object.entries(idx.key).map(([field, dir]) => ({
        field,
        direction: dir as MongoIndexKeyDirection,
      }));

      return new MongoSchemaIndex({
        keys,
        unique: idx.unique ?? false,
        sparse: idx.sparse,
        expireAfterSeconds: idx.expireAfterSeconds,
        partialFilterExpression: idx.partialFilterExpression,
      });
    });
}
```

Validator and collection options introspection read from `listCollections()` options:

```typescript
function introspectValidator(info: CollectionInfo): MongoSchemaValidator | undefined {
  const validator = info.options?.validator;
  if (!validator?.$jsonSchema) return undefined;

  return new MongoSchemaValidator({
    jsonSchema: validator.$jsonSchema,
    validationLevel: info.options?.validationLevel ?? 'strict',
    validationAction: info.options?.validationAction ?? 'error',
  });
}

function introspectCollectionOptions(info: CollectionInfo): MongoSchemaCollectionOptions | undefined {
  const opts = info.options;
  if (!opts) return undefined;

  const hasRelevantOptions =
    opts.capped || opts.timeseries || opts.collation || opts.changeStreamPreAndPostImages;
  if (!hasRelevantOptions) return undefined;

  return new MongoSchemaCollectionOptions({
    capped: opts.capped ? { size: opts.size, max: opts.max } : undefined,
    timeseries: opts.timeseries,
    collation: opts.collation,
    changeStreamPreAndPostImages: opts.changeStreamPreAndPostImages,
  });
}
```

### Schema verification

Schema verification compares the expected state (from the contract) against the actual state (from introspection) and reports issues. This is the Mongo equivalent of `verifySqlSchema()`.

```typescript
function verifyMongoSchema(options: {
  readonly contract: MongoContract;
  readonly actual: MongoSchemaIR;
}): readonly SchemaIssue[] {
  const expected = contractToMongoSchemaIR(options.contract);
  const issues: SchemaIssue[] = [];

  for (const [name, expectedCollection] of Object.entries(expected.collections)) {
    const actualCollection = options.actual.collections[name];
    if (!actualCollection) {
      issues.push({ kind: 'collection_missing', collection: name });
      continue;
    }

    issues.push(...verifyIndexes(name, expectedCollection.indexes, actualCollection.indexes));
    issues.push(...verifyValidator(name, expectedCollection.validator, actualCollection.validator));
    issues.push(...verifyOptions(name, expectedCollection.options, actualCollection.options));
  }

  return issues;
}
```

Index verification uses structural equivalence — an expected index is "satisfied" if any actual index has the same keys and semantic options. Names are ignored.

Use cases: `db verify` (contract vs live database), `migration status` (detect drift), planner pre-validation (verify origin matches live state), post-apply verification (verify destination matches live state).

Issue taxonomy (following the SQL `SchemaIssue` pattern):

| Issue kind | Severity | Description |
|---|---|---|
| `collection_missing` | Error | Expected collection does not exist |
| `collection_extra` | Warning | Collection exists but is not in the contract |
| `index_missing` | Error | Expected index does not exist |
| `index_extra` | Warning | Index exists but is not in the contract |
| `validator_mismatch` | Error | Validator differs from contract |
| `validator_missing` | Error | Expected validator not present |
| `options_mismatch` | Warning | Collection options differ from contract |

## Alternatives considered

**Why store `$jsonSchema` in the contract (not derive it at plan time)?** The contract is the unambiguous, hash-stable representation of required database state. If the `$jsonSchema` were derived at plan time, the same contract could produce different migration plans depending on the derivation logic version — breaking the guarantee that a contract hash uniquely identifies a database state. Storing the derived schema in the contract makes the planner a pure diff engine with no derivation responsibilities.

**Why separate contract types from IR types?** Contract types (`MongoStorageIndex` etc.) are JSON-serializable plain interfaces — they must be stable, hash-friendly, and part of `contract.json`. IR types (`MongoSchemaIndex` etc.) are frozen AST classes optimized for structural comparison via visitor dispatch — they carry behavior (`.accept()`, `.freeze()`) and may evolve independently (e.g., adding computed properties for diffing). Merging them would either make the contract carry behavior it shouldn't, or make the IR lose the structural guarantees the planner depends on.

## M1 scope

For Milestone 1:
- `contractToSchema` handles indexes only (no validator or options conversion)
- Live introspection and schema verification are not implemented
- The IR and contract types include index support only
- Arktype validation accepts index definitions
