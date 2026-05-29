# Don't run CI checks where it's avoidable — Plan

**Spec:** `projects/dont-run-ci-checks-where-its-avoidable/spec.md`
**Tracker:** [TML-2710](https://linear.app/prisma-company/issue/TML-2710/dont-run-ci-checks-where-its-avoidable) (umbrella)

## At a glance

Two slices, delivered as a stack. Both edit `.github/workflows/ci.yml`, so they are sequenced rather than parallel to avoid colliding edits. Slice 1 (Lever A) removes redundant work that hits every PR; slice 2 (Lever B) skips heavy work on no-op PRs on top of slice 1's restructured workflow.

## Composition

### Stack (deliver in order)

1. **Slice `build-dedup-and-caching`** — Linear: [TML-2712](https://linear.app/prisma-company/issue/TML-2712/ci-build-once-cache-deterministic-tasks-lever-a)
   - **Outcome:** `pnpm build` runs once per PR run; the `build` job uploads `dist/**` as an artifact and downstream `ci.yml` jobs download it instead of rebuilding. First-party `actions/cache` caches the Turbo cache dir + pnpm store so `build`/`typecheck`/`lint` restore across runs. Tests still always execute; no test/coverage result is cached.
   - **Builds on:** None (foundation).
   - **Hands to:** A restructured `ci.yml` where build is produced once and shared, and where caching infrastructure (`actions/cache` keys, artifact upload/download steps) already exists for slice 2 to gate on top of.
   - **Focus:** The job DAG + artifact passing + `actions/cache` wiring. Deliberately *not* doing any change-based skipping here — every job still runs its full work; this slice only removes duplicated build/install cost.

2. **Slice `inert-diff-gating`** — Linear: [TML-2713](https://linear.app/prisma-company/issue/TML-2713/ci-gate-heavy-jobs-on-inert-diffs-lever-b-pattern-1)
   - **Outcome:** A `changes` job emits a fail-safe `inert` boolean from `git diff --name-only origin/main...HEAD`. The expensive steps of `Test`/`E2E Tests`/`Integration Tests`/`Coverage`/`Fixtures` carry `if: needs.changes.outputs.inert != 'true'`; the jobs always launch and report (Pattern 1), so all eight required contexts stay green on a docs-only PR while the heavy work is skipped. `Lint` always runs in full. `preview-publish.yml`'s install+build+publish is gated on the same predicate.
   - **Builds on:** Slice 1's restructured `ci.yml`.
   - **Hands to:** The closed project — both levers landed.
   - **Focus:** The `changes` job, the inert allow-list predicate (fail-safe to run), and step-level `if:` gates. Deliberately *not* doing `turbo --affected` package-scoped selection (deferred) and *not* editing the ruleset.

## Dependencies (external)

- [x] Turbo `inputs`/`outputs` metadata already present in `turbo.json` — no dependency to resolve.
- [x] `actions/cache` is first-party — no new third-party action to vet.
- [ ] None blocking.

## Sequencing rationale

The stack is driven by a real file-level dependency: both slices edit `ci.yml`. Landing slice 1 first keeps the larger, higher-value, lower-risk change (build dedup helps *every* PR) unblocked by the gating logic, and gives slice 2 a clean base to add step-level `if:` gates without rebasing around an artifact restructure. The two are otherwise logically near-independent; if reviewer bandwidth demanded, slice 2 could precede slice 1, but the merge-conflict cost makes serial-in-this-order the right call.

## Out of scope (tracked for later)

- `turbo run test --affected` package-scoped test selection — needs a dependency-graph completeness audit first.
- Merge queue / relaxing the `strict` (require-branch-up-to-date) policy — likely the largest remaining avoidable-CI source; its own project.

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/dont-run-ci-checks-where-its-avoidable/spec.md`.
- [ ] Migrate any long-lived design (e.g. the CI caching/gating model) into `docs/` if it proves durable; otherwise capture rationale in the PR descriptions.
- [ ] Strip repo-wide references to `projects/dont-run-ci-checks-where-its-avoidable/**`.
- [ ] Delete `projects/dont-run-ci-checks-where-its-avoidable/`.
