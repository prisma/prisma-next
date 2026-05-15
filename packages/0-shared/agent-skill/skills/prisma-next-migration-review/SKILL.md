---
name: prisma-next-migration-review
description: Review what Prisma Next migrations will run on merge or deploy, render the migration graph, resolve concurrent / diamond-convergence conflicts, and configure environment refs for CI. Use for "what migrations are going to run", "what runs on deploy", merge conflict, diamond convergence, concurrent migrations, migration status --ref, migration ref, staging, production, prisma migrate deploy preview.
---

# Prisma Next — Migration Review (Deployment + Concurrency)

> **Edit your data contract. Prisma handles the rest.**

This skill is about *reviewing* migrations, not authoring them. It covers the questions that come up at deploy time and when multiple developers are landing migrations concurrently.

## When to Use

- User asks *"what migrations will run when I merge this?"* or *"what's about to run on deploy?"*.
- User hit a concurrent-migration conflict (`main` advanced while their branch was open).
- User wants to wire up a `staging` / `production` migration ref.
- User wants to run a migration against an environment that isn't pointed at by the local config.
- User asks about CI integration for migrations.

## When Not to Use

- User wants to *author* a migration → `prisma-next-migrations`.
- User wants to fix a hash-mismatch / drift in a single env → `prisma-next-migrations` or `prisma-next-debug`.
- User wants to edit the contract → `prisma-next-contract`.

## Key Concepts (before any workflow)

- **Migration ref**: a named pointer to an environment's expected state. Stored in `migrations/refs.json`. Each ref records: the env name (e.g. `staging`), the `DATABASE_URL` env-var name (e.g. `STAGING_DATABASE_URL`), and the marker hash the env is currently at.
- **From / to hash**: every migration carries a "from" hash (the contract hash it migrates *from*) and a "to" hash (the contract hash it migrates *to*). Migrations chain through these hashes; the database's marker must match a migration's "from" hash for that migration to apply.
- **Migration graph**: the graph of migrations from each environment's current marker forward to the contract head. Linear in the common case; branches when concurrent topic branches each add a migration off the same parent.
- **Diamond convergence**: two topic branches each add a migration off the same parent. The second to merge has to converge — either by pure rebase (if the schema deltas are compatible) or by re-planning.

## Workflow — "What's about to run on merge?"

The user asks: *"I'm about to merge this PR. What migrations are going to run when I deploy?"*

