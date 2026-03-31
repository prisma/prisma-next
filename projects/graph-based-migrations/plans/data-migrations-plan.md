# Data Migrations Plan

## Summary

Add data migration support to prisma-next's graph-based migration system. Users author data transformations in TypeScript using the existing ORM/query builder; these compile to JSON ASTs at verification time and execute as SQL at apply time (no arbitrary code execution). The system detects when data migrations are needed, scaffolds files, tracks named invariants in the ledger, and routes through invariant-satisfying paths. Success: the split-name example from April VP1 works end-to-end — `plan` detects and scaffolds, `verify` serializes, `apply` executes, `status` reports correctly, routing selects the invariant-satisfying path.

**Spec:** `projects/graph-based-migrations/specs/data-migrations-spec.md`

## Prerequisites

### P1: Ref format refactor

Refs currently store `{ "<name>": "sha256:<hash>" }`. Data migrations require refs to carry invariant declarations: `{ "<name>": { "hash": "sha256:<hash>", "invariants": ["split-user-name"] } }`. This is a breaking change to the ref type shape, storage module (`packages/1-framework/3-tooling/migration/src/refs.ts`), and all consumers.

We will also move on from having a single refs.json file to a refs directoyr with `<ref-name>.json`.

**Tasks:**

- [ ] Define new ref entry type: `type RefEntry = { hash: string; invariants: string[] }` - no backwards compatibility needed.
- [ ] Update `Refs` type from `Record<string, string>` to `Record<string, RefEntry>`
- [ ] Update `readRefs` to handle both old (string) and new (object) formats for migration
- [ ] Update `writeRefs` to always write new format
- [ ] Update `resolveRef` to return the full `RefEntry`, not just a hash string
- [ ] Update all ref consumers: `migration-apply.ts`, `migration-status.ts`, `migration-plan.ts`, and any CLI output formatting that displays ref values
- [ ] Update ref validation: invariant names should follow a naming convention (e.g., kebab-case)
- [ ] Update all refs.json files that exist (example project, fixtures)
- [ ] Tests: ref read/write round-trip with invariants, backward compatibility with old format, validation of invariant names
- [ ] Note: TML-2132 (implicit default ref) is separate work, not bundled here

### P2: Validate query builder expressiveness

The ORM/query builder needs to support the DML operations data migrations require. Validate before building the serialization pipeline.

**Tasks:**

- [ ] Verify the query builder supports UPDATE ... SET ... WHERE (S1, S2, S3, S4 scenarios)
- [ ] Verify INSERT INTO ... SELECT ... FROM with joins (S5, S7, S10 scenarios)
- [ ] Verify DELETE FROM ... WHERE (S6, S13, S15 scenarios)
- [ ] Verify subqueries in UPDATE context (S9 denormalization)
- [ ] Verify target-specific functions are expressible (e.g., `split_part`, `gen_random_uuid`, `AT TIME ZONE`)
- [ ] Document gaps — if critical DML operations are missing, assess whether query builder extensions are needed before M1
- [ ] If critical gaps exist, assess whether query builder extensions are needed before M1

## Milestones

### Milestone 1: Authoring surface, serialization, and runner execution

The core data migration lifecycle works end-to-end: author a `data-migration.ts` using the ORM/query builder → `migration verify` evaluates the TS and serializes JSON ASTs into `ops.json` → `migration apply` renders ASTs to SQL and executes them in the correct phase order. No planner detection, no routing — manual authoring only.

**Tasks:**

