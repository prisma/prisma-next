# @prisma-next/mongo

One-package MongoDB setup for Prisma Next. Install this single package to get config, runtime, contract authoring, control-plane access, and BSON value constructors — no reach-ins to internal packages required.

> **Breaking change:** the top-level `@prisma-next/mongo` barrel (`import { ObjectId } from '@prisma-next/mongo'`) has been removed. Move BSON constructor imports to `@prisma-next/mongo/bson`:
>
> ```diff
> - import { ObjectId } from '@prisma-next/mongo';
> + import { ObjectId } from '@prisma-next/mongo/bson';
> ```

## Package Classification

- **Domain**: extensions
- **Layer**: adapters
- **Planes**: shared (config, contract-builder, bson, family, target), migration (control), runtime (runtime)

## Quick Start

```typescript
// prisma-next.config.ts
import { defineConfig } from '@prisma-next/mongo/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: { connection: process.env['MONGODB_URL']! },
});
```

```typescript
// prisma/contract.ts
import { defineContract, field, model } from '@prisma-next/mongo/contract-builder';

export default defineContract({
  models: {
    User: model('User', { fields: { id: field.objectId() } }),
  },
});
```

## Exports

### `@prisma-next/mongo/config`

Simplified `defineConfig` that pre-wires all MongoDB internals (family, target, adapter, driver, contract providers). Accepts `contract`, `db`, `extensions`, and `migrations.dir`.

```typescript
import { defineConfig } from '@prisma-next/mongo/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: { connection: process.env['MONGODB_URL']! },
  migrations: { dir: 'migrations/app' },
});
```

### `@prisma-next/mongo/contract-builder`

TypeScript contract authoring DSL (`defineContract`, `field`, `model`, `rel`, `index`, `valueObject`, …). The `defineContract` facade pre-binds `family` and `target` — callers do not pass those fields.

```typescript
import { defineContract, field, model } from '@prisma-next/mongo/contract-builder';

export default defineContract({
  models: {
    User: model('User', { fields: { id: field.objectId() } }),
  },
});
```

### `@prisma-next/mongo/control`

Control-plane client factory. Collapses the family + target + adapter + driver wiring into a single call.

```typescript
import { createMongoControlClient } from '@prisma-next/mongo/control';

const control = createMongoControlClient({
  connection: process.env['MONGODB_URL']!,
});
await control.dbUpdate({ migrations: { dir: 'migrations/app' } });
```

### `@prisma-next/mongo/bson`

BSON value constructors for use in seed scripts, fixtures, and tests.

```typescript
import { ObjectId } from '@prisma-next/mongo/bson';

const id = new ObjectId();
```

Exports: `Binary`, `Decimal128`, `Long`, `MongoClient`, `ObjectId`, `Timestamp`.

### `@prisma-next/mongo/runtime`

Re-exports `createMongoRuntime` from `@prisma-next/mongo-runtime` for composing the MongoDB execution pipeline.

### `@prisma-next/mongo/family`

Re-exports the MongoDB family pack (only needed when using the low-level API; `defineContract` pre-binds this for you).

### `@prisma-next/mongo/target`

Re-exports the MongoDB target pack (only needed when using the low-level API; `defineContract` pre-binds this for you).

## Dependencies

This package bundles all the transitive dependencies needed for a MongoDB Prisma Next project, including those referenced in the emitted `contract.d.ts`:

- `@prisma-next/mongo-contract` (contract type definitions)
- `@prisma-next/adapter-mongo` (adapter + codec types)
- `@prisma-next/contract` (shared contract types)

## Related Docs

- Architecture: `docs/Architecture Overview.md`
- Subsystem: `docs/architecture docs/subsystems/5. Adapters & Targets.md`
