# Don't run CI checks where it's avoidable

## Purpose

PR CI burns ~5 minutes of CPU-intensive work on every pull request — including PRs that change no code at all — because every job re-does a full install + build of the 92-package workspace and the full test matrix runs unconditionally. This project removes the work that CI does not need to do, so the median PR is cheaper and faster to merge without weakening correctness or the repo's fork-PR security posture.

## At a glance

A typical PR today triggers `ci.yml` (8 required jobs) plus `preview-publish.yml`, and `pnpm build` over the 92-package graph runs ~8 times across them. The motivating example ([PR #604](https://github.com/prisma/prisma-next/pull/604)) changed no code yet still ran the full coverage suite.

Two independent levers attack this:

- **Lever A — unconditional redundancy (every PR).** Build is recomputed ~7× inside a single run; `coverage` re-executes the whole test suite. Fix: build once, share the `dist/**` artifact to downstream jobs, and cache deterministic Turbo tasks across runs.
- **Lever B — conditional skipping (no-op PRs).** A docs-only diff should not run the Postgres-backed test/coverage/fixtures work. Fix: a fail-safe "inert diff" predicate that gates the *expensive steps* of those jobs while the jobs themselves always report.

The hard constraint shaping the whole design: `main` is governed by repository ruleset `13495740` with `strict_required_status_checks_policy: true` and **eight required status checks** (`Type Check`, `Lint`, `Build`, `Test`, `E2E Tests`, `Integration Tests`, `Coverage`, `DCO`). A required context that never reports wedges the merge — so we design *around* the ruleset and never edit it.

## Non-goals

- **Caching test / e2e / integration / coverage results.** Explicitly rejected: their pass/fail is not a pure function of declared Turbo `inputs` (e.g. the cloudflare-worker test's `WRANGLER_HYPERDRIVE_*` is a `passThroughEnv`, outside the hash). A stale cached "pass" that masks a regression is worse than wasted CPU. Tests always actually execute.
- **`turbo run test --affected` package-scoped test selection.** Deferred to a later ticket — correctness hinges on the package dependency graph being complete, which needs its own audit.
- **Disabling the `strict` (require-branch-up-to-date) policy or introducing a merge queue.** Deferred; this is likely the largest *remaining* avoidable-CI source but the safe fix is a merge queue, which is its own project.
- **Editing ruleset `13495740` / changing the set of required status checks.** Out of scope; no admin change to required checks.
- **Introducing any third-party Turbo cache action or a remote-cache token/secret.** Caching uses first-party `actions/cache` only.
- **Touching `pr-code-security.yml`** (semgrep, secret detection) — security scanning stays as-is.

## Place in the larger world

- **`.github/workflows/ci.yml`** — the primary surface; all eight jobs live here.
- **`.github/workflows/preview-publish.yml`** — also runs `pnpm install` + `pnpm build` on every PR before `pkg-pr-new`; an additional avoidable full build, gated under Lever B.
- **`turbo.json`** — already declares precise `inputs`/`outputs` for `build`, `typecheck`, `lint`, `test`, `test:coverage`; the caching design leans on this existing metadata. CI does not cache it today (only `mise` is cached).
- **Repository ruleset `13495740`** ("Require approved PR") — the required-status-checks + `strict` policy that constrains the skip mechanism.
- **Repo Allowed-Actions policy** (`actions/permissions/selected-actions`) — hardened: `github_owned_allowed: false`, `sha_pinning_required: true`, explicit SHA-pinned allow-list. Any new action (including first-party ones like `actions/cache`) must be added to this list before it can run. `actions/download-artifact` is not allowed, which rules out artifact-passing between jobs.
- **`docs/oss/supply-chain.md`** + **`scripts/lint-workflow-triggers.mjs`** — the deliberate `pull_request`-only (never `pull_request_target`) posture; the caching/gating design must preserve fork-PR isolation.

## Cross-cutting requirements

- Every merged slice keeps all eight required status checks reporting success on every PR, including docs-only PRs (skipped work still reports green).
- No slice edits ruleset `13495740` or requires an admin/branch-protection change.
- No slice caches test/e2e/integration/coverage results.
- No slice introduces a third-party cache action or a remote-cache secret; caching is first-party `actions/cache` only.
- The "inert diff" predicate is **fail-safe to run**: skip heavy work only when *every* changed file matches a known-inert pattern; any unrecognized path runs the full suite.
- Fork-PR isolation is preserved (cold caches on forks are acceptable and expected).

## Transitional-shape constraints

- Every slice keeps CI green on `main` and leaves the workflow mergeable at all times.
- Slices touch `ci.yml`; they are sequenced (not parallel) to avoid colliding edits in the same workflow file.

## Project Definition of Done

Inherits the team-DoD floor ([`drive/calibration/dod.md`](../../drive/calibration/dod.md)) — not restated here. Project-specific conditions:

- [ ] A docs-only PR (diff ⊆ inert allow-list) runs **none** of the `Test` / `E2E Tests` / `Integration Tests` / `Coverage` / `Fixtures` heavy steps, yet all eight required contexts report success and the PR is mergeable.
- [ ] A PR touching any non-inert path runs the full matrix (no false skips) — verified with a representative code-touching PR.
- [ ] `pnpm build` executes **once** per PR run; downstream jobs consume the shared `dist/**` artifact rather than rebuilding.
- [ ] `build` / `typecheck` / `lint` Turbo tasks restore from `actions/cache` across runs; the pnpm store is cached.
- [ ] No test/e2e/integration/coverage result is cached; no third-party cache action or remote-cache token is present in any workflow.
- [ ] Ruleset `13495740` is unchanged; the eight required check names are unchanged.
- [ ] Before/after CI wall-clock + runner-minutes for (a) a docs-only PR and (b) a typical code PR are measured and recorded in the PR descriptions.

## Open Questions

1. Final membership of the inert allow-list. Working position: start with `**/*.md`, `docs/**`, `LICENSE`, `skills-contrib/**`, `.agents/**`, `.cursor/**`, `.claude/**`; expand conservatively via follow-ups as confidence grows. Anything not on the list runs everything.
2. ~~Cache-key scope for cross-run restore.~~ **Resolved:** single-writer model — the `build` job is the sole cache writer (key = head SHA); all other jobs `needs: build`, restore the exact key, and skip saving. The restore-key warms `build` across runs. GitHub's default branch-scoped cache isolation keeps fork PRs isolated, so no extra fork-safety wiring is needed.

## References

- Linear: [TML-2710](https://linear.app/prisma-company/issue/TML-2710/dont-run-ci-checks-where-its-avoidable)
- Motivating PR: [prisma/prisma-next#604](https://github.com/prisma/prisma-next/pull/604)
- Design notes: [`./design-notes.md`](./design-notes.md)
- Plan: [`./plan.md`](./plan.md)
- `docs/oss/supply-chain.md` — fork-PR posture the design preserves.
