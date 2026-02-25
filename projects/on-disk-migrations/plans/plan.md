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
- [x] Define the abstract operation IR types. The op vocabulary covers the additive operations the existing planner supports: `createTable`, `addColumn`, `createIndex`, `addUniqueConstraint`, `addPrimaryKey`, `addForeignKey`, `createStorageType` (for extension types like `vector`), `enableExtension`. Each op has: `op` (discriminant), typed `args` (op-specific), `pre[]` and `post[]` (check vocabulary per ADR 044), `operationClass`. Note: `setColumnDefault` is NOT a separate op — defaults are part of `createTable` and `addColumn` column definitions.
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
- [x] ~~Extend `TargetMigrationsCapability`~~ — Not needed. `planContractDiff` is a target-agnostic pure function over `SqlStorage`, exported from `@prisma-next/family-sql/control`. No capability dispatch required. The CLI command in M3 will call it directly, similar to how `executeDbInit` calls the introspection planner.

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

Lives in a new package `packages/1-framework/3-tooling/migration/` (framework domain, tooling layer, migration plane). This is reusable library code, not CLI-specific. All code here is target-agnostic — it works with the abstract ops IR, not SQL.

**Deliverable:** Migrations can be written to disk, read back, attested, and organized into a navigable DAG. Tested with unit tests (no DB needed — this is purely file-based).

#### Package scaffolding

- [x] Create `packages/1-framework/3-tooling/migration/` with `package.json` (name: `@prisma-next/migration-tools`), `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`.
  - Dependencies: `@prisma-next/core-control-plane` (for abstract ops types, `EMPTY_CONTRACT_HASH`), `@prisma-next/utils`, `pathe`.
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
- [x] Define `MigrationOps` type (`ops.json` shape): `readonly AbstractOp[]` — reuses the union type from M1 (`@prisma-next/core-control-plane/abstract-ops`).
- [x] Define `MigrationPackage` interface — the in-memory representation of a read migration package:
  ```typescript
  interface MigrationPackage {
    readonly dirName: string        // directory name (e.g., '20260225T1430_add_users')
    readonly dirPath: string        // full absolute path
    readonly manifest: MigrationManifest
    readonly ops: readonly AbstractOp[]
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
