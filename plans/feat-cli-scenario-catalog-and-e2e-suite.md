# CLI Scenario Catalog & E2E Test Suite

## Overview

Exhaustive catalog of CLI scenarios that 80%+ of Prisma Next users (humans, agents, CI pipelines) will encounter. Each scenario is a multi-step user journey with:

- **Precise behavioral expectations** (exit codes, output shape, database state)
- **Golden-file recordings** (ASCII as source of truth, SVGs derived for PR review)
- **E2e tests** organized by journey, with perfect database isolation via `@prisma/dev`

The catalog covers **happy paths** (complete workflows end-to-end), **drift/error scenarios** (with recovery procedures), and **output mode variants** (TTY, JSON, quiet).

---

## Principles & Constraints

### Test Design

- **Journey-organized**: Tests grouped by real-world workflow, not by command. Each journey composes multiple CLI commands against evolving database state.
- **Single-`it`-per-journey**: Each journey is a single `it()` block that runs all steps internally with descriptive assertion labels. This eliminates test-ordering fragility (Vitest does not guarantee `it()` execution order within a `describe()` by default) and aligns with the Testing Guide's independence principle — each `it()` is fully self-contained. Step-level failures are identified via assertion labels (e.g., `expect(result.exitCode, 'A.03: db init').toBe(0)`).
- **Schema-abstract, example-grounded**: Scenarios described behaviorally ("additive column change") with one concrete fixture per category. Exact table/column names are fixture details, not scenario definitions.
- **Flag-resilient**: Scenarios assert on _behavior_ (exit codes, JSON shape keys, state transitions) — not on exact flag names. If `--dry-run` becomes `--plan`, the scenario description stays valid; only the test invocation changes.
- **Dual-mode coverage**: Every database-touching journey is tested in both **TTY** (human) and **JSON** (agent/CI) output modes.
- **Parallel across journeys**: Each journey test file is independent (own database, own temp dir). Vitest parallelizes at the file level across workers, so journeys run concurrently. Steps within a journey are sequential (shared database state).

### Recording Design

- **ASCII is source of truth**: `.ascii` files committed to git, diffed in PRs.
- **SVGs are derived**: Regenerated only when underlying `.ascii` changes. Used in GitHub PR descriptions via `<div>` embeds.
- **Per-command recordings**: Each CLI invocation within a journey gets its own recording file, because the same command produces different output depending on database state.
- **Predictable naming**: `recordings/<journey-slug>/<NN>-<command-slug>.{ascii,svg}`
- **Stateful multi-step**: Recording infrastructure must carry database state across steps within a journey (extending current per-recording setup).
- **Flat directory with prefix convention**: Journey slugs use descriptive prefixes that naturally cluster when sorted alphabetically. No nested `happy/`/`drift/`/`error/` folders — many journeys span categories (drift scenarios include recovery happy paths), and the prefix already communicates intent.

### Journey Slug Prefix Convention

| Prefix | Category | Examples |
|---|---|---|
| `greenfield-*` | Happy: new project | `greenfield-setup` |
| `brownfield-*` | Happy: existing DB adoption | `brownfield-adoption`, `brownfield-mismatch`, `brownfield-extras` |
| `direct-*`, `destructive-*` | Happy: db update workflows | `direct-update`, `destructive-update` |
| `schema-evolution-*`, `multi-step-*` | Happy: migration workflows | `schema-evolution-migrations`, `multi-step-migration` |
| `init-to-*` | Happy: workflow transitions | `init-to-migrations` |
| `drift-*` | Drift detection + recovery | `drift-phantom`, `drift-stale-marker`, `drift-mixed-mode` |
| `connection-*`, `config-*` | Infrastructure errors | `connection-errors`, `config-errors` |
| `global-*` | Global flag behavior | `global-flags` |
| `target-*` | Target mismatch | `target-mismatch` |
| `unmanaged-*`, `no-contract-*` | Unusual initial states | `unmanaged-db-init`, `no-contract-yet` |

### Infrastructure

- **Postgres-only** via `@prisma/dev` (embedded PGlite). Future target support can extend the fixture/setup layer without changing scenario definitions.
- **Database isolation**: Each journey gets a fresh database instance. Steps within a journey share the same database (state accumulates).
- **No manual DDL in happy paths**: Database state changes only through CLI commands. Drift scenarios use explicit SQL setup.

### Parallelism Strategy

Journey tests run in parallel at the file level via Vitest's default `forks` pool. Each test file provisions its own PGlite instance in a `beforeAll` hook, so there are no cross-file database conflicts.

**Expected concurrency**: 4 workers (configurable via `vitest.config.ts` `poolOptions.forks.maxForks`). With 10 test files (journeys grouped by shared preconditions) and 4 workers, projected wall-clock time is **2–3 minutes** (vs. 6–12 minutes sequential). Peak concurrent PGlite instances ≤ 4 since grouped journeys run sequentially within each file.

**Constraints**:
- PGlite assigns ports automatically via `@prisma/dev`, so concurrent instances don't collide.
- Each PGlite instance uses ~50–100MB memory. 4 concurrent instances ≈ 200–400MB — well within CI runner limits.
- The `sql()` helper must use connect-execute-disconnect semantics (like existing `withClient`), never holding a persistent connection, to respect PGlite's single-connection constraint.
- Non-database journeys (Y: global flags, T: config errors, W: no contract) use short timeouts (`typeScriptCompilation` or `default`), not `spinUpPpgDev`.

**Vitest configuration** (for journey tests):
```typescript
// test/integration/vitest.journey.config.ts (or merged into existing config)
export default defineConfig({
  test: {
    include: ['test/cli-journeys/**/*.e2e.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 4,  // 13 files across 4 workers → peak 4 concurrent PGlite instances
      },
    },
    testTimeout: timeouts.spinUpPpgDev, // 30s per journey
    hookTimeout: timeouts.spinUpPpgDev, // 30s for beforeAll database setup
  },
});
```

---

## Contract Fixtures

All scenarios reference abstract fixture names. Concrete implementations live in `recordings/fixtures/`.

