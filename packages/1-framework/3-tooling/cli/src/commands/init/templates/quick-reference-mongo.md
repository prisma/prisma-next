# Welcome to Prisma Next!

Prisma Next lets you query your database in simple, easy to read TypeScript. Define what your data looks like, and Prisma Next gives you a fully typed client — with autocomplete for every collection, field, and relation.

This project is set up for MongoDB. Prisma Next also supports other databases.

## Your data contract

Your data contract is the heart of your application. It lives at [`{{schemaPath}}`]({{schemaPath}}) and describes your models:

```prisma
model User {
  id    ObjectId @id @map("_id")
  email String   @unique
  name  String?
  posts Post[]
  @@map("users")
}
```

Every model you define in your contract can be queried from your app. Your editor will autocomplete the query methods and show you what type each field is:

```typescript
import { db } from '{{dbImportPath}}';

const client = await db.connect(process.env['DATABASE_URL']!, 'mydb');

const user = await client.orm.User
  .where({ email: 'alice@example.com' })
  .first();

// Your editor will show the type of user as
// { id: ObjectId; email: string; name: string | null; posts: Post[] } | null
```

Your contract has two companion files in the same directory:

- **`contract.json`** — this tells your application what models exist, just like `package-lock.json` tells your package manager what dependencies your project has
- **`contract.d.ts`** — this powers autocomplete and type checking in your editor

Commit both files to git. When you change your contract, run `{{pkgRun}} contract emit` to update them.

If you use a framework like Next.js or Vite, the Prisma Next plugin will do this for you automatically.

## Configuration

[`prisma-next.config.ts`](prisma-next.config.ts) tells the CLI where your contract lives and how to connect to your database. It loads environment variables from `.env` automatically:

```typescript
import 'dotenv/config';
import { defineConfig } from '@prisma-next/mongo/config';

export default defineConfig({
  contract: './{{schemaPath}}',
  db: {
    connection: process.env['DATABASE_URL']!,
  },
});
```

Notice the `DATABASE_URL` above? It's defined in your [`.env`](./.env) file:

```env
DATABASE_URL="mongodb://localhost:27017/mydb"
```

You can customize how your environment variables are loaded by changing or removing the `import 'dotenv/config'` line.

## Quick reference

### Commands

```bash
{{pkgRun}} contract emit       # Update contract.json and contract.d.ts
{{pkgRun}} db init             # Create collections in the database
{{pkgRun}} migration status    # Show migration status
```

### Files

| File | Purpose |
|---|---|
| [`{{schemaPath}}`]({{schemaPath}}) | Your data contract — define your models here |
| [`prisma-next.config.ts`](prisma-next.config.ts) | CLI configuration |
| [`{{schemaDir}}/db.ts`]({{schemaDir}}/db.ts) | Database client — `import { db } from '{{dbImportPath}}'` |
| `{{schemaDir}}/contract.json` | Compiled contract (generated) |
| `{{schemaDir}}/contract.d.ts` | Contract types (generated) |

### Workflow

1. Edit [`{{schemaPath}}`]({{schemaPath}}) to add or change models.
2. Run `{{pkgRun}} contract emit` to regenerate the contract.
3. Query your models — your IDE will autocomplete everything.
