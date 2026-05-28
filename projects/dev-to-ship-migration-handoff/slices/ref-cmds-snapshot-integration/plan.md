# Slice plan: `ref set` / `ref delete` — snapshot integration

**Spec:** [`./spec.md`](./spec.md)
**Parent project:** [`projects/dev-to-ship-migration-handoff/`](../../)
**Parent plan position:** Parallel group A (see [project plan](../../plan.md))

## Validation gate

```bash
pnpm typecheck
pnpm vitest run                          # direct in @prisma-next/cli
pnpm vitest run                          # direct in test/integration/
pnpm lint:deps
pnpm build                               # full workspace (the migration-tools dist may not be stale, but the build playbook gotcha from Slice 4 makes a full build the safe default)
pnpm fixtures:check
```

### Grep gates

```bash
rg "from '[^']+\.(ts|tsx|js|jsx)'" packages/1-framework/3-tooling/cli/src/commands/ref.ts 2>/dev/null
rg ': any\b|\bany\[\]' packages/1-framework/3-tooling/cli/src/commands/ref.ts 2>/dev/null
rg '@ts-expect-error' packages/1-framework/3-tooling/cli/src/commands/ref.ts 2>/dev/null
rg 'writeRef\b|deleteRef\b' packages/1-framework/3-tooling/cli/src/commands/ref.ts 2>/dev/null   # expect zero matches — replaced by writeRefPaired/deleteRefPaired
rg 'projects/dev-to-ship-migration-handoff' packages/1-framework/3-tooling/cli/src/ 2>/dev/null
```

## Dispatch plan

### Dispatch 1: `ref set` enforcement + paired snapshot synthesis + `ref delete` cascade

**Intent.** Wire Slice 1's `writeRefPaired` and `deleteRefPaired` primitives into `ref set` and `ref delete`. Add the universal "from must be a graph node" enforcement on `ref set`. Add a regression test for `ref list` ignoring paired snapshot files.

**Files in play.**

- Modified: `packages/1-framework/3-tooling/cli/src/commands/ref.ts`:
  - `executeRefSetCommand`: graph-node check, bundle lookup, `readContractIR`, `writeRefPaired`. ~30 LoC of changes.
  - `executeRefDeleteCommand`: swap `deleteRef` → `deleteRefPaired`. 1-line change.
  - `executeRefListCommand`: unchanged.
- Modified: `packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts`:
  - Add `errorRefSetHashNotInGraph(resolvedHash, reachableHashes, graphTipHash?)`. Mirror `errorPlanForgotTheFlag`'s shape; consider extracting a shared base if the reuse case is clean (spec OQ2).
  - Add `errorRefSetEmptySentinel(hash)`. Small dedicated factory for the `EMPTY_CONTRACT_HASH` refuse.
- Modified: `packages/1-framework/3-tooling/cli/test/commands/ref.test.ts` (if exists) OR new `ref.test.ts`:
  - Unit tests per spec § Scope > In scope > Tests > Unit tests.
- New: `test/integration/test/cli.ref-snapshot-integration.e2e.test.ts`:
  - End-to-end `ref set` → `ref list` → `ref delete` round-trip.
  - Refuse-path assertions for `MIGRATION.HASH_NOT_IN_GRAPH` + `EMPTY_CONTRACT_HASH` sentinel.

**"Done when":**

- [ ] `pnpm typecheck` clean.
- [ ] `pnpm vitest run` direct in `@prisma-next/cli` clean.
- [ ] `pnpm vitest run` direct in `test/integration/` clean (the new e2e file at minimum).
- [ ] `pnpm lint:deps` clean.
- [ ] `pnpm build` clean.
- [ ] `pnpm fixtures:check` clean.
- [ ] All 22 spec § Edge cases rows have explicit tests OR explicit "regression covered by existing X" annotation.
- [ ] Grep gates from § Grep gates: zero matches (no lingering `writeRef`/`deleteRef` calls in `ref.ts`).
- [ ] **Intent-validation:** Diff matches the spec exactly. No subsystem-doc edits, no skill edits, no `@prisma-next/migration-tools/` source modifications.

**Edge cases (this dispatch):** All 22 rows from spec § Edge cases.

**Failure modes to avoid (per Drive calibration):**

