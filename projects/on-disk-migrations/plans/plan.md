# On-Disk Migrations Plan

## Summary

Implement on-disk migration persistence for prisma-next: a contract-to-contract diff planner, abstract operation IR, migration file management, DAG reconstruction, and CLI commands (`migration plan`, `migration new`, `migration verify`, `db update`). The system lets users plan schema changes offline from contract artifacts and persist them as migration edge packages. Apply is out of scope.

**Spec:** `projects/on-disk-migrations/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | TBD | Drives execution |
| Reviewer | TBD | Architectural review, layering compliance |

## Testing Strategy

The planner produces abstract ops — not SQL. We test the planner by asserting directly on the ops it produces: given two contracts, verify the right ops come out in the right order with the right arguments. This is straightforward unit testing against known inputs and expected outputs.

We do **not** build a test harness that resolves ops to SQL and executes them. That would require building the op resolver (abstract ops → SQL), which is `migration apply` territory and out of scope. The risk that an op can't be cleanly resolved to SQL later is low: the op vocabulary is derived directly from what the existing planner already generates as SQL, so we know the information content is sufficient.

The E2E tests in Milestone 3 validate the full user flow (emit → plan → write to disk → read back) but stop short of apply. `db update` E2E tests exercise the existing introspection-based planner against a real database, providing confidence that the operation vocabulary is sound.

## Milestones

### Milestone 1: Planner + ops IR

Build the contract-to-contract planner, the abstract operation IR it produces, and the control plane wiring so the CLI can call it. This is the core of the project — everything else is persistence and CLI wrapping around it.

The planner lives in `packages/2-sql/3-tooling/family/` (sql domain, tooling layer). The abstract ops IR types live in `packages/1-framework/3-tooling/` (framework domain) since they're target-agnostic. Tests assert directly on the planner's abstract ops output.

**Deliverable:** Given two contracts, the planner produces the correct abstract ops. All additive operation types are covered. The control plane stack exposes the planner to the CLI layer.

**Tasks:**

#### Abstract ops IR (framework/tooling)
- [ ] Define the abstract operation IR types. The op vocabulary covers the additive operations the existing planner supports: `createTable`, `addColumn`, `addIndex`, `addUniqueConstraint`, `addPrimaryKey`, `addForeignKey`, `setColumnDefault`, `createStorageType` (for extension types like `vector`), `enableExtension`. Each op has: `op` (discriminant), typed `args` (op-specific), `pre[]` and `post[]` (check vocabulary per ADR 044), `idempotency` class.
- [ ] Define the `sha256:empty` sentinel constant and export it.
- [ ] Verify `pnpm lint:deps` passes with the new types.

#### Contract-to-contract planner (sql/tooling)
- [ ] Study the existing Postgres planner to understand operation-generation logic for each additive type: createTable, addColumn, addIndex, addUniqueConstraint, addPrimaryKey, addForeignKey, setColumnDefault, storage types, database dependencies (extension enablement).
- [ ] Design the planner function signature: `planContractDiff(from: ContractIR | null, to: ContractIR, options?) → PlanResult<AbstractOp[]>`. `null` for `from` means empty contract (new project).
- [ ] Implement table-level diffing: tables in `to` but not in `from` → `createTable`. Tables in both → diff columns/constraints.
- [ ] Implement column-level diffing within existing tables: new columns → `addColumn`.
- [ ] Implement constraint diffing: primary keys, unique constraints, indexes, foreign keys. Use semantic satisfaction matching (not just name equality), following the existing planner's pattern.
- [ ] Implement storage type diffing: new types → `createStorageType`.
- [ ] Implement extension/database dependency diffing: emit `enableExtension` ops where needed.
- [ ] Implement deterministic operation ordering: database deps → storage types → tables → columns → primary keys → unique constraints → indexes → foreign keys → defaults.
- [ ] Implement conflict detection for non-additive changes: type change, nullability tightening, column removal → error. Additive-only policy for MVP.
- [ ] Implement pre/post check generation per ADR 044.

#### Control plane wiring
- [ ] Extend `TargetMigrationsCapability` (or add sibling) in `packages/1-framework/1-core/migration/control-plane/` to expose contract-to-contract planning. Add a `contractPlanner` that accepts two contracts and returns abstract ops.
- [ ] Implement the capability in the SQL family by wrapping the planner.
- [ ] Wire through the Postgres target descriptor.
- [ ] Add a control plane operation (`planMigrationFromContracts`) that the CLI can call.

#### Tests
- [ ] Test: empty contract → single table with columns, PK, and a unique constraint → verify correct `createTable` op with all fields.
- [ ] Test: empty contract → multiple tables with foreign key relationships → verify `createTable` ops + `addForeignKey` ops in correct order.
- [ ] Test: empty contract → table with indexes → verify `addIndex` ops.
- [ ] Test: empty contract → table with column defaults (literal and function) → verify `setColumnDefault` ops.
- [ ] Test: single table → add new table (incremental) → verify only the new table appears as ops.
- [ ] Test: existing table → add new columns → verify `addColumn` ops only for new columns.
- [ ] Test: existing table → add new constraints (unique, index, FK) → verify correct constraint ops.
- [ ] Test: extension-aware: pgvector column + index creation → verify `enableExtension` + `createStorageType` + column/index ops.
- [ ] Test: determinism — run planner twice with identical inputs, verify byte-identical ops output.
- [ ] Test: conflict rejection — type change between contracts → error, no ops produced.
- [ ] Test: conflict rejection — column removal → error.
- [ ] Test: no-op — identical contracts → empty ops list.
- [ ] Test: control plane integration — load stack, call `planMigrationFromContracts`, verify ops returned correctly.

### Milestone 2: On-disk persistence + DAG

Build the on-disk migration format, file management, edge attestation, and DAG reconstruction. This takes the planner output from Milestone 1 and makes it persistable and navigable.

Lives in `packages/1-framework/3-tooling/` (framework domain, tooling layer, migration plane). All code here is target-agnostic — it works with the abstract ops IR, not SQL.

**Deliverable:** Migrations can be written to disk, read back, attested, and organized into a navigable DAG. Tested with unit tests (no DB needed — this is purely file-based).

**Tasks:**

#### On-disk format types and I/O
- [ ] Define `MigrationManifest` type (`migration.json`): `from`, `to`, `edgeId` (string | null for Draft), `kind` ('regular' | 'baseline'), `fromContract` (full contract JSON or null for Draft), `toContract`, `hints`, `labels`, `authorship`, `createdAt`.
- [ ] Define `ops.json` type: ordered array of abstract ops (reuses types from M1).
- [ ] Define `MigrationGraphIndex` type (`graph.index.json`): `version`, `nodes[]`, `edges[]`, `integrity`. Type only — no read/write implementation yet.
- [ ] Implement `writeMigrationPackage(dir, manifest, ops)` — atomically writes `migration.json` and `ops.json`.
- [ ] Implement `readMigrationPackage(dir)` — reads and validates both files.
- [ ] Implement `readMigrationsDir(migrationsRoot)` — scans `migrations/` and returns all valid packages.
- [ ] Implement `formatMigrationDirName(timestamp, slug)` — produces `YYYYMMDDThhmm_{slug}` with slug sanitization.
- [ ] Implement collision handling: untouched Draft → noop; non-equivalent collision → suffix (`_2`, `_3`, ...); invalid existing → error.

#### Edge attestation
- [ ] Implement `computeEdgeId(manifest, ops)` — canonicalize and SHA-256 hash per ADR 028. Investigate and reuse existing canonicalization code (ADR 010).
- [ ] Implement `attestMigration(dir)` — compute `edgeId`, write it. Draft → Attested.
- [ ] Implement `verifyMigration(dir)` — recompute `edgeId`, compare. Pass/fail.

#### DAG reconstruction
- [ ] Implement `reconstructGraph(packages[])` — build in-memory DAG from migration packages. Nodes = contract hashes, edges = migrations.
- [ ] Implement `findLeaf(graph)` — return the leaf reachable from `sha256:empty`. This is the "current" contract hash for `migration plan`.
- [ ] Implement `findPath(graph, fromHash, toHash)` — ordered edge sequence, deterministic tie-breaking.
- [ ] Implement `detectCycles(graph)`.
- [ ] Implement `detectOrphans(graph)` — migrations not reachable from `sha256:empty`.

#### Tests
- [ ] Round-trip tests: write migration package, read back, verify byte-level equality.
- [ ] Validation tests: malformed `migration.json`, missing `ops.json`, invalid JSON.
- [ ] Directory naming tests: slug sanitization, timestamp formatting.
- [ ] Collision tests: reuse, suffix, error cases.
- [ ] Attestation tests: compute edgeId, verify, modify ops, verify mismatch.
- [ ] DAG tests: linear chain, branching, empty graph, single migration.
- [ ] findLeaf tests: linear chain, branching (error on ambiguity).
- [ ] findPath tests: path exists, no path, deterministic ordering.
- [ ] Cycle detection tests.
- [ ] Orphan detection tests.

### Milestone 3: CLI commands + end-to-end flows

Build all four CLI commands and validate the full user flows end-to-end. Commands follow existing CLI patterns (Result envelope, CliStructuredError, global flags, JSON/TTY output).

**Deliverable:** All commands registered and functional. E2E tests cover both user flows from the spec (new project, existing database adoption).

**Tasks:**

#### Config
- [ ] Add `migrations.dir` to `PrismaNextConfig` (default: `'migrations'`), following v2 branch pattern for config normalization.

#### `migration new` (scaffold)
- [ ] Implement command: scaffolds an empty Draft migration package (`edgeId: null`, empty ops). Reference v2 branch.
- [ ] Register under `migration` subcommand group in `cli.ts`.
- [ ] Add output formatters (TTY/JSON).
- [ ] Unit tests: scaffold creation, collision handling, JSON output.

#### `migration plan`
- [ ] Implement command:
  1. Load config, resolve `migrations.dir`
  2. Read emitted `contract.json` (the "to" contract)
  3. Read migration history via `readMigrationsDir` + `reconstructGraph` + `findLeaf` to determine "from" contract (or `sha256:empty` if no migrations)
  4. Support `--from <hash>` override
  5. Call control plane `planMigrationFromContracts`
  6. If no changes: success with no-op message, no files written
  7. If changes: write migration package, compute `edgeId` (Attested)
  8. Output operation summary
- [ ] Add `--name <slug>` flag.
- [ ] Add output formatters (TTY/JSON): operation count, directory path, from/to hashes.
- [ ] Register under `migration` subcommand group.
- [ ] Unit tests: happy path, no-op, missing contract.json, invalid migrations dir.

#### `migration verify`
- [ ] Implement command: read package → recompute edgeId → compare (or attest if Draft).
- [ ] Add `--dir <path>` argument.
- [ ] Add output formatters.
- [ ] Register under `migration` subcommand group.
- [ ] Unit tests: pass, fail (tampered), attest draft.

#### `db update`
- [ ] Implement command: connect → read marker contract → read emitted contract → plan via existing introspection planner → apply → update marker + ledger. Essentially `db init` without the "no marker" constraint.
- [ ] Factor out shared logic with `db init` to avoid duplication.
- [ ] Add output formatters.
- [ ] Register under `db` subcommand group.
- [ ] Unit tests.

#### End-to-end tests
- [ ] **New project flow**: emit contract → `migration plan` → verify migration package on disk → validate manifest and ops are correct.
- [ ] **Incremental change flow**: emit contract A → `migration plan` → emit contract B → `migration plan` → verify two migration packages form a valid DAG chain (A's `to` = B's `from`).
- [ ] **No-op flow**: emit contract → `migration plan` → `migration plan` again with no changes → verify no new files.
- [ ] **`migration new` → `migration verify` flow**: scaffold → verify (attests draft).
- [ ] **`db update` flow**: `db init` with contract A → change to contract B → `db update` → verify marker updated, schema correct.
- [ ] **Existing DB adoption flow**: `db init` / `db sign` → emit changed contract → `migration plan` → verify migration edge.

### Milestone 4: Close-out

**Tasks:**

- [ ] Walk through every acceptance criterion in the spec and confirm test coverage.
- [ ] Run `pnpm test:all` and `pnpm lint:deps` — everything passes.
- [ ] Update CLI README with new commands, usage examples, and workflow documentation.
- [ ] Write/update ADRs if implementation decisions diverged from existing ADRs (abstract ops IR vocabulary, control plane capability extension).
- [ ] Migrate long-lived docs into `docs/` (ops vocabulary reference, migration file format reference).
- [ ] Delete `projects/on-disk-migrations/`.

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| Planner produces correct additive ops | Unit | M1 | Assert expected ops for known contract pairs |
| Planner output is deterministic | Unit | M1 | Byte-identical on repeated runs |
| Planner handles empty contract (new project) | Unit | M1 | `from = null` → verify all ops present |
| Planner handles extension ops (pgvector) | Unit | M1 | enableExtension + createStorageType + column/index ops |
| Conflict rejection (non-additive changes) | Unit | M1 | Error, no ops |
| Types for migration.json, ops.json defined | Unit | M2 | Round-trip serialization |
| Round-trip fidelity | Unit | M2 | Byte-level equality |
| edgeId computed correctly | Unit | M2 | Compute, verify, tamper, re-verify |
| DAG reconstruction | Unit | M2 | Linear, branching, empty |
| Path resolution | Unit | M2 | Correct sequence, deterministic |
| Cycle detection | Unit | M2 | Reports illegal cycles |
| Orphan detection | Unit | M2 | Unreachable migrations |
| `migration plan` writes valid package | E2E | M3 | Full emit → plan → verify flow |
| `migration plan` no-op on no changes | E2E | M3 | No files written |
| `migration new` scaffolds Draft | Unit | M3 | edgeId null, empty ops |
| `migration verify` validates edgeId | Unit | M3 | Pass/fail/attest |
| `db update` applies and updates marker | E2E | M3 | Init → change → update → verify |
| Incremental migration chain | E2E | M3 | Two plans form valid DAG |
| Existing DB adoption flow | E2E | M3 | init/sign → plan → verify |
| All existing tests pass | E2E | M4 | `pnpm test:all` |
| `pnpm lint:deps` passes | Lint | M1, M2, M3, M4 | After each new package |

## Open Items

1. **Control plane capability design**: The exact shape of the contract-to-contract planning capability needs to be designed during M1. The existing `TargetMigrationsCapability` may need extension or a sibling type.

2. **Abstract ops IR vocabulary details**: The exact `args` shapes for each op type need to be defined during M1. The vocabulary must be rich enough for target adapters to generate deterministic SQL. The existing planner's SQL generation is the reference for what information each op needs to carry.

3. **Draft vs Attested from `migration plan`**: Default is Attested (compute `edgeId` immediately). If this causes friction, revisit. `migration verify` then serves as re-attestation after manual edits.

4. **Op resolution at apply time**: Not in scope. The abstract ops IR is derived from the existing planner's SQL generation, so the information content is sufficient. The resolver (abstract ops → SQL) is built when `migration apply` is implemented.

5. **`db update` overlap with `db init`**: Factor out shared planning/execution logic during M3 to avoid duplication.
