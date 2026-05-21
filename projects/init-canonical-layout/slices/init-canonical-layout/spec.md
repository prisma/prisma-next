# Slice: init-canonical-layout

_Parent project: [`projects/init-canonical-layout/`](../../). This slice satisfies all FRs (FR1–FR6) from the project spec — single-slice project._

## At a glance

Move `prisma-next init`'s default scaffold from `prisma/` to canonical `src/prisma/`, consolidating the layout convention behind a single `DEFAULT_PRISMA_DIR` constant the three call sites derive from, and adding a `--reinit` warning so users on the legacy layout can detect the dual-layout state.

## Scope

### In scope

- `packages/1-framework/1-core/config/src/config-types.ts` — introduce `DEFAULT_PRISMA_DIR`; re-express `DEFAULT_CONTRACT_OUTPUT` in terms of it.
- `packages/1-framework/1-core/config/src/exports/config-types.ts` — export the new constant.
- `packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates.ts` — `defaultSchemaPath` derives from `DEFAULT_PRISMA_DIR`.
- `packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts:102` — runtime fallback derives from `DEFAULT_CONTRACT_OUTPUT`.
- `packages/1-framework/3-tooling/cli/src/commands/init/init.ts` — new precondition branch under `--reinit` for legacy-layout detect-and-warn.
- `packages/1-framework/3-tooling/cli/src/commands/init/index.ts:75` — flag help text update.
- `packages/1-framework/3-tooling/cli/src/commands/contract-infer.ts:107` — usage example update.
- `packages/1-framework/3-tooling/cli/src/commands/init/hygiene-gitattributes.ts` — explanatory-comment updates.
- Init test surface (`packages/1-framework/3-tooling/cli/test/commands/init/*.test.ts` — ~6 files) and `packages/1-framework/3-tooling/cli/test/utils/command-helpers.test.ts` — assertion updates to canonical default.
- New test asserting the `--reinit` detect-and-warn fires on legacy layout.

### Out of scope (this slice)

- Deleting or moving legacy `prisma/` content during `--reinit` (surfaced via warning only).
- Promoting the `'prisma'` legacy literal in the detect-and-warn branch to a named constant.
- Detecting non-canonical project shapes (Deno without `src/`, monorepo package consumers, brownfield layouts). `--schema-path` continues to handle those.
- ADR 212 contract-space-package layout. Verified non-interfering — extension packages do not go through `init`.
- `.gitattributes` cleanup of legacy `prisma/contract.*` linguist-generated lines on `--reinit` (file is git-tracked user content; deletion-class risk).
- Any change to `--schema-path` semantics.

## Approach

