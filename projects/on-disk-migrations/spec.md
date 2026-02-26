# Summary

Implement on-disk migration persistence for prisma-next: the ability to plan contract-to-contract diffs and write them as migration edge packages (`migration.json` + `ops.json`) to a `migrations/` directory on disk, and apply them. This covers `migration plan`, `migration apply`, `migration verify`, `migration new`, and supporting infrastructure (DAG reconstruction, edge attestation, on-disk types). `db update` is explicitly out of scope.

# Description

prisma-next currently supports `db init` (bootstrap a fresh DB from a contract) and `db sign` (write a contract marker), but has no way to persist migration edges to disk. The architecture (ADR 001, ADR 028, Subsystem 7) specifies a rich on-disk format where migrations are directed edges in a DAG, each carrying `fromContract`/`toContract`, operations, pre/post checks, and a content-addressed `edgeId`.

The existing Postgres planner diffs a contract against a **live schema IR** (introspection-based), which is how `db init` currently works. On-disk migrations are different: the user edits their schema, emits a new contract, and plans a migration *before* the database reflects those changes. This requires a **contract-to-contract diff planner** that compares two contract JSON structures and produces operations without needing a live database. Long-term, the introspection-based path should converge to use the same diff engine: introspect → convert to contract → diff two contracts via `planContractDiff`. This project builds the contract-to-contract engine; converging the introspection path is future work (see RD-3).

Two user flows are in scope:

1. **New project**: Write contract → emit → `migration plan` → `migration apply`
2. **Existing database, no prisma-next contract**: Write contract → `db sign`/`db init` → `migration plan` → `migration apply`

`migration apply` is in scope in a limited sense: we want to be able to actually apply migrations, but not a full production-ready apply flow (no dry-run, no rollback, no multi-step orchestration). See FR-10.

# Requirements

## Functional Requirements

### FR-1: Contract-to-contract diff planner
- Given two canonical contract JSON objects (from-contract and to-contract), produce a migration plan with SQL operations for the target, pre/post checks, and metadata
- Produces correct additive SQL for MVP (create table, add column, add index, add FK, add unique, add PK, set default, enable extension, create storage type)
- Lowers directly to target SQL — no abstract intermediate representation (see RD-6)
- Must be deterministic: same inputs always produce the same plan
- This is intended to become the single diff engine for all migration planning (see RD-3)
- Diffing happens at the `SqlStorage` (contract) level, not at `SqlSchemaIR` level — see RD-5 for rationale

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
- Diff the two contracts using the contract-to-contract planner
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

### FR-10: `prisma-next migration apply` CLI command (limited)
- Read on-disk migration packages from the migrations directory
- Execute the SQL operations against the database
- Update the migration ledger / marker
- Limited scope: no dry-run, no rollback, no partial apply, no apply-to-specific-hash. Simple sequential execution of pending migrations.
- Requires a database connection

## Non-Functional Requirements

### NFR-1: Determinism
- All planner outputs and edge hashes must be fully deterministic given the same inputs
- Canonicalization per ADR 010 must be applied before any hashing

### NFR-2: Layering compliance
- New code must respect the package layering rules (`pnpm lint:deps` must pass)
- Structural diffing logic (what changed between two contracts) lives at the SQL family level; SQL generation is target-specific

### NFR-3: Test coverage
- Contract-to-contract planner must have comprehensive coverage of additive operations
- On-disk format round-trip tests (write then read back)
- DAG reconstruction tests (path finding, cycle detection, orphan detection)
- CLI integration tests for new commands

### NFR-4: Compatibility with existing system
- `db init` must continue to work unchanged
- Existing Postgres planner and runner are not broken

## Non-goals

- **`db update`**: Applying additive changes to a live DB and updating the marker without writing migration files. Deferred to a later project.
- **Production-ready apply**: Dry-run, rollback, multi-step orchestration, partial apply, apply-to-specific-hash. The MVP `migration apply` is a simple "read SQL from disk, execute" path.
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
- [ ] Contract-to-contract planner produces correct additive operations (create table, add column, add index, add FK, add unique, add PK, set default) for schema diffs
- [ ] Planner output is deterministic: running twice with the same inputs produces byte-identical `ops.json`
- [ ] Planner correctly handles the "from empty contract" case (new project)
- [ ] Planner correctly handles extension-owned operations (e.g., pgvector column/index creation)

## On-disk format
- [ ] TypeScript types for `migration.json`, `ops.json`, are defined and exported
- [ ] `migration.json` and `ops.json` can be written to and read from disk with full fidelity (round-trip)
- [ ] `edgeId` is correctly computed via content-addressed hashing per ADR 028

## CLI commands
- [ ] `prisma-next migration plan` writes a valid migration package to `migrations/` with correct `migration.json` and `ops.json`
- [ ] `prisma-next migration plan` fails clearly when no changes are detected between contracts
- [ ] `prisma-next migration new` scaffolds an empty migration package in Draft state
- [ ] `prisma-next migration verify` recomputes and validates `edgeId` for an existing migration package
- [ ] `prisma-next migration apply` reads on-disk migrations and executes SQL against a live database
- [ ] `prisma-next migration apply` updates the migration ledger after successful execution

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
- If no migrations exist, assume the empty contract (`sha256:empty`) as the starting point (new project).
- If migrations exist, find the DAG leaf: the node reachable from `sha256:empty` that has no outgoing edges. In a linear history (the common case) the leaf is unambiguous.
- If the DAG has multiple leaves (branching history — e.g., two developers planned migrations from the same starting point), `findLeaf` fails with a diagnostic listing the ambiguous leaves. The user must pass `--from <hash>` to disambiguate.
- `--from <hash>` always takes precedence when provided — the planner looks up the matching migration's `toContract` for the "from" side.

