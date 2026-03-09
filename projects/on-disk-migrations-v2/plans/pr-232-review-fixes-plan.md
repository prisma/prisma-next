# PR-232 Review Fixes Plan

## Summary

Fix three correctness issues identified in the PR-232 code and system design reviews. F01: decouple `migration status` from mandatory global leaf resolution when an explicit `--ref` target is provided. F02: make `findLeaf` (and by extension `migration plan`) fail explicitly on cycle-without-exit graphs instead of silently collapsing to the empty baseline. F03: validate that ref values are well-formed contract hashes on read and write. Success means divergent graphs with explicit targets work correctly, rollback cycles don't produce dangerous greenfield plans, and invalid ref values are rejected before they reach the migration graph.

**Spec:** `projects/on-disk-migrations-v2/spec.md`
**Review source:** `projects/on-disk-migrations-v2/reviews/pr-232/code-review.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Feature owner (current branch owner) | Implements fixes and test coverage |
| Reviewer | PR-232 reviewers | Validates fixes match review feedback |

## Milestones

### Milestone 1: F02 — Explicit error on cycle-without-exit graphs

`findLeaf` and `migration plan` must not silently fall back to `EMPTY_CONTRACT_HASH` when the graph has no reachable leaf nodes (all reachable nodes have outgoing edges due to cycles). This is the highest priority fix because it can produce incorrect migration plans that replay the entire schema history.

**Current behavior:**
- `findReachableLeaves` returns an empty array when every reachable node has outgoing edges (e.g., after a rollback cycle C1→C2→C1).
- `findLeaf` maps empty leaves to `EMPTY_CONTRACT_HASH`.
- `findLatestMigration` returns `null`.
- `migration plan` defaults to `fromHash = EMPTY_CONTRACT_HASH`, `fromContract = null`, producing a full greenfield plan instead of an incremental one.

**Target behavior:**
- `findLeaf` throws a distinct `MigrationToolsError` (`MIGRATION.NO_RESOLVABLE_LEAF`) when the reachable graph has nodes but no leaf, with a message directing the user to use `--from` to specify the planning origin.
- `migration plan` surfaces this error with clear remediation guidance.

**Tasks:**

- [x] Add a new error code `MIGRATION.NO_RESOLVABLE_LEAF` in `packages/1-framework/3-tooling/migration/src/errors.ts` with a helper function `errorNoResolvableLeaf(reachableNodes: readonly string[])`.
- [x] Update `findLeaf` in `packages/1-framework/3-tooling/migration/src/dag.ts`: when `findReachableLeaves` returns an empty array but reachable non-EMPTY nodes exist, throw `errorNoResolvableLeaf` instead of returning `EMPTY_CONTRACT_HASH`.
- [x] Verified `migration plan` propagates the error cleanly through the existing `catch` block for `MigrationToolsError`.
- [x] Updated unit test in `dag.test.ts`: cycle-without-exit (EMPTY→C1→C2→C1) now expects `MIGRATION.NO_RESOLVABLE_LEAF` instead of returning EMPTY.
- [x] Existing unit test: cycle-with-exit (C1→C3 exit) still works correctly, returning C3 as the leaf.

### Milestone 2: F01 — Decouple status/apply from global leaf resolution when explicit target is provided

`migration status` must not call `findLeaf` when `--ref` provides an explicit target. On divergent graphs, `findLeaf` throws `AMBIGUOUS_LEAF` before ref-based routing gets a chance. `migration apply` already resolves its target from `contract.json` or `--ref` before pathfinding, but `migration status` forces a global leaf resolution unconditionally.

**Current behavior (status):**
- L304–316: `findLeaf(graph)` is called unconditionally, before any ref-based routing.
- On a divergent graph (e.g., C1→C2 and C1→C3), this throws `AMBIGUOUS_LEAF` even when `--ref` points to a valid target.
- The chain is built from EMPTY→leafHash, which is used for the migration entry list.

**Target behavior:**
- When `--ref` is provided and resolves to a hash, skip `findLeaf` entirely. Use the ref hash as the target for chain construction and path display.
- When `--ref` is not provided, use `findLeaf` as before (and let `AMBIGUOUS_LEAF` surface as the divergence error).
- The chain displayed should be the path from EMPTY to the target (ref hash or leaf hash), showing the route that would be relevant for the user's context.

**Tasks:**

- [x] Refactored `executeMigrationStatusCommand`: `targetHash = refHash ?? findLeaf(graph)` — when `--ref` is provided, `findLeaf` is skipped entirely.
- [x] Renamed `leafHash` to `targetHash` in `MigrationStatusResult` interface and all consumers (output formatter, tests, JSON shape tests).
- [x] Verified `migration apply` does not call `findLeaf` — confirmed it resolves `destinationHash` from `--ref` or `contract.json` before pathfinding.
- [x] Updated JSON shape tests in `output.json-shapes.test.ts` for the `leafHash` → `targetHash` rename.
- [x] All existing tests pass with the refactor (281 CLI tests).

### Milestone 3: F03 — Contract hash format validation for ref values

Ref values should be validated as well-formed contract hashes on both read and write. Currently, ref names are validated but ref values accept any string. This prevents storing garbage values that will fail later during pathfinding with confusing errors.

**Current behavior:**
- `writeRefs` validates ref *names* via `validateRefName` but does not validate ref *values*.
- `readRefs` validates the shape is `Record<string, string>` and that keys are valid ref names, but does not validate values.
- `migration ref set` passes values through unchecked.

**Target behavior:**
- Ref values must match the contract hash format: `sha256:<hex>` where `<hex>` is a 64-character lowercase hex string.
- Validation occurs on both read (to catch manually edited or corrupted files) and write (to prevent storing invalid values).
- The error message clearly identifies the invalid value and the expected format.

**Tasks:**

- [x] Added `validateRefValue` function in `refs.ts` with pattern `sha256:(empty|[0-9a-f]{64})`.
- [x] Added `errorInvalidRefValue(value: string)` helper in `errors.ts`.
- [x] Updated `RefsSchema` narrow to validate both keys (ref names) and values (contract hashes).
- [x] Updated `writeRefs` to validate values via `validateRefValue` before writing.
- [x] Updated `resolveRef` to validate the resolved value before returning (defense in depth).
- [x] Added `validateRefValue` test suite (7 tests): accepts valid hashes, rejects empty, no prefix, wrong length, uppercase, non-hex.
- [x] Added `readRefs` test: rejects invalid hash values.
- [x] Added `writeRefs` test: rejects invalid hash values on write.
- [x] Added `resolveRef` test: rejects invalid hash values found in refs.
- [x] Updated all test fixtures using short hashes (e.g., `sha256:abc`) to use proper 64-char hex hashes.

### Milestone 4: Verification and close-out

Verify all three fixes work together and the playbook scenarios pass.

**Tasks:**

- [ ] Re-run scenario P-2 (rollback cycle): confirm `migration plan` without `--from` now errors with `NO_RESOLVABLE_LEAF` and clear guidance.
- [ ] Re-run scenario P-4 (divergence): confirm `migration status --ref production` works on a divergent graph without `AMBIGUOUS_LEAF`.
- [ ] Re-run scenario P-5 (staging ahead): confirm refs still work end-to-end with validated hash values.
- [x] All existing tests pass (`pnpm test:packages` — 66/66 tasks green).
- [ ] Update the playbook results in `projects/on-disk-migrations-v2/spec.md` to reflect the fixed behavior.
- [ ] Update the PR-232 review response: note F01, F02, F03 as resolved with references to the fix commits.

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| AC-1: Cycle-safe deterministic shortest path | Unit | M1 | New tests for cycle-without-exit error; existing cycle-with-exit tests remain green |
| AC-4: Divergence with explicit target | Unit + CLI | M2 | `--ref` on divergent graph bypasses `AMBIGUOUS_LEAF` |
| AC-5: Refs CRUD + validation | Unit + CLI | M3 | Value format validation on read/write/resolve |
| AC-6: Status/apply consume refs | Unit + CLI | M2 | Status works with refs on divergent graphs |
| F02 regression guard | Unit + CLI | M1 | `findLeaf` on cycle-without-exit throws, not returns EMPTY |
| F01 regression guard | Unit + CLI | M2 | Status `--ref` on multi-leaf graph succeeds |
| F03 regression guard | Unit + CLI | M3 | Invalid hash values rejected on set/read/resolve |

## Open Items

- **~~`leafHash` field rename~~:** Completed. Renamed to `targetHash` in `MigrationStatusResult` and all consumers. No external consumers affected (WIP).
- **`alternativeCount` semantics (F04):** Deferred — not addressed in this plan per the "nice to have" assessment. The semantics should be clarified in documentation but the implementation is functionally correct for practical graph sizes.