| Fixture ID | Description | Example Schema |
|---|---|---|
| `contract-base` | Minimal starting schema | `user(id: int4 PK, email: text)` |
| `contract-additive` | Adds a nullable column to base | `user(id, email, name: text?)` |
| `contract-destructive` | Removes a column from base | `user(id: int4 PK)` — drops `email` |
| `contract-add-table` | Adds a second table to base | `user(id, email)` + `post(id: int4 PK, title: text, userId: int4 FK)` |
| `contract-type-widen` | Widens a column type | `user(id, email: varchar(255) -> text)` |
| `contract-v3` | Third evolution (chain testing) | `user(id, email, name?)` + `post(id, title, userId)` |

> **Note**: `contract-base` and `contract-additive` already exist. The others need to be created.

---

## Scenario Catalog

### Journey A: Greenfield Setup

> A developer starts a new project with an empty database.

**Preconditions**: Fresh project directory with `prisma-next.config.ts` and contract source. Empty Postgres database.

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| A.01 | `contract emit` | Generates `contract.json` + `contract.d.ts`. Prints file paths and hashes. | 0 | `greenfield-setup/01-contract-emit` |
| A.02 | `db init --dry-run` | Shows planned CREATE TABLE operations. Does **not** modify database. No marker written. | 0 | `greenfield-setup/02-db-init-dry-run` |
| A.03 | `db init` | Creates tables + `prisma_contract` schema + marker. Reports operations applied. | 0 | `greenfield-setup/03-db-init` |
| A.04 | `db init` (again) | **Idempotent no-op**. Marker already matches. Reports "already initialized" or similar. | 0 | `greenfield-setup/04-db-init-idempotent` |
| A.05 | `db verify` | Marker hash matches contract. Passes. | 0 | `greenfield-setup/05-db-verify` |
| A.06 | `db schema-verify` | Schema satisfies contract (tolerant mode). Passes. | 0 | `greenfield-setup/06-db-schema-verify` |
| A.07 | `db schema-verify --strict` | No extra tables/columns in empty-initialized DB. Passes. | 0 | `greenfield-setup/07-db-schema-verify-strict` |
| A.08 | `db introspect` | Shows tree of created tables. | 0 | `greenfield-setup/08-db-introspect` |
| A.09 | `db verify --json` | JSON envelope: `ok: true`, `contract.storageHash`, `marker.storageHash`. | 0 | `greenfield-setup/09-db-verify-json` |
| A.10 | `db schema-verify --json` | JSON envelope with verification tree. | 0 | `greenfield-setup/10-db-schema-verify-json` |

> **JSON coverage convention**: JSON output is tested as inline steps within each journey (suffix `-json` on recording slug), not as separate `*-json/` directories. This avoids duplicating entire journeys for a flag variant. Each journey includes 1–2 `--json` assertion steps for the most important commands in that workflow.

---

### Journey B: Schema Evolution via Migrations

> Developer evolves the schema through the migration workflow. Also covers edge cases from former Journeys Q (apply noop), R (plan noop), and X (show variants) — merged as tail steps to avoid redundant PGlite instances.

**Preconditions**: Journey A completed (database initialized with `contract-base`).

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| B.01 | Swap to `contract-additive`, `contract emit` | Updated contract with new column. New storageHash. | 0 | `schema-evolution-migrations/01-contract-emit-v2` |
| B.02 | `migration plan --name add-name-column` | Creates migration dir `YYYYMMDD-HHmmss-add-name-column/` with `migration.json` + `operations.json`. Shows additive ops. | 0 | `schema-evolution-migrations/02-migration-plan` |
| B.03 | `migration show` | Displays latest migration details (from/to hashes, ops, DDL preview). | 0 | `schema-evolution-migrations/03-migration-show` |
| B.04 | `migration verify --dir <planned-dir>` | Verifies edgeId. If draft, auto-attests. | 0 | `schema-evolution-migrations/04-migration-verify` |
| B.05 | `migration status` | **Offline mode**: Shows 1 migration, status unknown (no DB). | 0 | `schema-evolution-migrations/05-migration-status-offline` |
| B.06 | `migration status --db` | **Online mode**: Shows 1 pending migration. | 0 | `schema-evolution-migrations/06-migration-status-online` |
| B.07 | `migration apply --db` | Applies the migration. Marker updated to v2 hash. | 0 | `schema-evolution-migrations/07-migration-apply` |
| B.08 | `migration status --db` | All applied. No pending. | 0 | `schema-evolution-migrations/08-migration-status-applied` |
| B.09 | `db verify` | Passes (marker matches v2 contract). | 0 | `schema-evolution-migrations/09-db-verify` |
| B.10 | `migration status --json --db` | JSON: `mode: "online"`, all migrations in `migrations[]` with status. | 0 | `schema-evolution-migrations/10-migration-status-json` |
| Q.01 | `migration apply --db --json` | Already up-to-date: `migrationsApplied: 0`. | 0 | — |
| R.01 | `migration plan --json` | No changes: `noOp: true`. | 0 | — |
| X.01 | `migration show` | Shows latest migration (post-apply). | 0 | — |
| X.03 | `migration show ./migrations/<dir>` | Shows migration by directory path. | 0 | — |
| X.05 | `migration show sha256:nonexistent` | **Fails**: no migration found for prefix. | 1 | — |

---

### Journey C: Multi-Step Migration Chain

> Developer plans multiple migrations before applying them all at once.

**Preconditions**: Journey A completed (database initialized with `contract-base`).

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| C.01 | Swap to `contract-additive`, `contract emit` | Contract v2. | 0 | `multi-step-migration/01-contract-emit-v2` |
| C.02 | `migration plan --name add-name` | Migration 1: base → additive. | 0 | `multi-step-migration/02-migration-plan-v2` |
| C.03 | Swap to `contract-v3`, `contract emit` | Contract v3 (adds second table). | 0 | `multi-step-migration/03-contract-emit-v3` |
| C.04 | `migration plan --name add-posts` | Migration 2: additive → v3. | 0 | `multi-step-migration/04-migration-plan-v3` |
| C.05 | `migration status --db` | Shows 2 pending migrations. | 0 | `multi-step-migration/05-migration-status-pending` |
| C.06 | `migration apply --db` | Applies both migrations sequentially. Reports count. | 0 | `multi-step-migration/06-migration-apply-all` |
| C.07 | `migration status --db` | All applied. | 0 | `multi-step-migration/07-migration-status-all-applied` |
| C.08 | `db verify` | Passes. | 0 | `multi-step-migration/08-db-verify` |

---

### Journey D: Direct Update (No Migrations)

> Developer iterates quickly using `db update` without migration files.

