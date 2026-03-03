# Summary

Implement on-disk migration persistence for prisma-next: the ability to plan migrations using the existing planner and serialize them as migration edge packages (`migration.json` + `ops.json`) to a `migrations/` directory on disk. This covers `migration plan`, `migration verify`, `migration new`, and supporting infrastructure (contract-to-schemaIR conversion, DAG reconstruction, edge attestation, on-disk types). `migration apply` and `db update` are explicitly out of scope for the initial PR and will be follow-up work.

# Description

prisma-next currently supports `db init` (bootstrap a fresh DB from a contract) and `db sign` (write a contract marker), but has no way to persist migration edges to disk. The architecture (ADR 001, ADR 028, Subsystem 7) specifies a rich on-disk format where migrations are directed edges in a DAG, each carrying `fromContract`/`toContract`, operations, pre/post checks, and a content-addressed `edgeId`.

The existing Postgres planner diffs a `SqlContract` against an `SqlSchemaIR`. For `db init`, the `SqlSchemaIR` comes from introspecting a live database. For `migration plan`, we reuse the same planner but the `SqlSchemaIR` comes from **converting the "from" contract** (read from on-disk migration history) into a schema IR. This keeps `migration plan` fully offline (no database connection) while reusing the existing, well-tested planner.

The new piece of infrastructure is a `ContractIR → SqlSchemaIR` converter that maps contract-level types (structured `ColumnDefault`, `codecId`, `typeParams`) down to the schema IR representation (raw default expressions, `nativeType`).

Two user flows are in scope:

1. **New project**: Write contract → emit → `migration plan` → `migration apply`
2. **Existing database, no prisma-next contract**: Write contract → `db sign`/`db init` → edit contract → emit → `migration plan` → `migration apply`

`migration apply` has been implemented and is included in M3.

# Requirements

## Functional Requirements

### FR-1: Migration planning via existing planner + contract-to-schemaIR conversion
- Reuse the existing `PostgresMigrationPlanner` (contract vs schema IR) to produce migration operations — the same planner `db init` uses
- `migration plan` calls `TargetMigrationsCapability.contractToSchema()` to convert the "from" contract to a schema IR, then calls `planner.plan()` to diff it against the "to" contract
- Destructive changes (table/column removals) are detected by a hash-diff heuristic: if the contract hashes differ but the additive-only planner produces zero operations, the CLI infers that the contract changed in ways the planner silently ignores and reports an error; the planner itself catches type changes and nullability tightening as conflicts
- Fully offline — no database connection required
- Produces correct additive SQL for MVP (create table, add column, add index, add FK, add unique, add PK, set default, enable extension, create storage type)
- Must be deterministic: same inputs always produce the same plan
- Infrastructure: `contractToSchemaIR(storage: SqlStorage) → SqlSchemaIR` converter in sql family tooling layer, exposed to CLI via `TargetMigrationsCapability.contractToSchema()` (respects layering — CLI does not import sql-domain code directly)

### FR-2: On-disk migration file format (TypeScript types)
- Define TypeScript types/interfaces for the on-disk artifacts specified in ADR 028:
  - `migration.json` header (from/to hashes, edgeId, parentEdgeId, kind, fromContract, toContract, hints, pre/post, labels, authorship)
  - `ops.json` (SQL operations for the target)
- These types must be the single source of truth for serialization/deserialization

### FR-3: Migration directory management
- Create migration package directories under `migrations/` with `{timestamp}_{slug}/` naming
- Write `migration.json` and `ops.json` into the package directory
- Support reading all migration packages from a `migrations/` directory

### FR-4: Edge attestation (content-addressed hashing)
- Compute `edgeId = sha256(canonicalize(migration.json) + canonicalize(ops.json) + canonicalize(fromContract) + canonicalize(toContract))` per ADR 028
- Newly planned migrations are written in "Attested" state (edgeId computed)

### FR-5: DAG reconstruction from disk
- Reconstruct the migration graph by reading all `migration.json` files from the `migrations/` directory
- Support basic graph operations: path-exists, plan-to (find path from A to B), cycle detection, orphan detection
- Chain ordering is determined by `parentEdgeId` pointers (see RD-18), not by node-level graph analysis or timestamps