- [ ] Define `defineMigration` API types in `packages/1-framework/3-tooling/migration/`: `DataMigrationDefinition { name: string; transaction: 'inline' | 'isolated' | 'unmanaged'; check(client): QueryAST | boolean; run(client): QueryAST | QueryAST[] }`
- [ ] Add `data_migration` operation type to framework-level operation types (`packages/1-framework/1-core/migration/control-plane/src/migrations.ts`) — carries serialized JSON ASTs for check and run
- [ ] Implement framework-level op interleaving function: given ops array + data migration entry, partition into `[additive/widening, data_migration, destructive]` by operation class
- [ ] Write tests for op interleaving: ops correctly partitioned, data migration slot inserted at the right position, edge cases (all additive, all destructive, mixed)
- [ ] Implement serialization in `migration verify`: evaluate `data-migration.ts` via tsx, call `check(client)` and `run(client)` with a recording query builder client that captures ASTs, serialize the ASTs as JSON into the `data_migration` ops entry
- [ ] Implement draft detection: migration package with `data-migration.ts` but no serialized ASTs in ops → draft state (no `edgeId`)
- [ ] Ensure `migration verify` fails on unimplemented scaffolds (functions that throw or return invalid ASTs)
- [ ] Extend the runner to handle `data_migration` ops: render ASTs to SQL via target adapter, execute check → (skip or run) → check → (fail or proceed)
- [ ] Implement `inline` transaction mode: data migration SQL runs inside the existing structural transaction
- [ ] Implement `isolated` transaction mode: commit phase 1, begin new tx for data migration, commit, begin new tx for phase 3
- [ ] Implement `unmanaged` transaction mode: commit phase 1, execute data migration SQL without tx wrapping, begin new tx for phase 3
- [ ] Write tests for check behavior: check query returns empty result → run skipped; check returns rows → run executes; `false` literal → always run; `true` literal → always skip
- [ ] Write tests for post-run validation: check runs after run, violations found → fail before phase 3
- [ ] Write tests for each transaction mode: inline rollback on failure, isolated partial commit behavior, unmanaged no-tx behavior
- [ ] Write test for retry after partial failure in isolated mode: phase 1 ops skip via idempotency, check determines data migration skip
- [ ] Write test: `data-migration.ts` source file is NOT part of `edgeId` — only serialized ASTs in ops.json are
- [ ] Write test: `migration apply` rejects draft (unattested) packages
- [ ] E2E test: hand-authored `data-migration.ts` using query builder that splits `name` → `firstName` + `lastName` → verify → apply → confirm data transformation and schema state

### Milestone 2: Planner detection, scaffolding, and `migration new`

The planner detects when data migrations are needed and scaffolds `data-migration.ts` files. `migration new` scaffolds packages for fully manual authoring. Both produce draft packages that require verification before apply.

**Tasks:**

- [ ] Extend the planner to detect NOT NULL column added without a default → flag as data-migration-required
- [ ] Extend the planner to detect non-widening type change → flag as data-migration-required
- [ ] Extend the planner to detect nullable → NOT NULL change → flag as data-migration-required
- [ ] Implement temp column strategy for same-column type changes: emit additive op for temp column, data migration slot (placeholder in ops), destructive ops for drop + rename
- [ ] When data migration is detected, produce migration package in draft state — structural ops in `ops.json` with placeholder data migration slot, `data-migration.ts` scaffolded
- [ ] Scaffold `data-migration.ts` with unimplemented `check` and `run` functions, comments describing detected changes
- [ ] Write tests for each detection case: NOT NULL add triggers scaffold, type change triggers scaffold, nullable → NOT NULL triggers scaffold
- [ ] Write test: temp column strategy produces correct op sequence (add temp, data slot, drop original, rename temp)
- [ ] Write test: `migration verify` rejects scaffolded package (unimplemented functions)
- [ ] Write test: no scaffold generated when detection doesn't trigger (nullable column add, lossless type widening)
- [ ] Implement `migration new` command: scaffold migration package with `data-migration.ts` boilerplate, minimal/empty structural ops, derive `from`/`to` hashes from graph state and emitted contract
- [ ] Support `--from` and `--to` flags on `migration new` for explicit hash override
- [ ] Write tests for `migration new`: correct `from`/`to` in manifest, scaffold file is valid TS, `--from`/`--to` override defaults
- [ ] E2E test: `migration plan` detects NOT NULL add → scaffolds → user fills in → `migration verify` → `migration apply` → data migrated
- [ ] E2E test: `migration new` → user writes data migration using query builder → verify → apply → post-apply verification passes

### Milestone 3: Graph integration and invariant-aware routing

The router collects data migration names along paths and selects paths that satisfy required invariants from environment refs. The ledger records data migration names. `migration status` shows data migration information.

**Tasks:**

- [ ] Extend `MigrationChainEntry` (or the migration manifest) to carry data migration metadata: `dataMigration?: { name: string }`
- [ ] Update `reconstructGraph` to include data migration metadata from migration packages
- [ ] Extend `findPath` / `findPathWithDecision` to collect data migration names along candidate paths via DFS
- [ ] Implement invariant-aware path selection: filter paths by required invariants from ref, prefer paths with more invariants, tie-break by existing rules (label priority → createdAt → to → edgeId)
- [ ] Write tests for routing: path with required invariant selected over shorter path without; when no invariants required, path with more data migrations preferred; no path satisfying invariants → clear error
- [ ] Extend ledger insert to record data migration name in the existing `operations` JSONB field
- [ ] Implement invariant querying from ledger: derive "which invariants are satisfied for this database" by querying ledger for completed edges that carried data migrations
- [ ] Update `migration status` to display data migration information: which edges have data migrations, invariant status per ref
- [ ] Update `migration plan` output to show data migration slot in the operation list with transaction mode
- [ ] E2E test: graph with two paths to same hash, one with data migration, one without. Router selects data-migration path when invariant required. Both paths available when no invariant required but data-migration path preferred.

