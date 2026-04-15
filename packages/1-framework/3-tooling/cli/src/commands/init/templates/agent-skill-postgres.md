# Prisma Next — project skill

This project uses **Prisma Next** with **PostgreSQL** via `@prisma-next/postgres`. Prisma Next lets the user define data models in a contract file and query them with a fully typed ORM.

## Files

- **Contract**: `{{schemaPath}}` — the user's data models. Edit this to add or change models.
- **Config**: `prisma-next.config.ts` — tells the CLI where the contract is and how to connect to the database. Loads `.env` via `dotenv/config`.
- **Database client**: `{{schemaDir}}/db.ts` — `import { db } from '{{dbImportPath}}'`. This is the entry point for all queries.
- **Generated files** (do not edit by hand):
  - `{{schemaDir}}/contract.json` — compiled contract, used at runtime
  - `{{schemaDir}}/contract.d.ts` — TypeScript types for the contract, used for autocomplete and type checking

## Commands

- `pnpm prisma-next contract emit` — regenerate `contract.json` and `contract.d.ts` after changing the contract
- `pnpm prisma-next db init` — bootstrap a database to match the contract (creates tables, indexes, constraints). Additive only — won't drop existing structures.
- `pnpm prisma-next db update` — update the database to match the current contract. Prompts for confirmation on destructive changes. Use `--dry-run` to preview.
- `pnpm prisma-next migration plan` — create a new migration from contract changes (offline, no database needed). Use `--name <slug>` to name it.
- `pnpm prisma-next migration apply` — apply pending migrations to the database
- `pnpm prisma-next migration status` — show which migrations are applied and which are pending
- `pnpm prisma-next migration show <name>` — show details of a specific migration

## How to write queries

Always use the ORM (`db.orm`). Only fall back to `db.sql` if the user explicitly asks for raw SQL or the ORM doesn't support the operation.

```typescript
import { db } from '{{dbImportPath}}';

// Find one record
const user = await db.orm.User
  .where(user => user.email.eq('alice@example.com'))
  .first();
// Returns { id: number; email: string; ... } | null

// Find multiple records
const users = await db.orm.User
  .select('id', 'email')
  .take(10)
  .all();
// Returns Array<{ id: number; email: string }>

// Filter, order, limit
const recentPosts = await db.orm.Post
  .where(post => post.authorId.eq(userId))
  .orderBy(post => post.createdAt.desc())
  .select('id', 'title', 'createdAt')
  .take(50)
  .all();

// Include relations
const usersWithPosts = await db.orm.User
  .select('id', 'email')
  .include('posts', post =>
    post.select('id', 'title').orderBy(p => p.createdAt.desc()).take(5)
  )
  .take(10)
  .all();
```

### Key ORM methods

- `.where(predicate)` — filter records. Predicate receives a model accessor with `.eq()`, `.neq()`, `.ilike()`, `.lt()`, `.gt()`, etc.
- `.select('field1', 'field2', ...)` — pick which fields to return
- `.orderBy(accessor => accessor.field.asc()` or `.desc())` — sort results
- `.take(n)` — limit number of results
- `.all()` — execute and return all matching records as an array
- `.first()` — execute and return the first matching record, or `null`
- `.first({ id: value })` — find a single record by primary key, or `null`
- `.include('relation', builder => ...)` — eager-load a relation

## Rules

- **Never hand-edit** `contract.json` or `contract.d.ts`. Always regenerate them with `contract emit`.
- **Always emit after contract changes.** When you modify `{{schemaPath}}`, run `pnpm prisma-next contract emit` before writing any code that depends on the new or changed models.
- **Don't restructure `db.ts`.** It's scaffolded by init and works as-is.
- **Use `db.orm` for queries**, not `db.sql`. The ORM is the primary query surface.
- **Connection string** is `DATABASE_URL` in `.env`. If the user reports connection errors, check this value and the `.env` file.

## Workflow for common tasks

**User wants to add a new model or field:**
1. Edit `{{schemaPath}}`
2. Run `pnpm prisma-next contract emit`
3. Write query code using `db.orm.ModelName`

**User wants to query data:**
1. Import `db` from `{{dbImportPath}}`
2. Use `db.orm.ModelName` with `.where()`, `.select()`, `.all()`, `.first()`, etc.

**User wants to set up or change the database connection:**
1. Edit `DATABASE_URL` in `.env`
2. The config file (`prisma-next.config.ts`) reads it automatically via `dotenv/config`

**User wants to set up the database for the first time:**
1. Run `pnpm prisma-next db init`

**User wants to update the database after changing the contract:**
1. Quick path: `pnpm prisma-next db update` — compares the database to the contract and applies changes directly
2. Migration path (for production workflows):
   - `pnpm prisma-next migration plan --name describe-the-change` — creates a migration
   - `pnpm prisma-next migration apply` — applies pending migrations

**User wants to check what migrations need to be applied:**
1. Run `pnpm prisma-next migration status`
