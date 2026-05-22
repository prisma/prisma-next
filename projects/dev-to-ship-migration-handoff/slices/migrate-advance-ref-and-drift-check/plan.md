# Slice plan: `migrate` — `--advance-ref` flag + apply-time drift check

**Spec:** [`./spec.md`](./spec.md)
**Parent project:** [`projects/dev-to-ship-migration-handoff/`](../../)
**Parent plan position:** Stack 4 (see [project plan](../../plan.md))

## Validation gate (slice-level, inherited by every dispatch)

```bash
pnpm typecheck                                                                    # always
pnpm vitest run                                                                   # direct in @prisma-next/cli; avoids the turbo env-pollution flake
pnpm vitest run                                                                   # direct in test/integration once integration tests land
pnpm lint:deps                                                                    # package boundaries
pnpm build --filter @prisma-next/cli                                              # refresh dist
pnpm fixtures:check                                                               # no fixture drift expected (verify)
```

Per-commit gate: `pnpm typecheck` and grep gates from § Grep gates.
End-of-dispatch gate: the full block above (selective during iteration; full block at dispatch close).

### Grep gates

Run after every dispatch:

```bash
rg "from '[^']+\.(ts|tsx|js|jsx)'" packages/1-framework/3-tooling/cli/src/commands/migrate.ts 2>/dev/null
rg ': any\b|\bany\[\]' packages/1-framework/3-tooling/cli/src/commands/migrate.ts 2>/dev/null
rg '@ts-expect-error' packages/1-framework/3-tooling/cli/src/commands/migrate.ts 2>/dev/null
rg '@ts-nocheck' packages/1-framework/3-tooling/cli/src/ 2>/dev/null
rg 'projects/dev-to-ship-migration-handoff' packages/1-framework/3-tooling/cli/src/ 2>/dev/null
```

Each grep gate expects **zero matches** to pass.

## Dispatch plan

### Dispatch 1: `--advance-ref` flag wiring + integration tests

**Intent.** Add the `--advance-ref <name>` flag to `migrate`, wire ref advancement using Slice 2 D2's existing helpers (`computeRefAdvancementName`, `executeRefAdvancement`, `readContractIR`), extend the `MigrateResult` envelope with `advancedRef`, and ship integration tests covering the matrix. **No pre-DDL drift check yet** — Dispatch 2.

**Files in play.**

- Modified: `packages/1-framework/3-tooling/cli/src/commands/migrate.ts`:
  - Add `--advance-ref <name>` option.
  - Extend `MigrateCommandOptions` interface.
  - Extend `MigrateResult` interface with `advancedRef?: { name; hash } | null`.
  - Insert ref advancement after successful `client.migrationApply(...)`. The advancement hash = `applyResult.value.markerHash`. The snapshot source = matching bundle's `end-contract.{json,d.ts}` when `--to` resolves to a bundle, else current contract.
