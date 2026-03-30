# Data Migrations Plan

## Summary

Add data migration support to prisma-next's graph-based migration system. Users can attach TypeScript functions to migration edges that transform data between structural phases (additive ops → data migration → destructive ops). The system detects when data migrations are needed, scaffolds files, tracks named invariants, and routes through invariant-satisfying paths. Success: the split-name example from the April milestone VP1 works end-to-end with `plan`, `apply`, and `status` all data-migration-aware.

**Spec:** `projects/graph-based-migrations/specs/data-migrations-spec.md`

## Prerequisites

### P1: Ref format refactor

Refs currently store `{ "<name>": "sha256:<hash>" }`. Data migrations require `{ "<name>": { "hash": "sha256:<hash>", "invariants": ["split-user-name"] } }`. This is a breaking change to the ref type shape, storage module (`packages/1-framework/3-tooling/migration/src/refs.ts`), and all consumers.

**Tasks:**

- [ ] Define new ref entry type: `type RefEntry = { hash: string; invariants?: string[] }` (backward-compatible: old string form can be migrated on read)
- [ ] Update `Refs` type from `Record<string, string>` to `Record<string, RefEntry>`
- [ ] Update `readRefs` to handle both old (string) and new (object) formats for migration
- [ ] Update `writeRefs` to always write new format
- [ ] Update `resolveRef` to return the full `RefEntry`, not just a hash string
- [ ] Update all ref consumers: `migration-apply.ts`, `migration-status.ts`, `migration-plan.ts`, and any CLI output formatting that displays ref values
- [ ] Update ref validation: invariant names should follow a naming convention (e.g., kebab-case)
- [ ] Tests: ref read/write round-trip with invariants, backward compatibility with old format, validation of invariant names
- [ ] Note: TML-2132 (implicit default ref) is separate work, not bundled here

## Milestones

### Milestone 1: Authoring surface and runner execution

The core data migration lifecycle works: define a `data-migration.ts`, the runner detects it, calls `check`/`run`, and interleaves execution with structural ops in the correct phase order. No planner detection, no routing — manual authoring only.

**Tasks:**

- [ ] Define `defineMigration` API types in `packages/1-framework/3-tooling/migration/` with a clean export path: `DataMigrationDefinition { name: string; transaction: 'inline' | 'isolated' | 'unmanaged'; check(db): Promise<boolean>; run(db): Promise<void> }`
- [ ] Define `DataMigrationDb` interface: `execute(sql, params?) → Promise<{ rowCount: number }>`, `query(sql, params?) → Promise<Row[]>`. Parameterized queries only.
- [ ] Implement `DataMigrationDb` backed by the Postgres driver's connection, respecting transaction mode
- [ ] Add `data_migration` operation class to framework-level operation types (`packages/1-framework/1-core/migration/control-plane/src/migrations.ts`)
- [ ] Implement framework-level op interleaving function: given ops array + data migration flag, partition into `[additive/widening, data_migration, destructive]` by operation class
- [ ] Write tests for op interleaving: ops correctly partitioned, data migration slot inserted at the right position, edge cases (all additive, all destructive, mixed)
- [ ] Implement TypeScript compilation at apply time: resolve `data-migration.ts` from migration package directory, compile via tsx/esbuild, load the default export
- [ ] Extend the runner to handle `data_migration` operation entries: detect, compile TS, call `check(db)` → if true skip, else call `run(db)`
- [ ] Implement `inline` transaction mode: data migration runs inside the existing structural transaction
- [ ] Implement `isolated` transaction mode: commit phase 1, begin new tx for data migration, commit, begin new tx for phase 3
- [ ] Implement `unmanaged` transaction mode: commit phase 1, run data migration without tx wrapping, begin new tx for phase 3
- [ ] Write tests for `check` skip behavior: `check` returns true → `run` not called; `check` returns false → `run` called
- [ ] Write tests for each transaction mode: inline rollback on failure, isolated partial commit behavior, unmanaged no-tx behavior
- [ ] Write test for retry after partial failure in isolated mode: phase 1 ops skip via idempotency, `check` determines data migration skip
- [ ] E2E test: hand-authored `data-migration.ts` that splits `name` → `firstName` + `lastName`, applied with `migration apply`, verify data transformation and schema state

### Milestone 2: Planner detection and scaffolding

The planner detects when data migrations are needed and scaffolds `data-migration.ts` files with a throw. `migration plan` produces migration packages that include the data migration slot in ops when detected.

**Tasks:**

- [ ] Extend the planner to detect NOT NULL column added without a default → flag as data-migration-required
- [ ] Extend the planner to detect non-widening type change → flag as data-migration-required
- [ ] Extend the planner to detect nullable → NOT NULL change → flag as data-migration-required
- [ ] Implement temp column strategy for same-column type changes (FR-7a): emit additive op for temp column, data migration slot, destructive ops for drop + rename
- [ ] When data migration is detected, insert `data_migration` operation entry into the ops array using the framework-level interleaving function
- [ ] Scaffold `data-migration.ts` file in the migration package directory with `throw new Error('Data migration not implemented')`, comments describing detected changes, and the `check` function also throwing
- [ ] Write tests for each detection case: NOT NULL add triggers scaffold, type change triggers scaffold, nullable→NOT NULL triggers scaffold
- [ ] Write test: temp column strategy produces correct op sequence (add temp, data slot, drop original, rename temp)
- [ ] Write test: scaffolded file is valid TypeScript that fails at runtime with clear error
- [ ] Write test: `migration apply` fails with clear error message when scaffold throw is still present
- [ ] Write test: no scaffold generated when detection doesn't trigger (e.g., nullable column add, lossless type widening)

