# CLI Output Pipeline Fixes

## Summary

Two CLI commands produce output that bypasses the structured CLI pipeline (`handleResult` / `CliStructuredError` / `TerminalUI`). This causes inconsistent behavior for `--json`, `--quiet`, `--no-color` flags, and incorrect exit codes. Additionally, `resolveDisplayChain` in `migration status` drops the marker from the displayed migration chain when the DB is ahead of the ref target, producing misleading output even though the summary text is correct.

**Spec:** `projects/on-disk-migrations-v2/spec.md`
**Source:** CodeRabbit PR #232 review comments #1 and #3

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Feature owner | Drives implementation |
| Reviewer | CLI maintainer | Ensures consistency with other commands |

## Milestones

### Milestone 1: Migrate `migration ref` subcommands to structured CLI pipeline

All four `migration ref` subcommands (`set`, `get`, `delete`, `list`) use `console.log`/`console.error`/`process.exit(1)` directly instead of the structured CLI pipeline. This means:

- Errors always go to stderr, even in `--json` mode (should go to stdout as JSON)
- Exit codes are always 1 for errors (should be 2 for CLI-domain errors per `handleResult`)
- `--quiet` is hand-checked with `if (!flags.quiet)` instead of being handled by `TerminalUI`
- `--no-color` has no effect (nothing to colorize currently, but the pattern should be in place)
- `MigrationToolsError` is formatted as `"Error: message\nfix"` instead of using `CliStructuredError` envelope format
- Validation failures (invalid ref name) bypass the error pipeline entirely

The reference pattern is `migration-show.ts`:

1. Extract command logic into `async function executeRefXxxCommand(...): Promise<Result<T, CliStructuredError>>`
2. Map domain errors (`MigrationToolsError`, validation failures) to `CliStructuredError` via `errorRuntime` / `errorUnexpected`
3. Return `ok(result)` for success
4. In the commander `.action()`, call `handleResult(result, flags, ui, onSuccess)` and `process.exit(exitCode)`
5. `onSuccess` handles JSON vs human-readable output using `ui.output()` / `ui.log()`

**Tasks:**

- [x] Create `errorInvalidRefName` / `errorRefNotFound` helper functions using `errorRuntime` (domain `RTM`, exit code 1) — consistent with how other commands map `MigrationToolsError` to `CliStructuredError`
- [x] Create `mapError` helper to convert `MigrationToolsError` → `errorRuntime` and unknown errors → `errorUnexpected`
- [x] Refactor `createRefSetCommand`: extract logic into `executeRefSetCommand` returning `Result<RefSetResult, CliStructuredError>`. Map `validateRefName` failure to `CliStructuredError`. Use `handleResult` + `TerminalUI` for output
- [x] Refactor `createRefGetCommand`: same pattern. `resolveRef` throwing `MigrationToolsError` for unknown refs mapped via `mapError`
- [x] Refactor `createRefDeleteCommand`: same pattern. The `Object.hasOwn` check for missing refs produces `errorRefNotFound` instead of `console.error` + `process.exit(1)`
- [x] Refactor `createRefListCommand`: same pattern. Error paths handled via `mapError`
- [ ] Add or update unit tests verifying JSON-mode error output goes to stdout (not stderr) for ref commands
- [ ] Add or update unit tests verifying exit code is 1 (RTM domain) for validation/not-found errors

### Milestone 2: Fix `resolveDisplayChain` for ahead-of-ref scenarios

When the DB marker is *ahead* of the ref target (e.g., marker at C3, ref targets C2), `resolveDisplayChain` calls `findPath(graph, markerHash, targetHash)` which returns null (no forward path from C3 to C2). It then falls back to `findPath(graph, EMPTY_CONTRACT_HASH, targetHash)`, which produces a chain from EMPTY to C2 that does not include the marker. The summary text from `summarizeRefDistance` is correct ("N edge(s) ahead of ref"), but the displayed chain is misleading — it shows the history up to the ref target without indicating where the marker actually is.

**What should happen:** When the marker is ahead of the ref target, the display chain should show the path from EMPTY through the ref target and continuing to the marker, so the user can see both the ref position and the marker position in context. The ref target and marker should both be visible in the chain.

**Tasks:**

- [ ] In `resolveDisplayChain`, when `findPath(marker, target)` returns null, try the inverse: `findPath(target, marker)`. If this succeeds, the marker is ahead of the target. Build the display chain as `EMPTY→target` + `target→marker` (the full path through both points)
- [ ] If neither forward nor inverse path exists (marker and target are on disconnected branches), fall back to `EMPTY→target` as today — this is a genuine divergence case
- [ ] Add unit tests for `resolveDisplayChain` covering: marker behind target (normal), marker at target (no-op), marker ahead of target (inverse path), marker on disconnected branch (fallback)
- [ ] Verify the human-readable and JSON output for `migration status --ref` correctly renders the ahead-of-ref chain (marker beyond the ref target is visible)

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| AC-6: Status/apply consume refs with consistent output | Unit | M1 | Ref commands use same pipeline as all other commands |
| AC-8: JSON output includes correct metadata | Unit | M1 | JSON errors go to stdout, structured envelope format |
| Ref validation errors produce structured error envelope | Unit | M1 | `--json` mode, exit code 1 (RTM domain) |
| Ref not-found errors produce structured error envelope | Unit | M1 | `--json` mode, exit code 1 (RTM domain) |
| Display chain includes marker when DB is ahead of ref | Unit | M2 | `resolveDisplayChain` inverse path |
| Ahead-of-ref renders correctly in human and JSON output | Integration | M2 | `migration status --ref` end-to-end |

## Open Items

- The `migration ref` commands currently have no styled header output (the `formatStyledHeader` call that other commands use). Milestone 1 should add this for interactive mode, but it's cosmetic and can be deferred if it complicates the diff.
- `resolveDisplayChain` currently lives as a private function in `migration-status.ts`. If it becomes more complex after the inverse-path fix, consider extracting it to a testable module. For now, unit-testing via the `executeMigrationStatusCommand` function (or exporting it) is sufficient.
