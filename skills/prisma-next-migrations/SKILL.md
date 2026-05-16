---
name: prisma-next-migrations
description: Author Prisma Next migrations — choose db update vs migration plan, edit the framework-rendered migration.ts (replace placeholder sentinels with dataTransform closures), recover from MIGRATION.HASH_MISMATCH or PN-MIG-2001 unfilled placeholder. Use for prisma migrate dev, prisma migrate deploy, prisma db push, db update, db update --dry-run, migration plan, migration apply, migration new, migration show, db verify, db sign, data migration, this.dataTransform, dataTransform, placeholder, generated migration.ts, edit migration.ts, MIGRATION.HASH_MISMATCH, schema drift.
---

# Prisma Next — Migration Authoring

> **Edit your data contract. Prisma Next plans the migration. You fill in any data transforms.**

The three-step user model:

1. **You edit your data contract.** (`prisma-next-contract`)
2. **Prisma Next plans the migration for you.** ← this skill
3. **If a data transform is needed, you edit `migration.ts` and self-emit.** ← this skill

Once the contract changes, you choose how the change reaches the database. This skill covers the two paths (`db update` and `migration plan` + `migration apply`), the migration-package contract, the `migration.ts` authoring API, and the failure modes you recover from without leaving the loop.

## When to Use

- User edited the contract and wants to apply the change to the DB.
- User wants to author a migration with a data transform.
- User wants to run pending migrations against a local DB.
- User hit `MIGRATION.HASH_MISMATCH`, `PN-MIG-2001` (unfilled placeholder), or a partially-applied migration.
- User mentions: *migrate, migration, db push, db update, `prisma migrate dev`, `prisma migrate deploy`, drift, hash mismatch, data backfill*.

## When Not to Use

- User wants to know what migrations *will run on deploy* / on merge, or to manage refs and invariants → `prisma-next-migration-review`.
- User wants to edit the contract → `prisma-next-contract`.
- User wants a deeper read of a single structured error envelope → `prisma-next-debug`.

## Key Concepts

- **`db update` (quick path).** Reads the emitted contract, diffs against the live DB, applies the change. Optional `--dry-run` prints the plan without executing. Interactive destructive-op confirmation (or `-y` to auto-accept). **Writes no migration directory.** Operations needing data transforms are not handled by this path — `db update` excludes the `data` operation class entirely and short-circuits where a data transform would be required. Use only against a database that has no shared history with anyone else (your local dev DB).
- **`migration plan` (formal path).** Reads the emitted contract, diffs against the head of the on-disk migration graph, writes a new migration package under `migrations/app/<YYYYMMDDTHHMM>_<snake_slug>/`. If any operation needs a data transform, the package's `migration.ts` contains `placeholder(...)` calls you fill in.
- **The `app/` segment in migration paths is the consuming application's contract-space id.** Every migration *you* author lives under `migrations/app/`. Extensions your contract depends on get their own sibling directories (`migrations/<extension-space-id>/`) — those are managed by the extension package and you don't write into them. The `app/` segment lands automatically the first time you run `migration plan` / `db init` against an app-level config.
- **Migration package files** (inside each `migrations/app/<dir>/`):
  - `migration.json` — manifest (metadata + `migrationHash`).
  - `ops.json` — canonical operation list. Content-addressed; `migrationHash` is computed over this.
  - `end-contract.json` and `end-contract.d.ts` — the contract this migration ends at, imported by `migration.ts` for type-safe data transforms.
  - `migration.ts` — TypeScript authoring source, **framework-rendered** by `migration plan` (or `migration new`). You edit specific holes in it (see *Fill a placeholder* below) and re-emit `ops.json` / `migration.json` by running it.