**Preconditions**: Journey A completed (database initialized with `contract-base`).

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| D.01 | Swap to `contract-additive`, `contract emit` | Contract v2. | 0 | `direct-update/01-contract-emit-v2` |
| D.02 | `db update --dry-run` | Shows planned ADD COLUMN. No database change. | 0 | `direct-update/02-db-update-dry-run` |
| D.03 | `db update` | Applies additive change. No confirmation prompt (additive only). Marker updated. | 0 | `direct-update/03-db-update-apply` |
| D.04 | `db update` (again, no changes) | **No-op**. Reports "no changes" or similar. | 0 | `direct-update/04-db-update-noop` |
| D.05 | `db verify` | Passes. | 0 | `direct-update/05-db-verify` |

---

### Journey E: Destructive Update with Confirmation

> Developer drops a column, requiring interactive confirmation.

**Preconditions**: Journey A completed (database initialized with `contract-base`).

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| E.01 | Swap to `contract-destructive`, `contract emit` | Contract removes `email` column. | 0 | `destructive-update/01-contract-emit` |
| E.02 | `db update --dry-run` | Shows planned DROP COLUMN. No database change. | 0 | `destructive-update/02-db-update-dry-run` |
| E.03 | `db update` (interactive, user declines) | Prompts for confirmation. User says no. Database unchanged. | 1 | `destructive-update/03-db-update-declined` |
| E.04 | `db update -y` | Auto-accepts destructive changes. Column dropped. Marker updated. | 0 | `destructive-update/04-db-update-auto-accept` |
| E.05 | `db update --no-interactive` (without `-y`) | Non-interactive mode, destructive changes detected. Fails with error. Suggests using `-y`. | 1 | `destructive-update/05-db-update-non-interactive-fail` |
| E.06 | `db update --json` | Destructive changes detected. Returns JSON error envelope (no prompt). | 1 | `destructive-update/06-db-update-json-destructive` |
| E.07 | `db update --json -y` | Auto-accepts. Returns JSON success with applied ops. | 0 | `destructive-update/07-db-update-json-accept` |

---

### Journey F: Brownfield Adoption

> Developer adopts Prisma Next on an existing database with tables.

**Preconditions**: Postgres database with pre-existing tables (created via raw SQL). No `prisma_contract` schema. No marker.

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| F.01 | `db introspect` | Shows existing tables as tree. | 0 | `brownfield-adoption/01-db-introspect` |
| F.02 | Write contract matching existing schema, `contract emit` | Contract matches database. | 0 | `brownfield-adoption/02-contract-emit` |
| F.03 | `db schema-verify` | Passes (schema satisfies contract). | 0 | `brownfield-adoption/03-db-schema-verify` |
| F.04 | `db sign` | Creates `prisma_contract` schema and marker. | 0 | `brownfield-adoption/04-db-sign` |
| F.05 | `db verify` | Passes (marker matches contract). | 0 | `brownfield-adoption/05-db-verify` |
| F.06 | Swap to `contract-additive`, `contract emit` | Evolve contract. | 0 | `brownfield-adoption/06-contract-emit-v2` |
| F.07 | `migration plan --name add-name` | Plan migration from adopted state. | 0 | `brownfield-adoption/07-migration-plan` |
| F.08 | `migration apply --db` | Apply migration. | 0 | `brownfield-adoption/08-migration-apply` |
| F.09 | `db sign --json` | JSON success shape (signature details). Tests the known dual-shape command in success path. | 0 | `brownfield-adoption/09-db-sign-json` |

---

### Journey G: Brownfield with Schema Mismatch

> Developer writes a contract that doesn't exactly match the existing database.

**Preconditions**: Postgres database with pre-existing tables. Contract has differences from actual schema.

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| G.01 | `db introspect` | Shows actual schema. | 0 | `brownfield-mismatch/01-db-introspect` |
| G.02 | Write slightly-off contract, `contract emit` | Contract has a column the DB doesn't have. | 0 | `brownfield-mismatch/02-contract-emit` |
| G.03 | `db schema-verify` | **Fails**: missing column reported. | 1 | `brownfield-mismatch/03-db-schema-verify-fail` |
| G.04 | `db sign` | **Fails**: schema verification fails first, sign refused. | 1 | `brownfield-mismatch/04-db-sign-fail` |
| G.05 | `db sign --json` | **Fails**: `CliErrorEnvelope` with `code: "PN-RTM-3004"` and `meta.verificationResult` containing the full tree. | 1 | `brownfield-mismatch/05-db-sign-json-fail` |
| G.06 | Fix contract to match DB, `contract emit` | Now matches. | 0 | `brownfield-mismatch/06-contract-emit-fixed` |
| G.07 | `db schema-verify` | Passes. | 0 | `brownfield-mismatch/07-db-schema-verify-pass` |
| G.08 | `db sign` | Succeeds. | 0 | `brownfield-mismatch/08-db-sign` |

---

### ~~Journey H: Brownfield with Extra Tables (Strict vs. Tolerant)~~ — REMOVED

> Removed: tolerant vs strict schema-verify is already covered by Journey N (extra column drift, N.02–N.03). Same verification code path, different schema objects.

---

### ~~Journey I: CI/CD Pipeline~~ — REMOVED

> Removed: JSON output for each command is already tested inline in other journeys (A.09, A.10, B.10, B/Q.01, E.06–E.07, F.09, G.05) and in isolated command tests. No integration is tested by running them in sequence since commands don't pipe JSON to each other.

---

### ~~Journey J: Help & Discovery~~ — REMOVED

> Removed: help output testing has near-zero regression prevention value. If help breaks, it's a CLI framework issue (commander.js), not application logic.

---

## Drift & Error Scenarios

### Journey K: Missing Marker (Never Initialized)

> Database has no `prisma_contract` schema.

**Preconditions**: Empty database, contract emitted, but `db init` never run.

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| K.01 | `db verify` | **Fails**: `PN-RTM-3001` marker missing. Suggests `db init`. | 1 | `drift-missing-marker/01-db-verify-fail` |
| K.02 | `db schema-verify` | **Fails**: missing tables. | 1 | `drift-missing-marker/02-db-schema-verify-fail` |
| K.03 | `db introspect` | Empty schema tree. | 0 | `drift-missing-marker/03-db-introspect-empty` |
| K.04 | `db init` | **Recovery**: creates tables + marker. | 0 | `drift-missing-marker/04-db-init-recovery` |
| K.05 | `db verify` | Passes. | 0 | `drift-missing-marker/05-db-verify-pass` |

