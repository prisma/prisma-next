---
name: prisma-next-quickstart
description: Adopt Prisma Next into a new project, onto an existing database, or as the first move after a bootstrap tool dropped you into a scaffold. Use for "what can I do next with Prisma", "what can I do with Prisma next", "what's next with Prisma Next", "where do I start", "what should I do first", "just ran createprisma", "createprisma", "npx createprisma", "npx create-prisma", "first steps", "first query", "I have a scaffolded Prisma Next project what now"; for `pnpm dlx prisma-next init` greenfield setup; and for `prisma-next contract infer` + `db sign` against an existing database. Also covers the connect-write-read first-arc orientation, the day-to-day commands (`contract emit`, `db init`, `db update`, `migration plan`, `migration apply`, `db schema`, `db verify`), and routing to `prisma-next-contract` / `prisma-next-queries` / `prisma-next-runtime` for the next move. Flags: --target, --authoring, --schema-path, --probe-db, --output.
---

# Prisma Next — Quickstart (Adoption)

> **Edit your data contract. Prisma handles the rest.**

This skill takes the user from zero (or near-zero) to a first working query against Prisma Next. Three paths — and they all converge on the same first arc: **connect → write → read**. Schema editing comes *after* the first arc, not before.

- **Post-bootstrap orientation** — a scaffold tool (typically `npx createprisma`) just dropped the user into a working project. They're asking *"what can I do next with Prisma?"* and want to start building, not study the framework.
- **Greenfield** — new project, fresh database. User runs `prisma-next init` themselves. `init` seeds a starter contract with a sample model, so the path joins the first arc as soon as the database is initialised.
- **Brownfield-DB** — existing database, no contract yet. Infer the contract from the database with `contract infer`, sign the marker with `db sign`, then write queries against one of the existing tables.

This skill does **not** cover migrating from another ORM (Drizzle, Prisma 6/7, Sequelize, TypeORM, Kysely, Knex, raw drivers). Those are separately-installable skills.

## When to Use

- User just ran `createprisma` (or equivalent) and is asking what to do next.
- User asks *"what can I do next with Prisma?"*, *"what can I do with Prisma next?"*, *"where do I start?"*, *"what should I do first?"*.
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
- **`db.ts`**: the runtime entry point. Lives next to the contract source at `src/prisma/db.ts`. Imports the contract artefacts and exports a `db` value the rest of the app uses.
- **Marker**: a `pn_meta_marker` row in your database that records the contract hash. Lets PN detect drift between contract and live DB. Created by `db init` (greenfield / post-bootstrap) or `db sign` (brownfield).

### Canonical on-disk layout

Every application that consumes Prisma Next uses the same shape:

```text
<app-root>/
├── prisma-next.config.ts             ← project config at repo root
├── src/
│   └── prisma/
│       ├── contract.prisma           ← (or contract.ts) — schema source you author
│       ├── contract.json             ← emitted by `contract emit` — do not edit
│       ├── contract.d.ts             ← emitted by `contract emit` — do not edit
│       └── db.ts                     ← runtime entry; the rest of `src/` imports from here
└── migrations/
    └── app/                          ← created on first `migration plan` / `db init`
        ├── refs/head.json
        └── <timestamp>_<slug>/
            ├── migration.json
            ├── ops.json
            ├── end-contract.json
            ├── end-contract.d.ts
            └── migration.ts
```

Three things to internalise:

- **`src/prisma/` is the home for the contract** — source + emitted artefacts + `db.ts` all colocated. The rest of `src/` imports from `./prisma/db` (or `../prisma/db`, depending on file depth).
- **`migrations/app/`** — the `app/` segment is the consuming application's space-id. Extensions you depend on get sibling directories under `migrations/` (one per extension contract-space), but you don't write into those — only the `app/` subtree is your migrations.
- **`prisma-next.config.ts` lives at the repo root**, not under `src/`. Every command resolves paths relative to the config's directory.

**Contributors building extension packages or aggregate-root monorepo packages use a different layout** — `src/contract.{prisma,ts}` (no `prisma/` subdir) + `migrations/<timestamp>_<slug>/` (no `app/` segment). That distinction is intentional; see `prisma-next-contract` for which path applies to you.

