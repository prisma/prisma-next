# @prisma-next/target-mongo

MongoDB target pack for Prisma Next.

## Responsibilities

- **Target pack assembly**: Exports the MongoDB target pack for authoring and family composition
- **Target metadata**: Defines the stable Mongo target identity (`kind`, `familyId`, `targetId`, `version`, `capabilities`)
- **Codec type surface**: Exposes the base Mongo codec type map used by authoring-time type composition
- **Migration authoring**: Factory functions and strategies for hand-authored MongoDB migrations

## Entrypoints

- `./pack`: pure target pack ref used by `@prisma-next/family-mongo` and `@prisma-next/mongo-contract-ts`
- `./codec-types`: base Mongo codec type map
- `./migration`: migration authoring — `Migration` base class, factory functions, strategies

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

```typescript
import { Migration, createIndex, createCollection }
  from "@prisma-next/target-mongo/migration"

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

Run `node migration.ts` to produce `ops.json`. Use `--dry-run` to preview without writing.

### Available factories

- `createIndex(collection, keys, options?)` — create an index
- `dropIndex(collection, keys)` — drop an index
- `createCollection(collection, options?)` — create a collection
- `dropCollection(collection)` — drop a collection
- `collMod(collection, options)` — modify collection options

### Strategies

- `validatedCollection(name, schema, indexes)` — create a collection with a JSON Schema validator and indexes
