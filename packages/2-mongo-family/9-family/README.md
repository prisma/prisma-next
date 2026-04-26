# @prisma-next/family-mongo

Mongo family descriptor and family pack for Prisma Next.

## Purpose

This package is the Mongo family integration point for both control-plane assembly and authoring-time pack composition. It provides:

- the Mongo `ControlFamilyDescriptor` and `mongoTargetDescriptor` used by configs and CLI flows
- the pure-data Mongo family pack ref used by `contract.ts` authoring
- a cohesive dependency surface for the Mongo family, including `@prisma-next/mongo-contract-ts`

## Responsibilities

- **Control-plane assembly**: Exposes `mongoFamilyDescriptor` and `createMongoFamilyInstance()` for validation and emission flows.
- **Family hook integration**: Wires `mongoEmission` from `@prisma-next/mongo-emitter` into the family descriptor.
- **Target bridge**: Exposes a `mongoTargetDescriptor` built from `@prisma-next/target-mongo/pack` metadata for control-plane stacks.
- **Authoring-time family pack**: Exposes `@prisma-next/family-mongo/pack` so `defineContract(...)` can bind a Mongo contract to the Mongo family without importing control-plane code.
- **Validation and emission**: Delegates Mongo contract validation to `@prisma-next/mongo-contract` and contract emission to the shared emitter pipeline.

## Entrypoints

- `./control`: control-plane entrypoint exporting `mongoFamilyDescriptor`, `mongoTargetDescriptor`, `createMongoFamilyInstance`, and `MongoControlFamilyInstance`
- `./migration`: migration authoring — `Migration` class, factory functions, and strategies (re-exported from `@prisma-next/target-mongo/migration`)
- `./pack`: pure pack ref for TypeScript authoring flows such as `@prisma-next/mongo-contract-ts/contract-builder`
- `./schema-verify`: re-exports the pure `verifyMongoSchema(...)` from `@prisma-next/target-mongo/schema-verify`. `MongoFamilyInstance.schemaVerify` (i.e. `db verify --schema-only`) and the `MongoMigrationRunner` post-apply verify step both call into this shared verifier, so both surfaces agree on "matches the contract" by construction

## Usage

### Control plane

```typescript
import { createControlStack } from '@prisma-next/framework-components/control';
import { mongoFamilyDescriptor, mongoTargetDescriptor } from '@prisma-next/family-mongo/control';

const stack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
});

const familyInstance = mongoFamilyDescriptor.create(stack);

const contract = familyInstance.validateContract(contractJson);
const result = await familyInstance.emitContract({ contract });
```

### TypeScript authoring

```typescript
import mongoFamily from '@prisma-next/family-mongo/pack';
import { defineContract, field, model, rel, valueObject } from '@prisma-next/mongo-contract-ts/contract-builder';
import mongoTarget from '@prisma-next/target-mongo/pack';

const Address = valueObject('Address', {
  fields: {
    street: field.string(),
    zip: field.string().optional(),
  },
});

const Task = model('Task', {
  collection: 'tasks',
  storageRelations: {
    comments: { field: 'comments' },
  },
  fields: {
    _id: field.objectId(),
    type: field.string(),
    metadata: field.valueObject(Address).optional(),
  },
  relations: {
    comments: rel.hasMany('Comment'),
  },
  discriminator: {
    field: 'type',
    variants: {
      Bug: { value: 'bug' },
    },
  },
});

const Comment = model('Comment', {
  owner: Task,
  fields: {
    _id: field.objectId(),
    text: field.string(),
  },
});

export const contract = defineContract({
  family: mongoFamily,
  target: mongoTarget,
  valueObjects: { Address },
  models: { Task, Comment },
});
```

The current `contract.ts` slice supports roots and collections, typed reference relations, owned models with `storage.relations`, value objects, and discriminator-based polymorphism.

### Migration authoring

```typescript
import { MigrationCLI } from "@prisma-next/cli/migration-cli"
import { Migration, createIndex, createCollection }
  from "@prisma-next/family-mongo/migration"

class AddUsersCollection extends Migration {
  override describe() {
    return { from: "abc123", to: "def456", labels: ["add-users"] }
  }

  override get operations() {
    return [
      createCollection("users", {
        validator: { $jsonSchema: { required: ["email"] } },
        validationLevel: "strict",
      }),
      createIndex("users", [{ field: "email", direction: 1 }], { unique: true }),
    ]
  }
}

export default AddUsersCollection;
MigrationCLI.run(import.meta.url, AddUsersCollection);
```

Run `node migration.ts` to produce `ops.json` and `migration.json`. Use `--dry-run` to preview without writing.

## Package Structure

- `src/core/control-descriptor.ts`: `MongoFamilyDescriptor` implementation
- `src/core/control-instance.ts`: `createMongoFamilyInstance()` and `MongoControlFamilyInstance`
- `src/core/mongo-target-descriptor.ts`: pre-built control target descriptor derived from `@prisma-next/target-mongo/pack`
- `src/core/mongo-migration.ts`: `MongoMigration` class (fixes the `Migration<TOperation>` type parameter to `MongoMigrationPlanOperation`)
- `src/exports/control.ts`: control-plane entrypoint
- `src/exports/migration.ts`: migration authoring entrypoint
- `src/exports/pack.ts`: authoring-time family pack ref
- `src/exports/schema-verify.ts`: schema-verify entrypoint that re-exports from `@prisma-next/target-mongo/schema-verify`

## Dependencies

- `@prisma-next/framework-components`: control-plane types and stack assembly
- `@prisma-next/migration-tools`: generic `Migration<TOperation>` base class
- `@prisma-next/mongo-contract`: Mongo contract validation and types
- `@prisma-next/mongo-contract-ts`: Mongo `contract.ts` authoring surface
- `@prisma-next/mongo-emitter`: Mongo family emission hook
- `@prisma-next/mongo-query-ast`: Mongo command AST types (`MongoMigrationPlanOperation`)
- `@prisma-next/target-mongo`: Mongo target pack metadata and migration factories
