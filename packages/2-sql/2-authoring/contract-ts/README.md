# @prisma-next/sql-contract-ts

**Status:** Phase 2 - SQL-specific contract authoring surface composed with generic core

This package contains the SQL-specific TypeScript contract authoring surface for Prisma Next.

## Package Classification

- **Domain**: sql
- **Layer**: authoring
- **Plane**: migration

**Note**: SQL authoring may depend on SQL core layer (e.g., `@prisma-next/sql-contract/types`) within the same domain.

## Overview

This package is part of the SQL family namespace (`packages/2-sql/2-authoring/contract-ts`) and provides:
- SQL contract builder (`defineContract`) in two forms:
  - legacy chain builder
  - refined Option A object-literal authoring with `model('User', { fields, relations }).attributes(...).sql(...)`
- SQL contract JSON schema - JSON schema for validating contract structure

## Responsibilities

- **SQL Contract Builder**: Provides both the existing chain builder and the refined Option A authoring surface for creating SQL contracts programmatically with type safety
- **Storage Type Authoring**: Supports `storage.types` declarations and `typeRef` columns via the SQL builder
- **SQL Contract JSON Schema**: Provides JSON schema for validating contract structure in IDEs and tooling
- **Composition Layer**: Composes the target-agnostic builder core from `@prisma-next/contract-authoring` with SQL-specific types and validation logic
- **Generated Defaults**: Supports client-generated defaults via `ColumnDefault.kind = 'generated'` in contract authoring

## Package Status

This package was created in Phase 1 and refactored in Phase 2. It now composes the target-agnostic builder core from `@prisma-next/contract-authoring` with SQL-specific types and validation logic.

## Architecture

- **Composes generic core**: Uses `@prisma-next/contract-authoring` for generic builder state management (`TableBuilder`, `ModelBuilder`, `ContractBuilder` base class)
- **SQL-specific types**: Provides SQL-specific contract types (`SqlContract`, `SqlStorage`, `SqlMappings`) from `@prisma-next/sql-contract/types`
- **SQL-specific build()**: Implements SQL-specific `build()` method in `SqlContractBuilder` that constructs `SqlContract` instances with SQL-specific structure (uniques, indexes, foreignKeys arrays)

```mermaid
flowchart LR
  builderInput[TS builder calls] --> sqlContractTs[@prisma-next/sql-contract-ts]
  sqlContractTs --> authoringCore[@prisma-next/contract-authoring]
  sqlContractTs --> sqlTypes[@prisma-next/sql-contract/types]
  sqlContractTs --> contractIR[SQL ContractIR]
```

This package is part of the package layering architecture:
- **Location**: `packages/2-sql/2-authoring/contract-ts` (SQL family namespace)
- **Ring**: SQL family namespace (can import from core, authoring, targets, and other SQL family packages)

## Exports

- `./contract-builder` - Contract builder API (`defineContract`, `field`, `model`, `rel`, `ColumnBuilder`)
- `./config-types` - TypeScript contract config helper (`typescriptContract`)
- `./schema-sql` - SQL contract JSON schema (`data-contract-sql-v1.json`)

## Usage

### Building Contracts

#### Refined Option A

The refined surface keeps domain meaning close to the model:
- field-level `id()` and `unique()` for the common single-field case
- `.attributes(...)` for compound `id` and compound `unique`
- optional staged `.relations(...)` for mutually recursive model graphs
- `.sql(...)` for table naming, indexes, and foreign keys

```typescript
import { defineContract, field, model, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import { textColumn, timestamptzColumn } from '@prisma-next/adapter-postgres/column-types';
import { uuidv4 } from '@prisma-next/ids';

const User = model('User', {
  fields: {
    id: field.generated(uuidv4()).id({ name: 'app_user_pkey' }),
    email: field.column(textColumn).unique({ name: 'app_user_email_key' }),
    createdAt: field.column(timestamptzColumn).defaultSql('now()'),
  },
});

const Post = model('Post', {
  fields: {
    id: field.generated(uuidv4()).id(),
    userId: field.column(textColumn),
    title: field.column(textColumn),
  },
});

export const contract = defineContract({
  target: postgresPack,
  naming: { tables: 'snake_case', columns: 'snake_case' },
  models: {
    User: User.relations({
      posts: rel.hasMany(Post, { by: 'userId' }),
    }).sql({
      table: 'app_user',
    }),
    Post: Post.relations({
      user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
    }).sql({
      table: 'blog_post',
    }),
  },
});
```

Compound model-level constraints live in `.attributes(...)`:

```typescript
const Membership = model('Membership', {
  fields: {
    orgId: field.column(textColumn).column('org_id'),
    userId: field.column(textColumn).column('user_id'),
    role: field.column(textColumn),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.orgId, fields.userId], { name: 'membership_pkey' }),
    uniques: [
      constraints.unique([fields.orgId, fields.role], {
        name: 'membership_org_role_key',
      }),
    ],
  }))
  .sql({ table: 'membership' });
```

This first slice intentionally keeps the scalar vocabulary pack-driven:

