# Spec — Consolidate the M2 contract-space orchestrator

- **Origin:** [`wip/system-design-review-m2.md`](system-design-review-m2.md) — the M2 system-design review against PR #438.
- **Linear ticket:** TML-2397 (the project this amends).
- **Branch to amend:** `tml-2397-codec-hooks-and-db-init-update` (the M2 branch).
- **Stack to rebase:** M3 / M4 / M5 (`tml-2397-cipherstash-contract-space`, `tml-2397-pgvector-contract-space`, `tml-2397-remove-database-dependencies-and-closeout`) all rebase onto the amended M2 head.
- **PRs affected:** #438 (M2), #439 (M3), #441 (M4), #442 (M5) — all open at the time of writing; merge order is M1 → M2 → M3 → M4 → M5.
- **Scope decision:** _minimum + path-resolver extraction + AC-16 sweep, amended at the M2 introduction site_.

## At a glance

Three problems, one architectural concern, four commits:

1. **AC-13 (orphan markers cause `db init` to fail) is unfulfilled at the integration level.** The marker-aware verifier (`runContractSpaceVerifierMarkerCheck`) is wired into `db verify` only. `db init` runs only the layout precheck; `db update` runs neither verifier. A user with an orphan marker row today silently passes through `db init`.
2. **Two `db init` code paths exist.** `executeDbInit` branches on `extensionContractSpaces.length > 0`: per-space path uses `executeAcrossSpaces` with multi-space transactional semantics; legacy single-space path uses `runner.execute` with a separate idempotency short-circuit. The justification at M2 was *"preserves existing behaviour for projects that don't load schema-contributing extensions."* With `databaseDependencies` removed at M5, that justification no longer applies.
3. **The app/extension distinction is structural in `executePerSpaceDbApply`.** Separate variables, separate planning logic, separate result handling for app vs extension spaces. The only legitimate special case is the migration-directory layout convention — and that lives in materialisation, not apply.

The fix:

- Wire the marker-aware verifier into `db init` and `db update` (locks AC-13 + AC-16 at the integration level).
- Collapse the dual `db init` path: always route through `executePerSpaceDbApply`, including when no extensions are declared (n=1 aggregate).
- Extract a path-resolver seam in `executePerSpaceDbApply` so app and extension spaces flow through one symmetric loop. The only remaining type-distinction is *which resolver* a space uses (`findPathWithDecision` graph walk for extensions; `planner.plan` against introspected schema for app), not separate code paths around it.

What we are **explicitly not doing** in this slice (defer to a follow-up if needed):

- Introducing a typed `ContractSpaceAggregate` structure. The reviewer's full proposal includes a typed aggregate with `spaces: [AppContractSpace, ...ExtensionContractSpace[]]`, `byId` map, etc. This is an abstraction over four orchestrator commands. The marginal value over well-named helpers is small at four callers. Capture as a follow-up if a fifth orchestrator command appears.
- Refactoring the verifier into a constructor-time invariant on the aggregate. Wiring it into `db init`/`db update` as an explicit precondition step is sufficient; the structural unification can come later if the duplication becomes painful.
- Touching the `MigrationPlan.targetId` placeholder pattern at `db-apply-per-space.ts:179, 237-240`. The M2 review documents this as awkward-but-contained; out of scope.
- Adding per-space progress spans. The current single `applySpanId='apply'` span is adequate for v1; the M2 review accepted this.

## Required reading (in order)