- **Self-emit.** Running `node migrations/app/<dir>/migration.ts` regenerates `ops.json` and `migration.json` from the (possibly edited) TS source. This is the only supported way to update an existing migration package after edits.
- **`migration.ts` shape.** Framework-rendered. A class extending `Migration` (re-exported by `@prisma-next/target-postgres/migration` in the rendered import line — see the framing block below), with an `operations` getter that returns an array of factory-call values. The file ends with `MigrationCLI.run(import.meta.url, M)` so executing it self-emits.
- **`placeholder(slot)`.** A sentinel the planner emits into the rendered `migration.ts` (imported from `@prisma-next/target-postgres/migration` on the framework-managed import line) wherever a data transform is needed. Calling `placeholder(...)` at emit time throws `PN-MIG-2001` *Unfilled migration placeholder*. The user replaces the `() => placeholder(...)` arrow with a real query-plan closure, then self-emits.
- **`this.dataTransform(endContract, name, { check, run })`.** The data-transform factory. `check` is a rowset query whose presence-of-any-row signals "work remains"; `run` is one or more mutation queries that perform the backfill. Both are lazy closures returning query-plans built against `endContract`. The runner wraps `check` as `EXISTS(...)` for precheck and `NOT EXISTS(...)` for postcheck, so the same closure asserts both "there is work" and "the work is done".
- **`pendingPlaceholders`.** A boolean field on the JSON result of `migration plan`. `true` means the package was written but contains unfilled placeholders — `migration apply` will throw `PN-MIG-2001` until you edit `migration.ts` and self-emit.
- **`migrationHash`.** Content-addressed identity of a migration package. `MIGRATION.HASH_MISMATCH` fires when the stored hash in `migration.json` disagrees with the hash recomputed from the on-disk files (almost always: someone edited `migration.ts` without self-emitting).
- **Marker.** A single row in the `prisma_contract.marker` table that records "this database is at contract hash X for space Y". Each successful migration advances the marker as part of the same transaction as the DDL. `db sign` writes the marker from the current contract hash, but only after a schema-verification pass succeeds (it will not sign a database whose live schema disagrees with the contract).
- **Apply runs in a transaction.** Each migration runs inside `BEGIN ... COMMIT`. On any failure mid-migration, Postgres rolls the migration back; the marker stays at the previous migration's `to` hash. The database is not left in a half-applied state for ordinary DDL + data-transform sequences.
- **Operation classes.** Every operation declares an `operationClass`: `additive`, `widening`, `data`, or `destructive`. The CLI surfaces these in the plan preview and in JSON output. There is no `long-running` class and the framework does not emit `CREATE INDEX CONCURRENTLY` — operations stay transactional.

## `migration.ts` is framework-rendered, not hand-authored

Files under `migrations/<space-id>/<timestamp>/migration.ts` (for your own app, `<space-id>` is always `app/`) are **rendered for you** by the framework — `prisma-next migration plan` writes a populated package whenever the contract changes, and `prisma-next migration new` writes an empty scaffold when you want to author operations directly. You do not write these files from scratch. You edit specific holes the framework leaves behind — chiefly replacing `placeholder("<slot>")` sentinels with real `this.dataTransform({ check, run })` closures — then self-emit.

