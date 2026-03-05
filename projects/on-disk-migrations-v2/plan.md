# On-disk Migrations V2 Plan

## Summary

Drop `parentMigrationId` and replace parent-pointer ordering with deterministic shortest-path resolution over the contract-hash graph. Add `migrations/refs.json` as declarative environment targets consumed by migration commands. Define divergent branches as a hard error with manual rebase as remediation. Success means cycle-tolerant pathfinding, explicit no-op semantics, ref-aware CLI flows, and a pathfinder architecture with a policy stage extensible to future invariant-aware routing.

**Spec:** `projects/on-disk-migrations-v2/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Feature owner (current branch owner) | Drives implementation and test coverage |
| Reviewer | Migration subsystem maintainer | Reviews graph semantics, divergence handling, and pathfinder architecture |
| Collaborator | CLI maintainers | Aligns CLI flags, JSON output schema, and ref UX |

## Milestones

### Milestone 1: Pathfinder engine (shortest-path, no-op, cycle tolerance, divergence detection)

Deliver the core pathfinder with two-stage architecture (candidate generation → policy-based selection), remove `parentMigrationId` from the migration model, and implement divergence detection. This milestone produces the foundational engine that all subsequent work depends on.

**Tasks:**

- [ ] Remove `parentMigrationId` from `MigrationManifest` type, `migration.json` schema, graph loader, and `computeMigrationId` in the attestation module. Update all fixture migrations.
- [ ] Implement BFS-based candidate path generation over the contract-hash graph with visited-node tracking (cycle tolerance).
- [ ] Implement structural-only policy stage: select shortest path with deterministic tie-break (label priority → `createdAt` → `to` → `edgeId`). Return a path-decision object containing `policyId`, `selectedPath`, `alternativeCount`, and `tieBreakReasons`.
- [ ] Implement explicit no-op detection: when start hash equals target hash, return a no-op result with reason before pathfinding runs.
- [ ] Implement divergence detection: from the current marker, compute the set of reachable leaf nodes on unapplied paths. If multiple distinct leaves exist and no explicit target is specified, produce a hard error with diagnostics (branches, common ancestor, leaf nodes, remediation guidance).
- [ ] Replace `findLeaf` (parent-pointer chain walk) with graph-topology leaf detection (nodes with no outgoing unapplied edges reachable from marker).
- [ ] Write unit tests: shortest-path over linear, branching, and cyclic graph fixtures.
- [ ] Write unit tests: deterministic tie-break produces stable results under equal-hop alternatives.
- [ ] Write unit tests: no-op result for `start == target` with correct messaging.
- [ ] Write unit tests: divergence detection fires for multi-leaf graphs, does not fire when explicit target is provided, does not fire for historical (already-applied) forks.
- [ ] Write unit tests: revisited-hash scenario `C1 -> C2 -> C1 -> C3` resolves correctly.

### Milestone 2: Refs and ref-aware CLI

Implement `migrations/refs.json` and integrate refs into migration commands as read-only declarative targets.

**Tasks:**

- [ ] Define ref entry type shape. For v1, each ref value is a contract hash string. The `refs.json` format is `{ "<name>": "<hash>" }`.
- [ ] Implement ref storage module: read/write `migrations/refs.json` with atomic writes (write-tmp + rename). Handle missing file (no refs defined) and malformed JSON (clear error).
- [ ] Implement ref name validation: alphanumeric, hyphens, forward slashes allowed; reject path traversal sequences, empty names, reserved names.
- [ ] Add `--ref <name>` flag to `migration apply`: resolve ref to target hash, pass to pathfinder. Refs are read-only — apply does not mutate `refs.json`.
- [ ] Add `--ref <name>` flag to `migration status`: report current marker state relative to ref target (e.g., "3 edges behind", "at target", "ahead of target").
- [ ] Add CLI subcommands or guidance for ref management (create/update/delete refs in `refs.json`). These are explicit developer actions, not side effects of migration commands.
- [ ] Write unit tests: ref name validation (valid names, traversal attempts, empty, reserved).
- [ ] Write unit tests: ref CRUD operations and atomic write guarantees (interrupted write does not corrupt file).
- [ ] Write integration tests: `migration apply --ref staging` resolves ref, applies path, does not mutate ref. Marker-mismatch when DB is ahead of ref target produces standard error.
- [ ] Write integration tests: `migration status --ref production` reports correct distance and direction.

### Milestone 3: Command integration, JSON output, and end-to-end scenarios

Wire the pathfinder and refs into `migration plan`, `migration apply`, and `migration status` commands. Deliver machine-readable JSON output. Validate end-to-end scenarios from the spec.

**Tasks:**

- [ ] Update `migration plan` to use the new pathfinder and emit path-decision metadata in both human-readable and `--json` output.
- [ ] Update `migration apply` to use the new pathfinder, consume refs, and emit path-decision metadata. Ensure divergence errors surface before any edges are applied.
- [ ] Update `migration status` to use the new pathfinder and refs. Report: current marker hash, target hash (from ref or explicit), chosen route, distance, and no-op/divergence status.
- [ ] Define and implement `--json` output schema for migration commands: path-decision object (selected path, alternative count, tie-break reasons), no-op details, ref provenance (which ref, resolved hash), divergence diagnostics.
- [ ] Write snapshot tests for `--json` output shape stability across migration commands.
- [ ] Write E2E test: S-1 (linear happy path) — `C1 -> C2 -> C3`, apply from `C1` to ref targeting `C3`.
- [ ] Write E2E test: S-2 (staging rollback cycle) — graph `C1 -> C2`, `C2 -> C1`, `C1 -> C3`. Apply from `C1` targeting `C3` selects direct path, skips detour.
- [ ] Write E2E test: S-3 (converging paths) — `C1 -> C2 -> C3` and `C1 -> C3`. Apply from `C1` targeting `C3` selects shortest path.
- [ ] Write E2E test: S-4 (same-base divergence) — `C1 -> C2` and `C1 -> C3`. No target specified: hard error. With `--ref` targeting `C3`: succeeds.
- [ ] Write E2E test: S-5 (staging ahead of production) — independent applies against different refs produce correct independent results.
- [ ] Write E2E test: S-6 (DB marker ahead of ref) — marker at `C3`, ref targets `C2`, no `C3 -> C2` edge: error.

### Milestone 4: Close-out

Finalize documentation, verify acceptance criteria, and remove transient project artifacts.

**Tasks:**

- [ ] Verify all acceptance criteria (AC-1 through AC-8) are met with linked tests or manual verification.
- [ ] Update `docs/architecture docs/subsystems/7. Migration System.md`: remove parent-pointer chain references, add graph-topology ordering, divergence semantics, and refs documentation.
- [ ] Update or supersede ADR 169 to document the removal of `parentMigrationId` and the shift to graph-topology ordering with refs.
- [ ] Update ADR 039 to reflect cycle tolerance (graph is no longer required to be a DAG) and updated divergence semantics.
- [ ] Migrate any long-lived design content from project docs into `docs/` if warranted.
- [ ] Strip repo-wide references to `projects/on-disk-migrations-v2/**` (replace with canonical `docs/` links or remove).
- [ ] Delete `projects/on-disk-migrations-v2/` in the final close-out PR.

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| AC-1: Cycle-safe deterministic shortest path | Unit | M1 | Cyclic graph fixtures, loop-prevention assertions, visited-node tracking |
| AC-2: Explicit no-op on `start == target` | Unit + E2E | M1 + M3 | No-op result with reason, human + JSON output parity |
| AC-3: Revisited-hash flows without `parentMigrationId` | Unit + E2E | M1 + M3 | `C1 -> C2 -> C1 -> C3` scenario (S-2) |
| AC-4: Divergent branches = hard error | Unit + E2E | M1 + M3 | Multi-leaf detection, diagnostics content, S-4 scenario |
| AC-5: Refs CRUD + atomic writes | Unit + Integration | M2 | Name validation, interrupted-write safety, missing file handling |
| AC-6: Status/apply consume refs | Integration + E2E | M2 + M3 | Provenance in output, marker-mismatch error, S-5/S-6 scenarios |
| AC-7: Deterministic tie-break documented and tested | Unit | M1 | Stable ordering under equal-hop alternatives |
| AC-8: JSON output includes path-decision metadata | Snapshot + E2E | M3 | Stable keys/shape, alternative count, tie-break reasons |

## Open Items

- **Rebase tooling:** Manual rebase (delete stale edge, replan from new base) is sufficient for this project. A `migration rebase` command may be added in a future project.
- **Invariant placeholders:** The pathfinder's policy stage and ref format are designed to be extensible to invariant-aware routing. Whether to carry empty `invariants: []` fields in v1 artifacts is a future-phase decision that does not block this project.