1. Identify the target environment. Default: `staging` (or whatever the user's deploy pipeline runs first). The user may say `production`.
2. Confirm a ref is configured for that environment:

   ```bash
   pnpm prisma-next migration ref list
   ```

3. Query the migration graph against that ref:

   ```bash
   pnpm prisma-next migration status --ref staging
   ```

Output lists every migration between the env's current marker and the contract head, in order, with each migration's name, "from" hash, "to" hash, and any data-transform steps it carries.

4. If the user wants the live DB consulted (not just the recorded marker in `refs.json`), add `--db`:

   ```bash
   pnpm prisma-next migration status --ref staging --db "$STAGING_DATABASE_URL"
   ```

This connects, reads the live marker, and reports the actual delta.

5. Surface the list to the user. For each migration, flag any that:
   - Contains a data transform — calls attention; transforms are not pure schema and warrant review.
   - Contains a destructive op (DROP COLUMN, DROP TABLE) — flag and name the dropped surface.
   - Has a long-running operation (CREATE INDEX without `CONCURRENTLY`, ALTER COLUMN with a default fill) — flag.

## Workflow — Render the migration graph from a topic branch

Useful when the user wants to see the current branch's migration ahead of `main`:

1. Run `migration status` without `--ref` to see local-vs-contract-head:

   ```bash
   pnpm prisma-next migration status
   ```

2. To compare branch's `main` state against the topic-branch state, do a side-by-side:

   ```bash
   git fetch origin main
   git switch main
   pnpm prisma-next migration status > /tmp/main-status.txt
   git switch -
   pnpm prisma-next migration status > /tmp/branch-status.txt
   diff /tmp/main-status.txt /tmp/branch-status.txt
   ```

(PN doesn't ship a built-in "branch diff" view; the workaround uses git + the status command.)

## Workflow — Detect that main advanced ahead of the topic branch

Symptom: the topic branch's migration was planned against a parent hash that no longer matches `main`'s head.

1. Fetch and inspect:

   ```bash
   git fetch origin main
   git log --oneline ..origin/main -- migrations/
   ```

If `main` has migrations the branch doesn't, the topic branch is behind.

2. Run `migration status` against the topic branch:

   ```bash
   pnpm prisma-next migration status
   ```

If it reports "branch migration's `from` hash does not match `main`'s head", you have a concurrent-migration conflict. Resolve it (next workflow).

## Workflow — Resolve a concurrent-migration conflict (diamond convergence)

The user has a topic branch with a migration. `main` advanced; another team's migration landed first. Both branches diverged from the same parent. The five-step procedure:

1. **Rebase the topic branch onto the new `main`.**

   ```bash
   git fetch origin main
   git rebase origin/main
   ```

This brings the other team's migration directory into your tree. Your migration directory is still there too.

2. **Delete your topic branch's locally-planned migration directory.**

   ```bash
   rm -rf migrations/<your-timestamp>-<your-slug>/
   ```

Your migration was planned against the old parent; it's no longer valid. Discard it.

3. **Re-run `migration plan`.**

   ```bash
   pnpm prisma-next contract emit
   pnpm prisma-next migration plan --name <your-slug>
   ```

This produces a new migration that captures *only* your contract delta on top of the other team's migration. The new "from" hash matches `main`'s head; the "to" hash captures your changes.

4. **Port any data-transform customizations** from the original `migration.ts` into the new one.

   - Open your git history (or a stash) for the original `migration.ts`. Copy any custom `runDataTransform` logic.
   - Paste into the new `migration.ts`, adapting names if the schema shape changed.

5. **Re-emit.** Self-emit from the new `migration.ts` to refresh `ops.json`:

   ```bash
   node migrations/<new-timestamp>-<your-slug>/migration.ts
   ```

Verify:

   ```bash
   pnpm prisma-next migration show <your-slug>
   pnpm prisma-next migration status
   ```

The status should report a clean chain from `main` → your migration.

There is no separate `migration revalidate` step. The flow is schema-first (re-plan from the post-merge contract head), then port data transforms by hand.

The same workflow applies whether the two branches converged on the same destination hash (the schema deltas are compatible) or diverged (re-plan handles either case).

## Workflow — Configure / use environment refs

Refs let you keep track of multiple environments' markers without naming `DATABASE_URL` interchangeably.

### Set a ref

```bash
pnpm prisma-next migration ref set staging \
  --env STAGING_DATABASE_URL \
  --marker "$(pnpm prisma-next contract emit --hash-only)"
```

Records in `migrations/refs.json`:

```json
{
  "staging": {
    "envVar": "STAGING_DATABASE_URL",
    "marker": "<contract-hash>"
  }
}
```

### List refs

```bash
pnpm prisma-next migration ref list
```

### Get a ref

```bash
pnpm prisma-next migration ref get staging
```

### Delete a ref

```bash
pnpm prisma-next migration ref delete staging
```

## Workflow — Run a migration against a ref

```bash
pnpm prisma-next migration apply --ref staging
```

PN reads `migrations/refs.json` for `staging`, expands `$STAGING_DATABASE_URL` from the environment, and applies pending migrations against that DB.

If the ref's recorded marker doesn't match the live DB's marker, PN refuses to apply and reports the mismatch. Either update the ref (`ref set` again) or investigate the drift.

## Decision: ref-mismatch on CI

CI reports: *"recorded ref `staging` is at hash X; live DB is at hash Y."*

Possibilities:

1. **The ref is stale** — someone applied a migration outside CI and didn't update `refs.json`. Fix: re-run `ref set staging` with the live marker.
2. **The DB is out of sync** — someone changed the DB out-of-band (manual SQL, restore from backup). Fix: `db verify`, identify what's off, decide whether to update the contract or update the DB.
3. **Concurrent apply** — another deploy ran between CI's snapshot and the apply step. Fix: re-run CI; if it consistently mismatches, investigate the deploy pipeline for races.

Never blindly run `ref set` to "fix" the mismatch without understanding which of these caused it. That can mask a drift.

## Workflow — CI: verify the branch can advance the target environment

A common CI check: *can this branch's migration apply to staging without manual intervention?*

```yaml
# .github/workflows/migration-check.yml
- run: pnpm prisma-next migration status --ref staging --db "$STAGING_DATABASE_URL"
- run: pnpm prisma-next migration apply --ref staging --dry-run --db "$STAGING_DATABASE_URL"
```

`--dry-run` validates the migration against the live schema without mutating. Fails CI if the migration can't apply (chain break, data- transform error, destructive op without explicit confirmation).

## Common Pitfalls

1. **Reading `migration status` without `--ref`.** Without a ref, you're comparing the *local* state (last apply) to the contract head — not what will run on deploy. Always pass `--ref` for deploy questions.
2. **Trusting the recorded marker over the live DB.** The recorded marker can drift if migrations run out-of-band. For high-stakes questions, pass `--db` to consult the live DB.
3. **Skipping the data-transform port in step 4 of diamond convergence.** Your custom transforms are gone if you don't manually port them. They're in your git history; copy them over.
4. **Running `ref set` to silence a mismatch.** Always understand why the mismatch exists first.

## What Prisma Next doesn't do yet

- **Per-environment migration ordering control beyond the default chain.** If you need staging to skip a migration that production requires (or vice versa), the recommended path is to author the per-env divergence as two separate migrations and gate one in your deploy script. If you need first-class per-env migration routing, file a feature request via the `prisma-next-feedback` skill.
- **A built-in "branch diff" view of migrations.** Workaround named above (run `migration status` on both branches, `diff`). If you need built-in branch comparison, file a feature request via the `prisma-next-feedback` skill.

## Reference Files

- `references/refs-json-format.md` — exact shape of `migrations/refs.json`.
- `references/diamond-convergence-walkthrough.md` — the 5-step procedure with full git + PN command output.
- `references/ci-integration-recipes.md` — drop-in workflow files for common CI providers.

## Checklist

- [ ] Identified the target environment (staging / production / other).
- [ ] Confirmed a ref exists for that environment, or set one.
- [ ] Ran `migration status --ref <env>` to see what's pending.
- [ ] For high-stakes questions, also passed `--db "$<ENV>_DATABASE_URL"` to consult the live DB.
- [ ] Flagged data transforms, destructive ops, and long-running ops in the pending list.
- [ ] For diamond convergence: rebased, deleted local migration, replanned, ported transforms, re-emitted.
- [ ] Did NOT blindly `ref set` to silence a mismatch.
- [ ] Did NOT confuse "what's applied locally" with "what will run on deploy".
