# Data Migrations Plan

## Summary

Add data migration support to prisma-next's graph-based migration system. All migrations (structural + data) are authored as TypeScript operation chains using operation builders, serialized to JSON ASTs at verification time, and executed as SQL at apply time. Data transforms are first-class operations in the chain, positioned by the planner at the correct point. The system detects when data migrations are needed, scaffolds the appropriate operations, tracks named invariants in the ledger, and routes through invariant-satisfying paths.

Success: the split-name example from April VP1 works end-to-end — `plan` produces a `migration.ts` with `dataTransform`, `verify` serializes, `apply` executes, `status` reports correctly, routing selects the invariant-satisfying path.

**Spec:** `projects/graph-based-migrations/specs/data-migrations-spec.md`

## Prerequisites

### P1: Ref format refactor — DONE

Refs refactored from `migrations/refs.json` to `migrations/refs/<name>.json` with `{ hash: string, invariants: string[] }`. All consumers updated. Committed on `feat/data-migrations`.

## Milestones

### Milestone 1: Operation builders and serialization pipeline

The operation builder API exists, builders produce AST objects, and `migration verify` can evaluate a `migration.ts` file and serialize the resulting ops into `ops.json`. No planner changes yet — manual authoring only.

**Tasks:**

- [ ] Define the `MigrationOperation` AST type at the framework level — the JSON-serializable structure that all builders produce
- [ ] Implement structural operation builders: `createTable`, `dropTable`, `addColumn`, `dropColumn`, `alterColumnType`, `setNotNull`, `dropNotNull`, `setDefault`, `dropDefault`
- [ ] Implement constraint builders: `addPrimaryKey`, `addUnique`, `addForeignKey`, `dropConstraint`
- [ ] Implement index builders: `createIndex`, `dropIndex`
- [ ] Implement type builder: `createType`
- [ ] Implement `dataTransform(name, { check, run })` builder — accepts query builder callbacks, captures ASTs at verify time
- [ ] Implement transaction annotations: `transaction([...ops])`, `noTransaction(op)`
- [ ] Write tests for each builder: produces correct operation shape, correct `operationClass`, correct `id` pattern
- [ ] Implement the serialization step in `migration verify`: evaluate `migration.ts` via tsx, call the exported function, serialize resulting operation list as JSON into `ops.json`
- [ ] Implement draft detection: `dataTransform` ops with null `check`/`run` in ops.json = draft state
- [ ] Ensure `migration verify` fails on unimplemented `dataTransform` callbacks (throw or return invalid ASTs)
- [ ] Write tests for serialization round-trip: TS → evaluate → ops.json → verify ops match expectations
- [ ] Write test: `migration.ts` source is NOT part of `edgeId`, only serialized ops are
- [ ] Write test: `migration apply` rejects draft (unattested) packages
- [ ] E2E test: hand-authored `migration.ts` with `addColumn` + `dataTransform` + `setNotNull` → verify → apply → schema and data correct

### Milestone 2: Runner execution of data transforms

The runner can execute `dataTransform` operations from serialized ops.json — check/run lifecycle, transaction modes, retry safety.

**Tasks:**

- [ ] Extend the runner to recognize `dataTransform` op entries in `ops.json`
- [ ] Implement check execution: render check AST to SQL via target adapter, execute, interpret result (empty = skip, rows = run, boolean literals)
- [ ] Implement run execution: render run ASTs to SQL, execute sequentially
- [ ] Implement post-run validation: re-execute check after run, fail if violations remain
- [ ] Implement `inline` transaction mode: data transform runs in the same transaction as surrounding ops
- [ ] Implement `isolated` transaction mode: commit preceding ops, run data transform in own tx, commit, continue
- [ ] Implement `unmanaged` mode: data transform runs without tx wrapping
- [ ] Write tests for check skip: empty result → run skipped; rows → run executes; `false` → always run; `true` → always skip
- [ ] Write tests for post-run validation: violations after run → fail before next op
- [ ] Write tests for each transaction mode: inline rollback, isolated partial commit, unmanaged no-tx
- [ ] Write test for retry in isolated mode: preceding ops skip via idempotency, check determines data transform skip
- [ ] E2E test: split `name` → `firstName`/`lastName` end-to-end with check, verify data transformation and schema state

### Milestone 3: Planner detection, scaffolding, and `migration new`

The planner detects data migration needs, produces `migration.ts` files with operation builder calls (including `dataTransform` placeholders), and `migration new` scaffolds manual migrations.

**Tasks:**

