# Slice plan: `migration plan` — ref-aware resolution + auto-baseline emission

**Spec:** [`./spec.md`](./spec.md)
**Parent project:** [`projects/dev-to-ship-migration-handoff/`](../../)
**Parent plan position:** Stack 3 (see [project plan](../../plan.md))

## Validation gate (slice-level, inherited by every dispatch)

```bash
pnpm typecheck                                                                    # always
pnpm vitest run                                                                   # direct in @prisma-next/cli; avoids the turbo env-pollution flake
pnpm vitest run                                                                   # direct in test/integration once the integration tests land
pnpm lint:deps                                                                    # package boundaries
pnpm build --filter @prisma-next/cli                                              # refresh dist
pnpm fixtures:check                                                               # no fixture drift expected (verify)
```

Per-commit gate: `pnpm typecheck` and grep gates from § Grep gates.
End-of-dispatch gate: the full block above (selective during iteration; full block once at dispatch close).

### Grep gates

Run after every dispatch:

```bash
rg "from '[^']+\.(ts|tsx|js|jsx)'" packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts packages/1-framework/3-tooling/cli/src/utils/plan-resolution.ts 2>/dev/null
rg ': any\b|\bany\[\]' packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts packages/1-framework/3-tooling/cli/src/utils/plan-resolution.ts 2>/dev/null
rg '@ts-expect-error' packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts packages/1-framework/3-tooling/cli/src/utils/plan-resolution.ts 2>/dev/null
rg '@ts-nocheck' packages/1-framework/3-tooling/cli/src/ 2>/dev/null
rg 'projects/dev-to-ship-migration-handoff' packages/1-framework/3-tooling/cli/src/ 2>/dev/null
```

Each grep gate expects **zero matches** to pass.

## Dispatch plan

### Dispatch 1: Resolution function + refuse paths

**Intent.** Replace the resolution block at `migration-plan.ts:240–301` with a new helper that returns a discriminated `FromResolution` and handles all the refuse paths. **No auto-baseline emission yet** — the resolver returns `kind: 'auto-baseline'` for the right inputs, but the emission branch still only handles the existing single-bundle cases for now (the `auto-baseline` kind is short-circuited to refuse at the emission site, with an explicit TODO comment pointing at Dispatch 2). This dispatch is the resolver-layer + refuse-paths slice; Dispatch 2 wires the emission.

**Files in play.**

- New: `packages/1-framework/3-tooling/cli/src/utils/plan-resolution.ts` (~150 LoC).
  - `type FromResolution = { kind: 'greenfield'; ... } | { kind: 'graph-node'; ... } | { kind: 'snapshot'; ... } | { kind: 'auto-baseline'; ... }` discriminated union per spec § Approach.
  - `resolveFromForPlan({ optionsFrom, refsDir, bundles, graph, familyInstance, ... }): Promise<Result<FromResolution, CliStructuredError>>` — pure-ish function (does disk I/O via `readRefSnapshot` + `readPredecessorEndContract`, but no DB connection).
  - `assertFromIsGraphNode(fromHash, graph)` — CLI-layer wrapper around Slice 1's `assertHashIsGraphNode` that turns the thrown `MIGRATION.HASH_NOT_IN_GRAPH` into a `CliStructuredError` with the forgot-the-flag `fix` text enumerating reachable refs.
- New: `packages/1-framework/3-tooling/cli/test/utils/plan-resolution.test.ts` (~250 LoC).
  - All 7 resolution branches from spec § Edge cases (greenfield / graph-node-via-explicit-hash / graph-node-via-explicit-ref / graph-node-via-implicit-db / snapshot-via-ref / auto-baseline / refuse paths).
  - Refuse-path tests assert the structured error shape: `code`, `meta.code` (the underlying `MIGRATION.*`), `fix` contains the expected affordances.
- Modified: `packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts` — strip the inline resolution block; call `resolveFromForPlan` from the helper; on `kind: 'auto-baseline'`, return a `CliStructuredError` placeholder ("auto-baseline emission not yet wired — Dispatch 2") so the path is observable but blocked until Dispatch 2.
- Possibly modified: `cli-errors.ts` — add `errorSnapshotMissing` factory + `errorPlanForgotTheFlag` factory (or extend an existing one). Discover via grep at dispatch start whether the existing structured-error factories cover the new diagnostics cleanly.

**"Done when":**