---

### Journey L: Stale Marker (Contract Changed, DB Not Updated)

> Developer emitted a new contract but forgot to apply migrations or update.

**Preconditions**: Database initialized with `contract-base`. Contract now emitted as `contract-additive` (different hash).

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| L.01 | `db verify` | **Fails**: `PN-RTM-3002` hash mismatch. Shows expected vs actual hash. | 1 | `drift-stale-marker/01-db-verify-fail` |
| L.02 | `db schema-verify` | **Fails**: missing `name` column. | 1 | `drift-stale-marker/02-db-schema-verify-fail` |
| L.03 | `db update` | **Recovery**: applies additive change, updates marker. | 0 | `drift-stale-marker/03-db-update-recovery` |
| L.04 | `db verify` | Passes. | 0 | `drift-stale-marker/04-db-verify-pass` |

**Alternative recovery via migrations:**

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| L.05 | `migration plan --name fix-drift` | Plans migration from old hash to new. | 0 | `drift-stale-marker/05-migration-plan` |
| L.06 | `migration apply --db` | Applies migration, updates marker. | 0 | `drift-stale-marker/06-migration-apply` |

---

### Journey M: Phantom Drift (Marker OK, Schema Diverged)

> DBA ran manual DDL. Marker still matches contract hash, but actual schema differs.

**Preconditions**: Database initialized with `contract-base`. Then `ALTER TABLE user DROP COLUMN email` run directly.

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| M.01 | `db verify` | **Passes** (marker hash still matches contract). This is the dangerous false positive. | 0 | `drift-phantom/01-db-verify-false-positive` |
| M.02 | `db schema-verify` | **Fails**: missing `email` column. This catches what `db verify` misses. | 1 | `drift-phantom/02-db-schema-verify-fail` |
| M.03 | `db introspect` | Shows schema without `email` column. | 0 | `drift-phantom/03-db-introspect-diverged` |
| M.04 | `db update` | **Recovery**: detects missing column, plans ADD COLUMN, applies. Marker re-signed. | 0 | `drift-phantom/04-db-update-recovery` |
| M.05 | `db schema-verify` | Passes. | 0 | `drift-phantom/05-db-schema-verify-pass` |

> **Key insight for users**: Always use `db schema-verify` before deployment, not just `db verify`. The marker can lie if someone modified the database outside of Prisma Next.

---

### Journey N: Manual DDL Added Extra Column

> DBA added a column that the contract doesn't know about.

**Preconditions**: Database initialized with `contract-base`. Then `ALTER TABLE user ADD COLUMN age int` run directly.

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| N.01 | `db verify` | Passes (marker matches). | 0 | `drift-extra-column/01-db-verify-pass` |
| N.02 | `db schema-verify` | **Passes** (tolerant mode: extras OK). | 0 | `drift-extra-column/02-db-schema-verify-tolerant-pass` |
| N.03 | `db schema-verify --strict` | **Fails**: extra `age` column reported. | 1 | `drift-extra-column/03-db-schema-verify-strict-fail` |
| N.04 | `db introspect` | Shows table with extra `age` column. | 0 | `drift-extra-column/04-db-introspect` |

**Recovery** (expand contract to include the extra column):

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| N.05 | Expand contract to include `age` column, `contract emit` | Updated contract now includes `age`. | 0 | `drift-extra-column/05-contract-emit-expanded` |
| N.06 | `db update` | Detects contract matches schema (no-op or marker update only). | 0 | `drift-extra-column/06-db-update` |
| N.07 | `db schema-verify --strict` | **Passes** (no extras now). | 0 | `drift-extra-column/07-db-schema-verify-strict-pass` |

---

### Journey O: db init on Already-Initialized DB (Different Contract)

> Developer tries to re-initialize a database that already has a marker for a different contract version.

**Preconditions**: Database initialized with `contract-base`. Contract now emitted as `contract-additive`.

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| O.01 | `db init` | **Fails**: marker exists but hash doesn't match destination. Error suggests using `db update` or migrations. | 1 | `drift-reinit-conflict/01-db-init-fail` |
| O.02 | `db init --dry-run` | **Fails** with same error (conflict detected before planning). | 1 | `drift-reinit-conflict/02-db-init-dry-run-fail` |

**Recovery** (use `db update` instead of `db init`):

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| O.03 | `db update` | Applies additive changes (adds missing column). Marker updated to new contract. | 0 | `drift-reinit-conflict/03-db-update-recovery` |
| O.04 | `db verify` | Passes. | 0 | `drift-reinit-conflict/04-db-verify-pass` |

---

### Journey P: Mixed Mode (db update Then migration apply)

> Developer used `db update` for quick iteration, now wants to switch to migration workflow.

**Preconditions**: Database initialized with `contract-base` via `db init`. Updated to `contract-additive` via `db update` (no migration files). Now has `contract-v3` and wants to use migrations.

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| P.01 | `migration status --db` | Diagnostics: marker hash doesn't match any migration edge. Reports `MARKER_DIVERGED`. | 0 | `drift-mixed-mode/01-migration-status-diverged` |
| P.02 | `migration plan --name add-posts` | Plans migration from current contract (v2) to v3. Creates edge. | 0 | `drift-mixed-mode/02-migration-plan` |
| P.03 | `migration apply --db` | Applies migration. Marker updated to v3 hash. Migration chain now has one edge (v2→v3). | 0 | `drift-mixed-mode/03-migration-apply` |
| P.04 | `migration status --db` | Shows 1 applied migration. Marker aligns with chain leaf. | 0 | `drift-mixed-mode/04-migration-status-ok` |

> **Note**: The transition from `db update` to migrations requires that the marker hash at the time of `migration plan` matches the `--from` hash. The plan reads the existing migration chain's leaf (or uses `--from` explicitly).

---

### Journey P2: Corrupt Marker

> Marker row has been tampered with or corrupted (ADR 123: `marker/corrupt`).

**Preconditions**: Database initialized with `contract-base`. Then marker row overwritten with garbage via raw SQL.

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| P2.01 | `db verify` | **Fails**: corrupt or unrecognized marker. Error suggests re-signing or re-initializing. | 1 | `drift-corrupt-marker/01-db-verify-fail` |
| P2.02 | `db schema-verify` | **Passes** (schema is still intact, only marker is corrupt). | 0 | `drift-corrupt-marker/02-db-schema-verify-pass` |
| P2.03 | `db sign` | **Recovery**: overwrites corrupt marker with valid signature. | 0 | `drift-corrupt-marker/03-db-sign-recovery` |
| P2.04 | `db verify` | Passes. | 0 | `drift-corrupt-marker/04-db-verify-pass` |

