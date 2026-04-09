# @prisma-next/sql-contract-ts

**Status:** Current SQL TypeScript contract authoring surface

This package owns the SQL TypeScript authoring API for Prisma Next.

## Package Classification

- **Domain**: sql
- **Layer**: authoring
- **Plane**: migration

## Overview

This package is part of the SQL family namespace (`packages/2-sql/2-authoring/contract-ts`) and provides:

- the SQL contract DSL centered on `defineContract(...)`
- the base structural helpers exported from `./contract-builder`: `field.column(...)`, `field.generated(...)`, `field.namedType(...)`, plus `model(...)` and `rel.*`
- an optional callback overload that exposes pack-composed helper namespaces such as `field.id.uuidv7()`, `field.text()`, `field.createdAt()`, and `type.enum(...)`
- lowering from authored model definitions into the canonical SQL `Contract`
- a SQL contract JSON schema export via `./schema-sql`

## Responsibilities

- **SQL contract authoring**: Build SQL contracts programmatically with type safety
- **Pack-composed helper vocabulary**: Merge family, target, and extension authoring contributions into the callback helper namespaces
- **Lowering pipeline**: Turn authored model definitions into the canonical SQL contract artifacts consumed by the rest of the stack
- **Config helper**: Provide `typescriptContract(...)` for `prisma-next.config.ts`
- **Schema export**: Publish the SQL JSON schema used by editors and tooling

## Package Status

This is the current SQL TypeScript authoring implementation. Shared descriptor types live in `@prisma-next/contract-authoring`. Contract validation lives in `@prisma-next/sql-contract/validate`.

## Architecture

- **Base DSL**: `./contract-builder` exports the stable structural DSL (`defineContract`, `field`, `model`, `rel`)
- **Composed helper namespaces**: `defineContract(config, (helpers) => ...)` synthesizes `helpers.field.*` and `helpers.type.*` from the selected family, target, and extension packs
- **SQL resolution and contract generation**: internal resolution normalizes names, relations, indexes, and FK materialization before producing the canonical SQL contract artifacts
- **Shared descriptor layer**: `@prisma-next/contract-authoring` provides the target-neutral descriptor types used by the DSL and by authoring-adjacent packs

Contributor-facing lowering notes and detailed warning semantics live in [DEVELOPING.md](./DEVELOPING.md).

```mermaid
flowchart LR
  builderInput[TypeScript contract input] --> sqlContractTs[@prisma-next/sql-contract-ts]
  sqlContractTs --> authoringCore[@prisma-next/contract-authoring]
  sqlContractTs --> sqlTypes[@prisma-next/sql-contract/types]
  sqlContractTs --> contract[SQL Contract]
```

## Exports

- `./contract-builder` - SQL contract DSL (`defineContract`, `field`, `model`, `rel`)
- `./config-types` - `typescriptContract(...)` config helper
- `./schema-sql` - SQL contract JSON schema (`data-contract-sql-v1.json`)

## Usage

### Direct Structural DSL

Direct imports expose the base structural helpers. Use this surface when you want to author with explicit column descriptors, explicit generators, or named storage types.

```typescript
import { textColumn, timestamptzColumn } from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { uuidv4 } from '@prisma-next/ids';
import { defineContract, field, model, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const User = model('User', {
  fields: {
    id: field.generated(uuidv4()).id(),
    email: field.column(textColumn).unique(),
    createdAt: field.column(timestamptzColumn).defaultSql('now()'),
  },
})
  .relations({
    posts: rel.hasMany('Post', { by: 'userId' }),
  })
  .sql({
    table: 'app_user',
  });

const Post = model('Post', {
  fields: {
    id: field.generated(uuidv4()).id(),
    userId: field.column(textColumn),
    title: field.column(textColumn),
  },
})
  .relations({
    user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
  })
  .sql({
    table: 'blog_post',
  });

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  naming: { tables: 'snake_case', columns: 'snake_case' },
  models: {
    User,
    Post,
  },
});
```

