# Prisma Next — project skill

This project uses **Prisma Next** with **{{targetLabel}}** via the `{{pkg}}` package.

## File locations

- Schema: `{{schemaPath}}` — edit models here, then re-emit
- Config: `prisma-next.config.ts`
- Runtime client: `{{schemaDir}}/db.ts` — import `db` from `{{dbImportPath}}`
- Emitted contract: `{{schemaDir}}/contract.json` + `{{schemaDir}}/contract.d.ts` (generated, do not edit)

## Key commands

- `pnpm prisma-next contract emit` — regenerate contract after schema changes
- `pnpm prisma-next db init` — initialize the database
- `pnpm prisma-next migration status` — check migration status

## Query pattern

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

## Workflow

1. Edit `{{schemaPath}}` to add or change models.
2. Run `pnpm prisma-next contract emit` to regenerate the typed contract.
3. Import `db` from `{{dbImportPath}}` and use the typed query builder.