---

### Journey P3: Migration Chain Breakage

> A migration directory is deleted after being planned (ADR 123: `dag/chain-breakage`).

**Preconditions**: Journey B completed (1 migration applied). A second migration planned but its directory deleted before apply.

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| P3.01 | `migration status` | Reports broken chain or missing migration. | 0 or 1 | `drift-chain-breakage/01-migration-status-broken` |
| P3.02 | `migration apply --db` | **Fails**: cannot resolve path from marker to destination (missing edge). | 1 | `drift-chain-breakage/02-migration-apply-fail` |
| P3.03 | Re-run `migration plan --name re-add` | **Recovery**: re-plans the missing edge. | 0 | `drift-chain-breakage/03-migration-plan-recovery` |
| P3.04 | `migration apply --db` | Applies the re-planned migration. | 0 | `drift-chain-breakage/04-migration-apply-recovery` |

---

### ~~Journey P4: Migration Apply Partial Failure and Resume~~ — REMOVED

> Removed: already tested in `cli.migration-apply.e2e.test.ts` ("resumes from last successful migration after failure"). Recovery pattern is a core migration-apply concern, not a distinct user journey.

---

### ~~Journey P5: No Migration Path (dag/no-path)~~ — REMOVED

> Removed: already tested in `cli.migration-apply.e2e.test.ts` ("fails when current contract has no planned migration path"). Recovery pattern (re-plan missing edge) is identical to P3.

---

### ADR 123 Drift Categories: Out-of-Scope

The following drift categories from ADR 123 are **not covered** by CLI e2e tests because they are either untestable deterministically, require infrastructure we don't have, or are runtime-only concerns:

| Category | Reason |
|---|---|
| `dag/circular-dependency` | Requires manually crafting invalid migration files with circular `from`/`to` references. Very unlikely in practice. |
| `capability/missing` | Requires extension packs not yet available in the Postgres-only test setup. |
| `transaction/marker-update-failed` | Requires simulating a transaction failure after DDL but before marker update. Not deterministically testable. |
| `transaction/partial-commit` | Same — requires simulating mid-transaction crash. |
| `canonical/version-mismatch` | Requires simulating a future canonical schema version. Defer until version upgrades are implemented. |

---

### ~~Journey Q: Migration Apply Already Up-to-Date~~ — MERGED INTO B

> Merged: now B/Q.01 — a tail step in Journey B after all migrations are applied.

---

### ~~Journey R: Migration Plan No Changes~~ — MERGED INTO B

> Merged: now B/R.01 — a tail step in Journey B after confirming no changes remain.

---

### Journey S: Connection Failures

> Various database connection error scenarios.

**Preconditions**: Contract emitted. Database may or may not exist.

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| S.01 | `db verify --db postgresql://bad:creds@localhost:5432/db` | **Auth failure**: connection error with hint about credentials. | 1 | `connection-errors/01-auth-failure` |
| S.02 | `db verify --db postgresql://user:pass@unreachable:5432/db` | **Network failure**: connection refused or timeout. | 1 | `connection-errors/02-network-failure` |
| S.03 | `db verify --db postgresql://user:pass@localhost:5432/nonexistent` | **DB not found**: database does not exist error. | 1 | `connection-errors/03-db-not-found` |
| S.04 | `db verify` (no `--db`, no config connection) | **Missing connection**: `PN-CLI-4005`. Suggests `--db` flag or config. | 2 | `connection-errors/04-no-connection` |

> **Note**: S.01–S.03 may be difficult to test deterministically with `@prisma/dev`. Consider testing S.04 (missing connection) programmatically and documenting S.01–S.03 as manual verification scenarios.

---

### Journey T: Config File Errors

> Missing or invalid configuration.

**Preconditions**: Various broken config states.

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| T.01 | `contract emit` (no config file) | **Fails**: `PN-CLI-4001` config not found. | 2 | `config-errors/01-missing-config` |
| T.02 | `contract emit --config ./nonexistent.ts` | **Fails**: `PN-CLI-4001` config not found at specified path. | 2 | `config-errors/02-missing-config-explicit` |
| T.03 | `contract emit` (invalid TS in config) | **Fails**: config parse/compile error. | 2 | `config-errors/03-invalid-config-ts` |
| T.04 | `contract emit` (config missing `contract` field) | **Fails**: `PN-CLI-4009`. Missing contract configuration. | 2 | `config-errors/04-missing-contract-field` |

---

### Journey U: Target Mismatch

> Contract targets a different database engine than what's connected.

**Preconditions**: Contract emitted for Postgres. Marker in database says different target (or contract target field mismatches).

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| U.01 | `db verify` | **Fails**: `PN-RTM-3003` target mismatch. | 1 | `target-mismatch/01-db-verify-fail` |

> **Note**: This scenario is difficult to test with a single Postgres-only setup. May require constructing a marker with a fake target hash to simulate.

---

### Journey V: db init on Non-Empty Unmanaged Database

> Database has tables created outside Prisma Next, no marker, and user runs `db init`.

**Preconditions**: Database has `user(id, email)` table created via raw SQL. No `prisma_contract` schema. Contract defines the same `user` table.

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| V.01 | `db init` | Behavior depends on planner: if tables match contract, creates marker only. If conflict (e.g., different column types), fails with conflict error. | 0 or 1 | `unmanaged-db-init/01-db-init` |
| V.02 | `db init --dry-run` | Shows plan: either no-op (tables exist) or conflict. | 0 or 1 | `unmanaged-db-init/02-db-init-dry-run` |

> **Important**: This scenario's exact behavior needs validation against the planner. The additive-only constraint of `db init` means it cannot DROP or ALTER existing objects, only CREATE missing ones.

---

### Journey W: db init From Scratch (No Contract Emitted Yet)

> User tries to run database commands before emitting a contract.

**Preconditions**: Config exists but `contract.json` not yet generated.

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| W.01 | `db init` | **Fails**: `PN-CLI-4004` contract file not found. Suggests running `contract emit` first. | 2 | `no-contract-yet/01-db-init-no-contract` |
| W.02 | `db verify` | **Fails**: same — contract file required. | 2 | `no-contract-yet/02-db-verify-no-contract` |