### Callback Helper Vocabulary

Pack-provided helper presets are available through the callback overload. This is the surface that exposes `field.id.*`, `field.text()`, `field.createdAt()`, and `type.*`.

```typescript
import pgvector from '@prisma-next/extension-pgvector/pack';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
    extensionPacks: { pgvector },
  },
  ({ type, field, model, rel }) => {
    const types = {
      Role: type.enum('role', ['USER', 'ADMIN'] as const),
      Embedding1536: type.pgvector.vector(1536),
    } as const;

    const User = model('User', {
      fields: {
        id: field.id.uuidv7().sql({ id: { name: 'user_pkey' } }),
        role: field.namedType(types.Role),
        embedding: field.namedType(types.Embedding1536).optional(),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.id.uuidv7(),
        authorId: field.uuid(),
        title: field.text(),
      },
    });

    return {
      types,
      models: {
        User: User.relations({
          posts: rel.hasMany(Post, { by: 'authorId' }),
        }).sql({
          table: 'user',
        }),
        Post: Post.relations({
          author: rel.belongsTo(User, { from: 'authorId', to: 'id' }),
        }).sql({
          table: 'post',
        }),
      },
    };
  },
);
```

### Constraint Placement

Single-field constraints are usually most readable inline on the field, while compound constraints live in `.attributes(...)` or model-level `.sql(...)`.

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

### Helper Notes

- Structural helpers: `field.column(...)`, `field.generated(...)`, `field.namedType(...)`, plus `model(...)` and `rel.*`
- Callback helper presets: `field.id.uuidv4()`, `field.id.uuidv7()`, `field.id.nanoid({ size })`, `field.uuid()`, `field.text()`, `field.timestamp()`, `field.createdAt()`, and `type.*`
- Keep field-local and FK-local storage overrides next to the authoring site with `field.sql(...)` and `rel.belongsTo(...).sql({ fk })`
- Prefer typed local refs such as `field.namedType(types.Role)`, `User.refs.id`, and `User.ref('id')` when those tokens are available
- See [DEVELOPING.md](./DEVELOPING.md#validation-and-warnings) for duplicate-name validation rules and typed-fallback warning behavior

### Foreign Key Defaults

Use the root-level `foreignKeyDefaults` option when a contract wants non-default FK materialization:

```typescript
const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  foreignKeyDefaults: { constraint: true, index: false },
  models: {
    // ...
  },
});
```

Per-FK overrides still live next to the FK authoring site, either via `constraints.foreignKey(...)` inside model `.sql(...)` or via `rel.belongsTo(...).sql({ fk: ... })`. See [ADR 161](../../../../docs/architecture%20docs/adrs/ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md).

### Validating Contracts

Contract JSON validation lives in `@prisma-next/sql-contract/validate`, while this package focuses on authoring and lowering.

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
  contract: typescriptContract(contract, 'src/prisma/contract.json'),
});
```

## Dependencies

- **`@prisma-next/config`** - `ContractConfig` types used by `typescriptContract(...)`
- **`@prisma-next/contract-authoring`** - Shared descriptor types
- **`@prisma-next/framework-components`** - Pack refs, authoring contributions, and codec lookup types
- **`@prisma-next/sql-contract`** - SQL contract types and validation target

## Testing

Unit tests for the authoring DSL live in this package. Broader integration tests that span authoring, emission, CLI, and runtime packages live in `@prisma-next/integration-tests`.

## Migration Notes

- Direct imports give you the structural DSL
- The callback overload gives you pack-composed helper vocabularies
- Import authoring helpers directly from `@prisma-next/sql-contract-ts`
- Import validation from `@prisma-next/sql-contract/validate`

## See Also

- `@prisma-next/contract-authoring` - Shared target-neutral authoring descriptor types
- `@prisma-next/sql-contract-psl` - PSL parser-output to SQL contract interpreter
- `@prisma-next/sql-contract-psl/provider` - SQL PSL-first `prismaContract()` helper