The imports at the top of the rendered file currently point at `@prisma-next/target-postgres/migration`. The user-facing `@prisma-next/postgres` façade does **not** currently re-export this surface, so the rendered import deliberately reaches into the target package directly. Linear ticket [TML-2526](https://linear.app/prisma-company/issue/TML-2526) tracks closing that gap; once it lands, the renderer (and this skill) will switch to `@prisma-next/postgres/migration` in one step.

Until then, treat the rendered import line as framework-managed:

- Leave it where it is. Don't rewrite it to a different `@prisma-next/<…>` path; the framework's renderer is the authoritative shape and any change you make by hand will be reverted (and may trip `MIGRATION.HASH_MISMATCH`) the next time the package is re-rendered or self-emitted.
- If you need an additional symbol (e.g. `dataTransform`, `setNotNull`, `rawSql`) to fill in a placeholder, **add it to the existing rendered import line** rather than introducing a second import from a different `@prisma-next/...` subpath.
- The "user code imports only from `@prisma-next/<target>`" convention applies to *your* own modules (queries, runtime setup, contract authoring). The framework-rendered `migration.ts` scaffold is the framework's surface, not yours; the rule is suspended for that one file.

## Diagnostic codes you route on

| Code | Source | Move |
|---|---|---|
| `PN-MIG-2001` *Unfilled migration placeholder* | Throwing `placeholder(...)` at emit time | Open `migration.ts`, replace the named `placeholder("<slot>")` call with the real query closure, self-emit. |
| `PN-MIG-2002` *migration.ts not found* | Reading a migration package | The package is malformed. Recover from version control, or run `prisma-next migration new` for a fresh one. |
| `PN-MIG-2003` *invalid default export* | Loading `migration.ts` | The file's default export is not a `Migration` subclass or factory function. Restore the planner-emitted scaffold from version control or re-run `migration plan` for a clean package. |
| `PN-MIG-2005` *dataTransform contract mismatch* | Building a data-transform query plan | The query builder was instantiated with a contract reference different from the `endContract` passed to `this.dataTransform(...)`. Use the `endContract` imported at module scope for both. |
| `MIGRATION.HASH_MISMATCH` *Migration package is corrupt* | `migration apply` (or any read of the package) | `ops.json` / `migration.json` were edited without self-emitting. Run `node migrations/app/<dir>/migration.ts` to re-emit, then re-apply. |
| `PN-RUN-3002` *Hash mismatch* | `db verify` | The marker in `prisma_contract.marker` disagrees with the contract hash. The DB is at a different contract version than the code thinks. Either run a migration forward, or — if the DB is correct and the marker is stale after a manual fix-up — run `db sign`. |
| `PN-RUN-3001` *Database not signed* | Any command needing a marker | The DB has no marker yet. Run `prisma-next db init --db <url>` to baseline an empty database, or `db update --db <url>` to apply the current contract directly. |

## Decision — which path do you take?

| Situation | Path | Why |
|---|---|---|
| Local dev, schema in flux | `db update` | Fast, interactive, no migration files. |
| Shared branch with other developers | `migration plan` + `apply` | Replayable, reviewable, content-hashed. |
| Anything reaching production | `migration plan` + `apply` | Production must run a reviewed, hashed migration. |
| Adding a column that needs a backfill | `migration plan` (writes `placeholder`), edit `migration.ts`, self-emit, then `migration apply` | `db update` does not author data transforms; the formal path does. |
| Recovering from drift (DB diverged from contract) | `db sign` after manual fix, *or* `migration plan` if PN can plan the fix | Depends on which side is right. See *Recover from drift* below. |

## Workflow — `db update` (quick path)

The concept: `db update` resolves the destination (`emitted contract`) against the live DB and applies the difference. Preview with `--dry-run`. Destructive ops prompt interactively unless you pass `-y` or `--no-interactive`. The path excludes operations of the `data` class entirely — if the diff requires a data transform, `db update` fails with a planning error and you switch to `migration plan` to author the transform.

Run after a contract edit:

```bash
pnpm prisma-next contract emit
pnpm prisma-next db update --db $DATABASE_URL --dry-run
pnpm prisma-next db update --db $DATABASE_URL
pnpm prisma-next db verify --db $DATABASE_URL
```

Inspect the JSON output to drive the next move:

```bash
pnpm prisma-next db update --db $DATABASE_URL --json
```

The JSON contains `plan.operations[]` with each `operationClass`, plus (in apply mode) `execution.operationsExecuted` and the post-apply `marker.storageHash`. If the command failed because of destructive operations, the error envelope's `meta.destructiveOperations[]` lists exactly what would have been dropped.

## Workflow — `migration plan` + `apply` (formal path)

The concept: `migration plan` writes a new migration package on disk. If the planner needed any data transforms, the package is *pending* — `migration.ts` holds `placeholder(...)` calls until you fill them in. `migration apply` runs every pending package in graph order, transactionally.

Plan a change:

```bash
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name <snake_slug>
```

Read the result. The JSON shape exposes the queryable signals:

- `dir` — the path of the new package (e.g. `migrations/app/20260515T1200_add_user_email/`).
- `pendingPlaceholders` — `true` if `migration.ts` still contains `placeholder(...)` calls.
- `operations[].operationClass` — for spotting `destructive` and `data` ops.
- `preview.statements` — family-agnostic textual preview.

Inspect the package:

```bash
pnpm prisma-next migration show
pnpm prisma-next migration show <dirName-or-migrationHash-prefix>
```

Fill in any data transforms (see *Fill a placeholder*), self-emit if you edited `migration.ts`, then:

```bash
pnpm prisma-next migration apply --db $DATABASE_URL
pnpm prisma-next db verify --db $DATABASE_URL
```

`migration apply` runs without prompting — destructive-op confirmation lives on `db update`, not here. Review destructive ops in the plan output or in `migration show` *before* applying.

## Workflow — Fill a placeholder

The concept: the planner can detect *that* a data transform is needed (e.g. backfilling a new `NOT NULL` column with no default) but not *what* it should do. It writes a typed scaffold and stops; you fill the check and run closures with real query plans built against `endContract`, then self-emit.

The scaffold the planner emits looks like:

```typescript
// migrations/app/20260515T1200_add_user_name/migration.ts
import endContract from './end-contract.json' with { type: 'json' };
import { Migration, MigrationCLI, addColumn, placeholder } from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override get operations() {
    return [
      addColumn('public', 'user', {
        name: 'name',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
      this.dataTransform(endContract, 'backfill user.name', {
        check: () => placeholder('backfill user.name:check'),
        run:   () => placeholder('backfill user.name:run'),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
```

Replace both `placeholder(...)` calls with query-plan closures built from `endContract`. The `check` closure must return a **rowset query whose presence of any row signals "work remains"** — conventionally `<table>.select('id').where(<violation predicate>).limit(1)`. Scalar/aggregate shapes (`count(*)`, `bool_and(...)`) silently break the contract: the runner wraps `check` twice (`EXISTS(...)` for precheck, `NOT EXISTS(...)` for postcheck), and a query that always returns one row makes `EXISTS` always true and `NOT EXISTS` always false.

Build the query builder against `endContract` so the storage hashes line up — using a different contract reference raises `PN-MIG-2005`. The filled-in shape (the rendered scaffold above with `placeholder(...)` calls replaced; if you need an extra factory like `setNotNull`, add it to the *existing* `@prisma-next/target-postgres/migration` import line rather than authoring a second import). See `prisma-next-queries` for the surrounding `db` setup:

```typescript
import endContract from './end-contract.json' with { type: 'json' };
import { Migration, MigrationCLI, addColumn, setNotNull } from '@prisma-next/target-postgres/migration';
import { db } from './db'; // sql({ context: createExecutionContext({ contract: endContract, ... }) })

export default class M extends Migration {
  override get operations() {
    return [
      addColumn('public', 'user', {
        name: 'name',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
      this.dataTransform(endContract, 'backfill user.name', {
        check: () => db.users.select('id').where((f, fns) => fns.eq(f.name, null)).limit(1),
        run:   () => db.users.update({ name: '' }).where((f, fns) => fns.eq(f.name, null)),
      }),
      setNotNull('public', 'user', 'name'),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
```

Self-emit:

```bash
node migrations/app/20260515T1200_add_user_name/migration.ts
```

Self-emit regenerates `ops.json` and recomputes `migrationHash` in `migration.json`. The next `migration apply` will see a consistent package.

## Workflow — Author a migration by hand

The concept: the same `Migration` class shape lets you author operations directly when the planner has nothing to plan (a custom data fix, an extension install, a baseline). Even here you don't write the file from scratch — `migration new` renders an empty package for you, and you edit the `operations` getter inside it, then self-emit.

```bash
pnpm prisma-next migration new --name <snake_slug>
```

The factories you can call are re-exported through the same framework-rendered `@prisma-next/target-postgres/migration` import line — add the names you need to that line rather than introducing a second import. Categories (browse with `--help` on the command and by reading the import list):

- Tables: `createTable`, `dropTable`.
- Columns: `addColumn`, `dropColumn`, `alterColumnType`, `setNotNull`, `dropNotNull`, `setDefault`, `dropDefault`.
- Constraints: `addPrimaryKey`, `addForeignKey`, `addUnique`, `dropConstraint`.
- Indexes: `createIndex`, `dropIndex`.
- Enums: `createEnumType`, `addEnumValues`, `renameType`, `dropEnumType`.
- Dependencies: `createSchema`, `createExtension`, `installExtension`.
- Raw escape hatch: `rawSql({ id, label, operationClass, target, precheck, execute, postcheck, ... })`.
- Data transforms: `this.dataTransform(endContract, name, { check, run })` (instance method, not a free factory).

Self-emit (`node migrations/app/<dir>/migration.ts`) after each edit.

## Workflow — Inspect the live schema

The concept: `db schema` is read-only and never writes files. It prints the live schema as a tree by default or as JSON with `--json`. Use it during planning and as part of verification.

```bash
pnpm prisma-next db schema --db $DATABASE_URL
pnpm prisma-next db schema --db $DATABASE_URL --json > schema.json
```

There is no built-in filter flag — pipe the JSON through `jq` (or your favourite JSON tool) if you only want one table.

## Workflow — Verify contract vs DB

The concept: `db verify` compares the live schema *and* the marker against the contract. Three modes:

- Default — full verification (schema + marker).
- `--marker-only` — skip schema verification, only check the marker.
- `--schema-only` — skip marker verification, only check schema satisfies contract.
- `--strict` adds: schema elements not present in the contract are an error (default is "DB may have extras").

```bash
pnpm prisma-next db verify --db $DATABASE_URL
```

On mismatch, the error envelope names the failure mode (`PN-RUN-3002` hash mismatch, `PN-RUN-3001` marker missing, target mismatch, schema issues with structured paths). Run after any manual fix or any `apply`.

## Workflow — Re-sign the marker

The concept: `db sign` rewrites the marker to the current contract hash. Use after a manual repair where the DB is the source of truth and the marker is stale. `db sign` performs a schema-verify first and refuses to sign a DB whose schema disagrees with the contract — so a successful sign always means the schema matches and the marker is now correct.

```bash
pnpm prisma-next db sign --db $DATABASE_URL
```

## Workflow — Recover from drift

The concept: drift means `db verify` reports the live DB schema doesn't match what the marker says it should be. Two valid moves, picked by which side is correct:

- **The contract is right; the DB is wrong** → run a migration. Either `db update` (quick path, dev DB only) or `migration plan` + `apply` (everywhere else).
- **The DB is right; the contract or marker is wrong** → edit the contract to match the DB (see `prisma-next-contract`), emit, then `db sign` to refresh the marker.

The diagnostic that reveals which side is right:

```bash
pnpm prisma-next db schema --db $DATABASE_URL --json
pnpm prisma-next db verify --db $DATABASE_URL --json
```

Re-verify after either branch. Stop when `db verify` returns `ok` with no diagnostics.

## Workflow — Recover from a partially-applied migration

The concept: each migration applies transactionally, so a mid-migration failure rolls back to the previous successful migration. The marker stays at the previous migration's `to` hash. The diagnostic move is to verify state, fix the failed migration's `migration.ts`, self-emit, and re-apply.

Failures that *can* leak partial state are limited to: explicit `rawSql(...)` operations that step outside a transaction (e.g. inside an `execute` step that runs against an autocommit driver session), or external side-effects (calls out to other systems from a `run` closure). For ordinary DDL + `this.dataTransform(...)` flows the runner's transaction wrap keeps the database consistent.

Diagnose:

```bash
pnpm prisma-next db verify --db $DATABASE_URL --json
pnpm prisma-next db schema --db $DATABASE_URL --json
```

Fix and re-apply:

```bash
node migrations/app/<dir>/migration.ts
pnpm prisma-next migration apply --db $DATABASE_URL
```

If the failure was an out-of-band side-effect that left external systems half-changed, repair those by hand before re-applying.

## Workflow — Recover from `MIGRATION.HASH_MISMATCH`

The concept: `migrationHash` is content-addressed. A mismatch means `migration.json`'s stored hash disagrees with the hash recomputed from `ops.json` (and metadata). The cause is almost always: someone edited `migration.ts` and forgot to self-emit. The remediation is to self-emit the offending package.

```bash
node migrations/app/<dir>/migration.ts
pnpm prisma-next migration apply --db $DATABASE_URL
```

If self-emit itself fails (e.g. the contract has moved on and the operations no longer make sense against `end-contract.json`), the package is stale. Either restore it from version control or delete it and re-plan with `migration plan`.

## Workflow — Resolve a destructive-operation prompt (`db update` only)

The concept: when `db update` would drop columns or tables, it stops and asks before applying. The prompt is `db update`-specific — `migration apply` does *not* prompt and runs whatever the migration package contains, so review the plan or call `migration show` before applying.

When `db update` reports destructive operations interactively, the warning lists them. The prompt is:

> Apply destructive changes? This cannot be undone.

Routing:

- Answer yes if the data is no longer needed.
- Answer no, then either:
  - Re-shape the migration via `migration plan` and hand-edit `migration.ts` to preserve the data (e.g. copy-to-new-column, then drop), or
  - Skip the destructive operation by reverting the contract change.

In non-interactive contexts (CI, `--no-interactive`, `--json`), the destructive-op response is returned as a structured error — `meta.destructiveOperations[]` lists what would have been dropped. Re-run with `-y` to auto-accept, or address each operation individually.

## Common Pitfalls

1. **Using `db update` against shared or production databases.** Never. The change leaves no migration history. Use `migration plan` + `apply`.
2. **Skipping a data transform.** Leaving `placeholder(...)` in `migration.ts` makes the next `migration apply` throw `PN-MIG-2001`. Fill every placeholder slot and self-emit.
3. **Editing `ops.json` directly.** It's the canonical artifact, not the authoring source. Edit `migration.ts`, then self-emit.
4. **Forgetting to self-emit after editing `migration.ts`.** The next `apply` either uses the stale `ops.json` (if you only added comments) or fails with `MIGRATION.HASH_MISMATCH` (if you changed operations). Always self-emit.
5. **Aggregate `check` closure in `this.dataTransform`.** Returning `count(*)` or `bool_and(...)` breaks the precheck/postcheck contract — both sides resolve to constants. Use a rowset shape: `select('id').where(<violation>).limit(1)`.
6. **Two contract references in one migration.** Building a query plan against a different contract than the one passed to `this.dataTransform(endContract, ...)` raises `PN-MIG-2005`. Always import `endContract` once at module scope and use the same reference.
7. **Renaming and expecting the planner to detect it.** Prisma Next has no in-contract rename hint today; the planner emits a destructive drop+add. Hand-edit `migration.ts` to rewrite the destructive op as a `rawSql({ ... })` that issues `ALTER TABLE ... RENAME COLUMN ...` (or use the two-migration keep / backfill / drop pattern), then self-emit. See `prisma-next-contract` § *Edit a field — rename*.
8. **Hand-authoring `migration.ts` from a blank file, or rewriting the rendered import line.** Migration files are framework-rendered — let `prisma-next migration plan` (or `migration new`) render the package, then edit only the holes the framework leaves for you. The rendered `@prisma-next/target-postgres/migration` import is the framework's surface, not a stable user-facing one (TML-2526 tracks moving it to `@prisma-next/postgres/migration`); leave the path alone, and add any extra symbols you need to the existing import line.

## What Prisma Next doesn't do yet

- **Runtime-apply migrations.** Prisma Next doesn't apply pending migrations from your app's startup code (the "Drizzle pattern" for serverless / edge). Workaround: run `prisma-next migration apply` from your deploy pipeline before the app starts. If you need runtime-apply built-in, file a feature request via the `prisma-next-feedback` skill.
- **Seeds-as-first-class.** Prisma Next doesn't ship a `prisma db seed` equivalent. Workaround: write a TypeScript script that imports your `db` instance and runs your setup queries; invoke it from `package.json`'s scripts. If you need first-class seeding, file a feature request via the `prisma-next-feedback` skill.
- **Migration squashing.** Prisma Next doesn't squash older migrations into a baseline. They accumulate; for very large histories, manual baseline-and-truncate is the path. If you need built-in squashing, file a feature request via the `prisma-next-feedback` skill.
- **In-contract rename hints.** The planner cannot detect that a field rename is a rename rather than a drop+add. Workaround: hand-edit `migration.ts` to issue a `RENAME COLUMN` via `rawSql(...)`, or use a keep / backfill / drop pattern across two migrations. If you need a contract-level rename hint, file a feature request via the `prisma-next-feedback` skill.
- **`@prisma-next/postgres` façade re-export of the migration surface.** The `@prisma-next/postgres` package does not yet re-export the migration authoring API (`Migration`, `MigrationCLI`, `placeholder`, `addColumn`, `setNotNull`, `dataTransform`, …). The framework-rendered `migration.ts` therefore imports from `@prisma-next/target-postgres/migration` directly. Workaround: leave the rendered import where it is — it works, it is what the framework emits, and rewriting it breaks `migrationHash` round-tripping. Linear ticket [TML-2526](https://linear.app/prisma-company/issue/TML-2526) tracks closing the gap; once it lands, the renderer will switch and existing files can be migrated by re-running the renderer. If this gap is biting you, file a follow-up via the `prisma-next-feedback` skill referencing TML-2526.

## Checklist

- [ ] Contract emitted (`contract.json` + `contract.d.ts` current).
- [ ] Chose the right path: `db update` (local dev) vs `migration plan` + `apply` (anything shared).
- [ ] For `migration plan`: ran `migration show` to review before apply.
- [ ] Filled every `placeholder(...)` in `migration.ts` (if any), built against `endContract`.
- [ ] `check` closures are rowset queries, not scalar aggregates.
- [ ] Self-emitted (`node migrations/app/<dir>/migration.ts`) after editing the TS.
- [ ] Ran `migration apply` (or `db update`) and saw it complete.
- [ ] Ran `db verify` and got an `ok` result with no diagnostics.
- [ ] Did NOT use `db update` against a shared or production database.
- [ ] Did NOT edit `ops.json` directly.
- [ ] Did NOT skip a destructive-op prompt without inspecting `meta.destructiveOperations[]`.
