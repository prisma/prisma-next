# CLI Migration Cleanup Plan

## Summary

Clean up the CLI migration commands (`migration-apply`, `migration-plan`, `migration-status`) to eliminate code duplication, fix incorrect error guidance, tighten types, rename terminology, flatten deeply nested control flow, and improve test quality. This is a review-driven cleanup pass — no new features, just making the existing code correct, consistent, and maintainable.

**Spec:** TODOs in `migration-apply.ts`, `migration-plan.ts`, `migration-status.ts` + `wip/cleanup-notes.md`

## Status: M1 complete, M3 complete

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Sævar Berg | Drives execution |

## Milestones

### Milestone 1: Shared utilities and type tightening

Extract duplicated patterns into shared utilities and tighten types that are unnecessarily loose. This is foundational — later milestones depend on these shared abstractions.

**Tasks:**

- [x] **Create `readContractEnvelope` utility**: Added to `command-helpers.ts`. Reads contract.json, validates framework-level envelope fields (`storageHash`, `schemaVersion`, `target`, `targetFamily`). Uses `ContractEnvelope` interface with index signature for family-specific fields. Replaces raw `JSON.parse` + `as Record<string, unknown>` casts in `migration-apply.ts` and `migration-status.ts`. Note: `validateContract` from `sql-contract` is off-limits due to layering (framework cannot import from SQL domain per ADR 140).
- [x] **Create `resolveMigrationPaths` utility**: Added to `command-helpers.ts`. Extracts the repeated `configPath` + `migrationsDir` + `migrationsRelative` computation. Used in `migration-apply.ts`, `migration-plan.ts`, and `migration-status.ts`.
- [x] **Create shared `loadMigrationBundles` utility**: Added to `command-helpers.ts`. Reads migrations dir, filters to attested, builds graph. Returns `{ bundles: AttestedMigrationBundle[], graph: MigrationGraph }`. Used by `migration-apply`, `migration-plan`, and `migration-status`. Also fixed `MigrationApplyStep.operations` to use `MigrationPlanOperation[]` directly (removed inline type + cast round-trip), replaced stale `MigrationPackage` references with `MigrationBundle`, and changed `targetSupportsMigrations` from type guard to boolean + added `getTargetMigrations` using the migration-control-plane's `ControlTargetDescriptor` (which has the optional `migrations?` property the config-level type omits).
- [x] **Split `MigrationManifest` into Draft/Attested types**: `MigrationManifest` is now a union of `DraftMigrationManifest` (`migrationId: null`) and `AttestedMigrationManifest` (`migrationId: string`). Added `AttestedMigrationBundle` interface, `isAttested()` type guard. `MigrationChainEntry.migrationId` is now `string` (non-nullable) since only attested migrations appear in the graph. `reconstructGraph` now accepts `AttestedMigrationBundle[]`. All 37 type errors in CLI test and source files resolved — tests use `isAttested` filter, source files use `loadMigrationBundles`.
- [x] **Reuse `PathDecision` type**: Added `PathDecisionResult` interface and `toPathDecisionResult()` helper to `command-helpers.ts`. Replaces inline PathDecision construction in both `migration-apply.ts` and `migration-status.ts`.
- [x] **Replace target cast with type guard**: Added `targetSupportsMigrations()` type guard to `command-helpers.ts`. Replaces `as typeof config.target & { migrations?: unknown }` casts in `migration-apply.ts` and `migration-plan.ts`. The config-level `ControlTargetDescriptor` doesn't include `migrations` (it's on the migration control-plane version), so runtime check is needed.
- [x] **Rename `packages` → `bundles`**: Renamed local variables in `migration-apply.ts` and `migration-status.ts` (`packages` → `bundles`, `allPackages` → `allBundles`, `packageByDir` → `bundleByDir`). `MigrationBundle` type already existed; added `MigrationBundle as MigrationPackage` re-export for backward compat.

### Milestone 2: Fix incorrect error messages and semantic issues

Review every error message and "fix" suggestion in the migration commands. Several suggest "reset the database with `db init`" which may not actually reset anything.

**Tasks:**

- [ ] **Fix "reset with db init" suggestions in migration-apply**: `db init` is additive-only and does not reset. Replace fix suggestions at lines 245-246, 316-317, 330-331 with accurate guidance. Likely candidates: "Drop and recreate the database, then re-run `migration apply`" for corrupted state, "Run `db sign` to update the marker" for marker mismatch, or "Check that your migrations directory matches this database" for unknown markers.
- [ ] **Stop conflating `undefined` marker with `EMPTY_CONTRACT_HASH`**: At `migration-apply.ts:323-324` and `migration-status.ts:404-405`, change `markerHash` from `string` (with `EMPTY_CONTRACT_HASH` fallback) to `string | undefined`. Handle `undefined` explicitly in downstream checks. Remove the `?? EMPTY_CONTRACT_HASH` fallback. This also simplifies the online/offline mode logic in migration-status.
- [ ] **Review redundant destination check**: At `migration-apply.ts:251`, the TODO says "will the destination ever be empty?" after already handling the no-packages case. Determine whether this check is reachable and remove if dead code.
- [ ] **Review `resolveDisplayChain` fallback behavior**: At `migration-status.ts:185-186` and `203-204`, when the marker can't be found in the graph, the code falls back to showing the full chain from empty. The TODO questions whether this produces misleading output. Determine the correct behavior: should it error, warn, or show a different view?
- [ ] **Review online/offline mode logic**: At `migration-status.ts:417-418`, the TODO notes that if we read a marker, we're online, and if we didn't, `markerHash` should be `undefined` not `EMPTY_CONTRACT_HASH`. Simplify: `markerHash` is `string | undefined` where `undefined` means offline/no marker, removing the need for `mode` variable entirely.
- [ ] **Review ref fallback to `findLeaf`**: At `migration-status.ts:378`, when a ref is provided but not found, the code falls back to `findLeaf`. The TODO suggests this should be an error. Determine: if the user passes `--ref foo` and `foo` doesn't exist, should that be a hard error?
- [ ] **Clarify ref update ordering**: Document in the migration apply command (or a shared doc) whether `migration apply` should update the ref after successful application, or if that's the user's responsibility.

