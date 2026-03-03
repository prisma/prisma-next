# Verification Scenarios

Comprehensive list of CLI workflow permutations for manual verification. Each scenario documents the preconditions, commands, and expected outcome. Scenarios are grouped by category:

- **W** — Happy-path workflows (things that should work)
- **E** — Out-of-order / wrong-sequence (expect useful errors)
- **X** — Edge cases & integrity
- **T** — Cross-workflow transitions

All scenarios assume:
- Postgres running via `docker compose up -d`
- `pnpm build` has been run
- Working directory is `examples/prisma-orm-demo` (or equivalent with a valid `prisma-next.config.ts`)
- `$DB` is the database connection URL

Reset between scenarios:
```bash
docker compose down -v && docker compose up -d --wait
rm -rf migrations/
```

---

## Happy-path workflows

### W1: Greenfield with `db init` (no migration history)

**Precondition:** Empty database, no migrations directory.

```bash
prisma-next contract emit
prisma-next db init --db $DB
prisma-next db verify --db $DB
prisma-next db schema-verify --db $DB
```

**Expected:**
- `contract emit` produces `contract.json` + `contract.d.ts`
- `db init` creates all tables, writes marker
- `db verify` passes (marker matches contract)
- `db schema-verify` passes (all columns/tables present)

---

### W2: Greenfield with migrations

**Precondition:** Empty database, no migrations directory.

```bash
prisma-next contract emit
prisma-next migration plan --name init
prisma-next migration apply --db $DB
prisma-next db verify --db $DB
prisma-next db schema-verify --db $DB
```

**Expected:**
- `migration plan` creates `migrations/<timestamp>_init/` with `migration.json` + `ops.json`
- `migration.json` has `from: sha256:empty`, `to: <contract hash>`, `edgeId: <hash>`
- `migration apply` executes the migration, marker set to contract hash
- Verify commands pass

---

### W3: Existing DB adoption via `db sign`

**Precondition:** Database with tables already created (e.g. manually or by another tool). Contract written to match existing schema.

```bash
# (tables already exist in DB)
prisma-next contract emit
prisma-next db schema-verify --db $DB       # confirm contract matches live schema
prisma-next db sign --db $DB                # write marker without modifying schema
prisma-next db verify --db $DB              # marker now matches
```

**Expected:**
- `db schema-verify` passes (contract matches existing tables)
- `db sign` writes the marker
- `db verify` passes
- No schema changes made

---

### W4: Existing DB adoption via `db init` (schema already matches)

**Precondition:** Database with tables matching the contract.

```bash
# (tables already exist in DB)
prisma-next contract emit
prisma-next db init --db $DB                # introspects, finds 0 ops, writes marker
prisma-next db verify --db $DB
```

**Expected:**
- `db init` reports 0 operations applied
- Marker written
- Existing data untouched

---

### W5: Additive change — add column

**Precondition:** W2 completed (DB bootstrapped via migrations).

```bash
# Edit contract: add a nullable column to an existing table
prisma-next contract emit
prisma-next migration plan --name add-bio
prisma-next migration apply --db $DB
prisma-next db verify --db $DB
prisma-next db schema-verify --db $DB
```

**Expected:**
- `migration plan` produces 1 operation (addColumn)
- `migration.json` `from` matches the previous migration's `to`
- `migration apply` applies it, marker updated
- New column visible in `db schema-verify`

---

### W6: Additive change — add table

**Precondition:** W2 completed.

```bash
# Edit contract: add a new table (e.g. Post with id, title, userId + FK)
prisma-next contract emit
prisma-next migration plan --name add-posts
prisma-next migration apply --db $DB
prisma-next db verify --db $DB
prisma-next db schema-verify --db $DB
```

**Expected:**
- `migration plan` produces createTable + createIndex/FK operations
- `migration apply` creates the table
- `db schema-verify` shows the new table

---

### W7: Destructive change — drop column

**Precondition:** W2 completed (table has columns to drop).

