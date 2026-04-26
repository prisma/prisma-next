# Prisma Next — project skill

This project uses **Prisma Next** with **MongoDB** via `@prisma-next/mongo`. Prisma Next lets the user define data models in a contract file and query them with a fully typed ORM.

## Files

- **Contract**: `{{schemaPath}}` ({{authoringLabel}} authoring) — the user's data models. Edit this to add or change models.
- **Config**: `prisma-next.config.ts` — tells the CLI where the contract is and how to connect to the database. Loads `.env` via `dotenv/config`.
- **Database client**: `{{schemaDir}}/db.ts` — `import { db } from '{{dbImportPath}}'`. This is the entry point for all queries.
- **Generated files** (do not edit by hand):
  - `{{schemaDir}}/contract.json` — compiled contract, used at runtime
  - `{{schemaDir}}/contract.d.ts` — TypeScript types for the contract, used for autocomplete and type checking

## Commands

- `{{pkgRun}} contract emit` — regenerate `contract.json` and `contract.d.ts` after changing the contract
- `{{pkgRun}} db init` — bootstrap a database to match the contract (creates collections, indexes, constraints). Additive only — won't drop existing structures.
- `{{pkgRun}} db update` — update the database to match the current contract. Prompts for confirmation on destructive changes. Use `--dry-run` to preview.
- `{{pkgRun}} migration plan` — create a new migration from contract changes (offline, no database needed). Use `--name <slug>` to name it.
- `{{pkgRun}} migration apply` — apply pending migrations to the database
- `{{pkgRun}} migration status` — show which migrations are applied and which are pending
- `{{pkgRun}} migration show <name>` — show details of a specific migration

## How to write queries

Use the ORM (`db.orm`). Each root accessor is the lowercased plural form emitted by `prisma-next contract emit` (typically the `@@map`-ped collection name) — for `model User { @@map("users") }` use `db.orm.users`, for `model Post { @@map("posts") }` use `db.orm.posts`. The Mongo facade has no raw-SQL surface. Two escape hatches exist for cases the ORM can't express; both are covered under "Escape hatches" below.

```typescript
import { db } from '{{dbImportPath}}';

// Find one record
const user = await db.orm.users
  .where({ email: 'alice@example.com' })
  .first();
// Returns { _id: ObjectId; email: string; ... } | null

// Find multiple records
const users = await db.orm.users
  .select('_id', 'email')
  .take(10)
  .all();
// Returns Array<{ _id: ObjectId; email: string }>

// Filter, order, limit
const recentPosts = await db.orm.posts
  .where({ authorId: userId })
  .orderBy({ createdAt: -1 })
  .select('_id', 'title', 'createdAt')
  .take(50)
  .all();

// Include relations (reference relations only — embedded relations come back automatically)
const usersWithPosts = await db.orm.users
  .select('_id', 'email')
  .include('posts')
  .take(10)
  .all();
```

### Key ORM methods

- `.where({ field: value, ... })` — filter records by an equality object. Pass a raw filter expression for `$gt`/`$in`/`$regex` etc.
- `.select('field1', 'field2', ...)` — pick which fields to return
- `.orderBy({ field: 1 | -1 })` — sort results (1 = ascending, -1 = descending)
- `.take(n)` / `.skip(n)` — limit and offset
- `.all()` — execute and return all matching records as an `AsyncIterableResult`
- `.first()` — execute with limit 1 and return the first matching row, or `null`
- `.include('relationName')` — eager-load a reference relation (`$lookup`); embedded relations are already part of the row
- `.variant('VariantName')` — narrow a polymorphic collection to a discriminator value

## Escape hatches

The ORM covers the common cases. When you genuinely need something it can't express, prefer these — in order — over reaching for `db.runtime()` (which is an internal executor surface, not a `mongodb`-driver handle):

1. **Typed raw aggregations — `db.query`.** The facade exposes a `db.query` builder that runs aggregation pipelines through the same runtime + middleware + codec stack as `db.orm`, so results stay typed against the contract. Use this for `$lookup`/`$facet`/`$graphLookup`/window-function pipelines that the ORM doesn't surface.

2. **Direct `mongodb` driver control — `mongoClient` binding.** If you need a raw `MongoClient` (e.g. for transactions, change streams, sessions, or a driver feature Prisma Next doesn't expose), construct one yourself and pass it to `mongo({ mongoClient, dbName, contractJson })`. Your code keeps the `MongoClient` reference and uses it directly, while the same `db` object still gives you the typed ORM surface:

   ```typescript
   import { MongoClient } from 'mongodb';
   import mongo from '@prisma-next/mongo/runtime';
   import type { Contract } from '{{schemaDir}}/contract.d';
   import contractJson from '{{schemaDir}}/contract.json' with { type: 'json' };

   const client = new MongoClient(process.env['DATABASE_URL']!);
   await client.connect();

   export const db = mongo<Contract>({ contractJson, mongoClient: client, dbName: 'mydb' });

   const session = client.startSession();
   try {
     await session.withTransaction(async () => {
       await db.orm.users.createAll([{ /* ... */ }]);
     });
   } finally {
     await session.endSession();
   }
   ```

## Rules

- **Never hand-edit** `contract.json` or `contract.d.ts`. Always regenerate them with `contract emit`.
- **Always emit after contract changes.** When you modify `{{schemaPath}}`, run `{{pkgRun}} contract emit` before writing any code that depends on the new or changed models.
- **Don't restructure `db.ts`.** It's scaffolded by init and works as-is. `db` connects lazily on the first query — there is no `db.connect(...)` step.
- **Root accessors are emitter-driven.** Use the lowercased plural collection name (e.g. `db.orm.users`, `db.orm.posts`) — not the PascalCase model name. Re-run `{{pkgRun}} contract emit` if a new model's accessor isn't appearing on `db.orm`.
- **Connection string** is `DATABASE_URL` in `.env`. If the user reports connection errors, check this value and the `.env` file.
- **Transactions and change streams** require a MongoDB **replica set**. The Mongo facade does not yet expose `db.transaction(...)` — for now, use the `mongoClient` escape hatch above to drive transactions/sessions directly. See the quick reference for dev-environment options and the linked roadmap ticket.
- **Don't reach for `db.runtime()`** as an escape hatch. It returns the internal executor (`MongoRuntime`), not a `mongodb` `MongoClient` or `Db`. Use `db.query` for raw aggregations and the `mongoClient` binding for direct driver control.

## Workflow for common tasks

**User wants to add a new model or field:**
1. Edit `{{schemaPath}}`
2. Run `{{pkgRun}} contract emit`
3. Write query code using `db.orm.<collection>` (lowercased plural, see Rules above)

**User wants to query data:**
1. Import `db` from `{{dbImportPath}}`
2. Use `db.orm.<collection>` with `.where()`, `.select()`, `.all()`, `.first()`, etc.

**User wants to set up or change the database connection:**
1. Edit `DATABASE_URL` in `.env`
2. The config file (`prisma-next.config.ts`) reads it automatically via `dotenv/config`

**User wants to set up the database for the first time:**
1. Run `{{pkgRun}} db init`

**User wants to update the database after changing the contract:**
1. Quick path: `{{pkgRun}} db update` — compares the database to the contract and applies changes directly
2. Migration path (for production workflows):
   - `{{pkgRun}} migration plan --name describe-the-change` — creates a migration
   - `{{pkgRun}} migration apply` — applies pending migrations

**User wants to check what migrations need to be applied:**
1. Run `{{pkgRun}} migration status`
