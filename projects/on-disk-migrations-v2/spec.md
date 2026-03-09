# Summary

Revamp on-disk migration path resolution so revisiting a prior contract hash is treated as a valid graph shape and can collapse to a no-op when start and target are equal. Drop `parentMigrationId` in favor of deterministic shortest-path selection over the contract-hash graph. Add filesystem-backed refs (`migrations/refs.json`) so teams can track environment positions (for example, `staging`, `production`) without requiring a live database marker read for every workflow.

# Description

The current on-disk migration model (ADR 169) introduced `parentMigrationId` to avoid ambiguity when contract hashes are revisited (for example, `C1 -> C2 -> C1`). This makes collaboration and graph interpretation safe, but it also forces migration ordering semantics to depend on an edge-to-edge chain rather than on contract state transitions.

This project removes `parentMigrationId` and implements a model where:

- contract hashes are the sole source of truth for structural state,
- pathfinding chooses a deterministic shortest path from current state to target state,
- all structural paths between the same two contract hashes are treated as semantically equivalent,
- returning to the same contract hash (`start == target`) is explicitly a no-op,
- and divergent branches (multiple developers planning from the same base) are a hard error requiring explicit resolution (rebase).

It also introduces filesystem refs to represent "where an environment is at" in local and CI workflows (for example, `staging`, `production`), enabling environment-aware migration operations without coupling to one global pointer.

**Scope boundary:** This project covers structural migrations only. Data migrations, invariant-aware routing, and postcondition-driven verification are documented as future exploration in `data-migrations.md` and `data-migrations-solutions.md` and are explicitly out of scope for this phase.

**Migration identity consequence:** The current `computeMigrationId` implementation includes `parentMigrationId` in the hash (it is part of `strippedMeta`). Removing `parentMigrationId` from the manifest will change the `migrationId` of every existing migration. Since there are no external users yet, this is acceptable — but the attestation module (`attestation.ts`) must be updated to reflect the new manifest shape.

## Key assumptions and design constraints

**Structural equivalence holds; semantic equivalence does not (yet).** Two paths between the same contract hashes produce the same end-state schema — the contract hash determines the target schema, regardless of path. But different paths may have different operational characteristics (data loss profiles, lock durations, intermediate states) and, once data migrations exist, different paths will produce different *data* states. A path that backfills a column is not interchangeable with one that doesn't, even if both arrive at the same contract hash.

This is a known limitation, not an oversight. The v1 pathfinder is designed with an explicit policy stage (candidate generation → policy-based selection) so that future phases can introduce invariant-aware path selection without rewriting the pathfinding core. In v1, the policy stage applies structural-only selection (shortest path with deterministic tie-break). In a future phase, it can filter or rank candidates based on required data invariants (see `data-migrations.md` and `data-migrations-solutions.md` for exploration).

**Refs are declarative targets:** A ref says "I want this environment to be at contract hash H." Refs are not mutated by migration commands — they are set by the developer or CI to declare intent, and consumed as read-only inputs by `migration apply` and `migration status`. The database marker and ledger remain the record of what actually happened. If the DB marker is already ahead of or inconsistent with the ref target, that is a standard marker-mismatch error (same as any other case where the database has drifted relative to expectations). In a future phase, refs may also declare required data invariants alongside the target hash (see `data-migrations.md` §5), but for v1 they carry only a contract hash.

**`contract.json` is only used for planning; migration edges are self-contained.** The repo contains a single `contract.json` reflecting the current schema state. This file is used in exactly two places: (1) `migration plan` reads it to diff against the previous contract and generate operations, and (2) `migration apply` without `--ref` reads its `storageHash` to determine the default target. All other operations — applying via refs, status checks, pathfinding — work entirely from the migration graph on disk.

Each migration edge directory embeds the full contract IR in `migration.json` as `fromContract` and `toContract` (per ADR 169). This makes edges self-contained: the contract state at any hash in the graph can be recovered by reading the relevant migration directory, without needing a separate contract file per environment or per ref.

This has concrete implications for multi-environment and branching workflows:

- **Multi-environment:** Staging may be at `C3` while production is at `C1`. The repo's `contract.json` reflects `C3` (the latest schema). `migration apply --ref production` targets `C1` and applies edges using their embedded operations — it never reads `contract.json`. The contract content at `C1` is preserved in the migration edge that produced it.
- **Branching:** If Alice commits edge `C1 -> C2` and Bob commits edge `C1 -> C3`, both edges embed their respective `toContract`. After merge, `contract.json` reflects whichever branch won the merge, but the other branch's contract state is preserved in its migration directory and remains routable via refs.
- **Planning constraint:** `migration plan` always diffs the *current* `contract.json` against the previous state. You cannot plan a new migration from an arbitrary historical contract hash without first checking out or emitting that contract. This is the normal git workflow — planning happens on a branch where `contract.json` reflects the desired base state.

# Requirements

## Functional Requirements

### FR-1: Shortest-path migration selection

The migration engine computes a deterministic shortest path (minimal hop count) from a start contract hash to a target contract hash using on-disk edges.

- If multiple shortest paths exist, tie-breaking is deterministic using the sort key tuple from ADR 039: label priority, `createdAt` ascending, `to` lexicographic, `edgeId` lexicographic.
- Pathfinding must terminate for cyclic graphs and never loop indefinitely.
- The pathfinder produces a path-decision object containing: policy ID, selected path, alternative count, and tie-break/rejection reasons. This internal structure supports future extension to invariant-aware routing without changing the user-facing API.

### FR-2: Explicit no-op semantics for same-state transitions

When start hash equals target hash, planning and apply flows return an explicit no-op result.

- No migrations are executed.
- Output explains why execution was skipped.
- Status surfaces that the environment is already at target.

No-op is defined in terms of structural contract state (contract hash equality). Data-level equivalence is out of scope for this phase.

### FR-3: Cycle-tolerant graph model without parent pointers

The system accepts migration graphs that revisit prior contract hashes (for example, rollback-like paths) without requiring parent-edge disambiguation.

- `parentMigrationId` is removed from the migration model. Ordering is determined entirely by graph topology (contract-hash nodes and edges).
- Cycles are allowed as graph structure but must not break deterministic path resolution.
- Edges with `from == to` remain invalid migration edges.

### FR-4: Branch detection and divergence resolution

When the graph contains divergent branches (multiple outgoing edges from a node leading to distinct, unapplied leaf nodes reachable from the current marker), the system treats this as a hard error.

- **Branch definition:** From the current marker hash, the set of reachable leaf nodes (nodes with no further outgoing edges on any unapplied path) contains more than one node, and no explicit target has been specified.
- **Divergence is a hard error** with actionable diagnostics: the error identifies the divergent branches, the common ancestor, and the leaf nodes.
- **Remediation:** The recommended resolution is rebase — replanning one branch's changes on top of the other's target. For example, if Alice committed `C1->C2` and Bob committed `C1->C3`, Bob replans his changes from `C2` to produce `C2->C3'`, then deletes or archives `C1->C3`.
- **Historical forks are inert:** Edges that were already applied (their `from` hash is behind the current marker) do not trigger divergence errors. Only unapplied forward paths from the current position matter.
- A `migration rebase` command is future scope. For v1, rebase is manual: delete the stale edge, replan from the new base.

Note on collaboration workflows: divergence typically surfaces when work from different branches is merged. Within a single branch, the developer has a linear history. Refs (FR-5) allow different environments to target different contract hashes, so `staging` advancing to `C2` while `production` stays at `C1` is not divergence — it is expected.

### FR-5: Filesystem refs for environment positions

Refs map a logical environment name to a contract hash, stored in `migrations/refs.json`.

- Format: `{ "head": "<hash>", "staging": "<hash>", "production": "<hash>" }`
- Ref names are bare keys (no `ref:` prefix). Names must pass strict validation: alphanumeric, hyphens, forward slashes, no path traversal sequences.
- The file is version-controlled alongside migration artifacts.
- Ref reads are a JSON parse. Ref writes are atomic (write-tmp + rename).

### FR-6: Ref-aware migration commands