---

### ~~Journey X: Migration Show Variants~~ — MERGED INTO B

> Merged: now B/X.01, B/X.03, B/X.05 — tail steps in Journey B reusing its migration chain. B.03 already tested `migration show` (latest); the merged steps add by-path lookup and not-found error.

---

### Journey Y: Global Flag Behavior

> Verifying global flags work consistently across commands.

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| Y.01 | `contract emit --no-color` | No ANSI escape codes in output. | 0 | `global-flags/01-no-color` |
| Y.02 | `contract emit -q` | Quiet: only errors, no decoration or success message. | 0 | `global-flags/02-quiet` |
| Y.03 | `contract emit -v` | Verbose: includes debug info and timings. | 0 | `global-flags/03-verbose` |
| Y.04 | `contract emit --trace` | Trace: deep internals, stack traces. | 0 | `global-flags/04-trace` |

---

### Journey Z: Transition from db init to Migration Workflow

> Developer starts with `db init` for convenience, then switches to migrations for production.

**Preconditions**: Database initialized with `contract-base` via `db init`.

| Step | Command | Expected Behavior | Exit | Recording |
|---|---|---|---|---|
| Z.01 | Swap to `contract-additive`, `contract emit` | Contract v2. | 0 | `init-to-migrations/01-contract-emit-v2` |
| Z.02 | `migration plan --name initial-evolution` | Plans migration from base → additive. Uses marker hash as `from`. | 0 | `init-to-migrations/02-migration-plan` |
| Z.03 | `migration apply --db` | Applies. Marker updated. | 0 | `init-to-migrations/03-migration-apply` |
| Z.04 | `migration status --db` | Shows 1 applied migration. Chain is healthy. | 0 | `init-to-migrations/04-migration-status` |

---

## Scenario Cross-Reference Matrix

Scenarios × CLI commands. "Happy" = exit 0 within a happy-path or recovery context. "Error" = exit ≠ 0 or drift detection. "JSON" = `--json` output tested.

Removed journeys (~~H, I, J, P4, P5~~) excluded. Merged steps (Q, R, X) shown under B.

| Command | Happy | Error | JSON |
|---|---|---|---|
| `contract emit` | A.01, B.01, C.01, C.03, D.01, E.01, F.02, F.06, G.02, G.06, N.05, Y.01–Y.03, Z.01 | T.01–T.04 | — |
| `db init` | A.03, A.04, K.04 | O.01, V.01, W.01 | — |
| `db init --dry-run` | A.02 | O.02, V.02 | — |
| `db update` | D.03, D.04, L.03, M.04, N.06, O.03 | E.03, E.05 | E.06, E.07 |
| `db update -y` | E.04 | — | E.07 |
| `db update --dry-run` | D.02, E.02 | — | — |
| `db verify` | A.05, B.09, C.08, D.05, F.05, K.05, L.04, M.01, N.01, O.04, P2.04 | K.01, L.01, P2.01, S.01–S.04, U.01, W.02 | A.09 |
| `db schema-verify` | A.06, A.07, F.03, G.07, M.05, N.02, N.07, P2.02 | G.03, K.02, L.02, M.02, N.03 | A.10 |
| `db sign` | F.04, G.08, P2.03 | G.04 | F.09, G.05 |
| `db introspect` | A.08, F.01, G.01, K.03, M.03, N.04 | — | — |
| `migration plan` | B.02, C.02, C.04, F.07, L.05, P.02, P3.03, Z.02 | — | B/R.01 |
| `migration apply` | B.07, C.06, F.08, L.06, P.03, P3.04, Z.03 | P3.02 | B/Q.01 |
| `migration status` | B.05, B.06, B.08, C.05, C.07, P.01, P.04, Z.04 | P3.01 | B.10 |
| `migration show` | B.03, B/X.01, B/X.03 | B/X.05 | — |
| `migration verify` | B.04 | — | — |

---

## Test Infrastructure Design

### File Structure

Journeys with shared preconditions are grouped into the same test file. After consolidation (removing redundant journeys, merging edge cases into B), this yields 10 test files:
- Lowers peak concurrent PGlite instances (grouped journeys run sequentially within a file, each with its own `describe`/`beforeAll`/`afterAll`)
- Keeps related scenarios co-located for easier maintenance
- Non-database files (`help-and-flags`, `config-errors`) use short timeouts

```
test/integration/test/
├── cli-journeys/                                  # Journey-based e2e tests
│   ├── greenfield-setup.e2e.test.ts               # Journey A
│   ├── schema-evolution-migrations.e2e.test.ts    # Journeys B (+ merged Q, R, X) + Z
│   ├── multi-step-migration.e2e.test.ts           # Journey C
│   ├── db-update-workflows.e2e.test.ts            # Journeys D + E + O
│   ├── brownfield-adoption.e2e.test.ts            # Journeys F + G
│   ├── help-and-flags.e2e.test.ts                 # Journey Y only (no DB needed)
│   ├── drift-schema.e2e.test.ts                   # Journeys M + N
│   ├── drift-marker.e2e.test.ts                   # Journeys K + L + P + P2
│   ├── drift-migration-dag.e2e.test.ts            # Journey P3 only
│   ├── connection-and-contract-errors.e2e.test.ts # Journeys S + W + U + V
│   └── config-errors.e2e.test.ts                  # Journey T (no DB needed)
├── utils/
│   ├── cli-test-helpers.ts                        # Existing helpers
│   ├── journey-test-helpers.ts                    # Journey lifecycle helpers
│   └── recording-helpers.ts                       # ASCII golden-file helpers (future)
```

**Grouping rationale:**

| File | Journeys | Shared precondition | PGlite instances |
|---|---|---|---|
| `greenfield-setup` | A | Empty DB | 1 |
| `schema-evolution-migrations` | B (+Q,R,X), Z | Init'd DB → plan → apply | 2 (sequential) |
| `multi-step-migration` | C | Init'd DB → multi-plan → apply | 1 |
| `db-update-workflows` | D, E, O | Init'd DB → db update variants | 3 (sequential) |
| `brownfield-adoption` | F, G | Pre-existing tables via raw SQL | 2 (sequential) |
| `help-and-flags` | Y | None | 0 |
| `drift-schema` | M, N | Init'd DB + manual DDL | 2 (sequential) |
| `drift-marker` | K, L, P, P2 | Marker-related drift states | 4 (sequential) |
| `drift-migration-dag` | P3 | Migration chain breakage | 1 |
| `connection-and-contract-errors` | S, W, U, V | Various error states | 1–2 |
| `config-errors` | T | None | 0 |
| **Total** | **22 journeys** | | **~17 instances across 11 files** |

