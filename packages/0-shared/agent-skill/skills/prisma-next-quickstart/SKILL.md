---
name: prisma-next-quickstart
description: Adopt Prisma Next into a new project or onto an existing database. Use for prisma-next init, getting started, set up, scaffold, first model, first query, brownfield, introspect existing database, infer schema, db sign, db init, "I have an existing Postgres/Mongo I want to start using".
---

# Prisma Next — Quickstart (Adoption)

> **Edit your data contract. Prisma handles the rest.**

This skill takes the user from zero to a first working query against Prisma Next. Two paths:

- **Greenfield:** new project, fresh database. Scaffolded by `prisma-next init`.
- **Brownfield-DB:** existing database, no contract yet. Infer the contract from the database, sign the marker, write queries.

This skill does **not** cover migrating from another ORM (Drizzle, Prisma 6/7, Sequelize, TypeORM, Kysely, Knex, raw drivers). Those are separately-installable skills.

## When to Use

- User is starting a new project and wants to use Prisma Next.
- User has an existing database (no PN contract) and wants to introduce PN.
- User typed *"prisma-next init"*, *"get started with PN"*, *"set up PN"*, *"how do I scaffold a project"*.
- User says *"I have an existing Postgres/Mongo, how do I start using PN?"*.

## When Not to Use

- User already has a PN project and wants to add a model → `prisma-next-contract`.
- User wants to migrate FROM a specific ORM → install `@prisma-next/migrate-from-<orm>-skill` (separate).
- User wants to wire `db.ts` in a project that already has a contract → `prisma-next-runtime`.
- User wants to integrate Prisma Next with a build tool (Vite plugin, Next.js, …) → `prisma-next-build`.

## Key Concepts (before any workflow)

- **Contract**: the data model. Authored as `schema.psl` (PSL) or a TypeScript file (`prisma/contract.ts`). The framework reads it and emits two artifacts: `contract.json` (runtime) and `contract.d.ts` (types).
- **Target**: the backing store. Today: `postgres` or `mongo`. Picked at `init` time; recorded in `prisma-next.config.ts`.
- **Authoring mode**: how you write the contract. `psl` (Prisma Schema Language) or `typescript` (programmatic builder, optionally paired with the Vite plugin for auto-emit during `vite dev` — see the `prisma-next-build` skill).
- **`db.ts`**: the runtime entry point. Imports `@prisma-next/postgres` (or `mongo`), the contract, type maps, and middleware. The agent imports `db` from here.
- **Marker**: a `pn_meta_marker` row in your database that records the contract hash. Lets PN detect drift. Created by `db init` or `db sign`.

## Workflow — Greenfield

1. Confirm the user has Node 22+ and a Postgres or MongoDB instance available.
2. Run `pnpm dlx prisma-next init <project-name>` (or `npm create prisma-next-app`).
3. Answer the prompts: target (`postgres` / `mongodb`), authoring (`psl` / `typescript`), schema path.
4. `init` scaffolds:
   - `prisma-next.config.ts`
   - `prisma/schema.psl` (or `prisma/contract.ts` for TS authoring)
   - `prisma/db.ts`
   - `prisma-next.md` (human quick-reference)
   - `.env.example`
   - Updates `package.json` with required dependencies + scripts.
   - Registers `@prisma-next/agent-skill` with the agent runtime.
5. Set `DATABASE_URL` in `.env` (copy from `.env.example`).
6. Edit the contract — add a first model. PSL example:

   ```prisma
   model User {
     id    Int    @id @default(autoincrement())
     email String @unique
   }
   ```

7. Emit the contract: `pnpm prisma-next contract emit`.
8. Initialize the database: `pnpm prisma-next db init`. This creates the tables, indexes, constraints, and writes the marker row.
9. Write a first query:

   ```typescript
   // src/list-users.ts
   import { db } from './prisma/db';

   export async function listUsers() {
     return db.orm.User.select('id', 'email').take(10).all();
   }
   ```