- Possibly modified: `packages/1-framework/3-tooling/cli/src/utils/ref-advancement.ts`:
  - May need a small extension OR a sibling helper for `migrate`-specific semantics. `migrate` differs from `db init`/`db update` in **two** ways: (a) **no implicit default** (`computeRefAdvancementName`'s db-default branch must NOT fire for `migrate`); (b) **no plan/apply mode discriminator** — `migrate` is always apply. Pick one of:
    - **Option A:** Skip `buildRefAdvancementFields` (which has the plan/apply mode logic); call `computeRefAdvancementName` (passing some marker so the db-default doesn't fire — likely the simplest: pass `{ advanceRef: options.advanceRef, db: 'sentinel' }` so non-undefined `db` value bypasses the implicit-default branch). Then call `executeRefAdvancement` directly. Verify at dispatch time by reading `computeRefAdvancementName`'s implementation.
    - **Option B:** Add a `mode: 'apply-only'` parameter to `buildRefAdvancementFields` that suppresses the implicit-default branch AND skips plan-mode handling. Heavier.
    - **Option C:** Add a sibling helper `computeMigrateAdvancementName(options)` that's specifically for `migrate` — returns `options.advanceRef ?? null`. Cleanest separation.
  - Recommend Option C if the dispatch's reconnaissance shows `computeRefAdvancementName` is non-trivial to bypass; Option A if it's a 1-line condition. Settle at dispatch time.
- Modified: `packages/1-framework/3-tooling/cli/src/utils/formatters/migrations.ts`:
  - Extend the `MigrateResult` (or `MigrationApplyCommandResult` — discover actual name at recon) formatter to surface the `Advanced ref "<name>" → sha256:<hash>` line in human output.
- New: `test/integration/test/cli.migrate-ref-advancement.e2e.test.ts`:
  - 4-row matrix: { no `--to`, `--to <ref>` } × { no `--advance-ref`, `--advance-ref <name>` }.
  - Edge cases: invalid ref name, no-op apply + advancement (ref still written), `--db <other-url>` + `--advance-ref` (no implicit default fires).
  - JSON envelope assertions: `advancedRef` populated.
  - Failure surface: `--advance-ref` with `--to <bad-ref>` → migrate fails before advancement; ref not written.

**"Done when":**

- [ ] `pnpm typecheck` clean.
- [ ] `pnpm vitest run` direct in `@prisma-next/cli` clean (retry on the pre-existing contract-emit flake; unrelated to this dispatch).
- [ ] `pnpm lint:deps` clean.
- [ ] `pnpm build --filter @prisma-next/cli` clean.
- [ ] `pnpm fixtures:check` clean.
- [ ] All matrix rows from § Files in play have e2e tests (4 base + edge cases).
- [ ] **Intent-validation:** Diff matches D1 intent only. **No pre-DDL drift check yet.** No edits to `mapApplyFailure` or `pathUnreachable` payload (D2's territory).
- [ ] Existing migrate tests still pass — these don't typically need updates for an additive flag; verify.
- [ ] Grep gates from plan § Grep gates: all return zero matches.

**Edge cases (this dispatch's portion):** All spec § Edge cases rows that don't depend on the pre-DDL drift check.

**Failure modes to avoid:**

- **F3 (discovery via grep before assuming)** —
  - `rg 'computeRefAdvancementName|executeRefAdvancement|buildRefAdvancementFields' packages/1-framework/3-tooling/cli/src/utils/ref-advancement.ts -C 5` to read the helper signatures + branching logic. Settle which option (A/B/C) before writing code.
  - `rg 'addMigrationCommandOptions|MigrationCommandResult' packages/1-framework/3-tooling/cli/src/utils/` to confirm whether `migrate.ts` extends from a shared options/result envelope or has its own (per the read, it's its own `MigrateCommandOptions` + `MigrateResult`).
  - `rg 'formatMigrationApplyCommandOutput' packages/1-framework/3-tooling/cli/src/utils/formatters/migrations.ts -C 5` to find the formatter that needs the new line.
  - `rg 'cli.db-ref-advancement|setupDbInitFixture|setupDbUpdateFixture' test/integration/test/` to find Slice 2's e2e fixture patterns to reuse.
- **F5** — destructive git operations forbidden without orchestrator approval.

**Out of scope (this dispatch):**

- Pre-DDL drift check — Dispatch 2.
- `pathUnreachable` payload improvement — Dispatch 2.
- Cold-clone drift e2e — Dispatch 2.
- Full J4 e2e — Dispatch 2.

**Size.** S–M. The wiring mirrors Slice 2 D2 closely; the main complexity is picking Option A/B/C for the helper invocation.

**Tier.** `composer-2.5-fast` (mechanical-shaped; pattern established by Slice 2).

**DoR confirmed:** [✓]

---

### Dispatch 2: Pre-DDL drift check + `pathUnreachable` improvement + e2e suite

**Intent.** Add the pre-DDL marker drift check (new `markerMismatch` structured error). Improve the existing `pathUnreachable` payload's `fix` text via a specific branch in `mapApplyFailure`. Ship the cold-clone drift e2e + the full J4 reproduction with `migrate --advance-ref db` — the project's end-to-end acceptance test.

**Files in play.**

- Modified: `packages/1-framework/3-tooling/cli/src/commands/migrate.ts`:
  - Insert pre-DDL drift check after `client.connect(dbConnection)` + `client.readAllMarkers()` but before `client.migrationApply(...)`.
  - Modify `mapApplyFailure` to route `failure.code === 'MIGRATION_PATH_NOT_FOUND'` to a specific factory.
- Modified: `packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts`:
  - Add `errorMarkerMismatch(markerHash, reachableHashes, graphTip?)` factory.
  - Add `errorPathUnreachable(failure)` factory (or extend the existing generic mapping with the specific branch inline).
- Modified: existing `migrate.test.ts` unit tests if any drift-check setup affects fixture expectations. Many existing tests will need a "marker is graph node" assumption baked into the fixture; enumerate at dispatch start.
- New: `test/integration/test/cli.migrate-drift-check.e2e.test.ts`:
  - Cold-clone drift scenario — marker present + not a graph node → refuse with `markerMismatch`.
  - Marker present + IS graph node → proceed (regression).
  - Marker absent (greenfield) → proceed (regression).
  - Graph empty + marker present → refuse with `markerMismatch`.
  - `--to <ref>` + drift → drift check fires regardless of `--to`.
  - `pathUnreachable` (runner-side) improved diagnostic in JSON output.
- New OR extended: e2e file for the **full J4 reproduction** — extend the existing `test/integration/test/cli.migration-plan-ref-aware.e2e.test.ts`'s scenario #1 with the `migrate --advance-ref db` step, OR add a new top-level e2e at `cli.j4-trap-closure.e2e.test.ts`. Working position: extend the existing J4 scenario (it already proves the migrate step works; this dispatch adds the `--advance-ref db` assertion that the ref + paired snapshot advance to the post-apply marker). Decide at dispatch time.

**"Done when":**

- [ ] Full validation gate passes.
- [ ] Pre-DDL drift check refuses cleanly with `markerMismatch` for the cold-clone scenario; passes for the healthy-marker case.
- [ ] `pathUnreachable`'s `fix` text is no longer empty; surfaces actionable affordances naming both hashes.
- [ ] The **full J4 reproduction passes end-to-end**: `db init` → contract edit → `db update` → `migration plan` (auto-baseline pair) → `migrate --advance-ref db` → assert: (a) both bundles apply, (b) `db` ref + paired snapshot advance to the post-apply marker. This is the project's acceptance test.
- [ ] Cold-clone drift e2e PASSES with the new diagnostic.
- [ ] All edge cases from spec § Edge cases (drift-check rows) have explicit tests with structured-error-shape assertions.
- [ ] **Intent-validation:** Diff matches D2 intent. The drift check is at the right boundary (after connect + readAllMarkers, before migrationApply). The `pathUnreachable` mapping is a discrete branch in `mapApplyFailure`. No advancement-logic changes (D1's territory).
- [ ] **WIP inspection at ~30 min wallclock.** Heartbeat mandatory.
- [ ] Grep gates pass.

**Edge cases (this dispatch's portion):** All spec § Edge cases rows that depend on the pre-DDL drift check or the `pathUnreachable` improvement.

**Failure modes to avoid:**

- **F3** —
  - `rg 'readAllMarkers' packages/1-framework/3-tooling/cli/src/commands/migrate.ts -C 5` to read the existing invariant-validation call site at L233. The drift check should be inserted at a similar boundary, BEFORE this invariant block (drift is a stronger refuse).
  - `rg 'MigrationApplyFailureCode|MIGRATION_PATH_NOT_FOUND' packages/1-framework/3-tooling/cli/src/control-api/` to confirm the runner's failure-code names + meta shape. The `pathUnreachable` mapping depends on the meta shape (e.g., `meta.from`, `meta.to`, `meta.deadEnds`).
  - `rg 'errorRuntime|mapMigrationToolsError' packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts -C 5` to find the existing factory patterns to mirror.
  - `rg 'isGraphNode' packages/1-framework/3-tooling/migration/src/exports/migration-graph.ts` to confirm the import path for the drift check.
- **F4** — explicit WIP inspection.
- **F5** — destructive git operations forbidden.

**Out of scope (this dispatch):**

- Documentation updates.
- Performance benchmarks for the drift check.
- `migration recover` command.

**Size.** M. The drift check is small (~15 LoC of logic + factory + tests); the `pathUnreachable` improvement is small (~20 LoC of factory + branch); the e2e suite is the load-bearing piece (~200 LoC for both new files + extending the J4 scenario).

**Tier.** `composer-2.5-fast` (mechanical-shaped — established e2e patterns from Slice 2 + 3).

**DoR confirmed:** [✓]

---

## Dispatch sequence

```
Dispatch 1 (S-M, --advance-ref wiring + integration tests; mirrors Slice 2 D2)
       ↓
Dispatch 2 (M, drift check + pathUnreachable improvement + cold-clone + full J4 e2e)
```

Total: 2 dispatches. WIP inspection in Dispatch 2 is the safety valve.

## Slice-DoD coverage map

| Slice-DoD | Delivered by |
|---|---|
| **SDoD1.** Validation gates pass | Both dispatches; final gate at slice close |
| **SDoD2.** Edge cases handled per disposition | Each dispatch's "Done when" enumerates its slice-spec edge cases |
| **SDoD3.** Reviewer SATISFIED on `code-review.md` | Per drive-build-workflow loop after Dispatch 2 |
| **SDoD4.** Manual-QA script | Slice close-out (extends slice-3's J4 walkthrough with the `migrate --advance-ref db` step + the cold-clone drift scenario) |
| **SDoD5.** No out-of-scope surfaces touched | Each dispatch's "Out of scope" + intent-validation |
| **SDoD6.** Existing tests pass unmodified (with documented exceptions for drift-check fixture updates) | Validation gate + intent-validation; document affected tests in Dispatch 2's return |
| **SDoD7.** No public-export drift | `pnpm lint:deps` clean |

## Open items

The spec's six open questions are dispatch-time decisions:

- OQ1 (`markerMismatch` error code naming) — Dispatch 2 settles per spec working position (`MIGRATION.MARKER_MISMATCH`).
- OQ2 (`pathUnreachable` CLI-side meta-code naming) — Dispatch 2 settles.
- OQ3 (`MigrateResult.advancedRef` shape) — Dispatch 1 settles (working position: `{ name; hash } | null` field).
- OQ4 (drift check vs invariant validation ordering) — Dispatch 2 settles (working position: drift check FIRST).
- OQ5 (extension-space markers in drift check) — Dispatch 2 settles (working position: app-only).
- OQ6 (`migration recover` command) — explicitly deferred to project close-out.

## Risks (slice-level)

1. **`computeRefAdvancementName` reuse vs new helper.** Slice 2's helper has an implicit-`db`-default branch that `migrate` must NOT trigger. Dispatch 1 picks between Options A (bypass via sentinel), B (extend), or C (sibling helper). If reviewer prefers a different option, Dispatch 1 may need a small reshape — keep the helper additions minimal so the reshape is cheap.

2. **Test-shape changes for existing `migrate` tests.** Spec § SDoD6 calls out that existing tests may need marker-setup updates. The Dispatch 2 reconnaissance must enumerate these. If the count is more than ~5 tests, escalate.

3. **A4 already verified.** Slice 3 D3's J4 e2e already proved the runner correctly applies the auto-baseline bundle pair. This slice's full J4 e2e adds the `--advance-ref db` assertion on top; no additional A4 risk.

4. **Cold-clone drift fixture complexity.** The cold-clone scenario requires setting up: (a) a DB with a marker, (b) a migration graph that DOESN'T include the marker's hash. The fixture-building may require some careful coordination of the existing `db init` / `migration plan` helpers. If it gets unwieldy, surface to orchestrator.

## Open items at slice close

The six open questions all have a dispatch-time owner (see § Open items above). At slice close, verify each is settled in the implementer's return.
