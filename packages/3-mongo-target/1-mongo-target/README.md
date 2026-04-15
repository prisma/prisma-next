# @prisma-next/target-mongo

MongoDB target pack for Prisma Next.

## Responsibilities

- **Target pack assembly**: Exports the MongoDB target pack for authoring and family composition
- **Target metadata**: Defines the stable Mongo target identity (`kind`, `familyId`, `targetId`, `version`, `capabilities`)
- **Codec type surface**: Exposes the base Mongo codec type map used by authoring-time type composition
- **Migration factories and strategies**: Atomic factory functions and compound strategies for MongoDB migration operations

## Entrypoints

- `./pack`: pure target pack ref used by `@prisma-next/family-mongo` and `@prisma-next/mongo-contract-ts`
- `./codec-types`: base Mongo codec type map
- `./migration`: factory functions and strategies (the `Migration` base class is in `@prisma-next/family-mongo/migration`)

## Usage

### Contract definition

```typescript
import mongoFamily from '@prisma-next/family-mongo/pack';
import { defineContract } from '@prisma-next/mongo-contract-ts/contract-builder';
import mongoTarget from '@prisma-next/target-mongo/pack';

const contract = defineContract({
  family: mongoFamily,
  target: mongoTarget,
});
```

### Migration authoring

Import from `@prisma-next/family-mongo/migration` for the full authoring experience (Migration class + factories + strategies):

```typescript
import { Migration, createIndex, createCollection }
  from "@prisma-next/family-mongo/migration"

export default class extends Migration {
  plan() {
    return [
      createCollection("users", {
        validator: { $jsonSchema: { required: ["email"] } },
        validationLevel: "strict",
      }),
      createIndex("users", [{ field: "email", direction: 1 }], { unique: true }),
    ]
  }
}

Migration.run(import.meta.url)
```

Run `node migration.ts` to produce `ops.json` and `migration.json` (when `describe()` is implemented). Use `--dry-run` to preview without writing.

### Available factories

- `createIndex(collection, keys, options?)` — create an index
- `dropIndex(collection, keys)` — drop an index
- `createCollection(collection, options?)` — create a collection
- `dropCollection(collection)` — drop a collection
- `collMod(collection, options)` — modify collection options

### Strategies

- `validatedCollection(name, schema, indexes)` — create a collection with a JSON Schema validator and indexes