1. **`wip/system-design-review-m2.md`** — the originating critique. Read all of it. The Architectural Concern section (lines 31–98) is load-bearing; the Recommendations section (lines 193–199) is where this spec extracts its scope.
2. **`docs/architecture docs/adrs/ADR 211 - Contract spaces.md`** — verify the ADR doesn't constrain verifier-runs-in-`db verify`-only. It doesn't. Lines 56 and 197 use "verify time" generically; the ADR is consistent with running the verifier as a precondition for any apply.
3. **`docs/architecture docs/adrs/ADR 212 - Codec lifecycle hooks.md`** — codec hook contract; you'll touch the planner integration only at the rebase-cascade level. No semantic changes.
4. **The current `db init` orchestrator:** [`packages/1-framework/3-tooling/cli/src/control-api/operations/db-init.ts`](../packages/1-framework/3-tooling/cli/src/control-api/operations/db-init.ts) (`executeDbInit`, all 351 lines).
5. **The current per-space orchestrator:** [`packages/1-framework/3-tooling/cli/src/control-api/operations/db-apply-per-space.ts`](../packages/1-framework/3-tooling/cli/src/control-api/operations/db-apply-per-space.ts) (`executePerSpaceDbApply`).
6. **The verifier helpers (already on disk):**
   - [`packages/1-framework/3-tooling/cli/src/utils/contract-space-verifier-precheck.ts`](../packages/1-framework/3-tooling/cli/src/utils/contract-space-verifier-precheck.ts) — layout-only precheck.
   - [`packages/1-framework/3-tooling/cli/src/utils/contract-space-verifier-marker-check.ts`](../packages/1-framework/3-tooling/cli/src/utils/contract-space-verifier-marker-check.ts) — marker-aware check (locks AC-13 at the unit-test level today).
7. **The `db verify` wiring as the pattern to follow:** [`packages/1-framework/3-tooling/cli/src/commands/db-verify.ts`](../packages/1-framework/3-tooling/cli/src/commands/db-verify.ts) lines 354–390. This shows how to call both the precheck and the marker-check in sequence with a database connection. Mirror this pattern in `db init` and `db update`.
8. **The `db init` command (CLI surface, distinct from the operation):** [`packages/1-framework/3-tooling/cli/src/commands/db-init.ts`](../packages/1-framework/3-tooling/cli/src/commands/db-init.ts) lines 119–142. Today it runs only the precheck. You will add the marker-check call here.
9. **The `db update` command:** [`packages/1-framework/3-tooling/cli/src/commands/db-update.ts`](../packages/1-framework/3-tooling/cli/src/commands/db-update.ts). Today it runs neither verifier. You will add both.
10. **The migration-tools verifier primitive:** [`packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts`](../packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts). Target-agnostic; do not modify. Re-used as-is.
11. **The runner protocol:** `executeAcrossSpaces` is on `SqlMigrationRunner`. For the n=1 (no-extensions) case, you'll call it with a single per-space input where the `space` is `'app'`. Verify by reading the runner's `executeAcrossSpaces` signature in [`packages/2-sql/9-family/src/`](../packages/2-sql/9-family/src/) — search for `executeAcrossSpaces` to find its source.

## Diagnosis (verify before changing)

Before starting work, verify the current-state claims. If any of these don't reproduce, **stop and report back**, because the spec assumes them:

1. **Two `db init` paths exist.** Read `executeDbInit` (`db-init.ts` lines 62–108 vs 110–351). The `if (extensionContractSpaces && extensionContractSpaces.length > 0)` branch is the load-bearing dispatch.
2. **`db init` runs precheck only.** Search `packages/1-framework/3-tooling/cli/src/commands/db-init.ts` — exactly one call to `runContractSpaceVerifierPrecheck` (around line 125), zero calls to `runContractSpaceVerifierMarkerCheck`.
3. **`db update` runs neither verifier.** Search `packages/1-framework/3-tooling/cli/src/commands/db-update.ts` — zero matches for `runContractSpaceVerifier`.
4. **`db verify` runs both.** `packages/1-framework/3-tooling/cli/src/commands/db-verify.ts` calls precheck around line 357 and marker-check around line 385.
5. **AC-13 locked only at unit-test level.** `packages/1-framework/3-tooling/cli/test/utils/contract-space-verifier-marker-check.test.ts` line 61 has the assertion *"reports orphanMarker when a marker exists for a space not in extensionPacks (locks AC-13)."* No corresponding `db init`-level integration test exists.
6. **No `executePerSpaceDbApply` test on Postgres.** Per the M2 review's "Test strategy adequacy" section: only SQLite has a CLI-level per-space test. This is acceptable as-is for the consolidation; do not add a new Postgres-level test in this slice.