### FR-6: `prisma-next migration plan` CLI command
- Fully offline — no database connection required
- Read the "from" contract from on-disk migration history (latest `toContract` in the DAG, or empty contract if no migrations exist)
- Read the "to" contract from the emitted `contract.json`
- Convert the "from" contract to `SqlSchemaIR` via `contractToSchemaIR`
- Diff using the existing planner (to-contract vs from-schemaIR)
- Write the resulting edge to disk as a new migration package
- Output a human-readable summary of operations
- Optional `--from <hash>` to explicitly select a different starting contract
- "From" resolution: the DAG leaf is the target hash of the edge with no children (no other edge has this edge's `edgeId` as its `parentEdgeId`). In the common case (linear history) this is unambiguous. When the DAG branches (multiple edges share the same `parentEdgeId`), the command fails with a diagnostic listing the ambiguous leaves and the user must specify `--from <hash>`. See RD-2 and RD-18 for details.

### FR-8: `prisma-next migration new` CLI command (scaffold)
- Scaffold an empty migration package directory (Draft state) with placeholder `migration.json` and `ops.json`
- Accept `--name <slug>` argument
- Produces a Draft artifact (`edgeId: null`) with `from`/`to` set to `sha256:empty` and empty ops

### FR-9: `prisma-next migration verify` CLI command
- Recompute `edgeId` from existing migration package contents
- Validate that the stored `edgeId` matches the recomputed one
- If the migration is a Draft (`edgeId: null`), attest it (compute and write `edgeId`)
- Signing with `--sign --key <keyId>` is deferred (see RD-15)

### FR-10: `prisma-next migration apply` CLI command
- Read on-disk migration packages from the `migrations/` directory
- Reconstruct DAG, read the current DB marker, find pending migrations (path from marker hash to DAG leaf)
- For each pending migration in DAG order, construct a `SqlMigrationPlan` from the on-disk manifest + ops and execute via the existing `runner.execute()`
- The runner handles: transaction boundaries, advisory locking, marker origin validation, precheck/execute/postcheck SQL, schema verification, marker update, and ledger entry — all within a single transaction per migration
- Each migration is its own `runner.execute()` call. If migration N fails, migrations 1..N-1 are committed and migration N is rolled back. Re-running `migration apply` resumes from where it left off (the marker reflects the last successful migration)
- Error when DB marker hash doesn't match any known `from` hash in the migration history (DB is in an unknown state)
- Error when no pending migrations exist (no-op with informational message)
- Requires a database connection (`--db <url>` or `config.db.connection`)
- Enable runner execution checks (prechecks, postchecks, idempotency probes) — unlike `db init` which disables them
- Stale-plan detection: when `contract.json` is present and its `storageHash` differs from the DAG leaf, emit a warning advising the user to run `migration plan`. Silently skipped when `contract.json` is absent (CI/pinned-migrations use case)
- Limited scope: no dry-run, no rollback, no partial apply, no apply-to-specific-hash. Simple sequential execution of all pending migrations to reach the DAG leaf

## Non-Functional Requirements

### NFR-1: Determinism
- All planner outputs and edge hashes must be fully deterministic given the same inputs
- Canonicalization per ADR 010 must be applied before any hashing

### NFR-2: Layering compliance
- New code must respect the package layering rules (`pnpm lint:deps` must pass)
- CLI calls through the control plane stack abstraction — no direct imports from sql/targets domains

### NFR-3: Test coverage
- On-disk format round-trip tests (write then read back)
- DAG reconstruction tests (path finding, cycle detection, orphan detection)
- CLI integration tests for new commands

### NFR-4: Compatibility with existing system
- `db init` must continue to work unchanged
- Existing Postgres planner and runner are not broken

## Non-goals

- **`db update`**: Applying additive changes to a live DB and updating the marker without writing migration files. Deferred to a later project.
- **Production-ready apply**: Dry-run, rollback, multi-step orchestration, partial apply, apply-to-specific-hash.
- **Destructive operations (production-ready)**: The planner and `migration plan` now support destructive operations (drops, type changes). However, production safeguards (confirmation prompts, `--allow-destructive` flags, dry-run) are deferred. See RD-17 for the policy architecture.
- **Squash/baseline tooling**: Creating baselines from paths, archiving edges. Infrastructure is designed for it but tooling is deferred.
- **Branch resolution tooling**: Automatic rebase or squash of parallel migrations created by team collaboration. The `parentEdgeId` design supports this (see RD-19), but the current resolution is manual: delete one branch, re-plan from the other. See RD-19 for future disambiguation strategies.
- **Preflight commands**: `prisma-next preflight` (shadow or PPg). Deferred.
- **Graph visualization**: Rendering the DAG for human review. Deferred.
- **Signing infrastructure**: `migration sign` with key management. `migration verify` will compute hashes but signing is stretch.
- **Multi-service / multi-contract**: Multiple contracts in one repo. Single contract for now.
- **`@deprecated`/`@deleted` authoring states**: The lifecycle management for deprecated/deleted fields in the authoring layer. Deferred.
- **Planner hints**: Rename hints, drop hints. These require authoring layer support that doesn't exist yet.

# Acceptance Criteria

## Planner
- [x] `contractToSchemaIR` correctly converts a contract's `SqlStorage` to `SqlSchemaIR`
- [x] `migration plan` produces correct additive operations by converting the "from" contract to schema IR and diffing against the "to" contract
- [x] `migration plan` correctly handles the "from empty contract" case (new project)

## On-disk format
- [x] TypeScript types for `migration.json`, `ops.json`, are defined and exported
- [x] `migration.json` and `ops.json` can be written to and read from disk with full fidelity (round-trip)
- [x] `edgeId` is correctly computed via content-addressed hashing per ADR 028

## CLI commands
- [x] `prisma-next migration plan` writes a valid migration package to `migrations/` with correct `migration.json` and `ops.json`
- [x] `prisma-next migration plan` fails clearly when no changes are detected between contracts
- [x] ~`prisma-next migration new` scaffolds an empty migration package in Draft state~ (removed — command required users to provide derived values they can't realistically produce)
- [x] `prisma-next migration verify` recomputes and validates `edgeId` for an existing migration package
- [x] `prisma-next migration apply` reads on-disk migrations and executes SQL against a live database
- [x] `prisma-next migration apply` updates the marker and ledger after each successful migration
- [x] `prisma-next migration apply` resumes from last successful migration on re-run after failure
- [x] `prisma-next migration apply` errors when DB marker doesn't match any known migration hash
- [x] `prisma-next migration apply` warns when contract.json storageHash differs from DAG leaf (stale plan detection)

## DAG
- [x] DAG can be reconstructed from on-disk migration packages (reading all `migration.json` files)
- [x] Path resolution finds the correct sequence of edges from any known hash to a target hash
- [x] Cycle detection identifies and reports illegal cycles
- [x] Orphan detection identifies migrations not reachable from the empty contract

## Integration
- [x] All existing tests continue to pass
- [x] `pnpm lint:deps` passes with new packages
- [x] New CLI commands have e2e tests

# Other Considerations

## Security

No new security concerns. Migration files contain no secrets or parameter values (per ADR 028). The signing infrastructure (optional) is deferred to a later phase. Edge attestation via content-addressed hashing provides tamper detection.

## Cost

No infrastructure cost impact. `migration plan`, `migration new`, and `migration verify` are purely local file-based tooling. `migration apply` requires a database connection but adds no new infrastructure.

## Observability

**Assumption:** MVP does not need telemetry or structured logging beyond what CLI already provides. Future phases can add events per ADR 028 (migration added, squashed, etc.).

## Data Protection

Migration files contain schema structure only. No PII, no application data. No GDPR/data protection concerns for the artifacts themselves.

## Analytics

Not applicable for MVP. Future: track migration plan/apply frequency for product analytics.

# References

- [ADR 001 - Migrations as Edges](../../docs/architecture%20docs/adrs/ADR%20001%20-%20Migrations%20as%20Edges.md)
- [ADR 028 - Migration Structure & Operations](../../docs/architecture%20docs/adrs/ADR%20028%20-%20Migration%20Structure%20&%20Operations.md)
- [ADR 116 - Extension-aware migration ops](../../docs/architecture%20docs/adrs/ADR%20116%20-%20Extension-aware%20migration%20ops.md)
- [Subsystem 7 - Migration System](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)
- [Contract-Driven DB Update](../../docs/architecture%20docs/Contract-Driven%20DB%20Update.md)
- [ADR 039 - DAG path resolution & integrity](../../docs/architecture%20docs/adrs/ADR%20039%20-%20DAG%20path%20resolution%20&%20integrity.md)
- [ADR 010 - Canonicalization Rules](../../docs/architecture%20docs/adrs/ADR%20010%20-%20Canonicalization%20Rules.md)
- [ADR 044 - Pre & post check vocabulary v1](../../docs/architecture%20docs/adrs/ADR%20044%20-%20Pre%20&%20post%20check%20vocabulary%20v1.md)
- [ADR 161 - On-disk migration persistence workflow boundaries](../../docs/architecture%20docs/adrs/ADR%20161%20-%20On-disk%20migration%20persistence%20workflow%20boundaries.md)
- Branch `feat/on-disk-migrations` — previous branch with contract-to-contract planner (preserved for reference)

# Resolved Decisions

## RD-1: Reuse existing planner with contract-to-schemaIR conversion

`migration plan` reuses the existing `PostgresMigrationPlanner` (which diffs `SqlContract` vs `SqlSchemaIR`), but instead of introspecting a live database for the schema IR, it **converts the "from" contract to a `SqlSchemaIR`**. This keeps `migration plan` fully offline while avoiding a second diff engine.

The conversion `contractToSchemaIR(SqlStorage) → SqlSchemaIR` maps contract-level constructs to schema IR:
- `StorageColumn.nativeType` → `SqlColumnIR.nativeType` (direct)
- `StorageColumn.nullable` → `SqlColumnIR.nullable` (direct)
- `ColumnDefault` (structured `kind`/`expression`) → `SqlColumnIR.default` (raw expression string)
- `StorageColumn.codecId`, `typeParams`, `typeRef` → dropped (not in schema IR)
- `StorageTable.uniques` → `SqlTableIR.uniques` (direct mapping)
- `StorageTable.indexes` → `SqlTableIR.indexes` (with `unique: false`)
- `StorageTable.foreignKeys` → `SqlTableIR.foreignKeys` (structural reshaping)
- `SqlStorage.types` → extension annotations or ignored (storage type instances are codec-level metadata)

This conversion is intentionally lossy in the contract→schemaIR direction (dropping codec metadata), but that's fine because the planner only needs the structural information to diff.

## RD-2: `migration plan` is fully offline (no DB connection)

`migration plan` reads the "from" contract from on-disk migration artifacts and the "to" contract from the emitted `contract.json`. No database connection is needed. The "from" contract is converted to `SqlSchemaIR` and fed into the existing planner.

**"From" contract resolution:**
- If no migrations exist, assume the empty contract (`sha256:empty`) as the starting point (new project). The converted schema IR is an empty schema.
- If migrations exist, find the DAG leaf: the edge whose `edgeId` is not referenced as `parentEdgeId` by any other edge. The leaf's `to` hash is the current contract state. In a linear history (the common case) the leaf is unambiguous.
- If the DAG has multiple leaves (branching history — e.g., two developers planned migrations from the same starting point, producing edges with the same `parentEdgeId`), `findLeaf` fails with a diagnostic listing the ambiguous leaves. The user must pass `--from <hash>` to disambiguate.
- `--from <hash>` always takes precedence when provided — the planner looks up the matching migration's `toContract` for the "from" side.

We resolve by parent-edge chain (see RD-18), not by timestamp. Timestamps are metadata for human readability (directory naming) but are not authoritative for ordering.

## RD-3: `migration plan` vs `db init` share the same planner, different schema IR source

- `migration plan`: offline, uses `TargetMigrationsCapability.contractToSchema()` to synthesize "from" schema IR from the previous contract, calls `planner.plan()`, writes ops to disk.
- `db init`: online, introspects live DB → `SqlSchemaIR`, calls `planner.plan()`, applies immediately.
- `db update`: online, introspects DB, applies immediately (out of scope for this project).
- All use the same `PostgresMigrationPlanner` via `TargetMigrationsCapability.createPlanner()`. The difference is where the schema IR comes from: `migration plan` synthesizes it from a contract via `contractToSchema()`, `db init`/`db update` introspect a live database via `familyInstance.introspect()`.

## RD-4: Timestamp format

Use `YYYYMMDDThhmm_{slug}` format per ADR 028 and the v2 branch convention.

## RD-5: Diffing via the existing planner (contract vs schema IR)

**Decision:** `migration plan` uses the existing planner that diffs a `SqlContract` against a `SqlSchemaIR`. For `migration plan`, the schema IR is synthesized from the "from" contract via `contractToSchemaIR`, not introspected from a live database.

**Rationale:** The existing planner is proven, well-tested, and handles all the edge cases (default normalization, native type matching, extension dependencies). Building a separate contract-to-contract diff engine is a significant investment that can be deferred. The serialization layer (on-disk format, attestation, DAG) is orthogonal to how the ops are produced.

**Key insight:** The `contractToSchemaIR` conversion is intentionally lossy (drops `codecId`, `typeParams`, `typeRef`), but the planner only needs structural information (native types, nullability, defaults, constraints) to produce correct diffs. The dropped metadata is contract-level semantic information that isn't relevant to schema diffing.

## RD-6: Direct SQL on disk (not abstract operation IR)

On-disk `ops.json` contains SQL operations lowered for the specific target (e.g., Postgres DDL statements). The existing planner already produces `SqlMigrationPlanOperation` with SQL — there is no intermediate abstract operation IR that needs a separate resolver at apply time.

**Rationale:** Migrations are written for a specific database. If you change targets, you'd start fresh rather than replay thousands of migrations. An abstract IR adds indirection without practical benefit. Having SQL on disk makes `migration apply` straightforward — it just executes the SQL that's already there.

## RD-7: Package layering

Validated against `architecture.config.json`:

- **On-disk format types + DAG logic**: `packages/1-framework/3-tooling/migration/` — framework domain, tooling layer, migration plane. Target-agnostic.
- **CLI commands**: `packages/1-framework/3-tooling/cli/` — calls through `TargetMigrationsCapability` interface methods (`contractToSchema()`, `createPlanner()`). Does not import from sql/targets domains directly. Destructive change detection uses a hash-diff heuristic in the CLI itself (no family-specific method needed).
- **Existing planner**: `packages/3-targets/3-targets/postgres/` — the `PostgresMigrationPlanner` lives here and is accessed via the `TargetMigrationsCapability` interface.
- **Contract-to-schema conversion**: `packages/2-sql/3-tooling/family/` — `contractToSchemaIR()` lives here, exposed to CLI via `TargetMigrationsCapability.contractToSchema()` on the postgres target descriptor. `detectDestructiveChanges()` also lives here as a SQL-family utility for direct use in tests and future tooling, but the CLI does not call it — it uses a hash-diff heuristic instead.

The CLI uses `config.target.migrations.createPlanner()` + `planner.plan()` — the same code path `db init` uses. No separate contract-diffing abstraction is needed.

## RD-8: Empty contract representation

Use the sentinel value `sha256:empty` — a human-readable marker, not a real SHA-256 hash. This is recognizable at a glance in migration files, error messages, and debugging. Export it as a named constant.

## RD-10: On-disk persistence package location

The on-disk I/O, attestation, and DAG logic live in a new package `packages/1-framework/3-tooling/migration/` (framework domain, tooling layer, migration plane). This is library code reusable by the CLI, CI tooling, PPg bundle building, etc. — not CLI-specific. It imports from `1-core/migration/control-plane/` for the `EMPTY_CONTRACT_HASH` sentinel and migration types.

## RD-11: Edge attestation canonicalization strategy

The `edgeId` formula hashes four inputs: the manifest (minus `edgeId`/`signature`), the ops, and the two embedded contracts. Contracts are canonicalized using the existing `canonicalizeContract` function (same function used for `storageHash`). The manifest and ops are canonicalized using a generic `canonicalizeJson` (deep lexicographic key sort + `JSON.stringify`). This keeps contract hashing consistent everywhere while using the simplest correct approach for non-contract data.

## RD-12: Full contracts embedded in migration manifest

`migration.json` embeds the complete `fromContract` and `toContract` JSON (not just hashes). This enables state reconstruction from any migration point, supports migration splitting, and makes migration packages self-contained per ADR 001. Storage overhead is minimal since contracts are small JSON.

## RD-13: Include hints field in manifest (even for additive-only MVP)

The `hints` field is included in the `MigrationManifest` type and populated by `migration plan`, even though the MVP planner is additive-only. For MVP this will be `{ used: [], applied: ["additive_only"], plannerVersion: "...", planningStrategy: "additive" }`. Including it now avoids a format change later when destructive hints are implemented.

## RD-14: Authorship field deferred

The `authorship` field is included in the `MigrationManifest` type as optional (`authorship?: { author?: string; email?: string }`) for forward compatibility, but is not populated by any command in this project. Auto-population from git config or `--author` flags is future work.

## RD-15: Signing deferred, attestation only

This project implements **attestation** only: computing the content-addressed `edgeId` hash via `computeEdgeId` / `verifyEdgeId`. **Signing** (cryptographic signature over `edgeId` for provenance, required by PPg hosted preflight) is a separate project requiring key management infrastructure. The `signature` field is included in the `MigrationManifest` type as `signature?: { keyId: string; value: string } | null` for forward compatibility but is not written by any command.

Terminology note: "attestation" (hashing migration content → `edgeId`), "signing" (cryptographic signature → provenance), and "database signing" (`db sign` → writing marker to DB) are three distinct concepts.

## RD-17: `migration apply` is policy-agnostic (trusts the planner)

`migration apply` derives its operation policy from the operations already present in the on-disk `ops.json`, rather than hardcoding `['additive']`. The planner is the single authority that decides which operation classes to emit at plan time — `apply` just executes what was already planned.

**Rationale:** The policy gate belongs at planning time (`migration plan`), not at apply time. The planner currently only emits additive operations and treats destructive changes as conflicts, so today `migration apply` will only ever see additive ops. But if the planner gains support for destructive or widening operations in the future, `migration apply` will work without changes — it derives `allowedOperationClasses` from the `operationClass` field on each operation in the migration package.

**Where the policy lives:**
- `migration plan` (planner call): passes `{ allowedOperationClasses: ['additive', 'widening', 'destructive'] }` — the planner is allowed to produce any operation class it supports.
- `migration apply` (runner call): passes all operation classes (`additive`, `widening`, `destructive`). The policy gate belongs at plan time, not apply time — apply trusts whatever the planner emitted.

## RD-18: Parent-edge linking (`parentEdgeId`)

### Two structures, not one

The migration system maintains two distinct structures that serve different purposes:

1. **The contract graph** (ADR 001): Nodes are contract storage hashes, edges are migrations with `from`/`to` hashes. This is the *semantic* model — it describes schema evolution and answers "how do I get from state A to state B?" The `from`/`to` relationship encodes what a migration *does*.

2. **The edge chain**: A singly-linked list of migrations via `parentEdgeId`. This is the *operational* model — it describes planning history and answers "what order were these migrations created in?" and "which one is the latest?" The `parentEdgeId` relationship encodes when a migration was *planned*.

Both are necessary. The contract graph alone cannot determine ordering when contract hashes are revisited (a valid scenario — see below). The edge chain alone cannot determine schema relationships. Together they provide a complete picture: `from`/`to` for the graph, `parentEdgeId` for the chain.

This is analogous to git, where commits serve as both a linked list (via parent pointers) and a snapshot graph (via tree hashes). The key mappings:

| Git | Migrations |
|-----|-----------|
| Commit | Migration edge |
| Tree hash (snapshot of working tree) | Contract storage hash (snapshot of schema) |
| Parent commit SHA | `parentEdgeId` |
| Commit SHA | `edgeId` |
| HEAD | DAG leaf (edge with no children) |
| Working tree | Current `contract.json` |
| Two branches from same commit | Two edges with same `parentEdgeId` (`AMBIGUOUS_LEAF`) |

One important difference: in git, the parent pointer is part of the commit hash. In our model, `parentEdgeId` is explicitly *excluded* from the `edgeId` computation. This means `edgeId` stays purely structural (same ops + same from/to = same content hash), and future squash/rebase operations can reassign `parentEdgeId` without changing the content identity of the migration. Git does not have this property — rebasing changes the commit SHA.

### Problem

The contract graph (structure 1) treats contract storage hashes as nodes. `findLeaf` determines the "current" state by finding nodes with no outgoing edges, and `findPath` uses BFS with a visited-nodes set. This breaks when a migration returns to a previously-seen contract hash — for example, adding a column, deploying, then rolling back:

```
edge1: empty → C1   (create table)
edge2: C1 → C2      (add column)
edge3: C2 → C1      (drop column — rollback)
```

At the node level, `C1` has an outgoing edge (edge2), so `findLeaf` doesn't consider it a leaf — even though edge3 is chronologically latest. `findPath` with visited-nodes would short-circuit at `C1` on first visit and never reach edge3.

**Why `from`/`to` alone cannot solve this:** `from` could serve as an implicit parent pointer in simple cases — find the edge whose `to` matches my `from`. But when contract hashes are revisited, `from` becomes ambiguous. After the sequence above, if the user plans a new migration from C1 → C3, there are *two* edges with `to: C1` (edge1 and edge3). We cannot determine from `from` alone whether the new migration follows edge1 (branching off the initial state) or edge3 (continuing after the rollback).

**Why timestamps cannot solve this:** In a team collaboration scenario where two developers plan migrations from the same contract state, timestamp-based ordering would silently pick the earlier one and orphan the other. Timestamps also cannot structurally distinguish branches from continuations.

### Decision

Add a required `parentEdgeId` field to `MigrationManifest`. This is the `edgeId` of the migration that this migration follows in the chain, or `null` for the first migration (whose `from` is `sha256:empty`).

```
edge1: empty → C1   parentEdgeId: null
edge2: C1 → C2      parentEdgeId: edge1.edgeId
edge3: C2 → C1      parentEdgeId: edge2.edgeId
```

The edge chain is `edge1 → edge2 → edge3` regardless of contract hash revisits. Chain reconstruction follows parent pointers, not node-level graph analysis.

**Key properties:**

- **Leaf**: An edge whose `edgeId` is not referenced as `parentEdgeId` by any other edge. Equivalent to "the edge with no children in the edge chain."
- **Branch detection**: Two edges with the same `parentEdgeId` = a branch = `AMBIGUOUS_LEAF`. This is structurally detectable without timestamps or heuristics, analogous to two git commits sharing a parent.
- **Path reconstruction**: Follow the parent chain from the leaf backward to the root, then reverse. No visited-nodes set needed; revisited contract hashes are handled naturally because the chain operates on edges, not nodes.
- **Content-addressing**: `parentEdgeId` is metadata for the edge chain. It is stripped from the hash input when computing `edgeId`, the same way `edgeId` and `signature` are stripped. This keeps the contract graph and the edge chain cleanly separated: `edgeId` is determined by what the migration *does* (ops, from/to), not by where it sits in the planning history.
- **Team collaboration**: Two developers planning from the same leaf produce edges with the same `parentEdgeId`. The system detects this as a branch and surfaces `AMBIGUOUS_LEAF`, requiring explicit resolution. This is the prerequisite for future rebase tooling — knowing the common parent makes automated re-planning possible (see RD-19).

**`parentEdgeId` is a required field.** There are no existing production users, so backward compatibility is not a concern.

### Alternatives considered

**1. Use `from` hash as an implicit parent pointer.** Each migration already has a `from` hash. To find the parent, find the edge whose `to` matches my `from`. This works when every contract hash is unique — but breaks when hashes are revisited. After `empty → C1 → C2 → C1`, a new migration with `from: C1` could follow edge1 (`to: C1`) or edge3 (`to: C1`). There is no way to distinguish a branch from a continuation. `parentEdgeId` is unambiguous because it points to a specific *edge*, not a *hash* that multiple edges may share.

**2. Use timestamps (`createdAt`) for ordering.** Find the leaf via `max(createdAt)` and order the chain by timestamp. This fails because it cannot detect branches. If Alice plans at 10:01 and Bob plans at 10:02 from the same base contract, both migrations end up in the chain sorted by timestamp. The system treats this as a normal linear sequence: Alice's migration runs first, then Bob's runs against the resulting state — but Bob's migration was planned against the *original* base, not the post-Alice state. The operations may conflict or produce unexpected results, and there is no error or signal that these migrations were planned independently. With `parentEdgeId`, two edges sharing a parent are a structurally detectable branch. With timestamps, they are indistinguishable from a legitimate sequential chain. Additionally, clock skew between machines can produce incorrect ordering. Timestamps are useful as human-readable metadata (directory naming) but are not reliable as an ordering or branch-detection primitive.

**3. Use a sequence number.** Each migration gets a monotonically increasing `sequence: number`. The leaf is `max(sequence)`. This is simpler than parent pointers but has the same team-collaboration problem as timestamps: Alice gets sequence 2, Bob gets sequence 2. Now there are two migrations with the same sequence and no structural way to detect the conflict. Additionally, sequence numbers require coordination (who assigns the next number?), which is at odds with offline, independent planning.

**4. Use a `HEAD` file.** Like git's `HEAD`, keep a `migrations/HEAD` file that records the current leaf's `edgeId`. `migration plan` reads HEAD, writes the new migration, updates HEAD. This is O(1) for leaf lookup and avoids graph traversal entirely. However, HEAD is a mutable singleton file that becomes a merge-conflict magnet in team workflows. When Alice and Bob both update HEAD on their branches, the git merge produces a conflict on HEAD — which is a useful signal, but annoying to resolve compared to the structural detection that `parentEdgeId` provides. HEAD also introduces a single point of corruption: if the file is lost or mangled, the system cannot determine the leaf without falling back to graph analysis anyway.

**5. Treat hash revisits as errors.** If a migration would create a cycle at the node level (`to` hash already appears as a node), reject it. This keeps the contract graph acyclic without needing `parentEdgeId`. However, this blocks legitimate workflows: adding a column, deploying to production, discovering a problem, and rolling back. The rollback produces a migration whose `to` matches a previously-seen hash. Blocking this forces users to produce artificially different contract states (e.g., adding a no-op change) to avoid the error. This is hostile UX for a common real-world scenario.

**6. Ignore revisited hashes and skip redundant migrations.** If the DB marker is already at the target hash, skip all intermediate migrations. This works for `migration apply` (which can compare the marker to the leaf and see "already there"), but fails for `migration plan`. The plan command is offline — it must determine the current schema state from disk alone. Without `parentEdgeId`, it cannot find the latest migration in a graph with revisited hashes (see "Problem" above). Additionally, skipping migrations is only safe when contract hashes are a faithful representation of database state. Future data migrations (backfills, transforms) would break this assumption: two databases at the same contract hash could differ in their data state depending on which migrations they applied.

### Consequences

- `migration plan` must look up the leaf edge's `edgeId` and write it as `parentEdgeId` on the new manifest.
- `findLeaf` is rewritten to walk the edge chain from root, not analyze node-level outgoing edges in the contract graph.
- `findPath` is rewritten to traverse the edge chain via parent pointers, not BFS over contract graph nodes.
- `reconstructGraph` adds a `childEdges` index (mapping `parentEdgeId → edge[]`) for efficient chain walking.
- `MigrationGraphEdge` gains a `parentEdgeId` field.

## RD-19: Team collaboration — parallel migrations and branch resolution

### Scenario

Two developers, Alice and Bob, start from the same migration history. Both plan migrations independently:

```
Shared history:
  edge1: empty → hash-a  (parentEdgeId: null)

Alice plans on her git branch:
  edge-alice: hash-a → hash-b  (parentEdgeId: edge1.edgeId)  — add email column

Bob plans on his git branch:
  edge-bob: hash-a → hash-c   (parentEdgeId: edge1.edgeId)   — add avatar column
```

When they merge into the same branch, the `migrations/` directory contains both edges. Both have `parentEdgeId: edge1.edgeId` — edge1 has two children.

### Current behavior

`findLeaf` detects the branch and throws `MIGRATION.AMBIGUOUS_LEAF` with both leaf hashes listed. All commands that depend on a unique leaf (`migration plan`, `migration apply`, `migration status`, `migration show`) fail with this error.

The error message tells the user to resolve the branch manually:
- Delete one migration, rebase onto the other, and re-plan
- Or use `--from <hash>` to explicitly select a starting point

This is a hard error by design. Silently choosing one branch (e.g., by timestamp) would orphan the other developer's migration, which is dangerous.

### Manual resolution workflow (current)

1. Alice and Bob merge their git branches. The result has both `edge-alice` and `edge-bob` in `migrations/`.
2. Any migration command fails with `AMBIGUOUS_LEAF`.
3. One developer (say Bob) resolves:
   - Delete his migration directory (`rm -rf migrations/20260303T1044_add_avatar`)
   - Run `prisma-next migration plan --name add_avatar` — this now plans from Alice's leaf, producing an edge with `parentEdgeId: edge-alice.edgeId`
4. The chain is linear again: `edge1 → edge-alice → edge-bob-v2`.

### Future disambiguation strategies (not implemented)

Several approaches could automate branch resolution in the future:

**Auto-rebase (recommended for v2):**
A `migration rebase` command that:
1. Detects the branch
2. Picks a canonical ordering (e.g., by `createdAt`, or user-specified)
3. Re-plans the "rebased" migration from the other branch's leaf
4. Writes the new migration with the correct `parentEdgeId`
5. Removes the old conflicting migration

This is analogous to `git rebase`. Because `parentEdgeId` is excluded from `edgeId` computation, re-parenting a migration preserves its content hash if the operations are the same — but in practice, re-planning from a different base often produces different operations (e.g., different column ordering or conflict with the other migration's changes), so a full re-plan is the correct approach.

**Auto-squash:**
A `migration squash` command that merges multiple edges into a single edge covering the combined changes. This requires re-planning from the common ancestor to the combined target state. Useful for cleaning up long migration chains, not just branch resolution.

**Parallel edge labels (from ADR 039):**
ADR 039 specifies a `parallel-ok` label that allows two edges with the same `(from, to)` pair. This could be extended to allow parallel edges from the same `parentEdgeId` when explicitly labeled, with deterministic tie-breaking by the sort tuple (label priority, `createdAt`, `to`, `edgeId`). This is only safe when the migrations are genuinely independent (commutative operations).

**Key design constraint:** Any future auto-resolution must re-plan (not just re-parent) the rebased migration. The operations depend on the "from" contract state, which changes when the base changes. Simply updating `parentEdgeId` without re-planning would produce a migration whose operations were planned against a stale base state.

## RD-16: Structured errors with MIGRATION.* stable codes

Migration tooling errors use the `MIGRATION.SUBCODE` format from ADR 027's stable code registry. The `MigrationToolsError` class carries `code`, `category` (always `'MIGRATION'`), `why` (plain-language cause), `fix` (actionable remediation), and `details` (machine-readable structured data for agents).

Tooling-time codes registered in ADR 027:
- `MIGRATION.DIR_EXISTS` — migration directory already exists on disk
- `MIGRATION.FILE_MISSING` — expected migration file not found
- `MIGRATION.INVALID_JSON` — migration file contains malformed JSON
- `MIGRATION.INVALID_MANIFEST` — manifest missing required fields or has invalid values
- `MIGRATION.INVALID_NAME` — migration name/slug empty after sanitization
- `MIGRATION.SELF_LOOP` — migration edge has from === to
- `MIGRATION.AMBIGUOUS_LEAF` — multiple leaf nodes in DAG (diverged branches)

These are distinct from the existing runtime `MIGRATION.*` codes (PRECHECK_FAILED, POSTCHECK_FAILED, etc.) which are apply-time. The CLI boundary catches `MigrationToolsError.is(e)` and converts to its own envelope format (`CliStructuredError`).

# Open Questions

None.

# Resolved Questions

1. **How does `migration plan` get its operations?**
   Resolved: `migration plan` uses the existing `PostgresMigrationPlanner` (same planner as `db init`). It reads the "from" contract from on-disk migration history, converts it to `SqlSchemaIR` via `contractToSchemaIR`, then diffs against the "to" contract. The result is serialized to disk. No database connection needed.

2. **Should `migration plan` produce Draft or Attested artifacts?**
   Resolved: `migration plan` produces **Attested** artifacts (`edgeId` computed immediately). If the user edits the migration afterward, they run `migration verify` to re-attest. See RD-15 for the distinction between attestation and signing.

3. **Direct SQL on disk?**
   Resolved: Yes. The existing planner already produces `SqlMigrationPlanOperation` with SQL. These are serialized directly to `ops.json`. No abstract IR or resolver needed at apply time.
