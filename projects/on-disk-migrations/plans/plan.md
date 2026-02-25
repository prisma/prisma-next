# On-Disk Migrations Plan

## Summary

Implement on-disk migration persistence for prisma-next: a contract-to-contract diff planner that lowers directly to target SQL, migration file management, DAG reconstruction, and CLI commands (`migration plan`, `migration apply`, `migration new`, `migration verify`). The system lets users plan schema changes offline from contract artifacts, persist them as migration edge packages with SQL operations, and apply them to a database. `db update` is out of scope.

**Spec:** `projects/on-disk-migrations/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | TBD | Drives execution |
| Reviewer | TBD | Architectural review, layering compliance |

## Testing Strategy

The planner produces SQL operations directly for the target. We test the planner by asserting on the SQL it produces: given two contracts, verify the right SQL statements come out in the right order. This is straightforward unit testing against known inputs and expected outputs.

The E2E tests in Milestone 3 validate the full offline user flow (emit → plan → write to disk → read back). Milestone 4 adds integration tests that exercise the full plan → apply flow against a real database.

## Milestones

### Milestone 1: Planner + SQL generation

Build the contract-to-contract planner that diffs two contracts and lowers directly to target SQL, plus the control plane wiring so the CLI can call it. This is the core of the project — everything else is persistence and CLI wrapping around it.

The planner lives in `packages/2-sql/3-tooling/family/` (sql domain, tooling layer). It performs structural diffing at the `SqlStorage` level and generates SQL for the target. Tests assert directly on the planner's SQL output.

**Deliverable:** Given two contracts, the planner produces the correct SQL operations. All additive operation types are covered. The control plane stack exposes the planner to the CLI layer.

**Note:** M1 was implemented with abstract ops IR. The decision to lower directly to SQL (RD-6 in spec) was made during M3 discussions. The existing implementation needs to be updated to produce SQL directly. The tasks below reflect the original implementation; the SQL lowering change is tracked separately.

**Tasks:**

#### Migration operation types (framework/tooling)
- [x] Define migration operation types. The op vocabulary covers the additive operations the existing planner supports: `createTable`, `addColumn`, `createIndex`, `addUniqueConstraint`, `addPrimaryKey`, `addForeignKey`, `createStorageType` (for extension types like `vector`), `enableExtension`. Each op has: `op` (discriminant), typed `args` (op-specific), `pre[]` and `post[]` (check vocabulary per ADR 044), `operationClass`. Note: `setColumnDefault` is NOT a separate op — defaults are part of `createTable` and `addColumn` column definitions.
- [x] Define the `sha256:empty` sentinel constant and export it.
- [x] Verify `pnpm lint:deps` passes with the new types.

#### Contract-to-contract planner (sql/tooling)
- [x] Study the existing Postgres planner to understand operation-generation logic for each additive type: createTable, addColumn, createIndex, addUniqueConstraint, addPrimaryKey, addForeignKey, storage types, database dependencies (extension enablement).
- [x] Design the planner function signature: `planContractDiff({ from: SqlStorage | null, to: SqlStorage }) → ContractDiffResult`. `null` for `from` means empty contract (new project). Operates on `SqlStorage` directly (not full `ContractIR`) since that's the only section relevant to diffing.
- [x] Implement table-level diffing: tables in `to` but not in `from` → `createTable`. Tables in both → diff columns/constraints.
- [x] Implement column-level diffing within existing tables: new columns → `addColumn`.
- [x] Implement constraint diffing: primary keys, unique constraints, indexes, foreign keys. Use semantic satisfaction matching (not just name equality), following the existing planner's pattern.
- [x] Implement storage type diffing: new types → `createStorageType`.
- [x] Implement extension/database dependency diffing: emit `enableExtension` ops where needed (codec→extension mapping for known cases like pgvector).
- [x] Implement deterministic operation ordering: database deps → storage types → tables → columns → primary keys → unique constraints → indexes → foreign keys.
- [x] Implement conflict detection for non-additive changes: type change, nullability tightening, column removal, table removal, PK change → error. Additive-only policy for MVP.
- [x] Implement pre/post check generation per ADR 044.

#### Control plane wiring
- [x] ~~Extend `TargetMigrationsCapability`~~ — Initially thought unnecessary, but M3 revealed a layering violation: the CLI (framework domain) cannot import directly from `@prisma-next/family-sql`. Resolved by adding `planContractDiff` to `TargetMigrationsCapability` (framework interface) and `contractDiff()` to `ControlClient`, with the Postgres target providing the implementation. See M3 architecture tasks.

#### Tests
- [x] Test: empty contract → single table with columns, PK, and a unique constraint → verify correct `createTable` op with all fields.
- [x] Test: empty contract → multiple tables with foreign key relationships → verify `createTable` ops + `addForeignKey` ops in correct order.
- [x] Test: empty contract → table with indexes → verify `createIndex` ops.
- [x] Test: empty contract → table with column defaults (literal and function) → defaults are in column definitions within `createTable`.
- [x] Test: single table → add new table (incremental) → verify only the new table appears as ops.
- [x] Test: existing table → add new columns → verify `addColumn` ops only for new columns.
- [x] Test: existing table → add new constraints (unique, index, FK) → verify correct constraint ops.
- [x] Test: extension-aware: pgvector column + type creation → verify `enableExtension` + `createStorageType` + correct ordering.
- [x] Test: determinism — run planner twice with identical inputs, verify byte-identical ops output.
- [x] Test: conflict rejection — type change between contracts → error, no ops produced.
- [x] Test: conflict rejection — column removal → error.
- [x] Test: no-op — identical contracts → empty ops list.
- [x] Test: pre/post checks — verify ADR 044 structured checks on all op types.
- [x] Test: nullability tightening → conflict; nullability widening → not a conflict.
- [x] Test: table removal → conflict.
- [x] Test: addColumn NOT NULL without default → tableIsEmpty pre-check.
- [x] Test: addColumn NOT NULL with default → no tableIsEmpty check.
- [x] Test: addPrimaryKey for existing table without PK.
- [x] Test: default constraint name generation (unique, index, FK).
- [ ] ~~Test: control plane integration — load stack, call `planMigrationFromContracts`~~ — Deferred to M3 (CLI command integration).

### Milestone 2: On-disk persistence + DAG

Build the on-disk migration format, file management, edge attestation, and DAG reconstruction. This takes the planner output from Milestone 1 and makes it persistable and navigable.

Lives in a new package `packages/1-framework/3-tooling/migration/` (framework domain, tooling layer, migration plane). This is reusable library code, not CLI-specific.

**Deliverable:** Migrations can be written to disk, read back, attested, and organized into a navigable DAG. Tested with unit tests (no DB needed — this is purely file-based).

#### Package scaffolding

- [x] Create `packages/1-framework/3-tooling/migration/` with `package.json` (name: `@prisma-next/migration-tools`), `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`.
  - Dependencies: `@prisma-next/core-control-plane` (for `EMPTY_CONTRACT_HASH`, migration types), `@prisma-next/utils`, `pathe`.
  - Export subpaths: `./types` (manifest/DAG types), `./io` (read/write), `./attestation` (edgeId), `./dag` (graph operations).
  - Follow the pattern of `@prisma-next/emitter`: `src/exports/` barrel files, `tsdown` entry map, manual exports.
- [x] Register the package in the pnpm workspace (`pnpm-workspace.yaml` or existing glob).
- [x] Add a `packages/1-framework/3-tooling/migration/` entry to `architecture.config.json` under `{ domain: "framework", layer: "tooling", plane: "migration" }`. The existing `packages/1-framework/3-tooling/**` glob already covers this, but verify with `pnpm lint:deps`.
- [x] Verify `pnpm lint:deps` passes with the new package and its imports.

#### On-disk format types

- [x] Define `MigrationManifest` interface (`migration.json` shape):
  ```typescript
  interface MigrationManifest {
    readonly from: string           // contract hash (or EMPTY_CONTRACT_HASH)
    readonly to: string             // contract hash
    readonly edgeId: string | null  // null = Draft, string = Attested
    readonly kind: 'regular' | 'baseline'
    readonly fromContract: ContractIR | null  // full contract JSON; null for Draft or empty
    readonly toContract: ContractIR           // full contract JSON
    readonly hints: MigrationHints
    readonly labels: readonly string[]
    readonly authorship?: { readonly author?: string; readonly email?: string }
    readonly signature?: { readonly keyId: string; readonly value: string } | null
    readonly createdAt: string      // ISO-8601 timestamp
  }

  interface MigrationHints {
    readonly used: readonly string[]
    readonly applied: readonly string[]
    readonly plannerVersion: string
    readonly planningStrategy: string
  }
  ```
  - `from`/`to` are the `storageHash` values from the contracts (or `EMPTY_CONTRACT_HASH`).
  - `fromContract`/`toContract` are the complete canonical contract JSON objects, not stringified.
  - `ContractIR` is imported from `@prisma-next/contract/ir`.
- [x] Define `MigrationOps` type (`ops.json` shape): SQL operations for the target.
- [x] Define `MigrationPackage` interface — the in-memory representation of a read migration package:
  ```typescript
  interface MigrationPackage {
    readonly dirName: string        // directory name (e.g., '20260225T1430_add_users')
    readonly dirPath: string        // full absolute path
    readonly manifest: MigrationManifest
    readonly ops: MigrationOps
  }
  ```

#### File I/O

- [x] Implement `writeMigrationPackage(dir, manifest, ops)`:
  - Create the directory with `mkdir`.
  - Write `migration.json` as pretty-printed JSON (`JSON.stringify(manifest, null, 2)`).
  - Write `ops.json` as pretty-printed JSON (`JSON.stringify(ops, null, 2)`).
  - Sequential writes, not atomic across both files. If the process crashes mid-write, the user deletes the partial directory and re-runs.
  - Use `pathe` for path operations (per repo rule).
  - Use `node:fs/promises` for file I/O (no cross-runtime concern for CLI tooling).
- [x] Implement `readMigrationPackage(dir)`:
  - Read `migration.json` and `ops.json`.
  - Validate both files exist; error with structured message if either is missing.
  - Parse JSON; error on malformed JSON with file path and parse error.
  - Validate manifest shape (required fields present, `from`/`to` are strings, `kind` is valid). Use a lightweight check, not a full schema validator — keep the dependency list small.
  - Return `MigrationPackage`.
- [x] Implement `readMigrationsDir(migrationsRoot)`:
  - Read directory entries, filter for subdirectories.
  - For each subdirectory, call `readMigrationPackage`. Skip directories that don't contain `migration.json` (warn, don't error — allows non-migration files like READMEs in the migrations folder).
  - Sort results by directory name (which is timestamp-prefixed, so lexicographic sort = chronological sort).
  - Return `readonly MigrationPackage[]`.
- [x] Implement `formatMigrationDirName(timestamp, slug)`:
  - Format: `YYYYMMDDThhmm_{slug}` (e.g., `20260225T1430_add_users`).
  - Slug sanitization: lowercase, replace non-alphanumeric with `_`, collapse consecutive `_`, trim leading/trailing `_`, truncate to reasonable length (64 chars).
  - `timestamp` is a `Date` object; format as UTC.
- [x] Implement collision handling: before `writeMigrationPackage`, check if the directory already exists. If so, error with a clear message suggesting `--name` or manual deletion.

#### Generic JSON canonicalization

- [x] Implement `canonicalizeJson(value: unknown): string`:
  - Deep lexicographic key sort on objects.
  - Arrays preserved in order (not sorted).
  - `JSON.stringify` with no whitespace.
  - Pure function, no side effects.
  - Lives in this package (not in `core-control-plane`). It's a utility for edge attestation, not a core contract concept.
  - Distinct from `canonicalizeContract` which has domain-specific normalization (default omission, top-level key ordering, index sorting). `canonicalizeJson` is generic.

#### Edge attestation

- [x] Implement `computeEdgeId(manifest, ops)`:
  - Per ADR 028: `edgeId = sha256(canonicalize(manifest without edgeId/signature) + canonicalize(ops) + canonicalize(fromContract) + canonicalize(toContract))`
  - Strip `edgeId` and `signature` from the manifest before canonicalizing.
  - Canonicalize the stripped manifest and ops with `canonicalizeJson`.
  - Canonicalize `fromContract` and `toContract` with `canonicalizeContract` from `@prisma-next/core-control-plane/emission`.
  - For `fromContract: null` (empty/Draft), use the string `"null"` as the canonical form.
  - Concatenate all four canonical strings and SHA-256 hash them. Use `node:crypto.createHash('sha256')`.
  - Return `sha256:<hex>` format (same prefix convention as `computeStorageHash`).
- [x] Implement `attestMigration(dir)`:
  - Read package from `dir`.
  - Compute `edgeId`.
  - Write updated `migration.json` with computed `edgeId`.
  - Return the computed `edgeId`.
- [x] Implement `verifyMigration(dir)`:
  - Read package from `dir`.
  - If `edgeId` is null (Draft), return `{ ok: false, reason: 'draft' }`.
  - Recompute `edgeId` from content.
  - Compare stored vs computed.
  - Return `{ ok: boolean, storedEdgeId: string, computedEdgeId: string }`.

#### DAG reconstruction

Per ADR 039, the graph is reconstructed from migration file headers. BFS for pathfinding, DFS with coloring for cycle detection. Typical DAGs are small (<50 edges with squash-first hygiene).

- [x] Define `MigrationGraph` interface:
  ```typescript
  interface MigrationGraph {
    readonly nodes: ReadonlySet<string>        // contract hashes
    readonly edges: ReadonlyMap<string, readonly MigrationGraphEdge[]>  // from → edges[]
    readonly reverseEdges: ReadonlyMap<string, readonly MigrationGraphEdge[]>  // to → edges[]
  }

  interface MigrationGraphEdge {
    readonly from: string
    readonly to: string
    readonly edgeId: string | null
    readonly dirName: string
    readonly createdAt: string
    readonly labels: readonly string[]
  }
  ```
- [x] Implement `reconstructGraph(packages)`:
  - Build adjacency maps `edges[from]` and `reverseEdges[to]`.
  - Collect all referenced hashes into `nodes`.
  - Filter out packages with `archived: true` (future-proofing, not used in MVP but the field may appear).
  - Self-loop check: reject `from === to` with structured error per ADR 039.
- [x] Implement `findLeaf(graph)`:
  - Starting from `EMPTY_CONTRACT_HASH`, follow edges forward to find the node with no outgoing edges (the leaf).
  - If the graph is empty (no edges), return `EMPTY_CONTRACT_HASH` (new project).
  - If multiple leaves exist (branching DAG), error with a diagnostic listing the ambiguous leaves. The user must resolve with `--from <hash>`.
  - Uses BFS/DFS from `EMPTY_CONTRACT_HASH`.
- [x] Implement `findPath(graph, fromHash, toHash)`:
  - BFS from `fromHash` to `toHash` over the forward adjacency map.
  - Deterministic tie-breaking per ADR 039: when multiple edges leave a node, sort by `(createdAt ascending, to lexicographic, edgeId lexicographic)`. Label priority (`main < default < feature`) is deferred since labels aren't populated in MVP.
  - Return `readonly MigrationGraphEdge[]` in order, or `null` if no path exists.
- [x] Implement `detectCycles(graph)`:
  - DFS with three-color marking (white/gray/black) starting from all nodes.
  - Return `readonly string[][]` — each entry is a cycle as a list of hashes.
  - Empty array means no cycles.
- [x] Implement `detectOrphans(graph)`:
  - BFS forward from `EMPTY_CONTRACT_HASH` to find all reachable nodes.
  - Any edge whose `from` is not in the reachable set is an orphan.
  - Return `readonly MigrationGraphEdge[]` (orphaned edges).

#### Tests

All tests are unit tests using vitest. Use `node:fs/promises` with temp directories for I/O tests. No database needed.

**I/O tests:**
- [x] Round-trip: write migration package, read back, verify `JSON.stringify` equality for both manifest and ops.
- [x] Validation: malformed `migration.json` (invalid JSON) → structured error.
- [x] Validation: missing `ops.json` → structured error with file path.
- [x] Validation: missing `migration.json` → structured error.
- [x] Validation: manifest missing required fields (`from`, `to`, `kind`, `toContract`) → error.
- [x] `readMigrationsDir`: directory with two valid packages → returns both sorted by name.
- [x] `readMigrationsDir`: directory with non-migration subdirectory (no `migration.json`) → skipped, not error.
- [x] `readMigrationsDir`: empty directory → returns empty array.

**Directory naming tests:**
- [x] `formatMigrationDirName` with normal slug → correct format.
- [x] Slug sanitization: special characters replaced with `_`, consecutive `_` collapsed.
- [x] Slug sanitization: empty slug → reasonable default or error.
- [x] Timestamp formatting: UTC, zero-padded.

**Collision tests:**
- [x] Write to existing directory → error.

**Attestation tests:**
- [x] `computeEdgeId` with known inputs → deterministic output.
- [x] `computeEdgeId` run twice with same inputs → identical hash.
- [x] `computeEdgeId` with `fromContract: null` (empty) → valid hash.
- [x] `verifyMigration` on attested package → pass.
- [x] `verifyMigration` after modifying ops → mismatch.
- [x] `verifyMigration` after modifying manifest field (e.g., `labels`) → mismatch.
- [x] `verifyMigration` on Draft (edgeId: null) → returns draft status.
- [x] `attestMigration` on Draft → writes edgeId, subsequent verify passes.

**DAG tests:**
- [x] Empty graph (no packages) → `findLeaf` returns `EMPTY_CONTRACT_HASH`.
- [x] Single migration (∅ → H1) → graph has 2 nodes, 1 edge. `findLeaf` returns H1.
- [x] Linear chain (∅ → H1 → H2 → H3) → `findLeaf` returns H3. `findPath(∅, H3)` returns 3 edges in order.
- [x] Branching (∅ → H1, H1 → H2a, H1 → H2b) → `findLeaf` errors with ambiguity.
- [x] `findPath` with no path → returns null.
- [x] `findPath` deterministic tie-breaking: two edges from same node → ordered by `createdAt`.
- [x] Cycle detection: A → B → C → A → reports cycle.
- [x] Cycle detection: linear chain → no cycles.
- [x] Orphan detection: edge D → E where D is not reachable from ∅ → reported as orphan.
- [x] Orphan detection: all edges reachable → no orphans.
- [x] Self-loop rejection: edge with `from === to` → error.

### Milestone 3: CLI commands + end-to-end flows

Build CLI commands and validate the full user flows end-to-end. Commands follow existing CLI patterns in `packages/1-framework/3-tooling/cli/`: Result envelope (`Result<T, CliStructuredError>`), `handleResult` for output, `GlobalFlags` for formatting, commander for argument parsing, `loadConfig` for config loading.

**Deliverable:** `migration plan`, `migration verify`, and `migration new` are registered and functional. E2E tests cover the new-project and incremental-change flows from the spec.

**Sequencing note:** `migration plan` is the critical-path command — it exercises M1 (planner) + M2 (I/O, attestation, DAG) end-to-end. Implement it first to validate the system works. `migration verify` and `migration new` are simple wrappers around M2 functions.

**Tasks:**

#### Config
- [x] Add `migrations.dir` to `PrismaNextConfig` in `packages/1-framework/1-core/migration/control-plane/src/config-types.ts` (default: `'migrations'`). Type: `readonly migrations?: { readonly dir?: string }`.
- [x] Add config validation for the new field in `config-validation.ts` (optional field, string if present).

#### CLI: `migration` subcommand group
- [x] Create `migration` subcommand group in `cli.ts`, following the pattern of the `db` and `contract` groups: `const migrationCommand = new Command('migration')` with description, then `program.addCommand(migrationCommand)`.

#### CLI: `migration plan`
- [x] Create `src/commands/migration-plan.ts` following the `db-init.ts` pattern:
  - Options interface: `--config <path>`, `--name <slug>`, `--from <hash>`, `--json [format]`, `-q`, `-v`, `-vv`, `--timestamps`, `--color`, `--no-color`.
  - `executeMigrationPlanCommand` function returning `Result<MigrationPlanResult, CliStructuredError>`.
  - Logic delegates through the control client's `contractDiff()` method, which dispatches to the target's `planContractDiff` capability (respects layering: CLI → control client → target → family).
  - `MigrationToolsError` is caught and mapped to `CliStructuredError` at the boundary.
- [x] Create `createMigrationPlanCommand()` factory, register under `migration` subcommand group.
- [x] Add output formatters (TTY: styled header + operation tree + hashes; JSON: structured result).
- [x] `MigrationPlanResult` type co-located with the command.

#### CLI: `migration verify`
- [x] Create `src/commands/migration-verify.ts`:
  - Options: `--dir <path>` (required), `--json`, `-q`, `-v`.
  - Calls `verifyMigration(dir)` / `attestMigration(dir)`.
- [x] Register under `migration` subcommand group.
- [x] Output formatters (TTY/JSON).

#### CLI: `migration new`
- [x] Create `src/commands/migration-new.ts`:
  - Options: `--name <slug>` (required), `--config`.
  - Scaffolds an empty Draft migration package.
- [x] Register under `migration` subcommand group.
- [x] Output formatters.

#### Architecture: `planContractDiff` via control plane
- [x] Add optional `planContractDiff` method to `TargetMigrationsCapability` in `migrations.ts` — accepts `ContractIR | null` and `ContractIR`, returns `ContractDiffResult`.
- [x] Implement in postgres target descriptor — casts `ContractIR.storage` to `SqlStorage` and delegates to `planContractDiff` from `@prisma-next/family-sql/control`.
- [x] Add `contractDiff()` method to `ControlClient` interface and implementation — delegates to target capability.
- [x] CLI imports only framework-domain types — no layering violations.

#### Tests

**Unit tests (in `packages/1-framework/3-tooling/cli/test/commands/`):**
- [x] `migration-plan`: happy path — writes valid migration package with correct manifest.
- [x] `migration-plan`: no-op when from and to hash match.
- [x] `migration-plan`: missing contract.json → ENOENT detected.
- [x] `migration-plan`: incremental DAG chain — two migrations, second's from === first's to.
- [x] `migration-plan`: `MigrationToolsError` has expected shape for CLI mapping.
- [x] `migration-verify`: verified package → success.
- [x] `migration-verify`: tampered package → mismatch error.
- [x] `migration-verify`: draft → attests and reports.
- [x] `migration-new`: scaffolds draft with correct structure.
- [x] `migration-new`: formats directory name correctly.
- [x] `migration-new`: rejects empty slug.

**End-to-end tests (in `packages/1-framework/3-tooling/cli/test/commands/migration-e2e.test.ts`):**
- [x] **New project flow**: write migration package → attest → verify → read back and validate all manifest fields.
- [x] **Incremental change flow**: two plans form valid DAG chain (A's `to` === B's `from`), both verify.
- [x] **No-op flow**: leaf hash matches target hash → no new migration needed.
- [x] **`migration new` → `migration verify` flow**: scaffold draft → verify detects draft → attest → verify passes.
- [ ] **Existing DB adoption flow**: `db init` / `db sign` with contract A → emit changed contract B → `migration plan` → verify migration edge has correct from/to. (Requires live DB — deferred to integration test suite.)

### Milestone 4: `migration apply` (limited)

Build a minimal `migration apply` command that reads on-disk migration packages and executes the SQL against a live database. Since the planner lowers directly to SQL at plan time (RD-6), no resolver is needed — apply just reads the SQL from `ops.json` and executes it. This is intentionally limited: no dry-run, no rollback, no partial apply, no apply-to-specific-hash. Simple sequential execution of pending migrations.

**Deliverable:** `migration apply` reads pending migrations from disk, executes their SQL, and updates the migration ledger/marker. Integration tests cover plan → apply against a real database.

**Tasks:**

#### CLI: `migration apply`
- [ ] Create `src/commands/migration-apply.ts`:
  - Options: `--config <path>`, `--url <connection-string>` (or from config/env), `--json`, `-q`, `-v`.
  - Read migrations directory, reconstruct DAG, determine pending migrations (not yet applied).
  - For each pending migration in order: execute SQL from `ops.json` in a transaction, record in ledger.
- [ ] Register under `migration` subcommand group.
- [ ] Output formatters (TTY: progress per migration; JSON: structured result).

#### Ledger / marker integration
- [ ] Determine how to track which migrations have been applied (ledger table, marker update, or both).
- [ ] Record each applied migration's `edgeId` and `to` contract hash.

#### Tests
- [ ] Integration: plan → apply against a real Postgres database, verify schema changes applied.
- [ ] Integration: apply is idempotent — running apply when all migrations are already applied is a no-op.
- [ ] Integration: apply with multiple pending migrations executes them in DAG order.

### Milestone 5: Close-out

**Tasks:**

- [ ] Walk through every acceptance criterion in the spec and confirm test coverage.
- [ ] Run `pnpm test:all` and `pnpm lint:deps` — everything passes.
- [ ] Update CLI README with new commands, usage examples, and workflow documentation.
- [ ] Write/update ADRs if implementation decisions diverged from existing ADRs (direct SQL lowering, control plane capability extension).
- [ ] Migrate long-lived docs into `docs/` (ops vocabulary reference, migration file format reference).
- [ ] Delete `projects/on-disk-migrations/`.

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| Planner produces correct additive SQL | Unit | M1 | Comprehensive coverage of all additive op types |
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
| `migration plan` error handling | Unit | M3 | MigrationToolsError → CliStructuredError mapping |
| `migration new` scaffolds Draft | Unit | M3 | edgeId null, empty ops |
| `migration verify` validates edgeId | Unit | M3 | Pass/fail/attest |
| Incremental migration chain | E2E | M3 | Two plans form valid DAG |
| Existing DB adoption flow | E2E | M3 | init/sign → plan → verify |
| `migration apply` executes SQL against live DB | Integration | M4 | plan → apply → verify schema |
| `migration apply` updates ledger | Integration | M4 | edgeId + contract hash recorded |
| `migration apply` idempotent | Integration | M4 | Re-run is no-op |
| All existing tests pass | E2E | M5 | `pnpm test:all` |
| `pnpm lint:deps` passes | Lint | M1, M2, M3, M4, M5 | After each new package |

## Open Items

1. ~~**Control plane capability design**~~: **Resolved in M3.** `planContractDiff` is exposed via `TargetMigrationsCapability` → `ControlClient.contractDiff()`. The Postgres target delegates to the sql family's pure function. CLI calls through the control client — no layering violations.

2. ~~**Migration operation types**~~: **Resolved in M1, updated post-M3.** The planner lowers directly to target SQL (RD-6). No abstract ops IR or separate resolver needed. `ops.json` contains SQL operations.

3. ~~**Draft vs Attested from `migration plan`**~~: **Resolved.** `migration plan` produces Attested artifacts (computes `edgeId` immediately). `migration verify` serves as re-attestation after manual edits.

4. ~~**Op resolution at apply time**~~: **Resolved.** No resolver needed — the planner produces SQL directly. `migration apply` reads SQL from `ops.json` and executes it.

5. ~~**`db update` overlap with `db init`**~~: **Deferred.** `db update` is out of scope. The existing `db init` covers the "apply from contract" flow.
