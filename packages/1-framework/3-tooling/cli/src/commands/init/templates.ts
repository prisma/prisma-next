export type TargetId = 'postgres' | 'mongo';

export function starterSchema(): string {
  return `model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  posts     Post[]
  createdAt DateTime @default(now())
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  author    User     @relation(fields: [authorId], references: [id])
  authorId  Int
  createdAt DateTime @default(now())
}
`;
}

export function configFile(target: TargetId, contractPath: string): string {
  const pkg = target === 'postgres' ? '@prisma-next/postgres' : '@prisma-next/mongo';
  return `import { defineConfig } from '${pkg}/config';

export default defineConfig({
  contract: '${contractPath}',
  db: {
    connection: process.env['DATABASE_URL']!,
  },
});
`;
}

export function dbFile(target: TargetId): string {
  if (target === 'postgres') {
    return `import postgres from '@prisma-next/postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({ contractJson });
`;
  }

  return `import { createMongoRuntime } from '@prisma-next/mongo/runtime';

export { createMongoRuntime };
`;
}

export function targetPackageName(target: TargetId): string {
  return target === 'postgres' ? '@prisma-next/postgres' : '@prisma-next/mongo';
}

export function quickReferenceMd(target: TargetId, schemaPath: string): string {
  const pkg = targetPackageName(target);
  const schemaDir = schemaPath.replace(/\/[^/]+$/, '');
  const dbImportPath = `./${schemaDir}/db`;

  return `# Prisma Next

## Files

| File | Purpose |
|---|---|
| \`${schemaPath}\` | Schema — define your models here |
| \`${schemaDir}/contract.json\` | Emitted contract (generated) |
| \`${schemaDir}/contract.d.ts\` | Contract types (generated) |
| \`${schemaDir}/db.ts\` | Runtime client — import this in your app |
| \`prisma-next.config.ts\` | Prisma Next configuration |

## Commands

\`\`\`bash
# Re-emit the contract after editing the schema
pnpm prisma-next contract emit

# Initialize the database
pnpm prisma-next db init

# Show migration status
pnpm prisma-next migration status
\`\`\`

## Quick example

\`\`\`typescript
import { db } from '${dbImportPath}';

const users = await db.sql
  .from(db.schema.tables.user)
  .select({
    id: db.schema.tables.user.columns.id,
    email: db.schema.tables.user.columns.email,
  })
  .build();
\`\`\`

## Package

This project uses [\`${pkg}\`](https://github.com/prisma/prisma-next) which bundles all
Prisma Next dependencies for ${target === 'postgres' ? 'PostgreSQL' : 'MongoDB'}.
`;
}

export function agentSkillMd(target: TargetId, schemaPath: string): string {
  const pkg = targetPackageName(target);
  const schemaDir = schemaPath.replace(/\/[^/]+$/, '');
  const dbImportPath = `./${schemaDir}/db`;

  return `# Prisma Next — project skill

This project uses **Prisma Next** with **${target === 'postgres' ? 'PostgreSQL' : 'MongoDB'}** via the \`${pkg}\` package.

## File locations

- Schema: \`${schemaPath}\` — edit models here, then re-emit
- Config: \`prisma-next.config.ts\`
- Runtime client: \`${schemaDir}/db.ts\` — import \`db\` from \`${dbImportPath}\`
- Emitted contract: \`${schemaDir}/contract.json\` + \`${schemaDir}/contract.d.ts\` (generated, do not edit)

## Key commands

- \`pnpm prisma-next contract emit\` — regenerate contract after schema changes
- \`pnpm prisma-next db init\` — initialize the database
- \`pnpm prisma-next migration status\` — check migration status

## Query pattern

\`\`\`typescript
import { db } from '${dbImportPath}';

const users = await db.sql
  .from(db.schema.tables.user)
  .select({
    id: db.schema.tables.user.columns.id,
    email: db.schema.tables.user.columns.email,
  })
  .build();
\`\`\`

## Workflow

1. Edit \`${schemaPath}\` to add or change models.
2. Run \`pnpm prisma-next contract emit\` to regenerate the typed contract.
3. Import \`db\` from \`${dbImportPath}\` and use the typed query builder.
`;
}
