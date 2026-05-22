# Slice: init-canonical-layout

_Parent project: [`projects/init-canonical-layout/`](../../). This slice satisfies all FRs (FR1–FR6) from the project spec — single-slice project._

## At a glance

Move `prisma-next init`'s default scaffold from `prisma/` to canonical `src/prisma/`, consolidating the layout convention behind a single `DEFAULT_CONTRACT_SOURCE_DIR` constant the call sites derive from.

## Scope

### In scope

- `packages/1-framework/1-core/config/src/config-types.ts` — introduce `DEFAULT_CONTRACT_SOURCE_DIR`; inline in-memory-only fallback in `normalizeContractConfig`.
- `packages/1-framework/1-core/config/src/exports/config-types.ts` — export the renamed constant.
- `packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates.ts` — `defaultSchemaPath` derives from `DEFAULT_CONTRACT_SOURCE_DIR`.
- `packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts` — `resolveContractPath` throws when output is absent (no static fallback).
- `packages/1-framework/3-tooling/cli/src/commands/init/index.ts:75` — flag help text derives from `defaultSchemaPath('psl')`.
- `packages/1-framework/3-tooling/cli/src/commands/contract-infer.ts:107` — usage example update.
- `packages/1-framework/3-tooling/cli/src/commands/init/hygiene-gitattributes.ts` — explanatory-comment updates.
- Init test surface (`packages/1-framework/3-tooling/cli/test/commands/init/*.test.ts` — ~6 files) and `packages/1-framework/3-tooling/cli/test/utils/command-helpers.test.ts` — assertion updates to canonical default.
- Init help snapshot in `help.snapshot.test.ts`.

### Out of scope (this slice)

- Legacy `prisma/` detect-and-warn or any compatibility code for past init defaults (see `design-decisions.md` § D5).
- Detecting non-canonical project shapes (Deno without `src/`, monorepo package consumers, brownfield layouts). `--schema-path` continues to handle those.
- ADR 212 contract-space-package layout. Verified non-interfering — extension packages do not go through `init`.
- Any change to `--schema-path` semantics.

## Approach

The consolidation and the user-visible default flip ride together in one PR (D3 of the project's design-decisions log). The new constant pulls together previously-independent declarations; the test surface updates are mechanical assertion swaps that follow the default-flip.

`init.ts` already derives `db.ts`'s path from `dirname(schemaPath)`, so the new schema root carries `db.ts` along automatically — no separate code change for `db.ts` placement.

Cross-package dependency note: `cli` already consumes `@prisma-next/.../config` (lint:deps green today); the new import of `DEFAULT_CONTRACT_SOURCE_DIR` rides that existing edge.

## Edge cases (Example-Mapping)

| Edge case | Disposition | Notes |
|---|---|---|
| Fresh `init` in empty dir, postgres + psl | Handle | Scaffolds `src/prisma/contract.prisma` + `src/prisma/db.ts`. |
| Fresh `init`, postgres + typescript | Handle | Scaffolds `src/prisma/contract.ts` + `src/prisma/db.ts`. |
| Fresh `init`, mongo + psl | Handle | Same shape under mongo target. |
| Fresh `init`, mongo + typescript | Handle | Same. |
| `init --schema-path my/path.prisma` overriding default | Handle | Override path continues to win; `db.ts` follows `dirname(my/path.prisma)`. |
| Cross-package import (`cli` → `config` for `DEFAULT_CONTRACT_SOURCE_DIR`) | Handle | `pnpm lint:deps` must remain green; gate of the dispatch. |
| Contract-space packages (ADR 212 carve-out) | Explicitly out | Verified by Grep: `init/` has no contract-space concepts; carve-out packages set `output` explicitly. |
| Brownfield project with custom `src/` layout (e.g. `src/lib/prisma/`) | Explicitly out | User supplies `--schema-path`. Not a regression. |
| `db.ts` placement continues to follow `dirname(schemaPath)` | Handle | Regression-covered by existing tests after assertion updates. |
| `config-validation.test.ts` already asserts `'src/prisma/contract.json'` (lines 450, 510) | Handle | These continue to pass against the inline in-memory fallback. |
| `resolveContractPath` with missing output | Handle | Throws typed error; no static fallback. |

## Slice Definition of Done

- [ ] **SDoD1.** All "Done when" gates from the slice plan pass: `pnpm typecheck`, `pnpm test:packages` (full workspace), `pnpm lint:deps`. Diff matches brief intent.
- [ ] **SDoD2.** Every pre-named edge case handled per disposition.
- [ ] **SDoD3.** Reviewer verdict: SATISFIED on `projects/init-canonical-layout/reviews/code-review.md`.
- [ ] **SDoD4.** Manual-QA per project PDoD6: clean `prisma-next init --yes --target postgres --authoring psl` in a scratch dir produces the same on-disk shape as `examples/prisma-next-demo/src/prisma/`. Run report appended to `projects/init-canonical-layout/manual-qa.md`.
- [ ] **SDoD5.** Slice doesn't touch out-of-scope surfaces (no extension packages; no `--schema-path` semantic changes; no legacy detect-and-warn).
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

### Dispatch 1: Consolidate `DEFAULT_CONTRACT_SOURCE_DIR` + sweep stale text + update test surface

**Intent.** Introduce `DEFAULT_CONTRACT_SOURCE_DIR = 'src/prisma'` in `config-types.ts`. Update `defaultSchemaPath` to derive from the renamed constant. Remove `resolveContractPath` static fallback (throw typed error). Derive `--schema-path` help from `defaultSchemaPath('psl')`. Sweep stale references in `contract-infer.ts:107` and `hygiene-gitattributes.ts` comments. Update init + `command-helpers` test files to assert against `src/prisma/...`. Add init help snapshot.

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
- `packages/1-framework/3-tooling/cli/test/help.snapshot.test.ts`
- (Verify, don't change: `packages/1-framework/1-core/config/test/config-validation.test.ts:450, 510` — already canonical.)

**Edge cases covered.** Fresh-init shapes (psl/ts × postgres/mongo); `--schema-path` override; cross-package import; `db.ts` derivation; `config-validation.test.ts` assertion continuity; `resolveContractPath` throws on missing output.

**Done when.**
- [ ] `pnpm typecheck` green workspace-wide.
- [ ] `pnpm test:packages` green workspace-wide.
- [ ] `pnpm lint:deps` green (cross-package dependency direction unchanged).
- [ ] Exactly one occurrence of the string literal `'src/prisma'` in `packages/1-framework/1-core/config/src/config-types.ts` (the `DEFAULT_CONTRACT_SOURCE_DIR` definition).
- [ ] Intent-validation: diff is scoped to files-in-play; no source files outside this list are modified.

**Predicted size.** M (~15 files, mostly mechanical assertion swaps + one renamed constant + derivation rewires; ≤ 2 hr implementer time).

### Operator step: Manual QA (PDoD6 / SDoD4)

Not a dispatch. After D1 ships, operator runs the manual repro from the Linear ticket in a scratch directory and appends the run report to `projects/init-canonical-layout/manual-qa.md`.
