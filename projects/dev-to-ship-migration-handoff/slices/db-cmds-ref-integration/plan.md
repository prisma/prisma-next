# Slice plan: `db init` / `db update` — ref-write integration

**Spec:** [`./spec.md`](./spec.md)
**Parent project:** [`projects/dev-to-ship-migration-handoff/`](../../)
**Parent plan position:** Stack 2 (see [project plan](../../plan.md))

## Validation gate (slice-level, inherited by every dispatch)

```bash
pnpm typecheck                                                            # always
pnpm turbo test --filter @prisma-next/cli                                 # cli package unit + integration
pnpm test:integration                                                     # full integration suite (PGlite + Mongo)
pnpm lint:deps                                                            # package boundaries
pnpm build --filter @prisma-next/cli                                      # refresh dist
pnpm fixtures:check                                                       # no fixture drift expected
```

Per-commit gate (during a dispatch): `pnpm typecheck` and grep gates from § Grep gates.
End-of-dispatch gate: the full block above (selective during iteration is fine; full block once at dispatch close).

### Grep gates

Run after every dispatch:

```bash
# No file-extension imports anywhere in new code:
rg "from '[^']+\.(ts|tsx|js|jsx)'" packages/1-framework/3-tooling/cli/src/commands/db-init.ts packages/1-framework/3-tooling/cli/src/commands/db-update.ts packages/1-framework/3-tooling/cli/src/utils/ref-advancement.ts 2>/dev/null

# No `any` in new code:
rg ': any\b|\bany\[\]' packages/1-framework/3-tooling/cli/src/commands/db-init.ts packages/1-framework/3-tooling/cli/src/commands/db-update.ts packages/1-framework/3-tooling/cli/src/utils/ref-advancement.ts 2>/dev/null

# No @ts-expect-error in new code:
rg '@ts-expect-error' packages/1-framework/3-tooling/cli/src/commands/db-init.ts packages/1-framework/3-tooling/cli/src/commands/db-update.ts packages/1-framework/3-tooling/cli/src/utils/ref-advancement.ts 2>/dev/null

# No @ts-nocheck:
rg '@ts-nocheck' packages/1-framework/3-tooling/cli/src/ 2>/dev/null

# No transient project-artefact references in source (per doc-maintenance rule):
rg 'projects/dev-to-ship-migration-handoff' packages/1-framework/3-tooling/cli/src/ 2>/dev/null
```

Each grep gate expects **zero matches** to pass.

## Dispatch plan

### Dispatch 1: Ref-advancement helper + formatter envelope extension

**Intent.** Add a single shared helper that computes the ref-advancement decision (which name, if any) and performs the write, plus extend the `MigrationCommandResult` envelope with the new `advancedRef` / `plannedAdvanceRef` fields. **Nothing in `db-init.ts` or `db-update.ts` is wired up yet** — this dispatch is library-shaped: pure functions, formatters, unit tests. No CLI surface change visible to end users yet.

**Files in play.**

- New: `packages/1-framework/3-tooling/cli/src/utils/ref-advancement.ts` — helper (~100 LoC).
  - `computeRefAdvancementName(options: { advanceRef?: string; db?: string }): string | null` — pure function: returns the ref name (or null if no advancement) per the implicit-`db`-default rule. Returns `null` when `--db` is provided and `--advance-ref` is not.
  - `executeRefAdvancement(refsDir, name, hash, contractJson): Promise<{ name; hash }>` — writes the pair via Slice 1's `writeRefPaired`. Returns the advanced ref details for output formatting. Throws on failure (existing `MigrationToolsError` flow, mapped by callers via `mapMigrationToolsError`).
- New: `packages/1-framework/3-tooling/cli/test/utils/ref-advancement.test.ts` — unit tests (~120 LoC).
  - All four matrix cases of `computeRefAdvancementName` (default+no-flag → `'db'`; default+flag → flag; non-default+no-flag → null; non-default+flag → flag).
  - `executeRefAdvancement` round-trip against a tmp `refsDir`: writes pointer + json + dts files.
  - `executeRefAdvancement` failure surface: simulated `writeRefPaired` throw propagates as a `MigrationToolsError`.
- Modified: `packages/1-framework/3-tooling/cli/src/utils/formatters/migrations.ts` — extend `MigrationCommandResult` interface with two optional fields (`advancedRef`, `plannedAdvanceRef`) and update `formatMigrationApplyOutput`, `formatMigrationPlanOutput`, `formatMigrationJson` to surface them.
- Modified: `packages/1-framework/3-tooling/cli/test/utils/formatters/migrations.test.ts` (or wherever the formatter tests live — identify via grep at dispatch start) — extend existing tests to cover the new fields' presence + absence cases. **No existing test should change shape** beyond adding the new field assertions.

**"Done when":**

