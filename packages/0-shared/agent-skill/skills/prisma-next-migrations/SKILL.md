---
name: prisma-next-migrations
description: Author Prisma Next migrations — choose db update vs migration plan, fill data-transform placeholders in migration.ts, recover from hash-mismatch or stuck migrations. Use for prisma migrate dev, prisma migrate deploy, prisma db push, db push, db update, migration plan, migration apply, migration status, migration show, db init, db sign, db verify, data migration, MIGRATION.HASH_MISMATCH, drift.
---

# Prisma Next — Migration Authoring

> **Edit your data contract. Prisma handles the rest.**

The three-step user model:

1. **You edit your data contract.** (`prisma-next-contract`)
2. **The system plans the migrations for you.** ← this skill
3. **If you need data migrations, you edit `migration.ts` and execute it.** ← this skill

Once the contract changes, you choose how the change reaches the
database. This skill covers the two paths (`db update` and the formal
`migration plan` → `apply` path), data-transform placeholders, and
recovery from common failure modes.

## When to Use

- User edited the contract and wants to apply it to the DB.
- User wants to author a migration with a data transform.
- User wants to run pending migrations.
- User hit `MIGRATION.HASH_MISMATCH` or a stuck/failed migration.
- User mentions: *migrate, migration, db push, db update,
  `prisma migrate dev`, `prisma migrate deploy`, marker, drift,
  `MIGRATION.HASH_MISMATCH`*.

## When Not to Use

- User wants to know what migrations *will run on merge* / on deploy → `prisma-next-migration-review`.
- User wants to edit the contract → `prisma-next-contract`.
- User has a hash-mismatch but wants to understand the error in detail → `prisma-next-debug`.

## Key Concepts (before any workflow)

- **`db update` (quick path)**: PN reads the current contract, diffs
  against the database, and applies the changes directly. Confirms
  destructive ops interactively. Use during dev iteration. **Not for
  production.**
- **`migration plan` (formal path)**: PN computes the diff and writes
  a migration directory under `migrations/<timestamp>-<slug>/`
  containing `ops.json` (canonical), `migration.json` (hashes /
  metadata), and `migration.ts` (authoring sugar). Review, optionally
  edit, then `migration apply`.
- **`migration.ts`**: authoring sugar around `ops.json`. Useful for
  data transforms — the operations are sequenced as a script, you fill
  in placeholder logic, and re-emit. The canonical artifact is
  `ops.json`; `migration.ts` is the source you edit.
- **`placeholder(slot)`**: in `migration.ts`, a placeholder function
  the planner inserts where a data transform is needed (e.g. when you
  add a `NOT NULL` column with no default and existing rows need a
  value). You replace it with the real logic.
- **Self-emit**: running `node migrations/<dir>/migration.ts` directly
  re-emits `ops.json` and `migration.json` from the (possibly edited)
  TS source.
- **Marker**: the `pn_meta_marker` row records "the database is at
  contract hash X." Migrations move the marker forward. `db sign`
  manually sets the marker (used after manual fix-ups).

## Decision: `db update` vs `migration plan` + `apply`

| Situation | Choose | Why |
|---|---|---|
| Local dev, schema in flux | `db update` | Fast, interactive, no migration files to manage. |
| Shared dev branch with other developers | `migration plan` + `apply` | Migrations are reviewable + replayable. |
| Anything reaching production | `migration plan` + `apply` | Production must run a reviewed, hashed migration. |
| Adding a column that needs a data transform | `migration plan`, edit `migration.ts`, apply | Data transforms require the formal path. |
| Recovering from drift | `db sign` (after manual fix) or `migration plan` (if PN can plan the fix) | Depends on the situation. |

## Workflow — Quick path (`db update`)

1. Confirm the user has edited the contract and run `prisma-next contract emit`.
2. Preview the change: `pnpm prisma-next db update --dry-run`.
3. Review the proposed operations. If destructive (DROP COLUMN, DROP
   TABLE), confirm with the user.
4. Apply: `pnpm prisma-next db update`. Answer the interactive
   destructive-op prompts.
5. Confirm the schema is up to date: `pnpm prisma-next db verify`.