- **F3 (reconnaissance before assuming):**
  - `rg 'parseContractRef|validateRefValue' packages/1-framework/3-tooling/cli/src/commands/ref.ts -C 5` — confirm the existing resolution flow.
  - `rg 'parseContractRef' packages/1-framework/3-tooling/migration/src/ref-resolution/ -C 5` — does `parseContractRef` accept paths today? (Per the existing inline call, it accepts hash-or-name; paths may not be in scope.)
  - `rg 'metadata\.to|metadata\.from' packages/1-framework/3-tooling/migration/src/` — confirm `OnDiskMigrationPackage.metadata` field names match the spec's working position.
  - `rg 'EMPTY_CONTRACT_HASH|isGraphNode' packages/1-framework/3-tooling/migration/src/exports/` — confirm import paths.
  - `rg 'errorPlanForgotTheFlag|MIGRATION.HASH_NOT_IN_GRAPH' packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts -C 10` — read Slice 3's existing factory to decide on reuse (spec OQ2).
  - `rg 'cli.ref|ref.test' test/integration/test/ packages/1-framework/3-tooling/cli/test/` — find existing ref-test fixtures + reuse helpers.
  - `rg 'readContractIR' packages/1-framework/3-tooling/cli/src/utils/ref-advancement.ts -C 8` — confirm the helper signature for the bundle snapshot read.
- **F4** — explicit WIP inspection if dispatch > ~30 min.
- **F5** — destructive git operations forbidden.

**Out of scope (this dispatch):**

- Documentation updates (Stack 5).
- `ref invariants` subcommands.
- `ref show` subcommand.
- Removing legacy `writeRef`/`deleteRef` exports from `@prisma-next/migration-tools/refs`.

**Size.** S–M. The surface is small; the meatier piece is the bundle lookup + `errorRefSetHashNotInGraph` factory.

**Tier.** `composer-2.5-fast` (mechanical-shaped; pattern established by Slice 2 and Slice 3 refuse-path factories).

**DoR confirmed:** [✓]

---

## Dispatch sequence

```
Dispatch 1 (S-M, ref set enforcement + ref delete cascade + ref list regression)
```

Total: 1 dispatch. If the implementer reports unexpected complexity, follow-up dispatch is permissible per spec § OQ4.

## Slice-DoD coverage map

| Slice-DoD | Delivered by |
|---|---|
| **SDoD1.** Validation gates pass | Dispatch 1 final gate |
| **SDoD2.** Edge cases handled per disposition | Dispatch 1 "Done when" |
| **SDoD3.** Reviewer SATISFIED | Per drive-build-workflow |
| **SDoD4.** Manual-QA | Light — slice-close decision (extend an existing slice's `manual-qa.md` or skip if e2e is sufficient) |
| **SDoD5.** No out-of-scope surfaces touched | Each dispatch's intent-validation |
| **SDoD6.** Existing tests pass unmodified | Validation gate |
| **SDoD7.** No public-export drift | `pnpm lint:deps` |

## Open items at slice close

The spec's four open questions are dispatch-time decisions:

- OQ1 (`EMPTY_CONTRACT_HASH` ref-set disposition) — Dispatch 1 settles per working position (refuse).
- OQ2 (error factory reuse between Slice 3 and Parallel A) — Dispatch 1 settles.
- OQ3 (`ref set --no-snapshot` opt-out) — explicitly deferred; not addressed.
- OQ4 (sizing: 1 or 2 dispatches) — Dispatch 1 settles by completion.

## Risks (slice-level)

1. **`parseContractRef` resolution semantics.** If `parseContractRef` already routes paths or other input forms in ways the spec didn't anticipate, the graph-node check applies uniformly to the resolved hash — the input form doesn't matter. Verify at dispatch time.
2. **`errorRefSetHashNotInGraph` vs `errorPlanForgotTheFlag` factoring.** If the reviewer prefers strict separation (different commands, different error codes), the duplication is minor. If they prefer extraction (one shared `errorHashNotInGraph` factory + per-command meta-code), the refactor is small and can land in this dispatch. Spec OQ2 captures this.
3. **Test fixture churn.** Existing `ref.test.ts` tests likely use `writeRef` directly to set up state; the new tests use `writeRefPaired` (or seed both files manually). Verify which fixture pattern is established before adding new tests.
