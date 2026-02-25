# Summary

Implement on-disk migration persistence for prisma-next: the ability to plan contract-to-contract diffs and write them as migration edge packages (`migration.json` + `ops.json`) to a `migrations/` directory on disk. This covers `migration plan`, `db update`, and supporting infrastructure (DAG reconstruction, edge attestation, on-disk types). Apply is explicitly out of scope.

# Description

prisma-next currently supports `db init` (bootstrap a fresh DB from a contract) and `db sign` (write a contract marker), but has no way to persist migration edges to disk. The architecture (ADR 001, ADR 028, Subsystem 7) specifies a rich on-disk format where migrations are directed edges in a DAG, each carrying `fromContract`/`toContract`, operations, pre/post checks, and a content-addressed `edgeId`.

The existing Postgres planner diffs a contract against a **live schema IR** (introspection-based), which is the right approach for `db init` and `db update` — commands that operate against a running database. On-disk migrations are different: the user edits their schema, emits a new contract, and plans a migration *before* the database reflects those changes. This requires a **contract-to-contract diff planner** that compares two contract JSON structures and produces operations without needing a live database.

Two user flows are in scope:

1. **New project**: Write contract -> `db update` (or `migration plan`) -> optionally `migration apply` later
2. **Existing database, no prisma-next contract**: Write contract by hand -> `db sign`/`db init` -> `migration plan` -> optionally `migration apply` later

The focus is on **creating and persisting migrations**, not applying them from disk.

# Requirements

## Functional Requirements

### FR-1: Contract-to-contract diff planner
- Given two canonical contract JSON objects (from-contract and to-contract), produce a migration plan with operations, pre/post checks, and metadata
- Must produce the same output as the existing introspection-based planner for equivalent diffs (additive-only for MVP)
- Must be deterministic: same inputs always produce the same plan

### FR-2: On-disk migration file format (TypeScript types)
- Define TypeScript types/interfaces for the on-disk artifacts specified in ADR 028:
  - `migration.json` header (from/to hashes, edgeId, kind, fromContract, toContract, hints, pre/post, labels, authorship)
  - `ops.json` (machine operations IR)
  - `graph.index.json` (optional DAG cache)
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
- Optional: write/read `graph.index.json` as a performance cache

### FR-6: `prisma-next migration plan` CLI command
- Fully offline — no database connection required
- Read the "from" contract from on-disk migration history (latest `toContract` in the DAG, or empty contract if no migrations exist)
- Read the "to" contract from the emitted `contract.json`
- Diff the two contracts using the contract-to-contract planner
- Write the resulting edge to disk as a new migration package
- Output a human-readable summary of operations
- Optional `--from <hash>` to explicitly select a different starting contract

### FR-7: `prisma-next db update` CLI command
- Requires a database connection
- Read the "from" contract from the DB marker's `contract_json`
- Read the "to" contract from the emitted `contract.json`
- Uses the existing introspection-based planner (same as `db init`)
- Synthesize and apply a migration edge immediately, without writing to disk
- Record the edge in the migration ledger
- **Assumption:** For MVP, `db update` supports the same additive-only operations as `db init`

### FR-8: `prisma-next migration new` CLI command (scaffold)
- Scaffold an empty migration package directory (Draft state) with placeholder `migration.json` and `ops.json`
- Accept optional `--from`/`--to` hash arguments

### FR-9: `prisma-next migration verify` CLI command
- Recompute `edgeId` from existing migration package contents
- Validate that the stored `edgeId` matches the recomputed one
- Optionally sign with `--sign --key <keyId>` (signing infrastructure is a stretch goal)

## Non-Functional Requirements

### NFR-1: Determinism
- All planner outputs and edge hashes must be fully deterministic given the same inputs
- Canonicalization per ADR 010 must be applied before any hashing

### NFR-2: Layering compliance
- New code must respect the package layering rules (`pnpm lint:deps` must pass)
- Contract-to-contract planner logic should live at the SQL family level, not Postgres-specific (unless Postgres-specific DDL is needed)

### NFR-3: Test coverage
- Contract-to-contract planner must have parity with existing planner tests
- On-disk format round-trip tests (write then read back)
- DAG reconstruction tests (path finding, cycle detection, orphan detection)
- CLI integration tests for new commands

### NFR-4: Compatibility with existing system
- `db init` must continue to work unchanged
- Existing Postgres planner and runner are not broken
- Migration ledger entries from `db update` must be indistinguishable from ledger entries from `migration apply`

## Non-goals