`db update` does *not* write a migration file. The change exists only
in the local DB. If you'll need to replay this on another environment,
use `migration plan` instead.

## Workflow — Formal path (`migration plan` + `apply`)

1. Confirm the contract is emitted: `pnpm prisma-next contract emit`.
2. Plan: `pnpm prisma-next migration plan --name <slug>`.
   - `<slug>` describes the change (e.g. `add-profile-bio`,
     `rename-user-email`).
   - Output: `migrations/<timestamp>-<slug>/` with `ops.json`,
     `migration.json`, `migration.ts`.
3. Inspect: `pnpm prisma-next migration show <slug>`. Reviews the
   operations in human-readable form.
4. If `migration.ts` contains `placeholder(...)` calls, edit them —
   see [Fill in placeholder data-transforms](#fill-in-placeholder-data-transforms) below.
5. Apply: `pnpm prisma-next migration apply`. Runs every pending
   migration in order.
6. Verify: `pnpm prisma-next db verify`.

## Fill in placeholder data-transforms

When the planner can't safely apply the schema change without a data
transform (e.g. adding a `NOT NULL` column without a default to a table
with existing rows), it inserts a placeholder:

```typescript
// migrations/2026-05-15-1200-add-user-name/migration.ts
import { defineMigration, placeholder } from '@prisma-next/postgres/migration';

export default defineMigration((step) => {
  step.addColumn('user', 'name', { type: 'text', nullable: false });
  step.runDataTransform(placeholder('backfill-user-name'));
  step.alterColumn('user', 'name', { nullable: false });
});
```

Replace the placeholder with the real logic:

```typescript
// Bad: leave the placeholder in. Apply will fail with a "placeholder
// not filled" runtime error.
step.runDataTransform(placeholder('backfill-user-name'));

// Good: replace with the transform.
step.runDataTransform(async (db) => {
  await db.execute(`UPDATE user SET name = email WHERE name IS NULL`);
});
```

Then re-emit `ops.json` from the edited TS:

```bash
node migrations/2026-05-15-1200-add-user-name/migration.ts
```

This is the **self-emit** flow — running the TS file directly regenerates
`ops.json` and updates the hash in `migration.json`. After self-emit,
`migration apply` is safe to run.

## Re-author a migration by hand

If the planner produces something you don't want, you can author the
migration's operations directly in `migration.ts`:

```typescript
import { defineMigration } from '@prisma-next/postgres/migration';

export default defineMigration((step) => {
  step.createTable('archive', {
    id: { type: 'serial', primaryKey: true },
    payload: { type: 'jsonb', nullable: false },
  });
  step.createIndex('archive', 'idx_archive_payload', ['payload']);
});
```

Then self-emit (`node migrations/<dir>/migration.ts`) to refresh
`ops.json` from your hand-authored TS. Apply normally.

## Inspect the schema (`db schema`)

```bash
# Tree-style summary of the live database.
pnpm prisma-next db schema

# Filter to one model / table.
pnpm prisma-next db schema --table user
```

This is the closest PN has to a "show me the database" surface. Useful
during planning and verification.

## Verify contract vs DB (`db verify`)

```bash
pnpm prisma-next db verify
```

Returns OK if the DB matches the contract exactly. Returns a structured
error naming the drift if anything diverges. Run after any manual fix
or after a `migration apply`.

## Re-sign the marker (`db sign`)

When you've manually fixed up the database (e.g. ran SQL out-of-band to
recover from a bad state) and the marker is now stale:

```bash
pnpm prisma-next db sign
```

This sets the marker to the current contract hash. Use only when you've
verified the DB and contract match (`db verify` returns OK).

## Recover from a drifted database

Symptom: `db verify` reports drift. The DB doesn't match what the
marker says it should be.

1. Identify what changed. `db schema` against the live DB; compare to
   the contract.
2. Decide direction:
   - **Update the contract** to match the DB → edit PSL, emit, `db sign`.
   - **Update the DB** to match the contract → `migration plan`, apply.
3. Re-verify: `db verify`.

## Recover from a stuck or failed migration mid-apply

Symptom: `migration apply` failed partway through. The marker is at the
"from" hash but some operations ran.