Migration commands support selecting a target via refs.

- `migration status` can report state relative to a ref (e.g., "staging is 2 edges behind its ref target").
- `migration apply` can use a ref as the desired target hash.
- Refs are not mutated by migration commands. Refs are updated by the developer (or CI) to declare intent; migration commands consume them as read-only inputs.
- CLI diagnostics clearly show source of truth used (DB marker, explicit hash, ref).

### FR-7: Machine-readable outputs

`--json` outputs for migration commands include enough metadata for agents and CI to reason about:

- chosen path (edge IDs and contract hashes),
- path-decision metadata (alternative count, tie-break reasons),
- no-op reason when applicable,
- ref reads/writes,
- and divergence/branch diagnostics when errors occur.

## Non-Functional Requirements

- **Determinism:** Same migration files + same start/target inputs always produce the same selected path. Guaranteed by the deterministic tie-break sort key.
- **Performance:** Path selection completes in linear graph time (`O(V+E)`). With squash-first hygiene (ADR 102), practical graph sizes are in the dozens of active edges, making this trivial.
- **Reliability:** Ref writes are atomic (write-tmp + rename); interrupted writes do not produce partial/corrupt ref state. Migration apply continues to use transactional per-edge execution so the database is never left in a partially-migrated state.
- **DX:** Diagnostics use stable error categories/codes and include clear remediation guidance.
- **Auditability:** Path choice and ref mutations are visible in logs and JSON output.

## Non-goals

- Building a visual migration graph UI.
- Weighted path optimization beyond shortest-hop semantics (e.g., least-risk, data-migration-aware).
- Replacing database marker verification as an execution safety control.
- Automatic conflict auto-merge for divergent migration histories (manual rebase for v1).
- Redesigning migration operation vocabulary (`ops.json`) in this project.
- Data migrations, invariant-aware routing, or postcondition-driven verification (see `data-migrations.md` for future exploration).
- Backward compatibility with `parentMigrationId`-based migration directories (no external users exist yet).

# Scenarios

These scenarios document expected behavior under the decisions made in this spec. Scenarios that expose limitations of the structural-only model are included deliberately — they motivate the invariant-aware routing design in future phases.

## S-1: Linear happy path

Graph: `C1 -> C2 -> C3`. Production ref targets `C3`. DB marker at `C1`.

**Behavior:** Pathfinder selects `C1 -> C2 -> C3` (only path). Apply executes both edges in order. No ambiguity.

## S-2: Staging rollback cycle, then different changes to production

Timeline:
1. Start at `C1`. Deploy to staging: `C1 -> C2`. Staging marker at `C2`.
2. Realize `C2` is wrong. Roll back staging: `C2 -> C1`. Staging marker back at `C1`.
3. Make different changes: `C1 -> C3`. Deploy to staging and then production.

Graph: `C1 -> C2`, `C2 -> C1`, `C1 -> C3`.

**Behavior (structural):** Production at `C1` targeting `C3`. Pathfinder sees two paths:
- `C1 -> C3` (1 hop)
- `C1 -> C2 -> C1 -> C3` (3 hops)

Shortest path selects `C1 -> C3`. The staging detour is never traversed by production. Correct for structural state.

**Limitation (data):** If `C1 -> C2` included a data backfill and `C2 -> C1` included a data revert, production never runs either. If `C3` assumes some data state established by the backfill, production is structurally correct but data-incorrect. This is exactly the case where invariant-aware routing would select the path that satisfies the required data invariants — and the reason the pathfinder has a policy stage that can be extended to handle this in a future phase.

## S-3: Converging paths with different data consequences

Graph: `C1 -> C2 -> C3` and `C1 -> C3`.
- `C1 -> C2` adds column `phone` (nullable).
- `C2 -> C3` adds column `email` (nullable) and backfills `phone` from an external source.
- `C1 -> C3` adds both columns in one step (no backfill).

**Behavior (structural):** Production at `C1` targeting `C3`. Shortest path selects `C1 -> C3` (1 hop), skipping the backfill. Structurally equivalent — both paths arrive at a schema with `phone` and `email` columns.

