# Init Journey Tests — Project Plan

## Summary

Deliver the `prisma-next init` user-journey test ([TML-2490](https://linear.app/prisma-company/issue/TML-2490)) and the four bug fixes whose seams it covers ([TML-2486](https://linear.app/prisma-company/issue/TML-2486), [TML-2487](https://linear.app/prisma-company/issue/TML-2487), [TML-2314](https://linear.app/prisma-company/issue/TML-2314), [TML-2461](https://linear.app/prisma-company/issue/TML-2461)) in **one PR with five commits**. The journey test lands "red-by-design": its assertions encode the four currently-broken seam behaviours, so CI is green at commit 1. Each subsequent commit fixes one bug and flips one assertion from "asserts bug" to "asserts fix". Reverting any one fix commit breaks the journey at exactly that seam — that commit-level rhythm is the proof artefact that the journey test catches the bug class.

**Spec:** [`projects/init-journey-tests/spec.md`](spec.md)

## Milestones

### Milestone 1 — Project shaping artifacts

PR scope: spec + plan only (this milestone may merge as a separate small shaping PR, or fold into the main implementation PR — see § PR strategy below).

**Tasks:**

- [ ] Validate spec with the team. Specifically pressure-test § Acceptance Criteria and § Open Questions.
- [ ] Confirm test-location decision (Open Question 1) and `pnpm install` mechanics (Open Question 2) before implementation starts.

**Exit criteria:** spec + plan reviewed; the five open questions in spec § Open Questions either resolved or accepted as implementer-degrees-of-freedom.

### Milestone 2 — Journey test harness + red-by-design baseline

Single PR commit. Closes [TML-2490](https://linear.app/prisma-company/issue/TML-2490).

**Tasks:**

- [ ] Create the test file at the chosen location (default: `test/integration/test/cli-journeys/init-journey.e2e.test.ts`). Wire it into the relevant `pnpm test:*` script.
- [ ] Implement the per-cell test runner (spec FR1) — materialise tmpdir, run `prisma-next init`, run `pnpm install` with isolated linker.
- [ ] Implement the project handle operations (spec FR2): `addModel`, `emit`, `dbInit`, `runUserCode`, `resetDb`, `planMigration`, `applyMigration`.
- [ ] Implement the `seamExpectation(name, status)` helper (spec FR3, FR4). Type the `status` arg to discriminate `'currently-broken-by:TML-NNNN' | 'fixed'`.
- [ ] Author the four per-cell fixtures (spec FR16–FR18) under `test/integration/test/cli-journeys/fixtures/<target>-<authoring>/`.
- [ ] Implement steps 1–11 of the journey (spec FR5–FR15) with assertions encoding the *current* broken behaviour at the four bug seams:
  - Step 3 (emit) — assert `contract.json` at the legacy default `src/prisma/contract.json` path (TML-2461 currently-broken).
  - Step 4 (`db init`) — Mongo cells assert the `createCollection` validator rejection (TML-2486 currently-broken); Postgres cells assert success.
  - Step 5 (user query) — Mongo cells assert `import { ObjectId } from '@prisma-next/mongo'` fails to resolve (TML-2487 currently-broken). Postgres cells assert `import { createPostgresControlClient } from '@prisma-next/postgres/control'` fails to resolve (TML-2314 currently-broken).
- [ ] Validate locally: revert PR #485 in a scratch worktree and confirm the journey breaks at step 5 with a diagnostic naming TML-2485-class behaviour. This proves the harness actually exercises the resolver (validates Open Question 2's resolution).
- [ ] Confirm wall-clock budget (spec NFR1) on local + CI.

**Exit criteria:** CI green on this commit; all four bug seams' assertions encode current broken behaviour; reverting PR #485 locally still breaks the journey.

### Milestone 3 — Bug fixes (one commit per ticket)

Four further commits in the same PR. Each fixes one bug and flips one assertion.

**Tasks:**

- [ ] **Commit 2 — [TML-2486](https://linear.app/prisma-company/issue/TML-2486).** Strip `undefined` keys from `createCollection` options in the mongo schema applier (or build the options object conditionally). Update step 4's assertion in both Mongo cells from `seamExpectation('db-init', 'currently-broken-by:TML-2486')` to `seamExpectation('db-init', 'fixed')`. Add or verify a narrow regression test in `@prisma-next/mongo` (or wherever the applier lives) — the journey is a backstop, not a replacement for the per-subsystem test.
- [ ] **Commit 3 — [TML-2487](https://linear.app/prisma-company/issue/TML-2487).** Add `ObjectId` (and the related BSON value types: `Decimal128`, `Long`, `Binary`, `Timestamp`) as a value re-export from `@prisma-next/mongo`. Update step 5's assertion in both Mongo cells from `currently-broken-by:TML-2487` to `fixed`. Update relevant docs / READMEs to point at the new import path.
- [ ] **Commit 4 — [TML-2314](https://linear.app/prisma-company/issue/TML-2314).** Add `@prisma-next/postgres/control` entry-point that exports `createPostgresControlClient` (or equivalent), per the proposal in TML-2314. Update step 5's assertion in both Postgres cells from `currently-broken-by:TML-2314` to `fixed`. Update relevant docs.
- [ ] **Commit 5 — [TML-2461](https://linear.app/prisma-company/issue/TML-2461).** Move the default-output computation from the global `DEFAULT_CONTRACT_OUTPUT` constant into the PSL / TS providers, so the default is `dirname(inputPath)/contract.json` (PSL) or the package root (TS). Update step 3's assertion in all four cells from `currently-broken-by:TML-2461` to `fixed`. Watch for examples / fixtures elsewhere in the repo that depend on the legacy path; update them in the same commit.

**Exit criteria per commit:** CI green; the relevant journey assertion is `fixed`; reverting only that commit breaks the journey at exactly that seam.

### Milestone 4 — PR landing & close-out

**Tasks:**

- [ ] Open one PR with all five commits. PR title references TML-2490 (Linear's GitHub integration will auto-link the others via the issue IDs in commit messages / PR body).
- [ ] PR body: reference all five tickets, describe the red-then-green commit rhythm, link to the spec.
- [ ] Validate one more time that reverting each individual fix commit breaks the journey at the intended seam. This is the proof step.
- [ ] Land the PR. Linear auto-transitions each of the five tickets to "Done" via the GitHub integration.
- [ ] Final commit (close-out): if any long-lived documentation should live beyond the project (e.g. a brief note in `docs/` about the seam-verifier test pattern), migrate it. Strip repo-wide references to `projects/init-journey-tests/**`. Delete `projects/init-journey-tests/`.

**Exit criteria:** all five tickets in "Done"; project directory deleted; CI green on `main`.

## PR strategy

Per the discussion that produced this plan, the canonical answer is **one PR with five commits** (the red-then-green rhythm is the proof artefact and requires a single connected change).

Variation worth considering during execution:

- **Optional pre-PR for shaping artifacts.** If the team wants early review on the spec + plan before implementation begins, Milestone 1 can land in a small separate PR. This is the workflow-rule default for projects of this shape. If the spec is well-understood by reviewers at this point, skip the shaping PR and fold Milestone 1 into the main PR.

Decision: **start with the spec + plan in a small shaping PR**, validate quickly with the team, then proceed to the implementation PR. Cancel the shaping PR and inline the artifacts into the implementation PR only if the shaping review pass adds no useful feedback in the first review cycle.

## Risks

- **`pnpm install` cost on CI.** If the chosen install mechanism (Open Question 2) takes longer than the NFR1 budget on cold CI, the per-cell budget needs revisiting. Mitigation: validate cost on local + CI during Milestone 2 before going further.
- **Mongo migration parity assumption (spec § Open Questions Q4).** If Mongo doesn't have `migration plan` / `migration apply` in the same shape as Postgres, steps 8–9 of the Mongo cells substitute "re-author + re-emit + re-run `db init`". The substitution is acceptable per the spec, but flag it in the plan if it materialises.
- **TML-2461 blast radius (assumption: small).** If TML-2461's fix turns out to require coordinated changes across examples / docs / demos that hard-code the legacy path, commit 5 grows. Mitigation: scope-check TML-2461's reach early in Milestone 2 (before all four fixes are queued up).

The red-then-green proof is validated **on the branch** before merge — reverting any one fix commit in the branch's history must break the journey at exactly that seam. Post-merge revertibility is not a goal; the per-subsystem regression tests added alongside each fix carry the long-term backstop.

## Close-out (required)

- [ ] Verify all acceptance criteria in [`spec.md`](spec.md).
- [ ] Migrate any long-lived docs into `docs/` (likely none — this is internal test infrastructure that lives with the test file).
- [ ] Strip repo-wide references to `projects/init-journey-tests/**` (replace with canonical `docs/` links or remove).
- [ ] Delete `projects/init-journey-tests/`.
