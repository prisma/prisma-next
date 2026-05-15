---
name: prisma-next-quickstart
description: Adopt Prisma Next into a new project or onto an existing database — `pnpm dlx prisma-next init` for a greenfield scaffold, `prisma-next contract infer` + `db sign` for a brownfield database, then `contract emit` + `db init` to reach a first typed query. Use for prisma-next init, getting started, set up, scaffold, first model, first query, brownfield, introspect existing database, infer schema, db sign, db init, contract infer, --target, --authoring, --schema-path, --probe-db, "I have an existing Postgres/Mongo I want to start using".
---

# Prisma Next — Quickstart (Adoption)

> **Edit your data contract. Prisma handles the rest.**

This skill takes the user from zero to a first working query against Prisma Next. Two paths:

- **Greenfield** — new project, fresh database. Scaffolded by `prisma-next init`.
- **Brownfield-DB** — existing database, no contract yet. Infer the contract from the database with `contract infer`, sign the marker with `db sign`, write queries.

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

## Key Concepts

- **Contract**: the data model. Authored as `contract.prisma` (PSL, the canonical surface) or `contract.ts` (TypeScript builder). The framework reads it and emits two artefacts: `contract.json` (runtime IR) and `contract.d.ts` (types).
- **Target**: the backing store. Today: `postgres` or `mongodb`. Picked at `init` time; baked into the `@prisma-next/<target>` façade the scaffold imports from.
- **Authoring mode**: how you write the contract. `psl` (Prisma Schema Language, default) or `typescript` (programmatic builder, optionally paired with the Vite plugin for auto-emit during `vite dev` — see `prisma-next-build`).
- **Façade packages.** The scaffold installs exactly one façade per target — `@prisma-next/postgres` (or `@prisma-next/mongo`). User code imports from façade subpaths (`@prisma-next/postgres/config`, `@prisma-next/postgres/runtime`, `@prisma-next/postgres/contract-builder`). The façade bakes in the family / target / adapter / driver wiring; never reach past it. See `prisma-next-contract` for the full list.
- **`db.ts`**: the runtime entry point. Scaffolded by `init` under `<schemaDir>/db.ts` (defaults to `prisma/db.ts`). Imports the contract artefacts and exports a `db` value the rest of the app uses.
- **Marker**: a `pn_meta_marker` row in your database that records the contract hash. Lets PN detect drift between contract and live DB. Created by `db init` (greenfield) or `db sign` (brownfield).

## Workflow — Greenfield

The concept: `prisma-next init` is one CLI command that scaffolds config, schema, runtime, dependencies, and the contract emit step. It operates on the current working directory — there is no positional project-name argument. Make the directory, `cd` in, then run init.

```bash
mkdir my-app && cd my-app
pnpm init                                          # if no package.json yet
pnpm dlx prisma-next init                          # interactive
# or non-interactive (CI / agent runs):
pnpm dlx prisma-next init --yes --target postgres --authoring psl
```

The flags `init` accepts (run `prisma-next init --help` for the source of truth):

- `--target <db>` — `postgres` or `mongodb`.
- `--authoring <style>` — `psl` or `typescript`.
- `--schema-path <path>` — defaults to `prisma/contract.prisma` (or `prisma/contract.ts`).
- `--force` — overwrite an existing scaffold without prompting (re-running init in a scaffolded directory triggers the reinit flow — `--force` skips the confirmation).
- `--write-env` — also write `.env` (default writes only `.env.example`; `.env` stays under your control).
- `--probe-db` — connect to `DATABASE_URL` once and check the server version against the target's minimum.
- `--strict-probe` — fail init if the probe fails (no-op without `--probe-db`).
- `--no-install` — skip dependency install + initial contract emit.
- `--no-skill` — skip the `@prisma-next/agent-skill` install (air-gapped / restricted environments).
- `--install-user-skill` — also install the agent skill at the user level (every project on this host).

`init` writes (when it runs cleanly):

- `prisma-next.config.ts` at the project root.
- `prisma/contract.prisma` (or `prisma/contract.ts`) — the starter schema source.
- `prisma/db.ts` — the runtime entry point.
- `prisma-next.md` — a human quick-reference.
- `.env.example` (and `.env` if `--write-env`).
- Updates `package.json` (deps + scripts) and `tsconfig.json` (required compiler options).
- Installs deps and runs `prisma-next contract emit` once.
- Registers `@prisma-next/agent-skill` with the local agent runtime.

After init succeeds:

1. Set `DATABASE_URL` in `.env` (copy from `.env.example`).
2. Edit the contract — add a first model. PSL example:

   ```prisma
   model User {
     id    Int    @id @default(autoincrement())
     email String @unique
   }
   ```

3. Re-emit the contract: `pnpm prisma-next contract emit`. (Or install the Vite plugin from `prisma-next-build` so emit fires on save.)
4. Initialise the database: `pnpm prisma-next db init`. Creates tables, indexes, constraints, and writes the marker row.
5. Write a first query:

   ```typescript
   // src/list-users.ts
   import { db } from '../prisma/db';

   export async function listUsers() {
     return db.orm.User.select('id', 'email').take(10).all();
   }
   ```

For the next move — add more models, write more queries — chain to `prisma-next-contract` and `prisma-next-queries`.

## Workflow — Brownfield-DB (existing database, no contract)

The concept: against an existing database with no PN contract, `contract infer` walks the live schema (tables, columns, indexes, constraints) and writes a PSL contract that describes it. The result is a *starting point*, not the final contract — review and clean it up, then `db sign` to record the current contract hash as the marker (instead of letting `db init` try to recreate the schema from scratch).