- [ ] Modify planner to output `migration.ts` (operation builder calls) instead of or alongside `ops.json`
- [ ] Planner detects NOT NULL column added without default → emits `addColumn` (nullable) + `dataTransform` (placeholder) + `setNotNull` in correct order
- [ ] Planner detects non-widening type change → emits temp column strategy: `addColumn`(temp) + `dataTransform` + `dropColumn`(original) + rename
- [ ] Planner detects nullable → NOT NULL → emits `dataTransform` (placeholder) + `setNotNull`
- [ ] Planner emits all structural ops using operation builders in correct order (additive → data transforms → tightening → destructive)
- [ ] Scaffolded `dataTransform` includes comments describing detected change and what the user needs to provide
- [ ] Write tests: NOT NULL add produces correct operation sequence with dataTransform placeholder
- [ ] Write test: type change produces temp column strategy sequence
- [ ] Write test: nullable → NOT NULL produces correct sequence
- [ ] Write test: no dataTransform emitted when not needed (nullable column add, lossless widening)
- [ ] Write test: scaffolded migration.ts with placeholder prevents attestation
- [ ] Implement `migration new` command: scaffold `migration.ts` with empty operation list, derive `from`/`to` hashes
- [ ] Support `--from` and `--to` flags on `migration new`
- [ ] Write tests for `migration new`: correct from/to, scaffold is valid TS
- [ ] E2E test: `migration plan` detects NOT NULL add → produces migration.ts with placeholder → user fills in → verify → apply

### Milestone 4: Graph integration and invariant-aware routing

The router collects data migration names along paths and selects paths that satisfy required invariants from environment refs. The ledger records data migration names.

**Tasks:**

- [ ] Extend `MigrationChainEntry` (or manifest) to carry data migration metadata: `dataTransforms?: { name: string }[]`
- [ ] Update `reconstructGraph` to include data transform metadata from migration packages
- [ ] Extend `findPath` / `findPathWithDecision` to collect data transform names along candidate paths via DFS
- [ ] Implement invariant-aware path selection: filter by required invariants from ref, prefer paths with more invariants, tie-break by existing rules
- [ ] Write tests: path with required invariant selected over shorter path without; no invariants required → prefer more; no satisfying path → clear error
- [ ] Extend ledger insert to record data transform names in the existing `operations` JSONB field
- [ ] Implement invariant querying from ledger: derive satisfied invariants by querying completed edges
- [ ] Update `migration status` to display data transform information per edge
- [ ] Update `migration plan` output to show data transform ops in the operation list
- [ ] E2E test: diamond graph, one path with data transform, one without. Router selects data-transform path when invariant required.

### Milestone 5: Close-out

**Tasks:**

- [ ] Run April VP1 scenario end-to-end: split `name` → `firstName`/`lastName` — plan detects, scaffolds migration.ts, user fills in, verify serializes, apply executes, status reports, routing works
- [ ] Verify all acceptance criteria met
- [ ] Write or update migration system subsystem doc covering data migrations and operation builders
- [ ] Migrate long-lived docs from `projects/graph-based-migrations/` to `docs/`
- [ ] Delete transient project files

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| Migration TS files recognized during verification | Integration | M1 | |
| `dataTransform` `check` required — type error without | Unit | M1 | |
| `check`/`run` return ASTs (or arrays) | Unit | M1 | |
| `migration verify` serializes ASTs into ops.json | Integration | M1 | |
| No TS loaded at apply time | Integration | M2 | Apply with TS file removed works |
| `migration.ts` not part of `edgeId` | Unit | M1 | |
| Unresolved `dataTransform` = draft state | Integration | M1 | |
| `migration apply` rejects draft packages | Integration | M1 | |
| Plan scaffolds on NOT NULL without default | Integration | M3 | |
| Plan scaffolds on non-widening type change | Integration | M3 | |
| Plan scaffolds on nullable → NOT NULL | Integration | M3 | |
| Scaffold includes descriptive comment | Unit | M3 | |
| Unimplemented scaffold prevents attestation | Integration | M3 | |
| Ops execute in chain order | Integration | M2 | |
| Check runs before and after data transform | Integration | M2 | |
| `inline`: one transaction, rollback on failure | Integration | M2 | |
| `isolated`: separate transactions | Integration | M2 | |
| `unmanaged`: no tx wrapping | Integration | M2 | |
| Retry: check determines skip | Integration | M2 | |
| Data transform name in ledger | Integration | M4 | |
| Router selects invariant-satisfying path | Integration | M4 | |
| Prefer more invariants when none required | Integration | M4 | |
| Ref declares required invariants | Integration | M4 | |
| S2→S1 rollback with data transform | E2E | M5 | |

## Open Items

1. **Cross-table coordinated migrations (S11)**: PK type changes cascade across FK graph. User-authored for v1.

2. **Table drop detection gap (S6)**: Horizontal splits may not trigger auto-detection. Known gap.

3. **Query builder expressiveness**: UPDATE with expressions, INSERT...SELECT, mutation joins — known gaps. Query builder extends independently; data migration infra doesn't depend on it.

4. **Planner TS output transition**: The planner currently writes ops.json directly. Changing it to produce `migration.ts` with operation builder calls is a significant refactor. M3 needs to design the transition — possibly planner emits both formats initially, with the TS file as the new source of truth.

5. **Invariant source of truth**: Ledger is the source of truth for satisfied invariants (query completed edges). Marker does not store invariant data.

6. **Strategy library**: Pre-built strategies (`columnSplit`, `nonNullBackfill`, `typeChange`) are future DX. For v1, planner emits raw operation sequences.