With 4 vitest workers: at most 4 files run concurrently, so peak PGlite count ≤ 4 (since journeys within a file run sequentially).

### Journey Test Pattern

Each journey is a single `it()` that runs all steps sequentially within one database lifecycle. This avoids Vitest test-ordering issues and keeps each test self-contained.

```typescript
// Pseudocode — illustrative, not prescriptive implementation
describe('greenfield-setup', () => {
  let connectionString: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const db = await createDevDatabase();
    connectionString = db.connectionString;
    cleanup = db.cleanup;
  }, timeouts.spinUpPpgDev);

  afterAll(async () => { await cleanup(); });

  it('emit → init → verify → introspect', async () => {
    const { testDir, configPath } = await setupDbTestFixture({
      connectionString,
      createTempDir,
      fixtureSubdir: 'greenfield',
    });

    // A.01: contract emit
    const emit = await runContractEmit(testDir, ['--config', configPath]);
    expect(emit.exitCode, 'A.01: contract emit').toBe(0);

    // A.02: db init --dry-run
    const dryRun = await runDbInit(testDir, ['--config', configPath, '--dry-run']);
    expect(dryRun.exitCode, 'A.02: db init dry-run').toBe(0);

    // A.03: db init
    const init = await runDbInit(testDir, ['--config', configPath]);
    expect(init.exitCode, 'A.03: db init').toBe(0);

    // A.04: db init (idempotent)
    const initAgain = await runDbInit(testDir, ['--config', configPath]);
    expect(initAgain.exitCode, 'A.04: db init idempotent').toBe(0);

    // A.05: db verify
    const verify = await runDbVerify(testDir, ['--config', configPath]);
    expect(verify.exitCode, 'A.05: db verify').toBe(0);

    // ... remaining steps
  }, timeouts.spinUpPpgDev);
});
```

**Key design decisions:**
- **`beforeAll`/`afterAll`** provisions and tears down the PGlite instance. The database lives for the entire journey.
- **Single `it()`** eliminates test-ordering fragility. Assertion labels (`'A.03: db init'`) pinpoint which step failed.
- **`CommandResult`** returned by each `run*()` call encapsulates stdout, stderr, and exit code for that invocation — no shared mutable `consoleOutput` array to clear between steps.
- **`sql()` for drift setup** uses connect-execute-disconnect (`withClient`) to respect PGlite's single-connection constraint. Never holds a persistent connection.
- **Contract swapping** copies a different fixture's `contract.ts` into the test directory before the next `contract emit` step.

### Tests vs. Recordings: Two Independent Concerns

**E2e tests** and **VHS recordings** share the same scenario catalog but are completely independent processes. They must never be coupled.

| | E2e Tests | VHS Recordings |
|---|---|---|
| **Purpose** | Verify CLI behavior (exit codes, output content, DB state) | Generate visual documentation (ASCII golden files, SVGs for PRs) |
| **Run by** | `pnpm test:integration` (CI, every PR) | `npx tsx scripts/record.ts` (manual, on-demand) |
| **Speed** | 2–4 min (parallelized) | 38–60 min (sequential VHS invocations) |
| **Assertions** | Programmatic (`expect(exitCode).toBe(0)`, JSON parsing) | Visual diff of committed `.ascii` files in PR review |
| **Database** | `@prisma/dev` PGlite per journey | `@prisma/dev` per recording group |
| **CI** | Runs on every PR | Never runs in CI. Developers regenerate locally when output changes. |

**Recording workflow:**
1. Developer changes CLI output formatting or adds a new command
2. Run `npx tsx scripts/record.ts --journey <slug>` to regenerate affected recordings
3. Commit updated `.ascii` files — PR diff shows exactly what changed
4. SVGs regenerated only if `.ascii` content changed (hash guard)
5. Reviewers inspect the ASCII diff and/or rendered SVGs in the PR

### Recording Infrastructure Extensions

To support the scenario catalog, `record.ts` needs:

1. **Selective recording**: Accept `--journey <slug>` to regenerate only one journey's recordings (essential for developer ergonomics — avoid re-running all 130+ recordings).

2. **Stateful multi-step support**: Instead of resetting database between recordings, support a `JourneyRecording` that carries state across steps within a journey group.

3. **SVG-on-change guard**: Before generating SVGs, compare `.ascii` content hash. Skip SVG regeneration if unchanged.

4. **Naming convention**: `recordings/<journey-slug>/<NN>-<command-slug>.{ascii,svg}`

---

## Exit Code Reference

| Exit Code | Meaning | Error Domain | Examples |
|---|---|---|---|
| 0 | Success (including no-op) | — | Verify passes, plan has no changes, apply up-to-date |
| 1 | Logical/runtime failure | `RTM` (`PN-RTM-*`) | Hash mismatch, schema mismatch, migration failed, destructive without `-y` |
| 2 | CLI usage/config error | `CLI` (`PN-CLI-*`) | Unknown command, missing argument, config not found, missing driver |

---

## JSON Output Shape Reference (Per Command)

Each command's `--json` success output has a different shape. Key fields for agent consumption:

| Command | Key JSON Fields |
|---|---|
| `contract emit` | `storageHash`, `profileHash`, `executionHash`, `outDir`, `files`, `timings` |
| `db init` | `mode`, `plan.operations[]`, `execution`, `marker`, `summary`, `timings` |
| `db update` | Same as `db init` |
| `db verify` | `ok`, `code`, `summary`, `contract.storageHash`, `marker.storageHash`, `target` |
| `db schema-verify` | `ok`, `summary`, `contract`, `target`, `schema.root` (verification tree), `schema.counts`, `timings` |
| `db sign` | `ok`, `contract.storageHash`, `marker.previous`, `marker.current`, `timings` |
| `db introspect` | Introspection IR, schema tree |
| `migration plan` | `ok`, `noOp`, `from`, `to`, `migrationId`, `dir`, `operations`, `sql`, `summary` |
| `migration apply` | `ok`, `migrationsApplied`, `migrationsTotal`, `markerHash`, `applied[]`, `summary` |
| `migration status` | `mode`, `migrations[]`, `markerHash`, `leafHash`, `contractHash`, `diagnostics[]` |
| `migration show` | `ok`, `dirName`, `from`, `to`, `migrationId`, `kind`, `operations`, `sql` |
| `migration verify` | `ok`, `status`, `dir`, `migrationId`, `computedMigrationId` |