- [ ] `pnpm typecheck` clean.
- [ ] `pnpm turbo test --filter @prisma-next/cli` clean, including new `ref-advancement.test.ts`.
- [ ] `pnpm lint:deps` clean.
- [ ] `pnpm build --filter @prisma-next/cli` clean; new exports surface in `dist/*.d.mts`.
- [ ] `pnpm fixtures:check` clean.
- [ ] `computeRefAdvancementName`'s four matrix rows have explicit test coverage.
- [ ] `executeRefAdvancement` round-trips through `writeRefPaired` (verify pointer + snapshot files land).
- [ ] Formatter tests cover both "field present" and "field absent" (null) cases for both apply and dry-run modes.
- [ ] **Intent-validation:** diff matches above intent. **`db-init.ts` and `db-update.ts` are NOT modified.** No command-action wiring yet.
- [ ] Grep gates pass with zero matches.

**Edge cases (this dispatch's portion):**

| Edge case | Disposition |
|---|---|
| `--advance-ref` provided, `--db` provided | Helper returns the explicit ref name (explicit always wins). |
| `--advance-ref` provided, `--db` not provided | Helper returns the explicit ref name. |
| `--advance-ref` not provided, `--db` not provided | Helper returns `'db'` (implicit). |
| `--advance-ref` not provided, `--db` provided | Helper returns `null` (no advancement). |
| `--advance-ref ''` (empty string) | Pass-through to Slice 1's `validateRefName`, which rejects with `MIGRATION.INVALID_REF_NAME`. Helper does not pre-validate; that's `writeRefPaired`'s contract. Test asserts the error code surfaces. |
| `executeRefAdvancement` called with a missing `refsDir` parent | Helper relies on `writeRefPaired`'s `mkdir -p` semantics (verify at dispatch start — if Slice 1's primitive doesn't do this today, add a `mkdir -p` step here before calling `writeRefPaired`). Test covers fresh-project case. |

**Failure modes to avoid:**

- **F3 (discovery via test suite instead of grep)** — before writing the helper, run `rg 'writeRef\b' packages/1-framework/3-tooling/migration/src/` to confirm whether existing `writeRef` does `mkdir -p`; check Slice 1's `writeRefPaired` source for the same behaviour. If neither does, this dispatch adds the dir creation in the helper.
- **F3** — `rg 'MigrationCommandResult' packages/1-framework/3-tooling/cli/src/` to find every place the envelope is consumed; if test envelopes assert exact shape, those tests need additive updates in this dispatch.
- **F5** — destructive git operations forbidden without orchestrator approval.

**Out of scope (this dispatch):**

- Touching `db-init.ts` or `db-update.ts`. Dispatch 2 wires the helper into both commands.
- Integration tests against a live (PGlite/Mongo) DB. Dispatch 2 covers those.

**Size.** M. New helper file + formatter envelope extension + unit tests + (possibly) formatter test updates.

**Tier.** `composer-2.5-fast` (mechanical-shaped: pure helper + envelope extension follow well-trodden patterns in the cli package).

**DoR confirmed:** [✓]

---

### Dispatch 2: Wire helper into `db init` + `db update` + integration tests

**Intent.** Now wire Dispatch 1's helper into both commands. Add `--advance-ref <name>` flag to both, call the helper post-`client.dbUpdate` / `client.dbInit` success, populate the result envelope's new fields, and verify the end-to-end behaviour via integration tests against PGlite + Mongo fixtures.

**Files in play.**

- Modified: `packages/1-framework/3-tooling/cli/src/commands/db-init.ts` — add `--advance-ref <name>` option; call helper in success branch; populate envelope.
- Modified: `packages/1-framework/3-tooling/cli/src/commands/db-update.ts` — same shape.
- Modified: integration test files (identify exact paths via grep — likely `packages/1-framework/3-tooling/cli/test/integration/db-init.integration.test.ts` and `db-update.integration.test.ts`, or sibling locations; verify at dispatch start). Add tests for the four matrix cases of § Spec scope.
- Likely touched: `cli-errors.ts` (verify `mapMigrationToolsError` surfaces `MIGRATION.INVALID_REF_NAME` cleanly — if it doesn't, add a mapping). Discovery via grep at dispatch start.

**"Done when":**

- [ ] Full validation gate from § Validation gate passes (the full block, all six commands).
- [ ] Integration tests cover all four matrix cases from spec § Scope > In scope (default + no-flag, default + flag, non-default + no-flag, non-default + flag). Each command (`db init`, `db update`) gets its own set; no shared scaffolding shortcuts that hide the matrix.
- [ ] Dry-run mode: no file writes; planned-advancement reported in output and JSON envelope.
- [ ] Apply failure: no ref written; existing apply-failure tests still pass.
- [ ] `--advance-ref` with a slashed name (`refs/staging/v1`) round-trips through the helper.
- [ ] `--advance-ref` with an invalid name surfaces `MIGRATION.INVALID_REF_NAME` as a `CliStructuredError` (not a stack trace).
- [ ] Apply succeeds + ref-write fails (disk-full injection or similar) surfaces a `CliStructuredError` with the underlying `MIGRATION.*` code in `meta` (NFR6); exit code non-zero; DDL is **not** rolled back.
- [ ] **Intent-validation:** the helper's logic is **not duplicated** in either command — both call into Dispatch 1's helper via a single line.
- [ ] WIP inspection at ~30 min wallclock: confirm at least one integration test (the default + no-flag case for `db update`) passes end-to-end before continuing; if it doesn't, course-correct on the wiring shape.
- [ ] Grep gates pass.

**Edge cases (this dispatch's portion):**

| Edge case | Disposition |
|---|---|
| `db update --to <ref>` + default DB + no `--advance-ref` | Implicit `db` advances to the **applied** hash (which came from the `--to`'s target bundle's `end-contract.json`, not the current contract). Test covers. |
| `db update --to <ref>` + `--advance-ref staging` | `staging` advances to the applied hash; default `db` is not touched. Test covers. |
| `db init` against a fresh project (no `migrations/app/refs/` dir yet) | Helper / `writeRefPaired` creates the dir; first ref + snapshot lands cleanly. Test covers the fresh-init scenario. |
| Apply succeeds, ref write throws | `CliStructuredError` propagated; exit code non-zero; DDL stays applied. Integration test injects via Slice 1's failure-injection harness (or, if not feasible at the integration layer, leave to Dispatch 1's unit test for the helper path + document the end-to-end behaviour in the manual-QA script). |
| `--json` flag + advancement | JSON envelope's `advancedRef` field populated. Test parses + asserts. |
| `--json` flag + no advancement (e.g. `--db` provided, no `--advance-ref`) | JSON envelope's `advancedRef` field is `null`. Test asserts. |
| `--dry-run` + `--json` | JSON envelope's `plannedAdvanceRef` field populated; `advancedRef` is null. Test asserts. |

**Failure modes to avoid:**

- **F3 (discovery via test suite)** — locate integration-test harness shape before writing tests. `rg 'integration\.test\.ts' packages/1-framework/3-tooling/cli/test/` and `rg 'PGlite|pglite' packages/1-framework/3-tooling/cli/test/integration/` to find prior art.
- **F4 (no inspection cadence)** — explicit mid-dispatch WIP inspection.
- **F5** — destructive git operations forbidden.

**Out of scope (this dispatch):**

- `migrate` command — Slice 4 of project.
- `migration plan` resolution path — Slice 3 of project.
- `ref set` / `ref delete` — parallel-group-A slice.
- Manual-QA script — separate authoring step at slice close.

**Size.** M (borderline; could approach the M-cap upper bound depending on how much integration-test scaffolding lands). If sizing escalates to L during pre-implementation reconnaissance, escalate to orchestrator for re-decomposition (split integration tests into Dispatch 3).

**Tier.** `composer-2.5-fast` (mechanical: thin wrapper + integration-test extension; the wiring pattern is well-trodden in both commands).

**DoR confirmed:** [✓]

---

## Dispatch sequence

```
Dispatch 1 (M, helper + envelope extension; library-shaped)
       ↓
Dispatch 2 (M, command wiring + integration tests; end-to-end shaped)
```

Total: 2× M, both at the M-cap. Dispatch 2's WIP inspection is the safety valve — if integration-test scaffolding sprawls, escalate before continuing.

## Slice-DoD coverage map

| Slice-DoD | Delivered by |
|---|---|
| **SDoD1.** Validation gates pass | Both dispatches; final gate at slice close |
| **SDoD2.** Edge cases handled per disposition | Each dispatch's "Done when" enumerates its slice-spec edge cases |
| **SDoD3.** Reviewer SATISFIED on `code-review.md` | Per drive-build-workflow loop after Dispatch 2 |
| **SDoD4.** Manual-QA script authored (not executed) | Slice close-out (`drive-qa-plan` invocation; lands at `./manual-qa.md`) |
| **SDoD5.** No out-of-scope surfaces touched | Each dispatch's "Out of scope" + intent-validation |
| **SDoD6.** Existing tests pass unmodified (envelope-shape exception per spec § SDoD6) | Validation gate + intent-validation |
| **SDoD7.** No public-export drift | `pnpm lint:deps` clean |

## Open items

The spec's four open questions (OQ1–OQ5) are dispatch-time decisions:

- OQ1 (extract `--advance-ref` into `addMigrationCommandOptions`) — Dispatch 2 settles per spec working position (keep command-local).
- OQ2 (JSON field naming) — Dispatch 1 settles per spec working position (two fields).
- OQ3 (test file layout) — Dispatch 2 settles via discovery.
- OQ4 (`mkdir -p` for ref dir) — Dispatch 1 verifies + settles.
- OQ5 (`--space` flag interaction) — Dispatch 2 verifies via grep; documents in manual-QA script if applicable.
