# Project Plan: init-canonical-layout

**Spec:** [`./spec.md`](./spec.md)
**Linear Project:** [`[PN] Onboarding Audit`](https://linear.app/prisma-company/project/pn-onboarding-audit-ae4e48d52ea3) (umbrella; this project contributes one ticket)
**Purpose** _(from spec)_: `prisma-next init` should scaffold the same on-disk shape every other surface in the framework already treats as canonical (`src/prisma/...`), with the canonical layout root expressed in a single named place so the three call sites that depend on it cannot drift apart again.

## At a glance

Single-slice project. One slice + one PR delivers the constant introduction, the three call-site rewires, the `--reinit` detect-and-warn, the touchpoint sweep, and the test-surface updates together — splitting would ship `main` an intermediate state telling inconsistent stories about the default layout.

## Composition

### Stack (deliver in order)

1. **Slice [`init-canonical-layout`](./slices/init-canonical-layout/spec.md)** — move `prisma-next init`'s default scaffold from `prisma/` to canonical `src/prisma/`, consolidating the layout convention behind `DEFAULT_PRISMA_DIR`, adding `--reinit` detect-and-warn for legacy layouts, and sweeping stale text references. Decomposed into two dispatches (D1 consolidation + sweep + test surface; D2 detect-and-warn) plus an operator manual-QA step — see the slice spec § Dispatch plan. Scope:
   - `packages/1-framework/1-core/config/src/config-types.ts` — introduce `DEFAULT_PRISMA_DIR`, re-express `DEFAULT_CONTRACT_OUTPUT` in terms of it.
   - `packages/1-framework/1-core/config/src/exports/config-types.ts` — export the new constant.
   - `packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates.ts` — `defaultSchemaPath` derives from `DEFAULT_PRISMA_DIR`.
   - `packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts:102` — runtime fallback derives from `DEFAULT_CONTRACT_OUTPUT`.
   - `packages/1-framework/3-tooling/cli/src/commands/init/init.ts` — new precondition branch: detect legacy `prisma/` co-located with new `src/prisma/`, append structured warning.
   - `packages/1-framework/3-tooling/cli/src/commands/init/index.ts:75` — flag help text update.
   - `packages/1-framework/3-tooling/cli/src/commands/contract-infer.ts:107` — example update.
   - `packages/1-framework/3-tooling/cli/src/commands/init/hygiene-gitattributes.ts` — comment updates.
   - Tests: `packages/1-framework/3-tooling/cli/test/commands/init/*` (~6 files), `packages/1-framework/3-tooling/cli/test/utils/command-helpers.test.ts`, `packages/1-framework/1-core/config/test/config-validation.test.ts` (assertions referencing `'src/prisma/contract.json'` continue to pass; verify no test pins the constant differently). New test for the `--reinit` warning path.
   - Manual repro per spec § PDoD6.

   Linear: `TML-2532`. Depends on: none.

### Parallel groups

None — single-slice project.

## Dependencies (external)

- [x] No external dependencies. The agent-skill cluster coordination (originally in ticket) is moot — cluster removed (see `design-decisions.md` D4).

## Project-DoD coverage map

| Project-DoD | Delivered by |
|---|---|
| **PDoD1.** Fresh `init` scaffolds `src/prisma/...` matching demo | Slice `init-canonical-layout` (FR1, FR6) + manual repro |
| **PDoD2.** One place declares `'src/prisma'`; three call sites derive | Slice `init-canonical-layout` (FR2, FR3) |
| **PDoD3.** `--reinit` warns on legacy layout; no deletion | Slice `init-canonical-layout` (FR4) |
| **PDoD4.** Init + `command-helpers` tests pass | Slice `init-canonical-layout` (test updates) |
| **PDoD5.** `pnpm lint:deps` + `pnpm test:packages` green | Slice `init-canonical-layout` (CI gate) |
| **PDoD6.** Manual repro from ticket | Slice `init-canonical-layout` (manual QA step) |
| **PDoD7.** PR merged; Linear closed; final retro | Project close-out |
| **PDoD8.** `projects/init-canonical-layout/` deleted | Project close-out |
| **PDoD9.** Linear Project updated | Project close-out |

## Risks + open questions

1. **Cross-package import** — `cli` imports `DEFAULT_PRISMA_DIR` from `config`. The dependency is already present (cli consumes `@prisma-next/.../config`), but `lint:deps` should be re-checked after the rewire to confirm no new layering violation.
2. **Test surface breadth** — six init test files reference `prisma/contract.*`. Sweep is mechanical but easy to miss one; `pnpm test:packages` is the gate.
3. **`hygiene.test.ts` `.gitattributes` assertions** — those tests assert specific lines (`prisma/contract.json linguist-generated`). They need updating to `src/prisma/...` and may need a new case asserting the linguist line is generated for the new path.

## Close-out (required)

- [ ] Verify all PDoDs in `spec.md`
- [ ] Mandatory final retro complete; output landed in canonical / project-context / ADR (likely: a `drive/triage/findings.md` or `drive/calibration/failure-modes.md` entry on the "two-facts-that-happen-to-agree" anti-pattern)
- [ ] Migrate long-lived docs into `docs/` (none expected; this is a refactor + bug fix, no new architecture)
- [ ] Strip repo-wide references to `projects/init-canonical-layout/**`
- [ ] Delete `projects/init-canonical-layout/`
- [ ] Linear: TML-2532 marked Done; parent project `[PN] Onboarding Audit` stays open (covers other audit tickets)