**Limitation (data):** The `phone` column is empty via the short path. If a data invariant requires "all phone numbers populated," the short path violates it. In a future phase, the policy stage would reject `C1 -> C3` and select `C1 -> C2 -> C3` because only that path provides an invariant-satisfying data migration.

## S-4: Same-base divergence (two developers)

Alice commits `C1 -> C2`. Bob commits `C1 -> C3`. Both merged to main.

Graph: `C1 -> C2`, `C1 -> C3`.

**Behavior:** DB marker at `C1`, no explicit target specified. Pathfinder detects two unapplied paths to distinct leaves (`C2` and `C3`). This is a hard error with diagnostics: "Divergent branches from C1: C1->C2 and C1->C3. Resolve by rebasing one branch onto the other's target."

If an explicit target is specified (e.g., `--ref production` pointing to `C3`), the pathfinder selects `C1 -> C3`. The `C1 -> C2` edge is not on any path to `C3` and is inert.

## S-5: Staging ahead of production (normal environment lag)

Staging ref targets `C3`. Production ref targets `C2`. Graph: `C1 -> C2 -> C3`.

**Behavior:** This is not divergence — it is expected environment lag. `migration apply --ref production` targets `C2`. `migration apply --ref staging` targets `C3`. Each environment routes independently from its DB marker to its ref target. No conflict.

## S-6: DB marker ahead of ref target