> **Heads up — `prisma-next init` currently scaffolds the wrong layout.** It writes `prisma/contract.{prisma,ts}` and `prisma/db.ts` at the repo root instead of under `src/prisma/`. Tracked as [TML-2532](https://linear.app/prisma-company/issue/TML-2532). Until the fix lands, either pass `--schema-path src/prisma/contract.prisma` to `init`, or move the scaffolded `prisma/` directory into `src/prisma/` after `init` and update the `contract` path in `prisma-next.config.ts` to match. The canonical layout above is what the demo example uses and what the rest of the framework expects.

## Your first arc — connect, write, read

All three paths in this skill converge here. Once the project is scaffolded and the database is reachable, the first move is **always** the same: connect, write a row, read it back, against whatever model the contract already declares. Don't touch the contract source on this first move — extend it later, after the round-trip works.

Write the snippet in a fresh file directly under `src/` (e.g. `src/first-arc.ts`) so the relative import resolves to one level deep:

```typescript
// src/first-arc.ts
import 'dotenv/config';
import { db } from './prisma/db';

// Write a row against the starter model. Adapt the field names to whatever
// model your contract source actually declares — read it first.
await db.orm.User.create({ email: 'alice@example.com' });

// Read it back.
const users = await db.orm.User.select('id', 'email').all();
console.log(users);
```

If that prints `[{ id: 1, email: 'alice@example.com' }]`, the project is wired end-to-end and the user has crossed from *"I have a project"* to *"I'm building."*

`db.orm.<Model>` is the default ORM lane — model-shaped, fully typed against the contract, lazily connects to the database on first use (it picks up `DATABASE_URL` from `.env` via the runtime's `dotenv/config`-loaded environment). The deeper `prisma-next-queries` skill covers the rest of the surface (filters, joins, transactions, the SQL builder, raw SQL, TypedSQL) when the user is ready.

**Prerequisites for the arc to work.** All three paths leave these in place by the time you reach the arc:

- `prisma-next.config.ts` exists at the repo root and declares the target + contract source (typically `src/prisma/contract.prisma` or `src/prisma/contract.ts`).
- The contract source exists at `src/prisma/contract.{prisma,ts}` (a starter model from `init`, or the inferred contract from `contract infer`, or whatever the bootstrap tool generated).
- `src/prisma/db.ts` exists and instantiates the runtime with the emitted contract.
- `DATABASE_URL` is set in `.env` (or wherever the runtime's config tells it to look).
- The database has been initialised (`db init`) or marker-signed (`db sign`), so the marker row exists and the schema matches the contract.

The three workflows below each describe how their path gets the user to that state. After that, the arc above is the same.

## Workflow — Post-bootstrap orientation (you just ran `createprisma`)

If the user's prompt is *"what can I do next with Prisma?"*, *"what can I do with Prisma next?"*, *"where do I start?"*, *"I just ran createprisma"*, or any close variant — and there's already a scaffolded project on disk — treat this as **orientation, not action**. The user wants to feel productive, not study the framework. The goal of this workflow is to get one round-trip (write a row → read it back) working as fast as possible. Schema editing comes later.

### Concept

The scaffold tool has done the work that the greenfield path's *"run `prisma-next init`"* step covers. You don't repeat it. You read the resulting project state, propose the smallest move that lands the user in their first query, run it with them, and then route them onward.

The first arc is **connect → write → read**, in that order. Not *edit the contract first*, not *plan a migration first*. The user's win is *I have application code running against my database*. The user said the magic word *"next"* — that means the next moment, not a Prisma Next tour.

### Step 1 — Read the project state

Before saying anything specific, read:

- `prisma-next.config.ts` at the repo root — confirms target (`postgres` / `mongodb`), authoring mode (`psl` / `typescript`), extensions, migrations dir.
- The contract source the config declares (canonically `src/prisma/contract.prisma` or `src/prisma/contract.ts`; a scaffold using the pre-[TML-2532](https://linear.app/prisma-company/issue/TML-2532) layout may have it at `prisma/contract.{prisma,ts}` instead — check the `contract` field of the config) — what starter models exist.
- `src/prisma/db.ts` (or wherever the config's `contract` field places it — `db.ts` sits beside the schema) — confirms the runtime entry point is wired.
- `.env` / `.env.example` — is `DATABASE_URL` set?
- Optionally `pnpm prisma-next db verify` — confirms the live DB matches the contract.

### Step 2 — Bring the project to the first-arc prerequisites

Compare what you found in Step 1 against the prerequisite list in *Your first arc — connect, write, read* above. The fastest move depends on what's missing:

- **All prerequisites already satisfied.** Skip to Step 3 — go straight to the arc.
- **DB not initialised yet** (marker row missing — `db verify` reports drift between contract and DB). Run `pnpm prisma-next db init`.
- **`DATABASE_URL` not set.** Have the user set it in `.env` (not in `prisma-next.config.ts` — see Pitfall 5), then `db init`.
- **Contract is empty** (a bootstrap tool that didn't seed a starter model). Add **one** model with **two** fields (e.g. `User { id, email }`), run `pnpm prisma-next contract emit`, then `pnpm prisma-next db init`. Don't bloat the starter — minimal model, get the round-trip working, extend after.

### Step 3 — Run the first arc

See *Your first arc — connect, write, read* above. Adapt the snippet's model name to whatever the contract declares.

### Step 4 — Orient the user to the toolbelt

Once one round-trip works, brief the user on the day-to-day commands — see *Commands you'll use day-to-day* below. Keep it short; don't lecture.

### Step 5 — Ask what they want to build, then route

- More queries (filters, joins, transactions, raw SQL, TypedSQL) → `prisma-next-queries`.
- Schema changes (add a model, change a field, add a relation) → `prisma-next-contract`.
- Middleware, environment config, switching targets → `prisma-next-runtime`.
- Vite plugin / dev-server integration → `prisma-next-build`.

### Anti-patterns on this path

- Diving into migration concepts before one query has run. Migrations exist; their value lands later.
- Adding several models in one go. Add one, get one query green, then iterate.
- Walking the user through `prisma-next.config.ts` keys. The scaffold's defaults are correct; revisit when the user needs to change something.
- Treating *"what can I do with Prisma next?"* as a request to explain Prisma Next. Don't. The user said *"do"*. Get them moving; explanation comes naturally as they touch each surface.

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
- `--schema-path <path>` — defaults to `prisma/contract.prisma` (or `prisma/contract.ts`). **Pass `--schema-path src/prisma/contract.prisma` (or `.../contract.ts`)** to scaffold into the canonical `src/prisma/` location directly — `init`'s default is wrong today, see [TML-2532](https://linear.app/prisma-company/issue/TML-2532).
- `--force` — overwrite an existing scaffold without prompting (re-running init in a scaffolded directory triggers the reinit flow — `--force` skips the confirmation).
- `--write-env` — also write `.env` (default writes only `.env.example`; `.env` stays under your control).
- `--probe-db` — connect to `DATABASE_URL` once and check the server version against the target's minimum.
- `--strict-probe` — fail init if the probe fails (no-op without `--probe-db`).
- `--no-install` — skip dependency install + initial contract emit.
- `--no-skill` — skip the `@prisma-next/agent-skill` install (air-gapped / restricted environments).
- `--install-user-skill` — also install the agent skill at the user level (every project on this host).

`init` writes (when it runs cleanly):

- `prisma-next.config.ts` at the project root.
- The contract source at `--schema-path` — `src/prisma/contract.prisma` if you passed the canonical override, `prisma/contract.prisma` if you accepted the (currently-wrong) default.
- `db.ts` in the same directory as the contract source.
- `prisma-next.md` — a human quick-reference.
- `.env.example` (and `.env` if `--write-env`).
- Updates `package.json` (deps + scripts) and `tsconfig.json` (required compiler options).
- Installs deps and runs `prisma-next contract emit` once.
- Registers `@prisma-next/agent-skill` with the local agent runtime.

**If you took `init`'s default and ended up with a top-level `prisma/` directory** (TML-2532), the cleanup is one move + one config edit:

```bash
mkdir -p src && mv prisma src/prisma
# Then update prisma-next.config.ts so `contract` reads
# 'src/prisma/contract.prisma' (or .ts) instead of 'prisma/contract.prisma'.
pnpm prisma-next contract emit   # re-emits contract.json + contract.d.ts under src/prisma/
```

Do this before running `db init` — once the marker row is written, restructuring is harder.

After init succeeds, the path converges on *Your first arc — connect, write, read* above. `init` has already seeded a starter contract with `User` and `Post` models (with a relation between them) and run `contract emit` once; the only remaining prerequisites are setting `DATABASE_URL` and initialising the database. Two commands:

1. Set `DATABASE_URL` in `.env` (copy from `.env.example`).
2. Initialise the database: `pnpm prisma-next db init`. Creates tables, indexes, constraints, and writes the marker row — using the starter contract `init` generated.

Then run the snippet from *Your first arc* above against the `User` model. When the user is ready to extend the contract — add more models, change fields, add relations — chain to `prisma-next-contract`. For more queries, chain to `prisma-next-queries`.

**Why this is queries-first, not schema-editing-first.** `init` ships with `User` and `Post` on purpose: the user shouldn't have to design a schema to prove their setup works. Extending the contract is the next move *after* the first arc lands, not part of getting there. If the user asks you to skip straight to *"add a Comment model"* — sure, do that — but get one query green against `User` or `Post` first if there's any doubt the project is wired correctly.

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
pnpm prisma-next contract infer --db "$DATABASE_URL" --output src/prisma/contract.prisma
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

Then run the snippet from *Your first arc — connect, write, read* above, using one of your existing tables in place of the starter model. The arc is the same; only the path that got you there differs.

## Commands you'll use day-to-day

A short toolbelt reference for the *Post-bootstrap orientation* workflow's Step 3 — and a useful one-glance summary for anyone newly oriented to Prisma Next. For flag-level detail, run `<command> --help`; the help output is the source of truth.

| What you want to do | Command | Deeper skill |
|---|---|---|
| Apply the current contract to the DB the first time | `prisma-next db init` | this skill |
| Re-emit `contract.json` + `contract.d.ts` after editing the contract source | `prisma-next contract emit` | `prisma-next-contract` |
| Quick dev-only schema sync (no migration history kept) | `prisma-next db update` | `prisma-next-migrations` |
| Plan a migration from a contract diff | `prisma-next migration plan --name <slug>` | `prisma-next-migrations` |
| Apply pending migrations | `prisma-next migration apply` | `prisma-next-migrations` |
| Inspect the live database | `prisma-next db schema` | `prisma-next-debug` |
| Confirm the DB matches the contract (drift check) | `prisma-next db verify` | `prisma-next-debug` |
| Bring an existing DB into a PN contract | `prisma-next contract infer --db "$DATABASE_URL"` | this skill (brownfield) |
| Decode a structured error envelope | (read the `code` / `why` / `fix` fields) | `prisma-next-debug` |
| Report a bug or request a feature | (file via the feedback skill) | `prisma-next-feedback` |

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

- [ ] Confirmed which path applies (post-bootstrap orientation / greenfield / brownfield) before proposing commands.
- [ ] **All paths:** brought the project to the *Your first arc* prerequisites (config, contract source, `db.ts`, `DATABASE_URL`, marker row) *before* writing application code.
- [ ] **All paths:** ran the first arc — one `create` + one `select` against the starter (or inferred) model — and got the round-trip working green.
- [ ] **All paths:** did *not* edit the contract source as part of the first arc. Schema extension is the *next* move, not the first.
- [ ] Confirmed the user's target (`postgres` / `mongodb`) and authoring mode (`psl` / `typescript`).
- [ ] **Post-bootstrap path:** read `prisma-next.config.ts`, the contract source, `db.ts`, and `.env` before proposing anything — didn't assume what the bootstrap tool left in place.
- [ ] **Greenfield path:** ran `prisma-next init` from the project directory — no positional project-name argument.
- [ ] **All paths:** the project ended up in the canonical `src/prisma/contract.{prisma,ts}` + `src/prisma/db.ts` + `migrations/app/` layout — including moving the scaffolded directory out of a top-level `prisma/` if `init` produced one (TML-2532).
- [ ] **Brownfield path:** ran `contract infer --db "$DATABASE_URL" --output src/prisma/contract.prisma`, reviewed the result, then `contract emit` + `db sign`.
- [ ] Set `DATABASE_URL` in `.env` and confirmed the value is reachable.
- [ ] Initialised the DB (`db init` greenfield / post-bootstrap) or signed the marker (`db sign` brownfield).
- [ ] Did NOT hand-edit `contract.json` or `contract.d.ts`.
- [ ] Did NOT set `DATABASE_URL` in `prisma-next.config.ts`.
- [ ] Confirmed the user understands what the *next* skill is for their workflow (typically `prisma-next-queries` for more queries, then `prisma-next-contract` when they're ready to extend the schema).