- [ ] `pnpm typecheck` clean.
- [ ] `pnpm vitest run` direct in cli clean, including new `plan-resolution.test.ts`.
- [ ] `pnpm lint:deps` clean.
- [ ] `pnpm build --filter @prisma-next/cli` clean.
- [ ] `pnpm fixtures:check` clean.
- [ ] All 7 resolution branches from § Edge cases have explicit unit tests with structured-error-shape assertions on refuse paths.
- [ ] Existing `migration-plan` tests still pass — except those that assert the old "from = graph leaf" default may need updating to "from = `db` ref by default". Identify these at dispatch start (rg for `migration-plan.test.ts` or similar) and document the changes in the implementer return.
- [ ] **Intent-validation:** diff matches above intent. **No auto-baseline emission yet** — the placeholder error is intentional. The single-bundle path (`kind: 'graph-node'`, `kind: 'snapshot'`, `kind: 'greenfield'`) still works end-to-end.
- [ ] Grep gates pass.

**Edge cases (this dispatch's portion — all 14 from spec § Edge cases except the auto-baseline emission rows):**

(See spec § Edge cases for the full enumerated table. This dispatch handles every row that doesn't require Dispatch 2's emission machinery. The auto-baseline rows resolve to `kind: 'auto-baseline'` but emission throws the placeholder error.)

**Failure modes to avoid:**

- **F3 (discovery via grep before assuming)** —
  - `rg 'parseContractRef' packages/1-framework/3-tooling/migration/src/refs/` to confirm whether the parsed result carries a discriminant for "resolved via ref name" vs "resolved via raw hash" — the resolver's branching depends on this.
  - `rg 'findLatestMigration' packages/1-framework/3-tooling/cli/` to understand current callers; the resolver removes the call but the function may still be used elsewhere.
  - `rg 'migration-plan\.test\.ts|migration-plan\.\w*\.test\.ts' packages/1-framework/3-tooling/cli/test/` to find existing test files that may need updates.
  - `rg 'isGraphNode|assertHashIsGraphNode' packages/1-framework/3-tooling/migration/src/exports/` to confirm the Slice 1 export paths.
- **F5** — destructive git operations forbidden without orchestrator approval.

**Out of scope (this dispatch):**

- Auto-baseline emission — Dispatch 2.
- Integration tests using real PGlite / Mongo fixtures — Dispatch 3.
- Output format for the two-bundle case — Dispatch 2 settles.
- J4 e2e reproduction — Dispatch 3.

**Size.** M. Resolver function + unit-test matrix; the main complexity is the discriminated-union shape and the refuse-paths' diagnostic-wording polish.

**Tier.** `composer-2.5-fast` (mechanical-shaped — pure resolver function with well-defined inputs/outputs; the existing resolution branch reads cleanly so the transform is structural).

**DoR confirmed:** [✓]

---

### Dispatch 2: Auto-baseline emission

**Intent.** Wire the `kind: 'auto-baseline'` branch into emission. Two planner invocations, two `writeMigrationPackage` calls, two sets of `end-contract.{json,d.ts}` files, two `migration.ts` files. Output formatting + result envelope extended to name both bundles.

**Files in play.**

- Modified: `packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts` — replace the placeholder error from Dispatch 1 with the actual two-bundle emission.
- Modified: `packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts` `MigrationPlanResult` interface — add optional `baselineDir?: string` field; add optional `baselineOperations` if the surface needs to distinguish; update `formatMigrationPlanOutput` to name both bundles.
- Possibly new: a small emission helper at `src/utils/plan-emission.ts` for the two-bundle orchestration, if the inline code gets unwieldy. Discover at dispatch time.
- Modified: relevant cli tests for `formatMigrationPlanOutput` and the result envelope.

**"Done when":**

- [ ] Full validation gate passes.
- [ ] `kind: 'auto-baseline'` produces TWO migration directories on disk under `appMigrationsDir`, sorted baseline-first by directory name.
- [ ] Each bundle has correct `metadata.from` / `metadata.to`, its own `migrationHash`, its own `migration.ts`, `ops.json`, `end-contract.{json,d.ts}`, and (for the delta) `start-contract.{json,d.ts}`.
- [ ] `MigrationPlanResult.dir` = delta's directory; `MigrationPlanResult.baselineDir` = baseline's directory.
- [ ] Output ("Planned baseline + N operation(s)" or the final wording) names both bundles.
- [ ] JSON envelope carries both directories.
- [ ] Unit tests: emission function produces the right metadata + file shapes (mocking the planner is fine; assert the disk-write calls).
- [ ] **Intent-validation:** the placeholder error from Dispatch 1 is gone. The auto-baseline path is the new emission path for `kind: 'auto-baseline'`. No regressions in the single-bundle paths.
- [ ] WIP inspection at ~30 min wallclock: confirm at least one auto-baseline unit test (or a constructed-graph integration test) passes end-to-end before continuing. The two-planner-invocations orchestration is the load-bearing piece — verify it works before sinking time on output polish.
- [ ] Grep gates pass.

**Edge cases (this dispatch's portion):**

| Edge case | Disposition |
|---|---|
| `kind: 'auto-baseline'` end-to-end | Two bundles, sorted, with correct metadata + content. |
| No-op short-circuit (`fromHash === toStorageHash`) when `kind: 'auto-baseline'` | The resolver returns `kind: 'auto-baseline'`, but the no-op check at `migration-plan.ts:329` short-circuits before emission. Result: zero bundles, success. Test covers. |
| Auto-baseline + extension packs | Seed phase runs once at top of command; both bundles are app-space-only. Extension-pack seeding is independent of the auto-baseline split. Test covers. |
| Auto-baseline + planner returns conflicts on baseline (e.g., the baseline can't be planned because the snapshot's contract has unsupported types) | Refuse cleanly with `errorMigrationPlanningFailed` from the baseline planner call; do not write the baseline bundle; do not invoke the delta planner. Test covers. |
| Auto-baseline + planner returns conflicts on delta but baseline succeeded | This is the awkward case. Options: (a) commit the baseline + refuse with delta-planning-failed; (b) refuse cleanly + don't write the baseline either. Working position: (a) — the baseline is independently useful (next `migration plan` would emit just the delta as a normal flow). Test covers. Decide at dispatch time after considering whether (a) leaves the user in a weird state. |
| Auto-baseline timestamp ordering | Pick approach (b) from spec OQ1: baseline = `now`, delta = `now + 1ms`. Test asserts `baselineDir < deltaDir` lexicographically. |

**Failure modes to avoid:**

- **F3** — `rg 'writeMigrationPackage|formatMigrationDirName' packages/1-framework/3-tooling/migration/src/` to find the bundle-write surface. Confirm `formatMigrationDirName(timestamp, slug)` produces lexicographically sortable names by timestamp prefix.
- **F4 (no inspection cadence)** — explicit WIP inspection.
- **F5** — destructive git operations forbidden.

**Out of scope (this dispatch):**

- Integration tests against fresh-project DB fixtures — Dispatch 3.
- J4 e2e — Dispatch 3.

**Size.** M (borderline; the two-bundle orchestration + the awkward "delta failed after baseline succeeded" edge case may push it). If pre-implementation reconnaissance reveals scope creep, escalate to orchestrator for re-decomposition.

**Tier.** `composer-2.5-fast` (mechanical-shaped — extend the existing emission block by one more invocation; the planner call shape is established).

**DoR confirmed:** [✓]

---

### Dispatch 3: Integration tests + J4 e2e

**Intent.** Verify the slice end-to-end against realistic DB fixtures. Include the TML-2629 J4 reproduction as a top-level test: `db init` → contract edit → `db update` → contract edit → `migration plan` → assert two bundles land. (The `migrate` part of the e2e ships in Slice 4 — this dispatch's e2e stops at the plan step.)

**Files in play.**

- New: `test/integration/test/cli.migration-plan-ref-aware.e2e.test.ts` — covers:
  - **J4 reproduction:** the spec § Scope > In scope walkthrough that's the project's purpose.
  - Implicit-`db` resolution with paired snapshot present (default workflow).
  - Explicit `--from <ref-name>` with paired snapshot.
  - Explicit `--from <raw-hash>` that's a graph node (regression).
  - Forgot-the-flag refuse path (`db update` past the graph).
  - Snapshot-missing refuse path (legacy on-disk state).
  - Auto-baseline + no extension packs.
  - Auto-baseline + one extension pack.
- Possibly modified: `test/integration/test/utils/` test helpers, if the J4 reproduction needs new fixture-builder helpers.

**"Done when":**

- [ ] Full validation gate passes.
- [ ] J4 reproduction test PASSES: `db init` → `db update` (advances `db` ref) → contract edit → `db update` (advances `db` ref again) → `migration plan` produces TWO bundles + the next `migrate` (orchestrator runs manually as part of the dispatch's verification, since `migrate --advance-ref` ships in Slice 4) successfully advances the DB marker to the current contract.
- [ ] Forgot-the-flag e2e PASSES: construct a state where `db.hash` is not a graph node + graph is non-empty → run `migration plan` → assert non-zero exit, `MIGRATION.HASH_NOT_IN_GRAPH` in JSON output, `fix` text enumerates reachable refs.
- [ ] Snapshot-missing e2e PASSES: construct the legacy on-disk state (pointer file, no paired snapshot) + `db.hash` not a graph node → `migration plan` refuses with `MIGRATION.SNAPSHOT_MISSING` (or final code name) + actionable `fix`.
- [ ] All other matrix rows from § Files in play pass.
- [ ] **Intent-validation:** the e2e tests use the same fixture-building approach as Slice 2's `cli.db-ref-advancement.e2e.test.ts` (consistency).
- [ ] WIP inspection at ~30 min wallclock: confirm the J4 reproduction test passes end-to-end before continuing on the matrix variants. The J4 case is the load-bearing one; if it doesn't pass, the slice isn't done.
- [ ] Grep gates pass.

**Edge cases (this dispatch's portion):** Mirrors spec § Edge cases via the e2e suite; each row has a corresponding scenario unless explicitly out.

**Failure modes to avoid:**

- **F3** — `rg 'setupDbInitFixture|setupDbUpdateFixture|withDevDatabase' test/integration/test/` to confirm the fixture helpers exist + their signatures. Reuse aggressively.
- **F4** — explicit WIP inspection.
- **F5** — destructive git operations forbidden.

**Out of scope (this dispatch):**

- The full `migrate` step of the J4 reproduction (Slice 4 closes this end-to-end). The J4 e2e in this dispatch stops at "two bundles on disk + asserting plan output" + an orchestrator-side manual verification that the bundles apply via the existing `migrate` command (which uses the existing pre-DDL marker path — that becomes the comparison anchor for Slice 4's drift-check addition).
- Performance benchmarks for the auto-baseline path.
- Documentation updates.

**Size.** M (borderline; e2e fixture-building for the J4 reproduction may push it).

**Tier.** `composer-2.5-fast` (mechanical-shaped — fixture-building + assertion patterns mirror Slice 2's existing integration tests).

**DoR confirmed:** [✓]

---

## Dispatch sequence

```
Dispatch 1 (M, resolver + refuse paths; library-shaped + unit tests)
       ↓
Dispatch 2 (M, auto-baseline emission; command wiring)
       ↓
Dispatch 3 (M, integration tests + J4 e2e; end-to-end shaped)
```

Total: 3× M. WIP inspections in Dispatches 2 and 3 are the safety valves.

## Slice-DoD coverage map

| Slice-DoD | Delivered by |
|---|---|
| **SDoD1.** Validation gates pass | All three dispatches; final gate at slice close |
| **SDoD2.** Edge cases handled per disposition | Each dispatch's "Done when" enumerates its slice-spec edge cases |
| **SDoD3.** Reviewer SATISFIED on `code-review.md` | Per drive-build-workflow loop after Dispatch 3 |
| **SDoD4.** Manual-QA script extended | Slice close-out (`drive-qa-plan` invocation; extends `db-cmds-ref-integration/manual-qa.md` with the J4 reproduction walkthrough OR lands a new `slices/plan-ref-aware-and-auto-baseline/manual-qa.md`) |
| **SDoD5.** No out-of-scope surfaces touched | Each dispatch's "Out of scope" + intent-validation |
| **SDoD6.** Existing tests pass unmodified (with the exception of "from = graph leaf" default tests) | Validation gate + intent-validation; document which tests need updating in Dispatch 1's return |
| **SDoD7.** No public-export drift | `pnpm lint:deps` clean |

## Open items

The spec's six open questions are dispatch-time decisions:

- OQ1 (bundle ordering) — Dispatch 2 settles per spec working position (timestamp-based).
- OQ2 (output format for two-bundle case) — Dispatch 2 settles; iterate at dispatch time.
- OQ3 (`MIGRATION.SNAPSHOT_MISSING` naming) — Dispatch 1 settles per spec working position (distinct code).
- OQ4 (refuse `--from <raw-hash>` with paired snapshot but not a graph node) — Dispatch 1 honors spec working position (refuse).
- OQ5 (legacy on-disk refs when `db.hash` is mid-graph) — Dispatch 1 settles per spec working position (fall through to bundle source).
- OQ6 (`db`-ref vs `findLatestMigration` precedence) — Dispatch 1 settles per spec working position (`db` ref always wins when present).

## Risks (slice-level)

1. **Runner idempotency assumption (A4 from project spec).** This slice produces the auto-baseline bundle pair; Slice 4's runner verification proves the bundles apply cleanly. If A4 turns out to be false (the runner re-runs `CREATE TABLE` ops whose postconditions are satisfied rather than skipping via `postcheck_pre_satisfied`), Slice 4's e2e fails — and that finding routes back to this slice's emission shape (does the baseline need to mark ops as `expected-already-satisfied` somehow?). Watching for that signal during Slice 4 dispatching.

2. **Test-shape changes for existing default behavior.** Slice spec § SDoD6 calls out that tests asserting "from = graph leaf" default may need updating. The implementer's Dispatch 1 reconnaissance must enumerate these. If the count is more than ~5 tests, escalate — the test rewrite is its own work and shouldn't be quietly folded in.

3. **Auto-baseline delta-planning-failure edge case.** Dispatch 2 settles whether "baseline committed + delta failed" leaves the user in a recoverable state (working position: yes — next `migration plan` would resume from baseline). If reviewer disagrees, the alternative is "refuse cleanly + don't write the baseline" — which has its own failure mode (two-planner-invocation atomicity). Surface at dispatch time.

## Open items at slice close

The four open questions in spec § Open Questions all have a dispatch-time owner (see § Open items above). At slice close, verify each is settled in the implementer's return.