### Milestone 4: Close-out

Validate all acceptance criteria, finalize documentation, clean up.

**Tasks:**

- [ ] Run the April VP1 scenario end-to-end: split `name` → `firstName` + `lastName` with check query, `plan` detects and scaffolds, `verify` serializes, `apply` executes, `status` reports correctly, routing selects invariant-satisfying path
- [ ] Verify all acceptance criteria from the spec are met (see Test Coverage below)
- [ ] Write or update subsystem doc for migration system (`docs/architecture docs/subsystems/`) covering data migrations
- [ ] Migrate any long-lived documentation from `projects/graph-based-migrations/` into `docs/`
- [ ] Strip references to `projects/graph-based-migrations/` from repo-wide docs
- [ ] Delete transient project files under `projects/graph-based-migrations/`

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| `data-migration.ts` recognized during verification | Integration | M1 | Verify detects and evaluates |
| `check(client)` required — type error without | Unit | M1 | TypeScript compile-time check |
| `run`/`check` return query ASTs | Unit | M1 | Type validation |
| `migration verify` serializes ASTs as JSON into `ops.json` | Integration | M1 | Round-trip: TS → AST → JSON → SQL |
| No TS loaded at apply time — only serialized ASTs | Integration | M1 | Apply with TS file removed still works |
| `data-migration.ts` not part of `edgeId` | Unit | M1 | Hash with/without TS file identical |
| Unresolved `data-migration.ts` = draft state | Integration | M1 | Package without serialized ASTs has no edgeId |
| `migration apply` rejects draft packages | Integration | M1 | Apply fails on unattested package |
| Scaffold on NOT NULL add without default | Integration | M2 | Planner detection test |
| Scaffold on non-widening type change | Integration | M2 | Planner detection test |
| Scaffold on nullable → NOT NULL | Integration | M2 | Planner detection test |
| Scaffold includes comment describing change | Unit | M2 | Inspect generated file content |
| Unimplemented scaffold prevents attestation | Integration | M2 | `migration verify` fails on scaffold |
| Ops execute: additive → data migration → destructive | Integration | M1 | Op ordering verified |
| `inline` mode: same transaction, rollback on failure | Integration | M1 | Transaction boundary test |
| `isolated` mode: three separate transactions | Integration | M1 | Transaction boundary test |
| `unmanaged` mode: no tx wrapping | Integration | M1 | Transaction boundary test |
| Phase 1 skipped on retry via idempotency | Integration | M1 | Postchecks pass on re-run |
| Check skip on retry (empty result → skip run) | Integration | M1 | Serialized check query |
| Data migration name recorded in ledger | Integration | M3 | Ledger query after apply |
| Router selects invariant-satisfying path | Integration | M3 | Multi-path graph test |
| Prefer more invariants when none required | Integration | M3 | Multi-path graph test |
| Ref declares required invariants | Integration | M3 (+ prereq P1) | Ref format test |
| S2→S1 rollback with data migration | E2E | M4 | No special machinery |

## Open Items

Carried forward from spec:

1. **Op partitioning edge cases (OQ-1)**: Constraint additions (UNIQUE, CHECK, FK) are `additive` but semantically tightening. Class-based partition puts them in wrong phase. Known gap for v1. Proper fix: operation dependency model.

2. **Cross-table coordinated migrations (OQ-3)**: PK type changes cascading across FK graph need planner FK awareness. User-authored for v1.

3. **Table drop detection gap (OQ-4)**: Horizontal table splits may not trigger auto-detection. Known gap for v1.

4. **Query builder expressiveness (OQ-5)**: Need to validate DML support (UPDATE, INSERT...SELECT, DELETE, subqueries, target-specific functions) before building M1. This is prerequisite P2.

5. **Prerequisite risk — ref refactor (P1)**: Breaking change that touches multiple CLI commands. Must be scoped and landed before M3.

6. **Invariant source of truth**: The ledger is the source of truth for which invariants are satisfied (query completed edges that carried data migrations). The marker does not store invariant data.

7. **Recording query builder client**: M1 requires building a "recording" query builder client that captures ASTs without executing queries. This is a new capability on the existing query builder infrastructure — scope needs assessment during M1.