1. Read the error envelope. It names the failed operation.
2. Inspect the live schema (`db schema`) to see what state the DB is
   actually in.
3. Either:
   - **Roll forward manually**: run the remaining SQL by hand, then `db sign`.
   - **Roll back manually**: undo the partial changes, leaving the DB at
     the "from" hash; then re-run `migration apply` after fixing the
     underlying issue.
4. Re-verify.

PN does **not** auto-roll-back. We don't know what state your data is
in mid-failure.

## Recover from `MIGRATION.HASH_MISMATCH`

Symptom: `migration apply` fails with `PN-MIG-2042 MIGRATION.HASH_MISMATCH`,
naming a migration whose `ops.json` hash doesn't match its `migration.json`.

Cause: someone edited `migration.ts` after the initial emit and forgot
to self-emit, leaving `ops.json` and `migration.json` out of sync.

Fix:

```bash
node migrations/<dir>/migration.ts   # self-emit refreshes ops.json + hash
pnpm prisma-next migration apply
```

Confirm by re-running `migration apply`.

## Resolve a destructive-operation prompt

When `db update` or `migration apply` proposes a destructive op
(DROP COLUMN, DROP TABLE), it confirms first:

> ⚠  Destructive operation: DROP COLUMN user.legacy_field. Continue? [y/N]

- **Yes** if you're certain the data is no longer needed.
- **No** if you want to keep the data — exit and write a migration that
  preserves it (e.g. copy to a different column, then drop).

## Common Pitfalls

1. **`db update` in production.** Never. Use `migration plan` + `apply`.
2. **Skipping the data transform.** If a placeholder is left in,
   `apply` fails with a runtime error. Always fill placeholders and
   self-emit.
3. **Editing `ops.json` directly.** It's the canonical artifact, not the
   source. Edit `migration.ts`, then self-emit.
4. **Forgetting to self-emit after editing `migration.ts`.** The next
   `apply` either uses the stale `ops.json` or fails with
   `HASH_MISMATCH`. Always self-emit.
5. **Renaming without `@hint(was: "...")` in the contract.** The
   migration plans a destructive drop+add. Add the hint in
   `prisma-next-contract` and re-emit.

## What Prisma Next doesn't do yet

- **Runtime-apply migrations.** Prisma Next doesn't apply pending
  migrations from your app's startup code (the "Drizzle pattern" for
  serverless / edge). Workaround: run `prisma-next migration apply`
  from your deploy pipeline before the app starts. If you need
  runtime-apply built-in, file a feature request via the `prisma-next-feedback` skill.
- **Seeds-as-first-class.** Prisma Next doesn't ship a `prisma db seed`
  equivalent. Workaround: write a TypeScript script that imports `db`
  and runs your setup queries; invoke it from `package.json`'s scripts
  (e.g. `"seed": "tsx scripts/seed.ts"`). If you need first-class
  seeding, file a feature request via the `prisma-next-feedback` skill.
- **Migration squashing.** Prisma Next doesn't squash older migrations
  into a baseline. They accumulate; for very large histories, manual
  baseline-and-truncate is the path. If you need built-in squashing,
  file a feature request via the `prisma-next-feedback` skill.

## Reference Files

- `references/db-update-vs-migration-plan.md` — full decision criteria.
- `references/migration-ts-api.md` — every operation `step.*` supports.
- `references/recovery-playbook.md` — drift, stuck-mid-apply, hash-mismatch in detail.

## Checklist

- [ ] Contract emitted (`contract.json` + `contract.d.ts` current).
- [ ] Chose the right path: `db update` (dev) vs `migration plan` + `apply` (anything shared).
- [ ] For `migration plan`: ran `migration show` to review before apply.
- [ ] Filled every `placeholder(...)` in `migration.ts` (if any).
- [ ] Self-emitted (`node migrations/<dir>/migration.ts`) after editing the TS.
- [ ] Ran `migration apply` and saw it complete.
- [ ] Ran `db verify` and got OK.
- [ ] Did NOT use `db update` in / for production.
- [ ] Did NOT edit `ops.json` directly.
- [ ] Did NOT skip a destructive-op prompt without reading what it would drop.