- **`migration apply`**: Applying on-disk migrations to a database (runner reads from disk and executes). The existing runner infrastructure exists but the "read from disk and execute path" is deferred.
- **Destructive operations**: Drops, renames, type narrowing. MVP is additive-only.
- **Squash/baseline tooling**: Creating baselines from paths, archiving edges. Infrastructure is designed for it but tooling is deferred.
- **Preflight commands**: `prisma-next preflight` (shadow or PPg). Deferred.
- **Graph visualization**: Rendering the DAG for human review. Deferred.
- **Signing infrastructure**: `migration sign` with key management. `migration verify` will compute hashes but signing is stretch.
- **Multi-service / multi-contract**: Multiple contracts in one repo. Single contract for now.
- **`@deprecated`/`@deleted` authoring states**: The lifecycle management for deprecated/deleted fields in the authoring layer. Deferred.
- **Planner hints**: Rename hints, drop hints. These require authoring layer support that doesn't exist yet.

# Acceptance Criteria

## Planner
- [ ] Contract-to-contract planner produces the same additive operations (create table, add column, add index, add FK, add unique, add PK, set default) as the existing introspection-based planner for equivalent schema diffs
- [ ] Planner output is deterministic: running twice with the same inputs produces byte-identical `ops.json`
- [ ] Planner correctly handles the "from empty contract" case (new project)
- [ ] Planner correctly handles extension-owned operations (e.g., pgvector column/index creation)

## On-disk format
- [ ] TypeScript types for `migration.json`, `ops.json`, and `graph.index.json` are defined and exported
- [ ] `migration.json` and `ops.json` can be written to and read from disk with full fidelity (round-trip)
- [ ] `edgeId` is correctly computed via content-addressed hashing per ADR 028

## CLI commands
- [ ] `prisma-next migration plan` writes a valid migration package to `migrations/` with correct `migration.json` and `ops.json`
- [ ] `prisma-next migration plan` fails clearly when no changes are detected between contracts
- [ ] `prisma-next migration new` scaffolds an empty migration package in Draft state
- [ ] `prisma-next migration verify` recomputes and validates `edgeId` for an existing migration package
- [ ] `prisma-next db update` applies additive changes to a live DB and updates the marker without writing migration files

## DAG
- [ ] DAG can be reconstructed from on-disk migration packages (reading all `migration.json` files)
- [ ] Path resolution finds the correct sequence of edges from any known hash to a target hash
- [ ] Cycle detection identifies and reports illegal cycles
- [ ] Orphan detection identifies migrations not reachable from the empty contract

## Integration
- [ ] All existing tests continue to pass
- [ ] `pnpm lint:deps` passes with new packages
- [ ] New CLI commands have e2e tests

# Other Considerations

## Security

No new security concerns. Migration files contain no secrets or parameter values (per ADR 028). The signing infrastructure (optional) is deferred to a later phase. Edge attestation via content-addressed hashing provides tamper detection.

## Cost

No infrastructure cost impact. `migration plan` is purely local file-based tooling. `db update` requires a database connection but adds no new infrastructure.

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
- [ADR 161 - On-disk migration persistence workflow boundaries](../../docs/architecture%20docs/adrs/ADR%20161%20-%20On-disk%20migration%20persistence%20workflow%20boundaries.md) (v2 branch, not yet merged)
- v2 branch `feat/on-disk-migrations-v2` — reference implementation for `migration new`, config normalization, and detailed plans

# Resolved Decisions

## RD-1: Contract-to-contract diffing (not introspection-based)

`migration plan` diffs two contracts — it does not introspect a live database. The user's workflow is: edit schema → emit contract → plan migration. The database doesn't exist in a state that reflects the new contract yet; the whole point of planning is to produce the edge that will transition it. The "from" contract comes from on-disk migration history, not from a DB.

The existing introspection-based planner remains the right tool for `db init` and `db update`, which operate against a live database. `migration plan` needs a new contract-to-contract diff engine.

**Implementation approach:** Build a contract-to-contract diff planner that operates on canonical contract IR directly. The existing introspection-based planner and this new planner will share operation-generation logic where possible (e.g., how to produce a `createTable` op from a table definition), but the diff strategy is fundamentally different: contract IR comparison vs. schema IR comparison.

## RD-2: `migration plan` is fully offline (no DB connection)

`migration plan` reads the "from" contract from on-disk migration artifacts and the "to" contract from the emitted `contract.json`. No database connection is needed.

**"From" contract resolution:**
- If migrations exist on disk, use the latest migration's `toContract` (determined by DAG: the leaf node reachable from the empty contract)
- If no migrations exist, assume the empty contract (`sha256:empty`) as the starting point (new project)
- Optional: `--from <hash>` flag to explicitly specify a different starting contract from the migration history