Production ref targets `C2`. DB marker is at `C3` (someone applied `C2 -> C3` out of band or the ref wasn't updated).

**Behavior:** Standard marker-mismatch error. The system cannot route from `C3` to `C2` unless a `C3 -> C2` edge exists. If it does, it would be applied (it's a valid edge). If it doesn't, the error tells the user the DB is ahead of the ref and the ref should be updated.

# Acceptance Criteria

- [ ] AC-1: For graphs with cycles, path resolution returns a deterministic shortest path and never loops.
- [ ] AC-2: For `start == target`, `migration plan` and `migration apply` both return explicit no-op results with clear messaging and JSON flags.
- [ ] AC-3: Revisited-hash scenarios (for example, `C1 -> C2 -> C1 -> C3`) execute correctly using graph topology alone, without `parentMigrationId`.
- [ ] AC-4: Divergent branches from the current marker (multiple unapplied paths to distinct leaves) produce a hard error with diagnostics identifying the branches, common ancestor, and remediation steps.
- [ ] AC-5: `migrations/refs.json` supports create, read, update, and delete of named refs pointing to contract hashes, with input validation and atomic writes.
- [ ] AC-6: `migration status` and `migration apply` can consume refs and produce consistent human/JSON output including ref provenance.
- [ ] AC-7: Deterministic tie-break strategy (label priority → `createdAt` → `to` → `edgeId`) is documented and covered by tests.
- [ ] AC-8: CI-oriented JSON output includes path-decision metadata (selected path, alternative count, tie-break reasons), no-op/skipped details, and ref read/write events.

# Other Considerations

## Security

Refs are local filesystem state and must be treated as untrusted input when read. Ref names require strict validation (path traversal prevention, reserved-name handling), and ref values must be valid contract hashes. `refs.json` stores only non-secret identifiers (hashes), not credentials.

## Cost

Operating cost impact is low. Main cost is engineering time for model transition and test fixtures for collaboration/cycle scenarios.

## Observability

Emit structured events for:

- path computation inputs and chosen path,
- tie-break decisions (including alternative count),
- no-op outcomes,
- ref read/write operations,
- and divergence/branch error details.

## Data Protection

No direct personal-data model change is expected. Ensure logs/events do not capture sensitive connection strings when ref-aware commands include DB context.

## Analytics

Track adoption and friction:

- count of no-op applies,
- count of multi-path tie-breaks,
- count of divergence/branch errors,
- and ref usage by command (status/plan/apply).

# Offline planning: contractToSchemaIR and declarative dependencies

During implementation, incremental migrations were incorrectly re-emitting operations for database extensions (`CREATE EXTENSION vector`), storage types (`CREATE TYPE user_type`), and FK-backing indexes that already existed in the previous contract. The planner itself was correct — it faithfully diffed the "from" and "to" states it was given. The bug was in `contractToSchemaIR`: it only received `SqlStorage` (tables), not the full contract, so the "from" schema IR it produced was incomplete — missing extensions, types, and FK-backed indexes. The planner correctly concluded these were new additions because they were absent from the "from" state.

## Design decision

`contractToSchemaIR` now accepts the full `SqlContract` (not just `SqlStorage`) and an options object:

```typescript
contractToSchemaIR(
  contract: SqlContract<SqlStorage> | null,
  options?: { expandNativeType?: NativeTypeExpander; frameworkComponents?: readonly unknown[] }
): SqlSchemaIR
```

The function derives schema IR fields from three sources:

1. **Tables** — from `contract.storage.tables`, same as before. Codec metadata (`codecId`, `typeRef`) is dropped; the planner only needs structural information. FK-backing indexes (from `foreignKeys` with `index: true`) are now derived into `SqlSchemaIR.indexes`.
2. **Dependencies** — from `frameworkComponents`. Each component that declares `databaseDependencies.init[]` contributes its dependency ID (e.g., `'postgres.extension.vector'`) to `SqlSchemaIR.dependencies`. This follows ADR 154: dependencies are component-owned declarations, not inferred from `contract.extensionPacks`.
3. **Type annotations** — from `contract.storage.types`. Storage types (e.g., enums) are placed into `SqlSchemaIR.annotations.pg.storageTypes` so the planner can diff them against the "to" contract and skip operations for types that already exist.

## Generic DependencyIR model

`SqlSchemaIR` uses a target-agnostic `dependencies: readonly DependencyIR[]` field instead of the earlier Postgres-specific `extensions: readonly string[]`. Each `DependencyIR` carries only an `id: string` — the same ID declared on `ComponentDatabaseDependency`:

```typescript
interface ComponentDatabaseDependency<TTargetDetails> {
  readonly id: string;
  readonly label: string;
  readonly install: readonly SqlMigrationPlanOperation<TTargetDetails>[];
}
```

The planner checks `schemaIR.dependencies` for each component dependency's `id` — if present, the dependency is already installed and install ops are skipped. Verification uses the same structural ID check, replacing the earlier per-component `verifyDatabaseDependencyInstalled` callback.

Introspection maps database objects to dependency IDs. For Postgres, `pg_extension` rows use the convention `postgres.extension.<extname>` (e.g., `{ id: 'postgres.extension.vector' }`). The adapter owns this convention; extension components must follow it.

See `projects/on-disk-migrations-v2/specs/declarative-database-dependencies.spec.md` for the full design rationale and solutions considered.

## Typing at the interface boundary

`TargetMigrationsCapability.contractToSchema` accepts `ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>`, not `readonly unknown[]`. This type is already available in the core control-plane layer and is the same type the planner and runner use. The inner `ContractToSchemaIROptions.frameworkComponents` in the family layer uses `readonly unknown[]` and narrows structurally via `DatabaseDependencyProvider` — this is an implementation detail behind the typed public interface.

## References

- ADR 154 — Component-owned database dependencies
- ADR 005 — Thin Core, Fat Targets
- Migration System subsystem doc (§ Offline planning via contract-to-schemaIR)

# References

- `projects/on-disk-migrations-v2/discussion-synthesis.md`
- `projects/on-disk-migrations-v2/data-migrations.md` (future exploration, not v1 scope)
- `projects/on-disk-migrations-v2/data-migrations-solutions.md` (future exploration, not v1 scope)
- `docs/architecture docs/subsystems/7. Migration System.md`
- `docs/architecture docs/adrs/ADR 001 - Migrations as Edges.md`
- `docs/architecture docs/adrs/ADR 039 - DAG path resolution & integrity.md`
- `docs/architecture docs/adrs/ADR 169 - On-disk migration persistence.md`

# Open Questions

No blocking open questions remain. The following are deferred to future scope:

- **Rebase tooling:** Manual rebase (delete stale edge, replan from new base) is sufficient for v1. A `migration rebase` command may be added in a future project.