The consolidation and the user-visible default flip ride together in one PR (D3 of the project's design-decisions log). The new constant pulls together three previously-independent declarations; the test surface updates are mechanical assertion swaps that follow the default-flip; the `--reinit` detect-and-warn is the user-recoverability story for the cohort already on the legacy layout. Splitting any of these into separate slices ships an intermediate state in which the project tells inconsistent stories about the default layout.

`init.ts` already derives `db.ts`'s path from `dirname(schemaPath)`, so the new schema root carries `db.ts` along automatically — no separate code change for `db.ts` placement.

Cross-package dependency note: `cli` already consumes `@prisma-next/.../config` (lint:deps green today); the new import of `DEFAULT_PRISMA_DIR` rides that existing edge.

## Edge cases (Example-Mapping)

| Edge case | Disposition | Notes |
|---|---|---|
| Fresh `init` in empty dir, postgres + psl | Handle | Scaffolds `src/prisma/contract.prisma` + `src/prisma/db.ts`. |
| Fresh `init`, postgres + typescript | Handle | Scaffolds `src/prisma/contract.ts` + `src/prisma/db.ts`. |
| Fresh `init`, mongo + psl | Handle | Same shape under mongo target. |
| Fresh `init`, mongo + typescript | Handle | Same. |
| `init --schema-path my/path.prisma` overriding default | Handle | Override path continues to win; `db.ts` follows `dirname(my/path.prisma)`. |
| `init --reinit` against project with all four legacy files (`prisma/contract.{prisma,ts,json,d.ts}`, `prisma/db.ts`) | Handle | Warning names every present legacy file + cleanup hint. |
| `init --reinit` against project already on `src/prisma/` | Handle | No warning; standard reinit behaviour unchanged. |
| `init --reinit` against project with partial legacy state (e.g. only `prisma/contract.prisma`) | Handle | Warning names only the files actually present. |
| `init` against project where `prisma/` exists with unrelated user content (no recognised legacy files) | Handle | No warning fires; user content untouched. |
| Existing `.gitattributes` lines for legacy `prisma/contract.*` | Explicitly out | Not cleaned up; surfaced in the warning text so the user knows to remove manually. |
| Cross-package import (`cli` → `config` for `DEFAULT_PRISMA_DIR`) | Handle | `pnpm lint:deps` must remain green; gate of the dispatch. |
| Contract-space packages (ADR 212 carve-out) | Explicitly out | Verified by Grep: `init/` has no contract-space concepts; carve-out packages set `output` explicitly. |
| Brownfield project with custom `src/` layout (e.g. `src/lib/prisma/`) | Explicitly out | User supplies `--schema-path`. Not a regression. |
| `db.ts` placement continues to follow `dirname(schemaPath)` | Handle | Regression-covered by existing tests after assertion updates. |
| `config-validation.test.ts` already asserts `'src/prisma/contract.json'` (lines 450, 510) | Handle | These continue to pass against the re-expressed `DEFAULT_CONTRACT_OUTPUT`. |

## Slice Definition of Done

- [ ] **SDoD1.** All "Done when" gates from the slice plan pass: `pnpm typecheck`, `pnpm test:packages` (full workspace), `pnpm lint:deps`. Diff matches brief intent.
- [ ] **SDoD2.** Every pre-named edge case handled per disposition.
- [ ] **SDoD3.** Reviewer verdict: SATISFIED on `projects/init-canonical-layout/reviews/code-review.md`.
- [ ] **SDoD4.** Manual-QA per project PDoD6: clean `prisma-next init --yes --target postgres --authoring psl` in a scratch dir produces the same on-disk shape as `examples/prisma-next-demo/src/prisma/`. Run report appended to `projects/init-canonical-layout/manual-qa.md`.
- [ ] **SDoD5.** Slice doesn't touch out-of-scope surfaces (no extension packages; no `--schema-path` semantic changes; no automated deletion of legacy `prisma/`).
- [ ] **SDoD6.** PR title includes `(TML-2532)` for Linear auto-close.

## Open Questions

None blocking. Working positions land in `../../design-notes.md`.

## References

- Parent project spec: [`../../spec.md`](../../spec.md)
- Project plan: [`../../plan.md`](../../plan.md)
- Design notes: [`../../design-notes.md`](../../design-notes.md)
- Design decisions log: [`../../design-decisions.md`](../../design-decisions.md)
- Linear: [TML-2532](https://linear.app/prisma-company/issue/TML-2532)
- ADR 212 (carve-out, unaffected): [`docs/architecture docs/adrs/ADR 212 - Contract spaces.md`](../../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md)

## Dispatch plan

### Dispatch 1: Consolidate `DEFAULT_PRISMA_DIR` + sweep stale text + update test surface

**Intent.** Introduce `DEFAULT_PRISMA_DIR = 'src/prisma'` in `config-types.ts`. Re-express `DEFAULT_CONTRACT_OUTPUT` as `${DEFAULT_PRISMA_DIR}/contract.json`. Update `defaultSchemaPath` and `command-helpers.ts:102` to derive from the new constant. Sweep stale `prisma/contract.*` references in `index.ts:75`, `contract-infer.ts:107`, and `hygiene-gitattributes.ts` comments. Update init + `command-helpers` test files to assert against `src/prisma/...`. **No new behaviour** — pure consolidation + default flip + test surface update.

**Files in play.**
- `packages/1-framework/1-core/config/src/config-types.ts`
- `packages/1-framework/1-core/config/src/exports/config-types.ts`
- `packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates.ts`
- `packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts`
- `packages/1-framework/3-tooling/cli/src/commands/init/index.ts`
- `packages/1-framework/3-tooling/cli/src/commands/contract-infer.ts`
- `packages/1-framework/3-tooling/cli/src/commands/init/hygiene-gitattributes.ts`
- `packages/1-framework/3-tooling/cli/test/commands/init/init.test.ts`
- `packages/1-framework/3-tooling/cli/test/commands/init/hygiene.test.ts`
- `packages/1-framework/3-tooling/cli/test/commands/init/templates.test.ts`
- `packages/1-framework/3-tooling/cli/test/commands/init/reinit-cleanup.test.ts`
- `packages/1-framework/3-tooling/cli/test/utils/command-helpers.test.ts`
- (Verify, don't change: `packages/1-framework/1-core/config/test/config-validation.test.ts:450, 510` — already canonical.)

**Edge cases covered.** Fresh-init shapes (psl/ts × postgres/mongo); `--schema-path` override; cross-package import; `db.ts` derivation; `config-validation.test.ts` assertion continuity.

**Done when.**
- [ ] `pnpm typecheck` green workspace-wide.
- [ ] `pnpm test:packages` green workspace-wide.
- [ ] `pnpm lint:deps` green (cross-package dependency direction unchanged).
- [ ] `rg "'prisma/contract\\.|\\\"prisma/contract\\." packages/` returns no matches outside the legacy-detect branch in `init.ts` (added in D2) and `hygiene-gitattributes.ts`' historical-context comments (which read `src/prisma/...` after this dispatch).
- [ ] Exactly one occurrence of the string literal `'src/prisma'` in `packages/1-framework/1-core/config/src/config-types.ts` (the `DEFAULT_PRISMA_DIR` definition).
- [ ] Intent-validation: diff is scoped to files-in-play; no source files outside this list are modified.

**Predicted size.** M (~15 files, mostly mechanical assertion swaps + one new constant + 4 small derivation rewires; ≤ 2 hr implementer time).

**Out of scope (this dispatch).** The new `--reinit` warning branch — that's D2. Any change to `--schema-path` semantics.

### Dispatch 2: `--reinit` detect-and-warn for legacy layout + test

**Intent.** Add a precondition-phase branch in `init.ts` that detects co-located legacy `prisma/contract.{prisma,ts,json,d.ts}` or `prisma/db.ts` files alongside the now-default `src/prisma/` scaffold (only fires under `--reinit`), and appends a structured warning naming every present legacy file plus a manual-cleanup hint. **No file deletion.** New unit/integration test asserts the warning fires on legacy layouts and is silent on canonical / unrelated-content cases.

**Files in play.**
- `packages/1-framework/3-tooling/cli/src/commands/init/init.ts` (new precondition branch; legacy `'prisma'` literal inlined with one-line comment).
- `packages/1-framework/3-tooling/cli/test/commands/init/init.test.ts` (or a new `reinit-legacy-warn.test.ts` if the existing file is unwieldy — implementer's call).

**Edge cases covered.** `--reinit` with all four / partial / none-of-the legacy files; project on `src/prisma/` (no warning); `prisma/` exists with unrelated content (no warning); `.gitattributes` legacy lines (surfaced in warning text, not deleted).

**Done when.**
- [ ] `pnpm typecheck` green.
- [ ] `pnpm test:packages` green; new test passes; existing tests still pass.
- [ ] Warning text names each present legacy file (no boilerplate; concrete file list).
- [ ] No `unlinkSync` / `rmSync` / `rmdir` call in the new branch.
- [ ] Intent-validation: branch only fires under `--reinit`.

**Predicted size.** S–M (one new precondition branch ~30 LoC + one new test file; ≤ 1 hr).

**Out of scope.** Automatic deletion; cleanup of `.gitattributes` legacy entries.

### Operator step: Manual QA (PDoD6 / SDoD4)

Not a dispatch. After D2 ships, operator runs the manual repro from the Linear ticket in a scratch directory and appends the run report to `projects/init-canonical-layout/manual-qa.md`.