- use pack-provided column descriptors with `field.column(...)`
- use generated-column specs such as `uuidv4()` with `field.generated(...)`
- use root `types` plus `field.namedType(...)` for `storage.types` references
- use named model tokens plus `User.refs.id` or `User.ref('id')` for cross-model foreign-key targets
- keep `constraints.ref('Model', 'field')` only as a fallback when you do not have a named token in scope
- use `field.id()` for single-field identity and `.attributes(({ fields, constraints }) => ({ id: constraints.id([...]) }))` for compound identity
- use `field.unique()` for single-field uniqueness and `.attributes(({ fields, constraints }) => ({ uniques: [constraints.unique([...])] }))` for compound uniqueness

#### Legacy Chain Builder

```typescript
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import pgvector from '@prisma-next/extension-pgvector/pack';
import { enumColumn, enumType, int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';

const contract = defineContract()
  .target(postgresPack)
  .extensionPacks({ pgvector })
  .storageType('Role', enumType('role', ['USER', 'ADMIN']))
  .table('user', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('email', { type: textColumn, nullable: false })
      .column('role', { type: enumColumn('Role', 'role') })
      .primaryKey(['id'], 'user_pkey')           // Named primary key
      .unique(['email'], 'user_email_unique')    // Named unique constraint
      .index(['email'], 'user_email_idx'),       // Named index
  )
  .table('post', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('userId', { type: int4Column, nullable: false })
      .column('title', { type: textColumn, nullable: false })
      .primaryKey(['id'])
      .foreignKey(['userId'], { table: 'user', columns: ['id'] }, 'post_userId_fkey'),  // Named FK
  )
  .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
  .model('Post', 'post', (m) => m.field('id', 'id').field('userId', 'userId').field('title', 'title'))
  .foreignKeys({ constraints: true, indexes: false })  // Optional FK config
  .build();
```

#### Table Builder Methods

The table builder supports the following constraint methods:

| Method | Description |
|--------|-------------|
| `.primaryKey(columns, name?)` | Define primary key with optional name |
| `.unique(columns, name?)` | Add unique constraint with optional name |
| `.index(columns, name?)` | Add index with optional name |
| `.foreignKey(columns, references, name?)` | Add foreign key with optional name |

#### Contract-Level Foreign Key Configuration

The builder supports a `.foreignKeys()` method to control FK constraint and index emission:

```typescript
const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  // ...tables and models...
  .foreignKeys({ constraints: true, indexes: false })  // Emit FK constraints but skip backing indexes
  .build();
```

| Config | Default | Description |
|--------|---------|-------------|
| `constraints` | `true` | Emit `FOREIGN KEY` constraints in DDL |
| `indexes` | `true` | Emit FK-backing indexes (e.g., `CREATE INDEX ... ON post (user_id)`) |

When `.foreignKeys()` is not called, defaults to `{ constraints: true, indexes: true }`. See [ADR 161](../../../docs/architecture%20docs/adrs/ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md).

### Validating Contracts

Contract JSON validation now lives in `@prisma-next/sql-contract/validate` (shared plane), while this package focuses on authoring/building contracts.

```typescript
import { validateContract } from '@prisma-next/sql-contract/validate';
import type { Contract } from './contract.d';

const contract = validateContract<Contract>(contractJson);
```

### Config Helper

Use `typescriptContract` from this package when wiring TS-authored contracts in `prisma-next.config.ts`.

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import { contract } from './src/prisma/contract';

export default defineConfig({
  // ...
  contract: typescriptContract(contract, 'src/prisma/contract.json'),
});
```

## Dependencies

- **`@prisma-next/contract-authoring`** - Target-agnostic builder core (builder state types, builder classes, type helpers)
- **`@prisma-next/contract`** - Core contract types (`ContractBase`)
- **`@prisma-next/core-control-plane`** - Contract config types used by `typescriptContract`
- **`@prisma-next/sql-contract`** - SQL contract types (`SqlContract`, `SqlStorage`, `SqlMappings`)
- **`arktype`** - Runtime validation
- **`ts-toolbelt`** - Type utilities

## Testing

Integration tests that depend on both `sql-contract-ts` and `sql-query` are located in `@prisma-next/integration-tests` to avoid cyclic dependencies.

## Migration Notes

- **Refined Option A is the long-term direction**: `defineContract({ ... })` plus `model('User', { fields, relations }).sql(...)`
- **The first slice keeps the helper vocabulary intentionally small**: prefer pack-provided descriptors over a large built-in preset surface for now
- **Backward Compatibility**: `@prisma-next/sql-query` re-exports contract authoring functions for backward compatibility (will be removed in Slice 7)
- **Import Path**: New code should import directly from `@prisma-next/sql-contract-ts`
- **Phase 2 Complete**: The target-agnostic core has been extracted to `@prisma-next/contract-authoring`. This package composes the generic core with SQL-specific types.

## See Also

- `@prisma-next/contract-authoring` - Target-agnostic builder core that this package composes
- `@prisma-next/sql-contract-psl` - PSL parser-output to SQL `ContractIR` interpreter for provider-based flows
- `@prisma-next/sql-contract-psl/provider` - SQL PSL-first `prismaContract()` helper (read -> parse -> interpret)