10. Run it (`pnpm tsx src/list-users.ts` or whatever the user's runner is) and confirm the query returns.

## Workflow — Brownfield-DB (existing database, no contract)

1. Confirm the user has a `DATABASE_URL` for the existing database. PN can read but won't write until the contract is in place.
2. Run `pnpm dlx prisma-next init <project-name>` to scaffold the project shell — but skip the schema authoring step (or accept the default empty schema; you'll overwrite it).
3. Set `DATABASE_URL` in `.env`.
4. Infer the contract from the database:

   ```bash
   pnpm prisma-next contract infer --db "$DATABASE_URL" --out prisma/schema.psl
   ```

This walks the database's tables, columns, indexes, and constraints and writes a PSL file describing them.
5. **Review and clean up the inferred PSL.** Inference is a starting point, not a final contract. Look for:
   - Tables PN couldn't categorize (e.g. legacy linking tables you could express as relations).
   - Columns where PN's type guess is wrong (e.g. `String` where you want a custom extension type like `pgvector.Vector(1536)`).
   - Missing `@unique` / `@index` hints PN couldn't see.
   - Field names you'd prefer to alias.
6. Emit the contract: `pnpm prisma-next contract emit`.
7. **Sign the marker.** This tells PN "the database is at *this* contract hash; don't try to migrate it to match the current contract from scratch":

   ```bash
   pnpm prisma-next db sign
   ```

8. Verify: `pnpm prisma-next db verify`. Reports OK if the DB matches the contract exactly. Reports drift if anything diverges; investigate and either adjust the PSL or the DB.
9. Write a first query against an existing table (same shape as the greenfield example).

## Decision: PSL vs TypeScript authoring

- **PSL** (`schema.psl`) — the default. Concise, declarative, familiar to anyone who has used Prisma. Recommended for most projects.
- **TypeScript** (`prisma/contract.ts`) — a programmatic builder. Use when you need to reuse contract fragments across files, when your contract is genuinely computed (multi-tenant per-tenant variants), or when you want auto-emit from the Vite dev server (`prisma-next-build`).

Switch later by running `prisma-next init --reinit` and choosing the other authoring mode. Existing contract content is preserved in spirit but you'll need to re-author by hand in the target language.

## Common Pitfalls

1. **`init` doesn't connect to your database.** It only scaffolds files and installs dependencies. You connect with `db init` / `db update` / `migration apply`. If `init` succeeds and queries fail, the issue is `DATABASE_URL`, not `init`.
2. **Inferred PSL is a starting point, not a final contract.** Review it. Don't `db sign` against a contract you haven't read.
3. **Forgetting to emit after editing the contract.** The contract artifacts (`contract.json`, `contract.d.ts`) are stale until you run `contract emit`. If the type-checker complains about a model that "doesn't exist", you skipped emit.
4. **Setting `DATABASE_URL` in `prisma-next.config.ts` instead of `.env`.** `prisma-next.config.ts` reads `.env` automatically via `dotenv/config`. Hardcoding the URL leaks credentials and bypasses per-environment overrides.
5. **Hand-editing `contract.json` or `contract.d.ts`.** They're emitted artifacts. The next `contract emit` overwrites your changes.

## What Prisma Next doesn't do yet

- **Migration from another ORM.** Prisma Next doesn't migrate your schema *from* Drizzle / Prisma 6/7 / Sequelize / TypeORM / Kysely / Knex / a raw driver. Workaround: install the matching `@prisma-next/migrate-from-<orm>-skill` separately, or treat the source as a brownfield database and `contract infer` from it. If you need a guided migration flow built-in, file a feature request via the `prisma-next-feedback` skill.
- **`prisma db push` equivalent in production.** `db update` is the quick path; for production, use migrations (`migration plan` + `apply`). PN deliberately does not offer a "push-to-prod-without-a- migration" surface.
- **Studio / GUI database browser.** Use `prisma-next db schema` for a CLI tree-style summary. If you need an interactive UI, file a feature request via the `prisma-next-feedback` skill.

## Reference Files

- `references/init-flags.md` — full flag reference for `prisma-next init` (`--target`, `--authoring`, `--schema-path`, `--force`, `--write-env`, `--probe-db`, `--strict-probe`, `--no-install`, `--reinit`, `--install-user-skill`, `--no-skill`).
- `references/brownfield-checklist.md` — the cleanup pass to do after `contract infer` before `db sign`.

## Checklist

- [ ] Confirmed the user's target (Postgres vs Mongo) and authoring mode.
- [ ] Ran `prisma-next init` (or `contract infer` + `db sign` for brownfield).
- [ ] Set `DATABASE_URL` in `.env` and confirmed the value is reachable.
- [ ] Edited the contract (greenfield) or reviewed the inferred PSL (brownfield).
- [ ] Ran `prisma-next contract emit` and confirmed `contract.json` + `contract.d.ts` updated.
- [ ] Initialized the DB (`db init` greenfield) or signed the marker (`db sign` brownfield).
- [ ] Wrote a first query against `db.orm.<Model>` and ran it green.
- [ ] Did NOT hand-edit `contract.json` or `contract.d.ts`.
- [ ] Did NOT set `DATABASE_URL` in `prisma-next.config.ts`.
- [ ] Confirmed the user understands what the *next* skill is for their workflow (likely `prisma-next-contract` or `prisma-next-queries`).