We resolve by DAG topology, not by timestamp. Timestamps are metadata for human readability (directory naming) but are not authoritative for ordering — the DAG edges (`from`/`to` hashes) are.

## RD-3: `migration plan` vs `db update` are distinct commands; one diff engine

- `migration plan`: offline, contract-to-contract, writes to disk. No DB.
- `db update`: online, reads DB marker contract + introspects DB, applies immediately, no disk artifacts.
- Both commands should ultimately use the same diff engine: `planContractDiff`. The introspection-based path (`db init`, `db update`) currently diffs a `SqlSchemaIR` against a contract using a separate planner. The convergence path is: introspect → convert to contract IR → feed both contracts into `planContractDiff`. This avoids maintaining two diff engines that must produce identical output for identical inputs.
- **This convergence is out of scope for this project** but is the intended architecture. For now, the introspection-based planner remains as-is and `planContractDiff` is the new engine for `migration plan`.

## RD-4: Timestamp format

Use `YYYYMMDDThhmm_{slug}` format per ADR 028 and the v2 branch convention.

## RD-5: Diffing at the contract level, not at SqlSchemaIR

**Decision:** The planner diffs two `SqlStorage` objects (from `ContractIR.storage`), not `SqlSchemaIR`. The planner then lowers the diff directly to target SQL (see RD-6).

**Why not convert contract → SqlSchemaIR and diff there?**

1. **SqlSchemaIR is an introspection artifact, not a planning intermediate.** It represents what the DB *currently looks like* — raw default expressions, no codec IDs, no `typeRef` to custom storage types. Converting `SqlStorage` to `SqlSchemaIR` is lossy: structured `ColumnDefault` flattens to a raw string, foreign key shapes differ, and synthetic fields would be needed for annotations/extensions. Going the other way (SqlSchemaIR → contract) is the convergence path (RD-3).

2. **Structural diffing is target-agnostic.** The question "what tables/columns/constraints were added or removed" is the same regardless of target. Two `SqlStorage` objects describe "what exists" and "what should exist" — the diff is purely structural.

3. **Sets up convergence.** The intended architecture (RD-3) is that the introspection-based path eventually converts introspected state *into* a contract and feeds it through the same `planContractDiff`. Going via SqlSchemaIR as the diff intermediate would reverse this direction.

## RD-6: Direct SQL on disk (not abstract operation IR)

On-disk `ops.json` contains SQL operations lowered for the specific target (e.g., Postgres DDL statements). The planner diffs two contracts and produces SQL directly — there is no intermediate abstract operation IR that needs a separate resolver at apply time.

**Rationale:** Migrations are written for a specific database. If you change targets, you'd start fresh rather than replay thousands of migrations. An abstract IR adds indirection without practical benefit: you'd need to build and maintain a resolver (abstract ops → SQL) that must perfectly reproduce the SQL the planner would have generated directly. Lowering to SQL at plan time is simpler, more honest about the target-bound nature of migrations, and makes `migration apply` straightforward — it just executes the SQL that's already on disk.

The planner still performs structural diffing at the `SqlStorage` level (RD-5), which is target-agnostic. Target-specific behavior enters at SQL generation time within the planner, not as a separate resolution step.

## RD-7: Package layering

Validated against `architecture.config.json`:

- **On-disk format types + DAG logic**: `packages/1-framework/3-tooling/` — framework domain, tooling layer, migration plane. Target-agnostic.
- **Contract-to-contract SQL diff planner**: `packages/2-sql/3-tooling/family/` — sql domain, tooling layer. Diffs `SqlStorage` objects and produces SQL operations. May import from framework domain.
- **CLI commands**: `packages/1-framework/3-tooling/cli/` — calls through the control plane stack abstraction. Does not import from sql/targets domains directly.

The CLI → control plane → sql family → postgres target delegation chain already exists for `db init`. The same pattern applies for `migration plan`.

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

1. **How does the control plane stack expose contract-to-contract planning?**
   Resolved: `TargetMigrationsCapability` gained an optional `planContractDiff` method. The Postgres target implements it by extracting `SqlStorage` from `ContractIR` and delegating to the sql family's `planContractDiff`. `ControlClient` exposes `contractDiff()` which delegates through this chain. The CLI calls `client.contractDiff()` — no layering violations.

2. **Should `migration plan` produce Draft or Attested artifacts?**
   Resolved: `migration plan` produces **Attested** artifacts (`edgeId` computed immediately). If the user edits the migration afterward, they run `migration verify` to re-attest. See RD-15 for the distinction between attestation and signing.

3. **Abstract operations: target-agnostic IR vs direct SQL lowering?**
   Resolved: lower directly to target SQL. Migrations are written for a specific database — if you change targets, you'd start fresh rather than replay thousands of migrations. An abstract IR adds indirection (a resolver layer) without practical benefit. Lowering to SQL at plan time is simpler, makes `migration apply` trivial (just execute the SQL on disk), and is more honest about the target-bound nature of migrations. See RD-6.