Error JSON (all commands): `{ ok: false, code: "PN-XXX-NNNN", domain, severity, summary, why?, fix?, meta? }`

All commands now produce consistent `CliErrorEnvelope` JSON on failure. For `db schema-verify` and `db sign`, schema verification failures use code `PN-RTM-3004` with the full verification tree preserved in `meta.verificationResult`.

---

## Acceptance Criteria

### Scenario Coverage

- [x] 22 journeys (A–G, K–P, P2–P3, S–Z; Q/R/X merged into B) have corresponding e2e test files across 10 files (+ config-errors = 11 files)
- [x] Each journey is a single `it()` block with descriptive assertion labels per step (e.g., `'A.03: db init'`)
- [x] Tests assert on: exit code, key output content (not exact strings), database state after each step
- [x] JSON variant journeys assert on JSON envelope keys and value types
- [x] Removed journeys (H, I, J, P4, P5) are covered by other journeys or command-specific tests

### Recording Coverage (separate from tests — manual/on-demand only)

- [ ] ASCII golden files exist for each step of each journey
- [ ] ASCII files are committed to git and diffed in PRs
- [ ] SVG regeneration only triggers when ASCII content hash changes
- [ ] Recording naming follows `recordings/<journey-slug>/<NN>-<command-slug>.{ascii,svg}`
- [ ] `record.ts` supports `--journey <slug>` for selective regeneration
- [ ] Recordings are never part of CI test runs

### Test Infrastructure

- [x] Each journey gets a fresh isolated database via `@prisma/dev` in `beforeAll`
- [x] Steps within a journey run sequentially inside a single `it()` block
- [x] Journeys parallelize across vitest workers (file-level parallelism, 4 workers)
- [x] Contract swap helper allows evolving schema mid-journey
- [x] Raw SQL helper uses connect-execute-disconnect (never holds persistent connection)
- [x] Non-database journeys (Y, T) use short timeouts, not `spinUpPpgDev`
- [x] Tests work in CI (timeouts account for `TEST_TIMEOUT_MULTIPLIER`)

### Fixture Coverage

- [x] All 6 contract fixtures created (`contract-base` through `contract-v3`)
- [x] Each fixture has a `contract.ts`, and optionally pre-computed `contract.json` + `contract.d.ts`
- [x] Config templates use `{{DB_URL}}` placeholder

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Recording infrastructure changes break golden files | High | Assert on semantic content (key phrases, exit codes), not exact bytes. Use `strip-ansi` for comparisons. |
| Flag names change (e.g., `--dry-run` → `--plan`) | Medium | Scenarios describe behavior, not flags. Flag names live only in test code and recording config. |
| `@prisma/dev` startup time makes tests slow | Medium | Reuse database within a journey (single `it()`, `beforeAll` provisioning). Parallelize journeys across 4 vitest workers (file-level). Projected: 2–4 min vs 8–15 min sequential. |
| Connection error tests (S.01–S.03) are non-deterministic | Medium | Test S.04 (missing connection) deterministically. Document S.01–S.03 as manual or skip in CI. |
| Multi-step recording state management is complex | Medium | Start with programmatic tests first. Add recordings incrementally per journey. |
| Postgres-only limits future target coverage | Low | Scenarios are target-agnostic by design. Only test infrastructure assumes Postgres. Future: parameterize `withDevDatabase()` factory. |

---

## Implementation Phases

### Phase 1: Foundations

- [x] Create contract fixtures (`contract-destructive`, `contract-add-table`, `contract-v3`)
- [x] Implement Journey A (greenfield-setup) e2e test as reference implementation
- [x] Validate the single-`it`-per-journey pattern and `beforeAll` database lifecycle

### Phase 2: Happy Path Journeys (tests)

- [x] Implement Journeys B–G e2e tests (all happy paths)
- [x] Verify parallelism works across 4 vitest workers
- [x] Removed H (redundant with N), I (JSON covered inline), J (help has no regression value)

### Phase 3: Drift & Error Journeys (tests)

- [x] Implement Journeys K–P, P2–P3 e2e tests (drift scenarios)
- [x] Implement Journeys S, T, U, V, W e2e tests (connection/config/target errors)
- [x] Merged Q, R, X into Journey B as tail steps
- [x] Removed P4, P5 (covered by cli.migration-apply.e2e.test.ts)

### Phase 4: Remaining Tests + Polish

- [x] Implement Journey Y e2e test (global flags — no DB)
- [x] Cross-reference coverage matrix against implemented tests

### Phase 5: Recordings (independent from tests)

- Add `--journey <slug>` selective recording support to `record.ts`
- Add stateful multi-step journey support to recording infrastructure
- Generate ASCII golden files for all journeys
- Add SVG-on-change guard
- Recording `.gitignore` already updated to track `ascii/` (done); `.gitattributes` marks them `linguist-generated`

---

## References

### Internal

- CLI commands: `packages/1-framework/3-tooling/cli/src/commands/`
- Recording config: `packages/1-framework/3-tooling/cli/recordings/config.ts`
- Recording script: `packages/1-framework/3-tooling/cli/scripts/record.ts`
- Existing e2e tests: `test/integration/test/cli.*.test.ts`
- Test helpers: `test/integration/test/utils/cli-test-helpers.ts`
- Drift detection ADR: `docs/architecture docs/adrs/ADR 123 - Drift Detection, Recovery & Reconciliation.md`
- DB initialization ADR: `docs/architecture docs/adrs/ADR 122 - Database Initialization & Adoption.md`
- Migration DAG: `packages/1-framework/3-tooling/migration/src/dag.ts`
- Error codes: `packages/1-framework/1-core/migration/control-plane/src/errors.ts`

### Architecture

- Migration system: `docs/architecture docs/subsystems/7. Migration System.md`
- Migrations as edges: `docs/architecture docs/adrs/ADR 001 - Migrations as Edges.md`
- Migration structure: `docs/architecture docs/adrs/ADR 028 - Migration Structure & Operations.md`
