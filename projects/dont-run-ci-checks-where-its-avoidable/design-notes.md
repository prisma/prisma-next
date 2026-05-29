# Design notes: don't run CI checks where it's avoidable

> Synthesized design document. Read this to understand **what the design is**, **what principles it serves**, and **what alternatives were rejected**. Captures the settled design, standing independently of the discussion that produced it.

## Principles this design serves

- **Correctness is never traded for speed.** A green check must mean the work actually ran; we never restore a cached result whose validity isn't a pure function of declared inputs.
- **Keep CI simple and legible.** A reviewer should understand why a job ran or skipped by reading the workflow, not by reasoning about a content-hash graph or a dependency closure.
- **Design around the ruleset, never edit it.** The set of required checks and the `strict` policy are fixed constraints; the workflow adapts to them.
- **Hold the line on supply-chain posture.** No `pull_request_target`, no third-party action in the trust path, no remote-cache token. Fork PRs get cold caches by design.
- **Fail safe.** When in doubt about whether a diff is inert, run everything.

## The model

### Two independent levers

The waste splits cleanly into two non-overlapping problems with very different risk profiles. They are addressed by different mechanisms and shipped as separate slices.

**Lever A — unconditional redundancy (hits every PR).** `pnpm build` over the 92-package workspace runs ~7× inside one PR run (each `ci.yml` job installs and rebuilds independently; `needs: build` shares no artifacts), and the `coverage` job re-executes the entire suite already run by `test`/`e2e`/`integration`. This is pure waste on *every* PR.

**Lever B — conditional skipping (hits no-op PRs).** A docs-only PR still runs the full Postgres-backed test matrix. The motivating #604 falls here.

### Lever A: build once via a single-writer Turbo cache

The repo enforces a hardened **Allowed Actions** policy (repo-level, `github_owned_allowed: false`, SHA-pinning required): only an explicit SHA-pinned allow-list of actions may run. `actions/download-artifact` is *not* on it, which rules out the artifact-passing approach; `actions/cache` had to be explicitly added (`actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae`, v5.0.5). All caching therefore goes through `actions/cache`.

A shared `.github/actions/setup` composite primes two first-party `actions/cache` entries (the pnpm store and Turbo's local cache, the latter pinned to `.turbo/cache` via `TURBO_CACHE_DIR`). The cache key is the head SHA, and the design is **single-writer**:

- The `build` job runs first (everything else `needs: build`). Its key is a miss, so it is the only job that *writes* the cache.
- Every other job restores that exact key and, per documented `actions/cache` behaviour on an exact-key hit, **skips saving**. Their `pnpm build` step is a cache hit (FULL TURBO) instead of a rebuild — build runs for real exactly once per run.
- The restore-key (`turbo-<os>-`) warms the cache from previous runs, so `build` itself is incremental across pushes/PRs.

The single-writer rule is load-bearing for correctness *and* safety: because only the build job ever writes, the persisted cache contains **build outputs only** — test/coverage task results can never leak into it. An earlier attempt let every job write the same key; `lint` (which does no build) won the save race and persisted a build-less cache, so downstream jobs restored it and rebuilt anyway. Making `lint` (and all jobs) `needs: build` fixed it.

### Lever B: gate the steps, not the jobs (Pattern 1)

A lightweight `changes` job computes whether the diff is **inert** and emits a boolean. The predicate lives in one place — the `.github/actions/detect-inert-diff` composite action — so `ci.yml` and `preview-publish.yml` share a single allow-list rather than two copies that can drift. It diffs the PR's `base.sha`…`head.sha` (first-party `git diff`, no `dorny/paths-filter`). The predicate is an **allow-list, fail-safe to run**: inert only if *every* changed file matches a known-inert pattern (`**/*.md`, `docs/**`, `projects/**`, `skills-contrib/**`, `.agents/**`, `.cursor/**`, `.claude/**`, `LICENSE`); any unrecognized path → not inert → run everything. `.github/workflows/**`, source, `package.json`, lockfile, and config files are explicitly non-inert. On any non-`pull_request` event (e.g. push to `main`) it reports non-inert, so nothing is skipped off a PR.

The required-status-checks ruleset forbids skipping a required *job* (a skipped required context never reports and wedges the merge). So every required job still launches and reports; only its **expensive steps** carry `if: needs.changes.outputs.inert != 'true'`. On a docs-only PR the `Test`/`E2E`/`Integration`/`Coverage`/`Fixtures` jobs start, skip their heavy steps, and go green in seconds. `Lint` always runs in full (it is exactly what catches docs/rules/skills/README/manifest changes); `Type Check` and `Build` always run but are ~free via Turbo cache. `preview-publish.yml`'s "Publish preview" is *not* a required context, so there the whole job is skipped at the job level (`needs: changes` + a job-level `if:`) rather than step-by-step.

### Why these jobs gate and these don't

| Job | Posture | Reason |
|---|---|---|
| `Test`, `E2E Tests`, `Integration Tests`, `Coverage` | gate heavy step | expensive, Postgres-backed, irrelevant to an inert diff |
| `Fixtures` | gate heavy step | contract emission is purely code/schema-driven |
| `Lint` | always run | catches docs/markdown/skill/rule/README/manifest changes — the inert diffs themselves |
| `Type Check`, `Build` | always run, cache-fast | required contexts; Turbo cache makes them near-free on unchanged inputs |

## Alternatives considered

- **Cache test results too.** Attractive (would make #604's tests free). **Rejected because:** test pass/fail depends on inputs outside the Turbo hash (services, `passThroughEnv`); a cached stale pass can hide a real regression. Operator was emphatic: "introducing cached tests is madness."
- **`turbo run test --affected` now.** Attractive (runs only affected packages). **Rejected (deferred) because:** correctness depends on the package dependency graph being complete; an under-declared dep silently under-runs and lets a regression escape. Needs its own audit.
- **Aggregator-gate restructure (Pattern 2):** replace the 8 required contexts with one always-running `CI` summary job so individual jobs can be truly skipped. **Rejected because:** requires editing ruleset `13495740` (admin change) and adds moving parts; Pattern 1 achieves the same merge-ability with no ruleset surgery.
- **Workflow-level `paths:` / `paths-ignore:`.** Attractive (built-in, declarative). **Rejected because:** a path-filtered-out required job never reports its context, wedging every merge under the current ruleset.
- **Removing the PR `Coverage` job entirely.** **Rejected by operator:** keep coverage on PR CI, just gate it like the other heavy jobs (removing it would require dropping the `Coverage` required context — a ruleset edit).
- **Third-party Turbo remote cache (Vercel / community cache server action).** Attractive (shared cache across all jobs/runs). **Rejected because:** adds a third-party action to the CI trust path and/or a remote-cache token; conflicts with the repo's supply-chain posture. First-party `actions/cache` covers cross-run skip adequately.

## Open questions

- **Inert allow-list membership** — resolved: `**/*.md`, `docs/**`, `projects/**`, `skills-contrib/**`, `.agents/**`, `.cursor/**`, `.claude/**`, `LICENSE`. `projects/**` is safe because nothing outside `projects/` imports it; `**/*.md` is safe because `fixtures:check` only diffs `**/contract.*` and no test reads markdown fixtures. Expand conservatively later.
- **Cache-key scope** — working position: lockfile + Turbo input hashes, relying on GitHub's default branch-scoped cache isolation for fork safety.

## References

- Project spec: [`./spec.md`](./spec.md)
- Project plan: [`./plan.md`](./plan.md)
- `docs/oss/supply-chain.md` — fork-PR posture preserved by this design.
- `turbo.json` — task `inputs`/`outputs` the caching leans on.
