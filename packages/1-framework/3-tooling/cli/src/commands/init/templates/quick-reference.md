# Prisma Next

## Files

| File | Purpose |
|---|---|
| `{{schemaPath}}` | Schema — define your models here |
| `{{schemaDir}}/contract.json` | Emitted contract (generated) |
| `{{schemaDir}}/contract.d.ts` | Contract types (generated) |
| `{{schemaDir}}/db.ts` | Runtime client — import this in your app |
| `prisma-next.config.ts` | Prisma Next configuration |

## Commands

```bash
# Re-emit the contract after editing the schema
pnpm prisma-next contract emit

# Initialize the database
pnpm prisma-next db init

# Show migration status
pnpm prisma-next migration status
```

## Quick example

```typescript
import { db } from '{{dbImportPath}}';

const users = await db.sql
  .from(db.schema.tables.user)
  .select({
    id: db.schema.tables.user.columns.id,
    email: db.schema.tables.user.columns.email,
  })
  .build();
```

## Package

This project uses [`{{pkg}}`](https://github.com/prisma/prisma-next) which bundles all
Prisma Next dependencies for {{targetLabel}}.
