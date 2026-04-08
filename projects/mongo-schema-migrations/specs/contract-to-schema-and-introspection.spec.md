# Contract-to-Schema + Introspection Design

The `MongoSchemaIR` has two producers: **`contractToSchema`** (offline, from a prior contract) and **live introspection** (from a running MongoDB instance). Both produce the same `MongoSchemaIR`, so the planner doesn't know or care where the IR came from. This doc covers both producers and the schema verification flow.

## `contractToSchema` — offline IR construction

### Role

`contractToSchema` is part of the `TargetMigrationsCapability` interface. The CLI calls it during `migration plan` to produce the "from" state:

```
fromContract (prior contract, or null for new project)
    ↓ contractToSchema(fromContract)
MongoSchemaIR (origin state)
    ↓ passed to planner as schema
Planner diffs origin vs destination contract
```

### Implementation

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

### Symmetry with SQL

The SQL equivalent is `contractToSchemaIR()` in `@prisma-next/family-sql/control`. It converts `Contract<SqlStorage>` → `SqlSchemaIR`. The Mongo version is simpler because:

- **No column-to-field mapping**: MongoDB document fields match domain fields directly
- **No native type expansion**: MongoDB doesn't have parameterized column types
- **No FK-backing index synthesis**: MongoDB has no foreign keys
- **No dependency resolution**: No database extensions to install

The conversion is essentially a structural copy from contract types to IR classes.

### Package placement

Lives in `packages/3-mongo-target/` alongside the planner and runner, since it's target-specific (only the Mongo target needs it). Exposed via `TargetMigrationsCapability.contractToSchema`.

## Contract types (`MongoStorageCollection`)

The contract type must be extended to carry the server-side state that `contractToSchema` reads. Currently:

```typescript
type MongoStorageCollection = Record<string, never>;  // empty
```

After this project:

```typescript
interface MongoStorageIndex {
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly unique?: boolean;
  readonly sparse?: boolean;
  readonly expireAfterSeconds?: number;
  readonly partialFilterExpression?: Record<string, unknown>;
}

interface MongoStorageValidator {
  readonly jsonSchema: Record<string, unknown>;
  readonly validationLevel: 'strict' | 'moderate';
  readonly validationAction: 'error' | 'warn';
}

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

interface MongoStorageCollection {
  readonly indexes?: ReadonlyArray<MongoStorageIndex>;
  readonly validator?: MongoStorageValidator;
  readonly options?: MongoStorageCollectionOptions;
}
```

These are **contract types** (plain interfaces, JSON-serializable, part of `contract.json`). They're distinct from the **IR types** (AST classes, immutable, used for diffing). The contract types live in `@prisma-next/mongo-contract`; the IR types live in `@prisma-next/mongo-schema-ir`.

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

## Live introspection (future)

Live introspection reads the current server-side state from a running MongoDB instance and produces a `MongoSchemaIR`. This is a **non-goal** for the current project but the IR is designed to support it.

### How it would work

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

### Index introspection

```typescript
async function introspectIndexes(db: Db, collectionName: string): Promise<MongoSchemaIndex[]> {
  const rawIndexes = await db.collection(collectionName).listIndexes().toArray();

  return rawIndexes
    .filter(idx => idx.name !== '_id_')  // skip the default _id index
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

### Validator introspection

`listCollections()` returns collection info with `options.validator` (the raw MongoDB validator object):

```typescript
function introspectValidator(
  info: CollectionInfo,
): MongoSchemaValidator | undefined {
  const validator = info.options?.validator;
  if (!validator?.$jsonSchema) return undefined;

  return new MongoSchemaValidator({
    jsonSchema: validator.$jsonSchema,
    validationLevel: info.options?.validationLevel ?? 'strict',
    validationAction: info.options?.validationAction ?? 'error',
  });
}
```

### Collection options introspection

```typescript
function introspectCollectionOptions(
  info: CollectionInfo,
): MongoSchemaCollectionOptions | undefined {
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

## Schema verification (future)

Schema verification compares the expected state (from the contract) against the actual state (from introspection) and reports issues. This is the Mongo equivalent of `verifySqlSchema()`.

### How it would work

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

### Index verification

Index verification uses structural equivalence. An expected index is "satisfied" if any actual index has the same keys and semantic options. Names are ignored.

```typescript
function verifyIndexes(
  collection: string,
  expected: ReadonlyArray<MongoSchemaIndex>,
  actual: ReadonlyArray<MongoSchemaIndex>,
): SchemaIssue[] {
  const issues: SchemaIssue[] = [];

  for (const idx of expected) {
    const satisfied = actual.some(a => indexesEquivalent(a, idx));
    if (!satisfied) {
      issues.push({
        kind: 'index_missing',
        collection,
        index: formatIndexKeys(idx.keys),
      });
    }
  }

  return issues;
}
```

### Use cases for schema verification

1. **`db verify`** — compare contract expectations against a live database
2. **`migration status`** — detect drift between the marker's contract and the live schema
3. **Planner pre-validation** — verify the origin contract matches the live database before planning (optional safety check)
4. **Post-apply verification** — verify the database matches the destination contract after applying migrations

### Issue taxonomy

Following the SQL pattern's `SchemaIssue` type:

| Issue kind | Severity | Description |
|---|---|---|
| `collection_missing` | Error | Expected collection does not exist |
| `collection_extra` | Warning | Collection exists but is not in the contract |
| `index_missing` | Error | Expected index does not exist |
| `index_extra` | Warning | Index exists but is not in the contract |
| `validator_mismatch` | Error | Validator differs from contract |
| `validator_missing` | Error | Expected validator not present |
| `options_mismatch` | Warning | Collection options differ from contract |

## The `_id` index

MongoDB automatically creates a unique index on `_id` for every collection. This index cannot be dropped and is not modeled in the contract or schema IR. Both `contractToSchema` and live introspection filter it out (the introspection code above has `filter(idx => idx.name !== '_id_')`).

## M1 scope

For Milestone 1:
- `contractToSchema` handles indexes only (no validator or options conversion)
- Live introspection and schema verification are not implemented
- The IR and contract types include index support only
- Arktype validation accepts index definitions