## RD-3: `migration plan` vs `db update` are distinct commands with distinct planners

- `migration plan`: offline, contract-to-contract, writes to disk. No DB.
- `db update`: online, reads DB marker contract + introspects DB, applies immediately, no disk artifacts. Reuses existing introspection-based planner.
- They share the operation vocabulary and output format, but the diff input is different.

## RD-4: Timestamp format

Use `YYYYMMDDThhmm_{slug}` format per ADR 028 and the v2 branch convention.

## RD-5: Direct contract-to-contract diffing (not via SqlSchemaIR conversion)

The contract IR (`SqlStorage`) and `SqlSchemaIR` are structurally similar but not identical. Converting contract → SqlSchemaIR is feasible but lossy (structured `ColumnDefault` flattens to raw string, foreign key shapes differ, synthetic fields needed for annotations/extensions). Direct contract-to-contract diffing avoids all impedance mismatches since both sides are `SqlStorage` with identical types.

The existing planner's operation-generation logic (how to build a `createTable` op from a table definition) can be extracted and shared. The diff strategy is new.

## RD-6: Abstract operation IR on disk (not SQL strings)

On-disk `ops.json` uses an abstract, target-agnostic IR (e.g., `{op: 'createTable', table: 'user', columns: [...], pre: [...], post: [...]}`). Operations are resolved to actual SQL by the target adapter at apply/preflight time. This aligns with the ADR 028 design and keeps the on-disk format in the framework domain (no SQL dependency). The IR type definitions live in `packages/1-framework/` (framework/tooling/migration plane).

## RD-7: Package layering

Validated against `architecture.config.json`:

- **On-disk format types + DAG logic**: `packages/1-framework/3-tooling/` — framework domain, tooling layer, migration plane. Target-agnostic.
- **Contract-to-contract SQL diff planner**: `packages/2-sql/3-tooling/family/` — sql domain, tooling layer. Produces abstract ops from `SqlStorage` diffs. May import from framework domain.
- **CLI commands**: `packages/1-framework/3-tooling/cli/` — calls through the control plane stack abstraction. Does not import from sql/targets domains directly.

The CLI → control plane → sql family → postgres target delegation chain already exists for `db init`. The same pattern applies for `migration plan`.

## RD-8: Empty contract representation

Use the sentinel value `sha256:empty` — a human-readable marker, not a real SHA-256 hash. This is recognizable at a glance in migration files, error messages, and debugging. Export it as a named constant.

## RD-9: Start fresh (don't cherry-pick v2)

Start fresh, using the v2 branch as reference. Key reasons:
- The v2 planner approach (introspection-based) is fundamentally different from what we need
- Starting clean avoids merge conflicts and lets us structure packages properly from the start
- The v2 `migration new` implementation, config normalization, and ADR 161 are good reference but straightforward to rewrite

## RD-10: On-disk persistence package location

The on-disk I/O, attestation, and DAG logic live in a new package `packages/1-framework/3-tooling/migration/` (framework domain, tooling layer, migration plane). This is library code reusable by the CLI, CI tooling, PPg bundle building, etc. — not CLI-specific. It imports from `1-core/migration/control-plane/` for abstract ops types and the `EMPTY_CONTRACT_HASH` sentinel.

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

1. **How does the control plane stack expose contract-to-contract planning?**
   The existing `ControlFamilyInstance` has `migrations?: TargetMigrationsCapability` with a planner that takes a live schema IR. We need to add a new capability or method for contract-to-contract planning that the CLI can call through the control plane abstraction.
   **This is an implementation design question to resolve in the plan.**

2. **How does abstract ops IR map back to SQL at apply time?**
   The abstract IR must be rich enough that a target adapter can deterministically generate SQL from it. The op vocabulary needs to be defined. This is closely related to what the existing planner already produces — we're essentially extracting the "what to do" from "how to do it in SQL".
   **This is an implementation design question to resolve in the plan.**

3. **Should `migration plan` produce Draft or Attested artifacts?**
   The v2 branch and ADR 161 position `migration plan` as producing Draft artifacts (`edgeId: null`), with `migration verify` as a separate attestation step. Alternatively, `migration plan` could compute the `edgeId` immediately (Attested state) since the content is known at plan time. The two-step approach (plan → verify) adds ceremony but allows editing before attestation.
   **Default assumption:** `migration plan` produces Attested artifacts (computes `edgeId` immediately). If the user edits the migration, they run `migration verify` to re-attest.