```bash
# Edit contract: remove a column
prisma-next contract emit
prisma-next migration plan --name drop-col
prisma-next migration apply --db $DB
prisma-next db verify --db $DB
prisma-next db schema-verify --db $DB
```

**Expected:**
- `migration plan` produces a `dropColumn` operation
- `migration apply` executes the DROP
- Column no longer appears in `db schema-verify`

---

### W8: Destructive change — drop table

**Precondition:** W6 completed (an extra table exists to drop).

```bash
# Edit contract: remove the table added in W6
prisma-next contract emit
prisma-next migration plan --name drop-posts
prisma-next migration apply --db $DB
prisma-next db schema-verify --db $DB
```

**Expected:**
- `migration plan` produces a `dropTable` operation
- `migration apply` drops the table
- Table no longer appears in `db schema-verify`

---

### W9: Multiple changes in one migration

**Precondition:** W2 completed.

```bash
# Edit contract: add a column + add a table + add an index (all at once)
prisma-next contract emit
prisma-next migration plan --name big-update
prisma-next migration apply --db $DB
prisma-next db schema-verify --db $DB
```

**Expected:**
- `migration plan` produces multiple operations in a single `ops.json`
- All changes applied in one `migration apply` invocation

---

### W10: Multi-step migration chain

**Precondition:** W2 completed.

```bash
# Change 1: add a column
# Edit contract
prisma-next contract emit
prisma-next migration plan --name step-1

# Change 2: add another column
# Edit contract again
prisma-next contract emit
prisma-next migration plan --name step-2

# Apply both at once
prisma-next migration apply --db $DB
```

**Expected:**
- Two migration directories on disk
- `step-2`'s `migration.json` `from` equals `step-1`'s `to`
- `migration apply` applies both in DAG order
- Output shows both migrations applied

---

### W11: Idempotent apply

**Precondition:** W10 completed (all migrations applied).

```bash
prisma-next migration apply --db $DB
```

**Expected:**
- Output: "Already up to date"
- No operations executed
- Exit code 0

---

### W12: Migration integrity verification

**Precondition:** W2 completed (at least one attested migration on disk).

```bash
# Verify — should pass
prisma-next migration verify

# Tamper with ops.json
echo '[]' > migrations/*/ops.json

# Re-verify — should fail
prisma-next migration verify
```

**Expected:**
- First verify: passes, edgeId matches
- After tampering: fails with edgeId mismatch error
- Error includes fix text: "Set edgeId to null in migration.json and rerun `migration verify` to re-attest"

---

### W13: `db update` workflow (no migrations)

**Precondition:** W1 completed (DB bootstrapped via `db init`, no migration history).

```bash
# Edit contract: add a column
prisma-next contract emit
prisma-next db update --db $DB --plan       # preview
prisma-next db update --db $DB              # apply
prisma-next db verify --db $DB
prisma-next db schema-verify --db $DB
```

**Expected:**
- `db update --plan` shows planned operations without applying
- `db update` applies changes and updates marker
- Verify commands pass

---

### W14: Re-plan a migration (the "oops, one more thing" flow)

**Precondition:** W2 completed.

This is the intended workflow when a user plans a migration, then realizes they need to change the contract before applying.

```bash
# First attempt — plan a migration
# Edit contract: add column A
prisma-next contract emit
prisma-next migration plan --name add-fields

# Oops — forgot column B. Edit contract to add both A and B.
prisma-next contract emit

# Delete the stale migration and re-plan
rm -rf migrations/*_add_fields
prisma-next migration plan --name add-fields
prisma-next migration apply --db $DB
prisma-next db verify --db $DB
```

**Expected:**
- After deleting the stale migration, `migration plan` succeeds with a single clean edge
- The re-planned migration includes both columns A and B
- DAG is linear (no branches)
- `migration apply` works cleanly

---

### W15: CI pipeline — `migration verify` then `migration apply`

**Precondition:** W2 completed (at least one attested migration on disk), fresh database.

```bash
prisma-next migration verify
prisma-next migration apply --db $DB
prisma-next db verify --db $DB
```