```bash
mkdir my-app && cd my-app
pnpm init
pnpm dlx prisma-next init --yes --target postgres --authoring psl
# scaffold lands; you'll overwrite the starter schema below
```

Then, with `DATABASE_URL` set in `.env`:

```bash
pnpm prisma-next contract infer --db "$DATABASE_URL" --output prisma/contract.prisma
```

(Note: the flag is `--output`, not `--out`. Run `prisma-next contract infer --help` for the full surface.)

The agent should pause here and read the inferred PSL. Symptoms a re-author pass is needed:

- Tables PN couldn't categorise (e.g. legacy linking tables you could express as relations).
- Columns where PN's type guess is wrong (e.g. `String` where you want an extension type like `pgvector.Vector(length: 1536)`).
- Missing `@unique` / `@index` hints PN couldn't see.
- Field names you'd prefer to alias.

Then re-emit and sign:

```bash
pnpm prisma-next contract emit
pnpm prisma-next db sign
pnpm prisma-next db verify   # confirms the DB matches the contract; reports drift if not
```

Write a first query against an existing table (same shape as the greenfield example).

## Decision — PSL vs TypeScript authoring

- **PSL** (`contract.prisma`) — the default. Concise, declarative, familiar to anyone who has used Prisma. Recommended for most projects.
- **TypeScript** (`contract.ts`) — a programmatic builder. Use when the contract is genuinely computed (multi-tenant per-tenant variants), when you reuse contract fragments across files, or when an extension requires constructs PSL doesn't yet express (e.g. pgvector's parameterised storage-type registration). Pairs with the Vite plugin from `prisma-next-build` for auto-emit on save.

Switch authoring later by re-running `prisma-next init` in the same directory. The init flow detects the existing scaffold and prompts to reinit (use `--force` to skip the prompt in non-interactive runs). Existing contract content is *not* automatically translated — you'll re-author by hand in the target language.

## Common Pitfalls

1. **Running `prisma-next init <project-name>` with a positional argument.** `init` operates on the current working directory; there is no positional project-name argument. `mkdir foo && cd foo && pnpm dlx prisma-next init`.
2. **`init` doesn't connect to your database.** It only scaffolds files and installs dependencies (and runs the initial `contract emit`). You connect with `db init` / `db update` / `migration apply`. If `init` succeeds and queries fail, the issue is `DATABASE_URL`, not `init`.
3. **Treating inferred PSL as the final contract.** `contract infer` produces a starting point. Don't `db sign` against a contract you haven't read.
4. **Forgetting to emit after editing the contract.** The contract artefacts (`contract.json`, `contract.d.ts`) are stale until you run `contract emit`. If the type-checker says a model "doesn't exist", you skipped emit.
5. **Setting `DATABASE_URL` in `prisma-next.config.ts` instead of `.env`.** The config reads `.env` automatically via `dotenv/config`. Hardcoding the URL leaks credentials and bypasses per-environment overrides. See `prisma-next-runtime`.
6. **Hand-editing `contract.json` or `contract.d.ts`.** They're emitted artefacts; the next `contract emit` overwrites your changes. Edit the source instead.
7. **Using `--out` for `contract infer`.** The flag is `--output`.

## What Prisma Next doesn't do yet

- **Migration from another ORM.** Prisma Next doesn't migrate your schema *from* Drizzle / Prisma 6/7 / Sequelize / TypeORM / Kysely / Knex / a raw driver. Workaround: install the matching `@prisma-next/migrate-from-<orm>-skill` if one exists for your source, or treat the source as a brownfield database and `contract infer` from it. If you need a guided migration flow built-in, file a feature request via the `prisma-next-feedback` skill.
- **`prisma db push`-style production sync.** `db update` is the quick development path; for production, use migrations (`migration plan` + `apply`). PN deliberately does not offer a "push-to-prod-without-a-migration" surface — see `prisma-next-migrations`.
- **Studio / GUI database browser.** Use `prisma-next db schema` for a CLI tree-style summary of the live DB. If you need an interactive UI, file a feature request via the `prisma-next-feedback` skill.

## Reference Files

This skill is intentionally body-only; `prisma-next init --help`, `contract infer --help`, and `db sign --help` are the authoritative surfaces for flag-level detail. When in doubt, run `--help` and read the actual command's description rather than guessing from this skill.

## Checklist

- [ ] Confirmed the user's target (`postgres` / `mongodb`) and authoring mode (`psl` / `typescript`).
- [ ] Ran `prisma-next init` from the project directory (greenfield) — no positional project-name argument.
- [ ] For brownfield: ran `contract infer --db "$DATABASE_URL" --output prisma/contract.prisma`, reviewed the result, then `contract emit` + `db sign`.
- [ ] Set `DATABASE_URL` in `.env` and confirmed the value is reachable.
- [ ] Ran `pnpm prisma-next contract emit` after editing the contract source.
- [ ] Initialised the DB (`db init` greenfield) or signed the marker (`db sign` brownfield).
- [ ] Wrote a first query against `db.orm.<Model>` and ran it green.
- [ ] Did NOT hand-edit `contract.json` or `contract.d.ts`.
- [ ] Did NOT set `DATABASE_URL` in `prisma-next.config.ts`.
- [ ] Confirmed the user understands what the *next* skill is for their workflow (typically `prisma-next-contract` or `prisma-next-queries`).