### Milestone 3: Graph integration and invariant-aware routing

The router collects data migration names along paths and selects paths that satisfy required invariants from environment refs. The ledger records data migration names and content hashes. `migration status` shows data migration information.

**Tasks:**

- [ ] Extend `MigrationChainEntry` (or the migration manifest) to carry data migration metadata: `dataMigration?: { name: string }`
- [ ] Update `reconstructGraph` to include data migration metadata from migration packages
- [ ] Extend `findPath` / `findPathWithDecision` to collect data migration names along candidate paths
- [ ] Implement invariant-aware path selection: filter paths by required invariants from ref, prefer paths with more invariants, tie-break by existing rules
- [ ] Write tests for routing: path with required invariant selected over shorter path without; when no invariants required, path with more data migrations preferred; no path satisfying invariants → clear error
- [ ] Extend ledger insert to record data migration name in the existing `operations` JSONB field (no schema change needed)
- [ ] Implement invariant querying from ledger: derive "which invariants are satisfied for this database" by querying ledger for completed edges that carried data migrations
- [ ] Update `migration status` to display data migration information: which edges have data migrations, invariant status per ref
- [ ] Update `migration plan` output to show data migration slot in the operation list with transaction mode
- [ ] E2E test: graph with two paths to same hash, one with data migration, one without. Router selects data-migration path when invariant required. Both paths available when no invariant required but data-migration path preferred.

### Milestone 4: Close-out

Validate all acceptance criteria, finalize documentation, clean up.

**Tasks:**

- [ ] Run the April VP1 scenario end-to-end: split `name` → `firstName` + `lastName` with postcondition check, `plan` detects and scaffolds, `apply` executes, `status` reports correctly, routing selects invariant-satisfying path
- [ ] Verify all acceptance criteria from the spec are met (see Test Coverage below)
- [ ] Write or update subsystem doc for migration system (`docs/architecture docs/subsystems/`) covering data migrations
- [ ] Migrate any long-lived documentation from `projects/graph-based-migrations/` into `docs/`
- [ ] Strip references to `projects/graph-based-migrations/` from repo-wide docs
- [ ] Delete transient project files under `projects/graph-based-migrations/`

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| `data-migration.ts` recognized by runner | Integration | M1 | Runner detects and loads file from package |
| `check(db)` required — type error without | Unit | M1 | TypeScript compile-time check |
| Runner calls `check` before `run`, skips if true | Unit + Integration | M1 | |
| `db.execute` parameterized SQL, returns row count | Integration | M1 | Test against real Postgres |
| `db.query` parameterized SQL, returns rows | Integration | M1 | Test against real Postgres |
| TS compiled at apply time | Integration | M1 | No pre-build step needed |
| Scaffold on NOT NULL add without default | Integration | M2 | Planner detection test |
| Scaffold on non-widening type change | Integration | M2 | Planner detection test |
| Scaffold on nullable → NOT NULL | Integration | M2 | Planner detection test |
| Scaffold includes comment describing change | Unit | M2 | Inspect generated file content |
| Apply fails with clear error on scaffold throw | Integration | M2 | Runner error message test |
| Ops execute: additive → data migration → destructive | Integration | M1 | Op ordering verified |
| `inline` mode: same transaction, rollback on failure | Integration | M1 | Transaction boundary test |
| `isolated` mode: three separate transactions | Integration | M1 | Transaction boundary test |
| `unmanaged` mode: no tx wrapping | Integration | M1 | Transaction boundary test |
| Phase 1 skipped on retry via idempotency | Integration | M1 | Postchecks pass on re-run |
| `check` skip on retry | Integration | M1 | check returns true → run skipped |
| Data migration name recorded in ledger | Integration | M3 | Ledger query after apply |
| Router selects invariant-satisfying path | Integration | M3 | Multi-path graph test |
| Prefer more invariants when none required | Integration | M3 | Multi-path graph test |
| Ref declares required invariants | Integration | M3 (+ prereq P1) | Ref format test |
| S2→S1 rollback with data migration | E2E | M4 | No special machinery |

## Open Items

Carried forward from spec:

1. **Op partitioning edge cases (OQ-1)**: Constraint additions (UNIQUE, CHECK, FK) are `additive` but semantically tightening. Class-based partition puts them in wrong phase (before data migration instead of after). Known gap for v1. Proper fix: operation dependency model.

2. **Cross-table coordinated migrations (OQ-8)**: PK type changes cascading across FK graph need planner FK awareness. User-authored for v1.

3. **Table drop detection gap (OQ-9)**: Horizontal table splits may not trigger auto-detection. Known gap for v1.

4. **Prerequisite risk**: Ref format refactor (P1) is a breaking change that touches multiple CLI commands. Scope and churn should be assessed before starting M3.

5. **Invariant source of truth**: The ledger is the source of truth for which invariants are satisfied (query completed edges that carried data migrations). The marker does not store invariant data. This means determining satisfied invariants requires a ledger query, not just reading the marker.