### Milestone 3: Rename "packages" to "MigrationBundle" ✅

Completed as part of M1. `MigrationBundle` has JSDoc, local variables renamed, `MigrationPackage` kept as re-export alias for backward compat.

### Milestone 4: Flatten and simplify control flow

Reduce nesting in both commands. The current code has deeply nested if/else/try/catch blocks that are hard to follow.

**Tasks:**

- [ ] **Flatten migration-apply empty-packages branch**: At `migration-apply.ts:226-282`, the empty-packages case creates a client, reads a marker, checks various conditions, then returns. Refactor to use early returns and reduce nesting levels.
- [ ] **Flatten migration-apply main execution path**: At `migration-apply.ts:227`, the main path has try/catch/finally with nested if/else for marker states. Refactor to extract the marker-state validation into a helper function that returns early with errors.
- [ ] **Flatten migration-status graph/chain logic**: At `migration-status.ts:351-460`, the attested/graph/chain/entries/summary logic is deeply nested. Extract the online status probing into a helper, extract summary generation into a helper.
- [ ] **Extract control client creation**: Both commands create a control client with the same config pattern. Extract to a shared `createControlClientFromConfig(config)` helper.

### Milestone 5: Test cleanup

Review the tests flagged in the cleanup notes and TODOs. Remove duplicative tests, fix tests relying on invalid states, add missing coverage.

**Tasks:**

- [ ] **Remove tests using `migrationId: null`**: After tightening the type in M1, find and fix tests that construct migrations with `migrationId: null`. These should use a valid string ID.
- [ ] **Review "refs sorted keys" test**: The cleanup note asks "why?". Determine if this test is asserting an implementation detail or a user-facing guarantee. Remove or document.
- [ ] **Review "C1 → C2 edge is inert when targeting C3" test**: The cleanup note says "useless?". Determine if this test covers a meaningful scenario or is redundant with other tests. Remove or document.
- [ ] **Review marker tests**: The cleanup note says "marker tests are mostly duplicating the implementation of what should happen in those cases". Audit the marker tests — if they're just asserting the same logic as the implementation, they're not useful. Rewrite to test observable behavior (CLI output, DB state) rather than internal logic.
- [ ] **Add partial migration failure test**: The cleanup note has a TODO: "ensure that e.g. partial migration failure makes sense". Add a test that applies multiple migrations where one fails mid-way, verifying the marker is at the last successful migration and the error message is actionable.
- [ ] **Ensure `migration status` truncates output**: The cleanup note mentions "migration status: truncate output". Add or verify that long migration lists are truncated in non-JSON mode with a "... and N more" message.

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| Contract loading uses validated path | Unit | M1 | Shared utility tested directly |
| `migrationId` is never `null` on attested migrations | Unit | M1 | Type system enforces + test update |
| `PathDecision` reused from dag module | Typecheck | M1 | Compilation verifies type reuse |
| Error messages suggest correct fix actions | Manual | M2 | Review each error string |
| `markerHash` handling is consistent | Unit/Integration | M2 | Journey tests cover marker scenarios |
| "packages" renamed to "bundles" everywhere | Grep | M3 | No remaining `packages` variable names in migration commands |
| No deeply nested blocks (max 3 levels) | Manual | M4 | Code review |
| No tests relying on `migrationId: null` | Typecheck | M5 | Type system prevents after M1 |
| Partial failure test exists | Integration | M5 | Journey test |

## Resolved Questions

### `db init` does NOT reset the database

Traced the code: `db init` → `client.dbInit()` → `executeDbInit()`. It introspects the live schema, plans an **additive-only** migration, checks for an existing marker (fails with `MARKER_ORIGIN_MISMATCH` if one exists and doesn't match), and executes. It never drops anything. The error messages suggesting "reset the database with `prisma-next db init`" are doubly wrong: `db init` doesn't reset, and would itself fail if the marker is mismatched. The correct fix suggestions need to be determined per scenario (likely "manually drop and recreate the database", "use `db sign` to overwrite the marker", or "check your migrations directory").

### Marker semantics: `undefined` means "no marker", not `EMPTY_CONTRACT_HASH`

The code currently does `markerHash = marker?.storageHash ?? EMPTY_CONTRACT_HASH`, then later checks `if (markerHash !== EMPTY_CONTRACT_HASH)` — effectively conflating "no marker row" with "empty database". These are different states: no marker means the database has never been initialized by prisma-next. The fix: keep `markerHash` as `string | undefined`, handle `undefined` explicitly, remove `EMPTY_CONTRACT_HASH` fallback.

## Immediate next steps

M1 and M3 are complete. Next up is M2 (fix incorrect error messages).

## Open Items

- **Ref update ordering**: Does `migration apply` update the ref after success, or is it the user's responsibility? This affects CI workflows. Needs a design decision before M2 tasks can finalize the error messages.