**Expected:**
- `migration verify` passes (edgeId matches, no side effects)
- `migration apply` applies all pending migrations
- `db verify` passes
- `migration verify` does not interfere with `migration apply` (no state mutation)

---

## Out-of-order / wrong-sequence scenarios

### E1: `migration apply` before any `migration plan`

**Precondition:** Empty database, no migrations directory.

```bash
prisma-next contract emit
prisma-next migration apply --db $DB
```

**Expected:**
- "No attested migrations found" (or migrations dir doesn't exist)
- Exit code 0 (no-op, DB is empty, no migrations — consistent state)

---

### E2: `migration apply` on fresh DB without `db init`

**Precondition:** Empty database, migration planned but `db init` never run.

```bash
prisma-next contract emit
prisma-next migration plan --name init
prisma-next migration apply --db $DB
```

**Expected:**
- Works. `migration apply` doesn't require `db init` — it traverses from `sha256:empty` to the DAG leaf.
- DB ends up with tables and marker, just like W2.

---

### E3: `migration plan` without `contract emit`

**Precondition:** No `contract.json` on disk.

```bash
rm -f src/prisma/contract.json   # or wherever contract output is
prisma-next migration plan --name oops
```

**Expected:**
- Error: "Contract file not found"
- Fix text suggests running `prisma-next contract emit`

---

### E4: `db update` without marker (no `db init`)

**Precondition:** Empty database, contract emitted, no `db init` done.

```bash
prisma-next contract emit
prisma-next db update --db $DB
```

**Expected:**
- Error about missing marker
- Fix text suggests running `db init` or `db sign` first

---

### E5: `db verify` on fresh DB (no marker)

**Precondition:** Empty database.

```bash
prisma-next contract emit
prisma-next db verify --db $DB
```

**Expected:**
- Error: "Marker missing"
- Fix text suggests running `db sign` or `db init`

---

### E6: `db init` when database already has marker

**Precondition:** W1 completed (marker already written).

```bash
prisma-next db init --db $DB
```

**Expected:**
- `db init` introspects, finds all tables already exist, produces 0 operations
- Marker is overwritten (idempotent — same contract hash, so same marker value)
- No error, no data loss
- Verify the output clearly communicates that nothing changed (e.g. "0 operations applied")

---

### E7: `migration plan` when contract hasn't changed

**Precondition:** W2 completed, no contract edits since last plan.

```bash
prisma-next contract emit
prisma-next migration plan --name no-change
```

**Expected:**
- Error or informational message: contract hasn't changed since last migration
- No new migration directory created

---

### E8: `migration apply` after `db init` with no migrations on disk

**Precondition:** W1 completed (DB bootstrapped via `db init`, no migration directory).

```bash
prisma-next migration apply --db $DB
```

**Expected:**
- Error: "Database has state but no migrations exist"
- The DB marker is non-empty but no attested migrations are found — this is the F01 guardrail.
- Fix text suggests checking the migrations directory or resetting with `db init`.

---

### E9: `migration apply` when DB marker doesn't match any migration

**Precondition:** W2 completed, then migration directories deleted.

```bash
rm -rf migrations/
prisma-next migration apply --db $DB
```

**Expected:**
- Same as E8: "Database has state but no migrations exist" (no attested migrations found, marker is non-empty)

---

### E10: `migration apply` with stale plan (contract changed, no new plan)

**Precondition:** W2 completed.

```bash
# Edit contract (add a column)
prisma-next contract emit
# Intentionally skip `migration plan`
prisma-next migration apply --db $DB
```

**Expected:**
- Output: "Already up to date" (DAG leaf matches DB marker)
- **Warning:** "contract.json storageHash (sha256:xxx) does not match the latest planned migration (sha256:yyy). Run `prisma-next migration plan` to plan a migration for the current contract."
- No operations executed

---

### E11: `db update` after migrations applied (mixing workflows)

**Precondition:** W2 completed (DB state managed via migrations).

```bash
prisma-next db update --db $DB
```

**Expected:**
- No-op (marker matches contract, no drift)
- Verify this doesn't create conflicts with the migration DAG

---

### E12: `migration plan` after `db update` changed the DB

**Precondition:** W13 completed (DB updated via `db update`, no migration history).

```bash
# Edit contract again
prisma-next contract emit
prisma-next migration plan --name after-db-update
```

**Expected:**
- `migration plan` uses DAG leaf (`sha256:empty` — no prior migrations on disk) as `from`
- Plans against the full current contract as `to`
- The planned migration includes ALL schema changes (not just the incremental one) because no prior migration exists
- If the user then runs `migration apply`, it will fail: the DB already has tables from `db update`, and the migration tries to create them again
- This is a workflow transition edge case — users who started with `db update` cannot seamlessly switch to migrations without creating a baseline

---

### E13: `migration plan` twice with same name (same minute)

**Precondition:** W2 completed.

```bash
# Edit contract: add a column
prisma-next contract emit
prisma-next migration plan --name add-stuff

# Within the same minute — try again with same name
prisma-next migration plan --name add-stuff
```

**Expected:**
- Second plan fails with `MIGRATION.DIR_EXISTS`
- Error message: directory already exists, suggests using a different name or deleting the existing directory
- No partial state created

---

### E14: `migration plan` twice without deleting (creates DAG branch)

**Precondition:** W2 completed.

This is the footgun when a user plans, changes their mind, and plans again without cleaning up.

```bash
# Plan a migration
# Edit contract: add column A
prisma-next contract emit
prisma-next migration plan --name attempt-1

# Change mind — edit contract differently: add column B instead
prisma-next contract emit
prisma-next migration plan --name attempt-2
```

**Expected:**
- Both `migration plan` commands **succeed** — no error at plan time
- Two migration directories on disk, both with `from` pointing to the same parent hash
- The DAG now has a branch (two leaves)
- **The next `migration plan` or `migration apply` fails with `MIGRATION.AMBIGUOUS_LEAF`**
- The error fires on the *third* operation, not the second — this is a delayed failure
- Fix text should tell the user to delete the unwanted migration directory (not "squash/merge" which doesn't exist as a command)

---

### E15: `migration plan` after partial apply (unapplied migration in chain)

**Precondition:** W2 completed.

```bash
# Plan migration A
# Edit contract: add column A
prisma-next contract emit
prisma-next migration plan --name step-a

# Apply A
prisma-next migration apply --db $DB

# Plan migration B (not applied yet)
# Edit contract: add column B
prisma-next contract emit
prisma-next migration plan --name step-b

# Plan migration C (chained after B)
# Edit contract: add column C
prisma-next contract emit
prisma-next migration plan --name step-c

# Apply — should apply both B and C
prisma-next migration apply --db $DB
prisma-next db verify --db $DB
```

**Expected:**
- `step-c`'s `from` equals `step-b`'s `to` (correct chaining through unapplied migration)
- `migration apply` applies both B and C in order
- All three columns present after apply

---

### E16: `contract emit` with stale schema source

**Precondition:** W2 completed. User edits the schema file but forgets to run `contract emit`.

```bash
# Edit schema.psl (or TypeScript contract source) — add a column
# Do NOT run `contract emit`
prisma-next migration plan --name oops
```

**Expected:**
- `migration plan` reads the *stale* `contract.json` from disk
- Either detects no changes (E7 behavior — "contract hasn't changed") or plans based on the old contract
- No error about the schema source being newer — `migration plan` doesn't know about the source
- This is a UX gap: the user thinks they planned the right thing but the migration doesn't include their latest changes

---

### E17: `db update` on database managed by migrations

**Precondition:** W2 completed (DB state managed via migrations). Contract modified.

```bash
# Edit contract: add a column
prisma-next contract emit
prisma-next db update --db $DB
```

**Expected:**
- `db update` applies the column addition and updates the marker
- The migration DAG is now stale — the DB marker points to the new contract hash, but the DAG leaf still points to the old one
- A subsequent `migration plan` works (plans from the DAG leaf, which is older than the DB state)
- A subsequent `migration apply` would fail: the planned migration covers changes already applied by `db update`
- This demonstrates why mixing `db update` and `migration apply` on the same DB is dangerous

---

## Edge cases & integrity

### X1: Tampered migration file, then `migration apply`

**Precondition:** W2 completed (attested migration on disk).

```bash
# Tamper with ops.json (change the SQL)
# Keep edgeId intact in migration.json
echo '[{"id":"evil","label":"evil","operationClass":"additive","precheck":[],"execute":[{"sql":"DROP TABLE \"User\"","description":"evil"}],"postcheck":[]}]' > migrations/*/ops.json

prisma-next migration apply --db $DB
```

**Expected:**
- `migration apply` filters by `typeof edgeId === 'string'` — tampered migration still has a valid edgeId string
- Apply does NOT re-verify integrity (verification is a separate step)
- Document actual behavior: does the runner fail due to precheck/postcheck mismatch, or does it execute the tampered SQL?
- This demonstrates why `migration verify` should be run in CI before `migration apply`

---

### X2: Draft migration (edgeId: null) skipped by apply

**Precondition:** Attested migration on disk.

```bash
# Manually set edgeId to null in migration.json
# (simulating a draft state)
prisma-next migration apply --db $DB
```

**Expected:**
- Draft migration is skipped (filtered out by `typeof edgeId === 'string'`)
- Only attested migrations are applied
- If the only migration is the draft, behaves like E1

---

### X3: `migration verify` on draft (edgeId: null)

**Precondition:** Migration with `edgeId: null` on disk.

```bash
prisma-next migration verify
```

**Expected:**
- Verify re-attests the draft: computes edgeId and writes it to migration.json
- Migration is now attested and will be picked up by `migration apply`

---

### X4: `migration verify` after tampering an attested migration

**Precondition:** W2 completed, tamper with `ops.json`.

```bash
echo '[]' > migrations/*/ops.json
prisma-next migration verify
```

**Expected:**
- Error: edgeId mismatch (recomputed hash doesn't match stored edgeId)
- Fix text: "If the change was intentional, set edgeId to null in migration.json and rerun `migration verify` to re-attest. Otherwise, restore the original migration."

---

### X5: Full lifecycle — create then drop everything

**Precondition:** Empty database.

```bash
# Create
prisma-next contract emit
prisma-next migration plan --name create-all
prisma-next migration apply --db $DB

# Drop everything (edit contract to empty tables)
prisma-next contract emit
prisma-next migration plan --name drop-all
prisma-next migration apply --db $DB

# Verify
prisma-next db schema-verify --db $DB
```

**Expected:**
- First apply creates tables
- Second apply drops them
- `db schema-verify` shows no contract-managed tables
- Marker reflects the final (empty) contract hash

---

### X6: `migration plan` with type change conflict

**Precondition:** W2 completed.

```bash
# Edit contract: change a column type (e.g. text → int4)
prisma-next contract emit
prisma-next migration plan --name type-change
```

**Expected:**
- Planner detects type mismatch as a conflict
- Error reported with details about which column has a type conflict
- No migration directory created

---

### X7: `migration plan` with nullability tightening conflict

**Precondition:** W2 completed, column exists as `nullable: true`.

```bash
# Edit contract: change column from nullable: true to nullable: false
prisma-next contract emit
prisma-next migration plan --name tighten-null
```

**Expected:**
- Planner detects nullability tightening as a conflict
- Error reported: making a column NOT NULL requires a manual migration (backfill first)
- No migration directory created

---

### X8: `db init --plan` is side-effect free

**Precondition:** Empty database.

```bash
prisma-next contract emit
prisma-next db init --db $DB --plan         # dry run
prisma-next db verify --db $DB              # should still fail (no marker)
```

**Expected:**
- `db init --plan` shows planned operations
- No tables created, no marker written
- `db verify` reports "Marker missing"

---

### X9: Multiple plans without apply between them

**Precondition:** W2 completed.

```bash
# Plan A
# Edit contract (add column A)
prisma-next contract emit
prisma-next migration plan --name add-col-a

# Plan B (without applying A)
# Edit contract (add column B)
prisma-next contract emit
prisma-next migration plan --name add-col-b

# Apply — should apply both A and B in order
prisma-next migration apply --db $DB
```

**Expected:**
- Both migration directories on disk
- DAG chain: `init.to` → `add-col-a.to` → `add-col-b.to`
- `migration apply` applies both in order
- Both columns present after apply

---

### X10: `migration apply` with no `--db` and no config connection

**Precondition:** Config file has no `db.connection` set.

```bash
prisma-next migration apply
```

**Expected:**
- Error: "Database connection is required for migration apply"
- Fix text suggests `--db <url>` or setting `db.connection` in config

---

### X11: `migration apply` with unreachable database

```bash
prisma-next migration apply --db postgresql://localhost:9999/nonexistent
```

**Expected:**
- Connection error with masked URL in output
- No credentials leaked in error message

---

### X12: JSON output for all commands

**Precondition:** Appropriate state for each command.

```bash
prisma-next contract emit --json
prisma-next migration plan --name test --json
prisma-next migration apply --db $DB --json
prisma-next db verify --db $DB --json
prisma-next db schema-verify --db $DB --json
prisma-next db introspect --db $DB --json
```

**Expected:**
- All produce valid JSON to stdout
- No ANSI escape codes in JSON output
- Parseable by `jq`

---

### X13: Delete a middle migration from disk, then `migration apply`

**Precondition:** W10 completed (migration chain A → B on disk, neither applied yet).

```bash
# Delete migration A (the first one in the chain), keep B
rm -rf migrations/*_step_1

# Try to apply
prisma-next migration apply --db $DB
```

**Expected:**
- The DAG has a broken chain: migration B's `from` hash has no corresponding `to` on any other edge
- `migration apply` should error: it cannot find a path from the DB marker (`sha256:empty`) to the DAG leaf
- Error message should be clear about the broken chain (not a generic "no path found")

---

### X14: Intentional manual edit to `ops.json`, then re-attest

**Precondition:** W2 completed (attested migration on disk).

This tests the legitimate workflow for hand-editing a migration (e.g. adding custom SQL).

```bash
# Edit ops.json to add a custom SQL statement (e.g. a data backfill)
# Then re-attest: set edgeId to null, re-verify
jq '.edgeId = null' migrations/*/migration.json > tmp.json && mv tmp.json migrations/*/migration.json
prisma-next migration verify --dir migrations/*_init
```

**Expected:**
- `migration verify` detects draft state (`edgeId: null`), recomputes edgeId
- Migration is now attested with the new content hash
- A subsequent `migration apply` uses the edited ops

---

### X15: Plan migration, apply it, then delete the migration directory from disk

**Precondition:** W2 completed (migration applied, DB marker set).

```bash
# Delete the migration directory after it was applied
rm -rf migrations/

# Try to plan a new migration
# Edit contract: add a column
prisma-next contract emit
prisma-next migration plan --name after-delete
```

**Expected:**
- `migration plan` finds no prior migrations on disk — DAG leaf is `sha256:empty`
- Plans the FULL schema as a new migration (not just the incremental change)
- If applied, this migration would fail: DB already has the tables from the deleted migration
- The user has created a mismatch between on-disk history and DB state

---

### X16: `db update --plan` is side-effect free

**Precondition:** W1 completed (DB bootstrapped via `db init`).

```bash
# Edit contract: add a column
prisma-next contract emit
prisma-next db update --db $DB --plan       # dry run
prisma-next db schema-verify --db $DB       # should show the column is missing
```

**Expected:**
- `db update --plan` shows planned operations without applying
- No schema changes made, marker not updated
- `db schema-verify` still reports the missing column

---

## Cross-workflow transitions

### T1: Start with `db init`, transition to migrations

**Precondition:** W1 completed (DB bootstrapped via `db init`).

```bash
# Edit contract (add a column)
prisma-next contract emit
prisma-next migration plan --name first-migration
prisma-next migration apply --db $DB
prisma-next db verify --db $DB
```

**Expected:**
- `migration plan` uses `sha256:empty` as `from` (no prior migrations on disk)
- The planned migration covers the FULL schema (not just the incremental change) because the DAG has no prior edge
- `migration apply` compares DB marker (set by `db init`) against the DAG — the marker is the contract hash, but the first migration's `from` is `sha256:empty`
- `migration apply` should error: DB marker doesn't match `sha256:empty` and doesn't match the migration's `to` either (contract changed since `db init`)
- **This is a known limitation**: `db init` and `migration plan` produce different DAG histories. Users must choose one workflow from the start, or create a baseline migration (plan from the initial contract before making changes) to bridge the gap.

---

### T2: `db init` on DB that was set up via migrations, after DB reset

**Precondition:** W2 completed, then database dropped and recreated.

```bash
docker compose down -v && docker compose up -d --wait
# (don't delete migrations/)
prisma-next db init --db $DB
prisma-next db verify --db $DB
```

**Expected:**
- `db init` creates tables from contract (fresh DB), writes marker
- `db verify` passes
- Migrations still on disk but `db init` doesn't interact with them
- A subsequent `migration apply` should be a no-op if the marker (set by `db init`) matches the DAG leaf's `to` hash (same contract). If the contract was modified between the last `migration plan` and `db init`, the marker won't match and `apply` would error.

---

### T3: Start with migrations, switch to `db update`

**Precondition:** W2 completed (DB state managed via migrations).

```bash
# Edit contract: add a column
prisma-next contract emit
prisma-next db update --db $DB
prisma-next db verify --db $DB
```

**Expected:**
- `db update` introspects the DB, finds the missing column, applies it, updates marker
- `db verify` passes
- The migration DAG on disk is now stale (its leaf doesn't match the DB marker)
- A subsequent `migration plan` would plan from the stale DAG leaf, producing a migration that includes changes already applied by `db update`
- A subsequent `migration apply` of that plan would fail (duplicate columns/tables)
- **Takeaway:** switching from migrations to `db update` is a one-way door unless the user also creates a baseline migration to bridge the gap

---

### T4: Two developers plan migrations in parallel (DAG branch conflict)

**Precondition:** W2 completed. Two developers have the same migration history on disk.

```bash
# Developer A: add column A
# Edit contract: add column A
prisma-next contract emit
prisma-next migration plan --name add-col-a

# Developer B (simulated): add column B from the same starting point
# Reset contract to pre-A state, add column B instead
prisma-next contract emit
# Manually create a second migration directory with the same `from` hash as A
# (In practice this happens when both developers branch from the same git state)
```

After merging both developers' branches, the `migrations/` directory contains two edges with the same `from` hash.

**Expected:**
- Any `migration plan` or `migration apply` fails with `MIGRATION.AMBIGUOUS_LEAF`
- The error lists both leaf hashes
- Fix text should explain: one developer needs to delete their migration, rebase onto the other's, and re-plan
- This is the standard team conflict resolution flow and the error message quality matters a lot

---

### T5: `db init` then immediate `migration plan` (baseline creation)

**Precondition:** W1 completed (DB bootstrapped via `db init`). No prior migrations.

This tests whether a user can retroactively create a baseline migration to bridge from `db init` to migrations.

```bash
# Create a baseline migration for the CURRENT contract (no changes since db init)
prisma-next migration plan --name baseline
prisma-next migration apply --db $DB
prisma-next db verify --db $DB
```

**Expected:**
- `migration plan` produces a migration from `sha256:empty` to the current contract hash
- `migration apply` should detect that the DB marker (set by `db init`) already equals the migration's `to` hash
- Verify whether apply treats this as "already applied" (no-op) or errors because the marker doesn't equal `sha256:empty` (the migration's `from`)
- If it errors, the user cannot create a baseline migration after `db init` — this is a significant UX gap

---

## W16: `migration show` with explicit directory

**Scenario:** User runs `migration show` pointing to a specific migration directory.

```bash
prisma-next migration show migrations/20260101_100000_add_user
```

**Expected:**
- Shows migration metadata (from/to hashes, edgeId, kind, createdAt)
- Shows operations with `[additive]`/`[widening]`/`[destructive]` badges
- Shows DDL preview
- Shows destructive warning if any operation is destructive

---

## W17: `migration show` defaults to latest

**Scenario:** User runs `migration show` with no argument.

```bash
prisma-next migration show
```

**Expected:**
- Resolves to the DAG leaf migration (latest attested migration)
- Output clearly identifies which migration was selected (dirName shown)
- Errors if no attested migrations exist

---

## E18: `migration show` with ambiguous hash prefix

**Scenario:** User provides a short hash prefix that matches multiple migrations.

```bash
prisma-next migration show sha256:abc
```

**Expected:**
- Error with `Ambiguous hash prefix`
- Lists the matching migrations with their edgeIds
- Suggests providing a longer prefix

---

## E19: `migration show` with unknown hash prefix

**Scenario:** User provides a hash prefix that matches no migration.

```bash
prisma-next migration show sha256:nonexistent
```

**Expected:**
- Error with `No migration found matching prefix`
- Suggests running `migration show` without argument or checking the migrations directory

---

## W18: `migration show` with git-style hash prefix

**Scenario:** User provides a unique prefix of an edgeId.

```bash
prisma-next migration show sha256:abc123
```

**Expected:**
- Resolves to the unique matching migration
- Shows full migration details (same output as explicit directory)

---

## Verification checklist

| ID | Category | Verified | Notes |
|----|----------|----------|-------|
| W1 | Happy path | | |
| W2 | Happy path | | |
| W3 | Happy path | | |
| W4 | Happy path | | |
| W5 | Happy path | | |
| W6 | Happy path | | |
| W7 | Happy path | | |
| W8 | Happy path | | |
| W9 | Happy path | | |
| W10 | Happy path | | |
| W11 | Happy path | | |
| W12 | Integrity | | |
| W13 | Happy path | | |
| W14 | Happy path | | Re-plan workflow |
| W15 | Happy path | | CI verify+apply |
| E1 | Out-of-order | | |
| E2 | Out-of-order | | |
| E3 | Out-of-order | | |
| E4 | Out-of-order | | |
| E5 | Out-of-order | | |
| E6 | Out-of-order | | |
| E7 | Out-of-order | | |
| E8 | Out-of-order | | |
| E9 | Out-of-order | | |
| E10 | Out-of-order | | |
| E11 | Out-of-order | | |
| E12 | Out-of-order | | |
| E13 | Out-of-order | | Same-name collision |
| E14 | Out-of-order | | DAG branch footgun |
| E15 | Out-of-order | | Chain through unapplied |
| E16 | Out-of-order | | Stale contract.json |
| E17 | Out-of-order | | db update + migrations mix |
| X1 | Edge case | | |
| X2 | Edge case | | |
| X3 | Edge case | | |
| X4 | Edge case | | |
| X5 | Edge case | | |
| X6 | Edge case | | |
| X7 | Edge case | | |
| X8 | Edge case | | |
| X9 | Edge case | | |
| X10 | Edge case | | |
| X11 | Edge case | | |
| X12 | Edge case | | |
| X13 | Edge case | | Broken DAG chain |
| X14 | Edge case | | Manual edit + re-attest |
| X15 | Edge case | | Deleted migration post-apply |
| X16 | Edge case | | db update --plan dry run |
| T1 | Transition | | |
| T2 | Transition | | |
| T3 | Transition | | Migrations → db update |
| T4 | Transition | | Parallel team branches |
| T5 | Transition | | Baseline after db init |
| W16 | Happy path | | migration show explicit dir |
| W17 | Happy path | | migration show default latest |
| E18 | Out-of-order | | migration show ambiguous prefix |
| E19 | Out-of-order | | migration show unknown prefix |
| W18 | Happy path | | migration show hash prefix |