If all six reproduce, proceed.

## Design

### Principle

> The orchestrator loads configuration + contract and assembles a sequence of contract spaces. One space is always the app; zero or more are extensions. Commands accept the sequence and operate on it uniformly. Commands do not branch on space cardinality, do not branch on space "type", and do not own the question "is there an extension declared?". The only legitimate special case in the system is the migration-directory layout convention for the app space — and it lives in the materialisation pass, not in the apply orchestration.

This is the principle the M2 PR's primitives support but the M2 PR's orchestrator violates. This spec restores the principle.

### Three properties this slice must produce

1. **AC-13 holds end-to-end.** A user with an orphan marker row in their database (a marker for a space not declared in `extensionPacks`) cannot complete `db init` or `db update` — both fail with the same `MIGRATION.SPACE_ORPHAN_MARKER` (or whichever error code `verifyContractSpaces` raises) that `db verify` produces today. The error names the orphan space.
2. **AC-16 holds end-to-end.** A user who declares an extension in `extensionPacks` but has not yet run `migrate` (so no pinned `migrations/<space-id>/` exists) cannot complete `db init` or `db update`. Both fail with the same `declaredButUnmigrated` error class that `db verify` produces today.
3. **`db init` has one code path.** No conditional branch on `extensionContractSpaces.length`. The "no extensions declared" case is the trivial n=1 aggregate, walking the same `executePerSpaceDbApply` → `runner.executeAcrossSpaces` flow as the n=5 case.

### Verifier wiring contract

For `db init` and `db update`:

- **Precheck before any DB connection** (matches today's `db init` pattern; preserves the no-DB-needed property of the layout check).
- **Marker-check after DB connection but before any apply work** (matches today's `db verify` pattern; requires reading marker rows, which requires a connection but should fail closed before the runner does anything destructive).
- **Both checks fail closed.** A failure exits the operation with a structured `Result.notOk(...)` that the CLI command surfaces to the user.

The marker-check's invocation site reuses the existing pattern from `db verify`. Look at `packages/1-framework/3-tooling/cli/src/commands/db-verify.ts:381-389` and copy the call shape (it takes a `migrationsDir`, an `extensionPacks` list, and a function to read marker rows from the live database).

### Path-resolver seam

In `executePerSpaceDbApply` today, app and extension spaces are handled in two distinct code paths:

- **Extension spaces** are iterated (`for ext of extensionContractSpaces`) and each one calls `computeExtensionSpaceApplyPath` (which composes `findPathWithDecision` from ADR 208).
- **The app space** is handled separately: introspect live schema, prune extension-owned tables, run `planner.plan` against the introspected slice.

The path-resolver seam unifies these into:

```ts
type SpacePathResolver = {
  readonly spaceId: string;
  readonly migrationsDir: string;        // for materialisation (not used at apply)
  readonly resolve: (
    currentMarkerHash: string | null,
  ) => Promise<MigrationPlannerResult>;
};
```

For an extension: `resolve` returns the result of `computeExtensionSpaceApplyPath({ spaceId, currentMarkerHash, ... })`.

For the app: `resolve` introspects the live schema (once, hoisted out of the loop), prunes by every other space's pinned contract, and runs `planner.plan` against the pruned slice.

The orchestrator then concatenates resolvers per the cross-space ordering convention (extensions alphabetically by space-id, then app), iterates them in order calling `resolve(currentMarker)`, and builds the `perSpaceOptions` array passed to `runner.executeAcrossSpaces`.

The introspection is hoisted out of the per-space loop because (a) it's app-scoped (extensions don't introspect), and (b) it happens at most once.

### What the symmetric loop looks like

A sketch:

```ts
async function executePerSpaceDbApply(options) {
  const allMarkers = await readAllMarkers(driver);

  // Hoisted: app-only work.
  const introspectedSchema = await familyInstance.introspect({ driver });
  const prunedSchema = pruneSchemaByOtherSpaceContracts(
    introspectedSchema,
    options.extensionContractSpaces,
    migrationsDir,
  );

  const resolvers: SpacePathResolver[] = [
    ...options.extensionContractSpaces
      .map(ext => makeExtensionResolver(ext, migrationsDir))
      .sort(byAlphabeticalSpaceId),
    makeAppResolver(contract, planner, prunedSchema, frameworkComponents, policy),
  ];

  const perSpaceOptions = await Promise.all(
    resolvers.map(async r => ({
      space: r.spaceId,
      plan: (await r.resolve(allMarkers.get(r.spaceId)?.contractHash ?? null)).plan,
    })),
  );

  if (mode === 'plan') {
    return ok({ kind: 'plan', perSpacePlans: perSpaceOptions });
  }

  return runner.executeAcrossSpaces({
    driver,
    perSpaceOptions,
    onProgress,
  });
}
```

The conditional that distinguished "app vs extension" disappears. The only remaining type-distinction is *which resolver* is in the list — which is exactly the right place for the asymmetry to live.

### One-path `db init`

After the path-resolver seam exists, `executeDbInit` collapses to:

```ts
export async function executeDbInit(options) {
  const { extensionContractSpaces = [], migrationsDir, ...rest } = options;

  if (!migrationsDir) {
    throw new Error('executeDbInit: `migrationsDir` is required.');
  }

  return executePerSpaceDbApply({
    ...rest,
    migrationsDir,
    extensionContractSpaces,
    policy: { allowedOperationClasses: ['additive'] },
    action: 'dbInit',
  });
}
```

The `migrationsDir` parameter is now always required (the legacy single-space path didn't need it because it never read pinned artefacts). Document this in the JSDoc and update any caller that passes `migrationsDir: undefined`.

The "today's single-space path" code (lines 110–351 of the current `db-init.ts`) is deleted. The behaviours it provided — introspection, planning, idempotency check, runner.execute — are all subsumed by `executePerSpaceDbApply` walking an n=1 resolver list.

## Implementation slice — commit-by-commit

Land in this order. Each commit should leave the workspace green on `pnpm typecheck` + `pnpm test:packages`. The integration tests for AC-13 / AC-16 land in commit 1 (where the verifier wiring lands).

### Commit 1: wire marker-aware verifier into `db init` and `db update` (AC-13 + AC-16 lock)

**Files:**
- `packages/1-framework/3-tooling/cli/src/commands/db-init.ts` — add `runContractSpaceVerifierMarkerCheck` call after the existing `runContractSpaceVerifierPrecheck`, before the `client.dbInit(...)` call. Mirror the `db verify` invocation pattern (lines 381-389 of `db-verify.ts`).
- `packages/1-framework/3-tooling/cli/src/commands/db-update.ts` — add both `runContractSpaceVerifierPrecheck` and `runContractSpaceVerifierMarkerCheck` calls. Same precondition position (after DB connection, before any apply work).
- `test/integration/test/cli/db-init.contract-space-verifier.test.ts` (new) — covers AC-13 (`db init` rejects when an orphan marker exists in the DB) and AC-16 (`db init` rejects when an extension is declared but no pinned `migrations/<space-id>/` exists). Mirror the shape of an existing `db init` integration test for setup; use the `marker-check` test patterns for the assertion shape.
- `test/integration/test/cli/db-update.contract-space-verifier.test.ts` (new) — same pair, against `db update`. The orphan-marker case is more interesting on `db update` because (per the precheck-only history) it was completely uncovered.

**Don't:**
- Don't introduce a generalised "verify-first" decorator. Two explicit call sites are clearer than one abstraction over two callers.
- Don't change the verifier's API shape. `runContractSpaceVerifierMarkerCheck` is already correctly typed; callers compose it.

**Validation:** `pnpm test:packages` and `pnpm test:integration` (the new tests should fail before this commit and pass after). Plus `pnpm typecheck`.

### Commit 2: extract path-resolver seam in `executePerSpaceDbApply`

**File:** `packages/1-framework/3-tooling/cli/src/control-api/operations/db-apply-per-space.ts`.

Pure refactor — no behavioural change. Introduce `SpacePathResolver`; build resolvers for extensions (`makeExtensionResolver`) and for the app (`makeAppResolver`); replace the two-path body with the symmetric loop sketched above. Hoist introspection to once-per-call.

**Validation:** All existing tests stay green. Watch in particular:
- `packages/3-targets/6-adapters/sqlite/test/migrations/db-apply-per-space.cli.test.ts` — the e2e that locks the multi-space happy path.
- `packages/3-targets/6-adapters/postgres/test/migrations/runner.multi-space.integration.test.ts` — the failing-space rollback test that asserts on `MultiSpaceRunnerFailure.failingSpace`. The path-resolver refactor must not change the `failingSpace` semantics (the runner sees a list of `(space, plan)` inputs in cross-space order, applies them in order, and reports the failing one — the orchestrator's job is just to build the list correctly).

### Commit 3: collapse the dual `db init` path

**Files:**
- `packages/1-framework/3-tooling/cli/src/control-api/operations/db-init.ts` — replace the conditional dispatch + the legacy 240-line single-space path with the single `executePerSpaceDbApply` call shown in the sketch above. `executeDbInit` becomes ~25 lines.
- `packages/1-framework/3-tooling/cli/src/control-api/operations/db-init.ts` — update JSDoc and the `ExecuteDbInitOptions` interface: `migrationsDir` is now always required, not "required only when extensions are non-empty"; `extensionContractSpaces` defaults to `[]` (no behavioural difference in the new path).
- `packages/1-framework/3-tooling/cli/src/commands/db-init.ts` — confirm it always passes `migrationsDir` (it should already; the precheck call has needed it since M2).
- Search for callers of `executeDbInit` and `client.dbInit` across the workspace. Any caller that was relying on `migrationsDir: undefined` to opt into the legacy path needs to be updated to pass a real path. (Grep `executeDbInit\|\.dbInit(`.)
- Tests: any `db init` test that exercised the legacy path's specific behaviours (the "marker matches destination" idempotency short-circuit, the legacy result-envelope shape) needs to either be deleted (if its property is now covered by the per-space tests) or refactored to assert against the per-space result envelope.

**Validation:** `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`. The behavioural change to watch for:
- The legacy single-space `db init` had an explicit "marker matches destination → skip apply, return success" short-circuit. The per-space path achieves the same property differently — the planner returns an empty plan when prior=current, and the runner is a no-op on an empty plan. End-user behaviour is the same; some assertion details (logged messages, span timings) may shift. Update tests to match the new shape rather than restoring the old one.

### Commit 4: clean-up + docs

**Files:**
- `wip/contract-spaces-team-walkthrough.md` line 508 — change *"`db verify` rejects and names the orphan"* to *"any apply-or-verify path rejects and names the orphan."* (You can read line 508 to confirm the exact wording before editing.)
- `docs/architecture docs/adrs/ADR 211 - Contract spaces.md` — verify the table at lines 267–270 (`prisma-next migrate / db init / db apply / db verify` columns) is still accurate. If it needs to grow a column or note for the marker-check wiring, add it. The ADR's architectural claims do not need to change — the implementation now matches what the ADR already committed to.
- Any other doc that over-specified `db verify` as the rejector for marker-aware violations. Grep `db verify` in `docs/architecture docs/` for survey.

**Validation:** Doc changes only; `pnpm typecheck` + `pnpm lint:deps` should pass unchanged.

## Acceptance criteria

The slice is done when all of these hold:

1. ``rg "extensionContractSpaces.*length\|extensionContractSpaces\?\.length" packages/`` returns zero matches outside `executePerSpaceDbApply`'s argument-defaulting (no orchestrator-level cardinality branches).
2. The integration test for AC-13 (`db init` rejects orphan marker) is green. The same test on `db update` is green.
3. The integration test for AC-16 (`db init` rejects declared-but-unmigrated) is green. The same test on `db update` is green.
4. `executeDbInit` is one code path: no `if (extensionContractSpaces.length > 0)` branch. The function is ≤ 30 lines (compared to today's 351).
5. `executePerSpaceDbApply` has one symmetric loop over a `SpacePathResolver[]`. No `for (const ext of extensionContractSpaces)` followed by separate app-space code.
6. Every M2 / M3 / M4 / M5 test that was green before this slice is still green after the rebase cascade.
7. `pnpm lint:deps` ✓ (no layering regressions).
8. `pnpm typecheck` ✓ workspace-wide.
9. `pnpm test:packages` ✓ (modulo the pre-existing PGlite parallel-resource-contention flakes documented in earlier milestones — flag them by name if they recur, don't try to fix them).
10. `pnpm test:integration` ✓.
11. `pnpm build` ✓.
12. `wip/contract-spaces-team-walkthrough.md` line 508 reflects the new wiring (verifier runs in any apply-or-verify path, not `db verify` only).

## Rebase cascade

Once the four commits land on `tml-2397-codec-hooks-and-db-init-update` (the M2 branch), rebase the stack:

```bash
# M3 onto amended M2
git checkout tml-2397-cipherstash-contract-space
git rebase --onto tml-2397-codec-hooks-and-db-init-update <previous-M2-head> tml-2397-cipherstash-contract-space
# verify clean: pnpm lint:deps && pnpm typecheck && pnpm test:packages && pnpm test:integration
git push --force-with-lease

# M4 onto amended M3
git checkout tml-2397-pgvector-contract-space
git rebase --onto tml-2397-cipherstash-contract-space <previous-M3-head> tml-2397-pgvector-contract-space
# verify clean
git push --force-with-lease

# M5 onto amended M4
git checkout tml-2397-remove-database-dependencies-and-closeout
git rebase --onto tml-2397-pgvector-contract-space <previous-M4-head> tml-2397-remove-database-dependencies-and-closeout
# verify clean
git push --force-with-lease
```

Use `--force-with-lease` (not bare `--force`) for safety. The previous-head SHA for each branch is the tip of that branch _before_ the rebase — capture them before starting:

```bash
M2_OLD=$(git rev-parse tml-2397-codec-hooks-and-db-init-update)
M3_OLD=$(git rev-parse tml-2397-cipherstash-contract-space)
M4_OLD=$(git rev-parse tml-2397-pgvector-contract-space)
# (M5_OLD is the rebase target after M4 amends; doesn't need pre-capture)
```

**Why each rebase should be conflict-free:** I (the spec author) verified that M3 (cipherstash extension descriptor + tests), M4 (pgvector + monorepo example), and M5 (`databaseDependencies` removal + docs) do not touch `db-init.ts`, `db-update.ts`, or `db-apply-per-space.ts` substantively. The amendments at M2 affect only files those later milestones do not edit. If a conflict appears anyway, **stop and report** — it indicates an assumption mismatch worth investigating before resolving mechanically.

After each rebase, the gates **must** pass on that branch independently (don't batch all four rebases then run gates once — gate per branch, in stack order). This catches a regression at the closest point to its introduction.

If a gate fails after a rebase: investigate whether the failure is from your amendment or from rebase mechanics. Most likely cause is that a test in the rebased milestone made an assumption about the legacy `db init` path; update that test to match the new shape.

## Watchpoints (non-obvious gotchas)

1. **The `MigrationPlan.targetId` placeholder pattern.** `db-apply-per-space.ts:179, 237-240` patches `targetId` after app-space planning. The M2 review documents this as awkward-but-contained — don't touch it. Your refactor should preserve the placeholder-then-patch sequence inside `makeAppResolver`.
2. **`MultiSpaceRunnerFailure.failingSpace` semantics.** The Postgres `runner.multi-space.integration.test.ts` and SQLite `db-apply-per-space.cli.test.ts` both assert on `failingSpace`. This is the runner's responsibility, not the orchestrator's — but if your refactor changes the order of spaces in the `perSpaceOptions` array, the runner reports a different `failingSpace`. Preserve `concatenateSpaceApplyInputs`'s ordering convention (extensions alphabetically, then app) literally.
3. **`ensureControlTables` runs once per space inside `executeOnConnection` today.** The M2 review flags this as a redundant N-round-trip cost in the "Risks" section. Out of scope for this slice — leave the per-space invocation as-is. (A separate cleanup ticket could hoist it to outer-transaction scope.)
4. **The `SqlMigrationRunnerExecuteOptions.space?` parameter** defaults to `'app'`. After the consolidation, `runner.execute` (single-space) still exists for callers that don't go through `executeAcrossSpaces` (e.g. some test fixtures). Don't delete `runner.execute`.
5. **`hasMultiSpaceRunner` capability check.** Today this fires when `extensionContractSpaces.length > 0`. After consolidation it should fire unconditionally (every `db init`/`db update` goes through `executeAcrossSpaces`). Update the check + its error message.
6. **`buildContractSpaceVerifierError` is duplicated** between the precheck and marker-check helpers. The M2 review's recommendation 5 calls this out. **Out of scope for this slice** — extracting it doesn't affect AC-13/AC-16 satisfaction. Capture as a follow-up if you have spare cycles after the rebase cascade.
7. **Pre-existing test-suite flakes.** Pattern: PGlite parallel-resource-contention timeouts in postgres-adapter tests under heavy turbo parallelism. Pass cleanly when re-run isolated. Documented as Open Item #4 in the project plan; if you see them, flag by name and re-run rather than treat as regressions.
8. **Don't touch the project plan.** `projects/extension-contract-spaces/` was deleted in the M5 close-out (it's not on disk; `wip/system-design-review-m2.md` references paths that no longer exist via the relative `../../` link). All design decisions made by this spec are recorded here and (after merge) in the commit history; no project artefacts to update.

## What to push back on

If during execution any of the following surfaces, **stop and report rather than work around**:

- A rebase conflict in M3/M4/M5 against your M2 amendment. The spec assumes none. A conflict means an assumption was wrong; investigate before resolving.
- A pre-existing test that pins behaviour the legacy `db init` path provided that the per-space path can't replicate (e.g. an exact error-message string only the legacy path produced). Most likely the test should be updated to assert on the new shape, but if the property genuinely matters, surface it.
- A consumer of `executeDbInit` outside `packages/1-framework/3-tooling/cli/` that relies on `migrationsDir: undefined` to opt into the legacy path. Spec assumes this doesn't exist (verified by the author for tracked source files only); flag if found.

## What to deliver

A 4-commit stack on `tml-2397-codec-hooks-and-db-init-update` (force-pushed after rebase) plus three force-pushed downstream branches (M3/M4/M5). All gates green on each branch. Brief return summary of:

- Commit shas + 1-line message for each.
- Any deviations from this spec, with rationale.
- Any pre-existing flakes encountered (by test name).
- Confirmation that all 12 acceptance criteria above hold.

If the user wants ADR 211 amended (e.g. to add a "Verifier runs as precondition for any apply or verify command" sentence at line 197), capture that as a recommendation in the return summary rather than landing it — it's editorial, not load-bearing for the fix.
