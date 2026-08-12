# @prisma-next/sqlite

One-package SQLite setup for Prisma Next. Install this single package to get config, runtime, contract authoring, control-plane access, and migration helpers — no reach-ins to internal packages required.

## Package Classification

- **Domain**: extensions
- **Layer**: adapters
- **Planes**: shared (config, contract-builder), migration (control, migration), runtime (runtime)

## Quick Start

```typescript
// prisma-next.config.ts
import { defineConfig } from '@prisma-next/sqlite/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: { connection: 'path/to/app.db' },
});
```

```typescript
// prisma/contract.ts
import { defineContract, field, model } from '@prisma-next/sqlite/contract-builder';

export default defineContract({
  models: {
    User: model('User', { fields: { id: field.id.uuidv4String() } }),
  },
});
```

## Exports

### `@prisma-next/sqlite/config`

Simplified `defineConfig` that pre-wires all SQLite internals (family, target, adapter, driver, contract providers). Accepts `contract`, `db.connection`, `extensions`, and `migrations.dir`.

```typescript
import { defineConfig } from '@prisma-next/sqlite/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: { connection: 'path/to/app.db' },
  migrations: { dir: 'migrations/app' },
});
```

### `@prisma-next/sqlite/contract-builder`

TypeScript contract authoring DSL (`defineContract`, `field`, `model`, `rel`, …). The `defineContract` facade pre-binds `family` and `target` — callers do not pass those fields.

```typescript
import { defineContract, field, model } from '@prisma-next/sqlite/contract-builder';

export default defineContract({
  models: {
    User: model('User', { fields: { id: field.id.uuidv4String() } }),
  },
});
```

### `@prisma-next/sqlite/control`

Control-plane client factory. Collapses the family + target + adapter + driver wiring into a single call.

```typescript
import { createSqliteControlClient } from '@prisma-next/sqlite/control';

const control = createSqliteControlClient({
  connection: 'path/to/app.db',
});
await control.dbUpdate({ migrations: { dir: 'migrations/app' } });
```

### `@prisma-next/sqlite/migration`

Re-exports all migration operation helpers from `@prisma-next/target-sqlite/migration` (`Migration`, `MigrationCLI`, `col`, `lit`, `fn`, `primaryKey`, `foreignKey`, `unique`, `addColumn`, `dropTable`, `createIndex`, `dropIndex`, `dropColumn`, `recreateTable`, `dataTransform`, `placeholder`, `rawSql`). `createTable` is no longer a free export — it is a protected method on `Migration`; call it as `this.createTable({...})` inside `get operations()`.

### `@prisma-next/sqlite/runtime`

Composes the SQLite execution stack and returns typed query roots (`db.sql`, `db.orm`, `db.context`, `db.stack`).

## Dependencies

This package bundles all the transitive dependencies needed for a SQLite Prisma Next project:

- `@prisma-next/target-sqlite` (target descriptor + migration surface)
- `@prisma-next/adapter-sqlite` (adapter descriptor)
- `@prisma-next/driver-sqlite` (driver descriptor)
- `@prisma-next/sql-contract-ts` (TypeScript contract authoring)
- `@prisma-next/sql-contract` (contract type definitions)

## Related Docs

- Architecture: `docs/Architecture Overview.md`
- Subsystem: `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`
- Subsystem: `docs/architecture docs/subsystems/5. Adapters & Targets.md`
