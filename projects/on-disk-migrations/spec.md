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
  - `migration.json` header (from/to hashes, edgeId, kind, fromContract, toContract, hints, pre/post, labels, authorship)
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

### FR-6: `prisma-next migration plan` CLI command
- Fully offline — no database connection required
- Read the "from" contract from on-disk migration history (latest `toContract` in the DAG, or empty contract if no migrations exist)
- Read the "to" contract from the emitted `contract.json`
- Convert the "from" contract to `SqlSchemaIR` via `contractToSchemaIR`
- Diff using the existing planner (to-contract vs from-schemaIR)
- Write the resulting edge to disk as a new migration package
- Output a human-readable summary of operations
- Optional `--from <hash>` to explicitly select a different starting contract
- "From" resolution: the DAG leaf is the unique node with no outgoing edges reachable from `sha256:empty`. In the common case (linear history) this is unambiguous. When the DAG branches (multiple leaves), the command fails with a diagnostic listing the ambiguous leaves and the user must specify `--from <hash>`. See RD-2 for details.

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
- **Destructive operations**: Drops, renames, type narrowing. MVP is additive-only. See RD-17 for the policy architecture — `migration apply` is already policy-agnostic, but the planner and `migration plan` policy gate are additive-only.
- **Squash/baseline tooling**: Creating baselines from paths, archiving edges. Infrastructure is designed for it but tooling is deferred.
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
- [x] `prisma-next migration new` scaffolds an empty migration package in Draft state
- [x] `prisma-next migration verify` recomputes and validates `edgeId` for an existing migration package
- [x] `prisma-next migration apply` reads on-disk migrations and executes SQL against a live database
- [x] `prisma-next migration apply` updates the marker and ledger after each successful migration
- [x] `prisma-next migration apply` resumes from last successful migration on re-run after failure
- [x] `prisma-next migration apply` errors when DB marker doesn't match any known migration hash

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
- If migrations exist, find the DAG leaf: the node reachable from `sha256:empty` that has no outgoing edges. In a linear history (the common case) the leaf is unambiguous.
- If the DAG has multiple leaves (branching history — e.g., two developers planned migrations from the same starting point), `findLeaf` fails with a diagnostic listing the ambiguous leaves. The user must pass `--from <hash>` to disambiguate.
- `--from <hash>` always takes precedence when provided — the planner looks up the matching migration's `toContract` for the "from" side.

We resolve by DAG topology, not by timestamp. Timestamps are metadata for human readability (directory naming) but are not authoritative for ordering — the DAG edges (`from`/`to` hashes) are.

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
- `migration plan` (planner call): hardcodes `{ allowedOperationClasses: ['additive'] }` — this is the policy gate where we decide what the planner is allowed to produce.
- `migration apply` (runner call): derives `allowedOperationClasses` from the operations in each edge via `deriveAllowedClasses()`. If an edge has no operations, defaults to `['additive']`.

**Implication:** To support destructive operations end-to-end, two things need to change: (1) the planner must learn to generate destructive SQL instead of emitting conflicts, and (2) `migration plan` must relax its policy to allow the planner to emit those operations. `migration apply` requires no changes.

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
