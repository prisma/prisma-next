# Versioning

This page documents how Prisma Next versions its packages, who is allowed to publish them, and the procedure maintainers follow to cut a release.

## Source of truth

The version Prisma Next ships is the `version` field of the **root [`package.json`](../../package.json)**. The publish workflow ([`.github/workflows/publish.yml`](../../.github/workflows/publish.yml)) reads this value at the workflow's git ref and refuses to publish anything else. There is no `workflow_dispatch` input to override the version, no per-package `version` drift, and no separate "release manifest" file. Anyone — human or agent — can answer the question "what version are we on?" by reading a single file under git.

This is by design. Two of the three other places a version *could* live cause silent problems:

- **Querying the npm registry for the latest tag** (the previous behaviour) makes the next minor implicit. A yanked release, a manually-rewritten dist-tag, or registry latency all silently shift what the next CI build calls itself.
- **A separate `versions.json` or `release.toml`** would diverge from the per-package `version` in tooling that only inspects `package.json` (npm, dependency analyzers, supply-chain scanners, downstream consumers). Keeping it in `package.json` means there's nothing to keep in sync.

## Lockstep

Every workspace package — publishable, private, the workspace root, and example apps — carries the same `version`. Lockstep is the invariant that lets a single read of the root `package.json` answer "what version are we shipping?" If private packages or examples drifted, that invariant would be silently violated.

The [`scripts/set-version.ts`](../../scripts/set-version.ts) helper enforces this: a single invocation walks every workspace `package.json` and writes the requested version. The publish workflow uses the same script, so the per-package and root values cannot diverge through the publish path.

Internal packages are never published — their `private: true` flag means `pnpm publish` skips them — but they still version in lockstep so that a contributor cloning the repo at any commit sees one consistent answer to "what version is this code?"

## SemVer scheme

Released artefacts use the standard SemVer triple `major.minor.patch`. Prisma Next is pre-`1.0`, so today every release is a minor bump (`0.7.0` → `0.8.0` → `0.9.0`). Patches are reserved for emergency fixes to a recent minor and are produced by hand if the situation arises; the routine release cadence is minor-only.

Pre-`1.0` minors are not strictly backwards-compatible, in line with SemVer's allowance for breakage on `0.x`. Behaviour changes that would be considered breaking under post-`1.0` SemVer ship in regular minor bumps and are called out in release notes. The agent-driven upgrade skill (planned as a follow-on task) is the long-run answer to keeping consumers on the latest minor with minimal churn; until that ships, breaking changes are surfaced through release notes only.

## Dist-tag convention

The npm registry exposes Prisma Next under three dist-tags:

- **`latest`** — the most recent stable release. Cut automatically: when a `pnpm bump-minor` PR merges to `main`, the resulting push changes the root `package.json` `version`, and the publish workflow recognises that as a release bump and publishes `<base>` under `latest` (and creates a matching GitHub Release). This is the default any `npm install @prisma-next/...` resolves to.
- **`dev`** — every push to `main` *that doesn't change the root `version`* produces a `<base>-dev.N` tarball under this tag, where `N` is the next available build number for the current `<base>` (the root `package.json` `version` field). These exist so we can pin reproductions, install internal CI runs, or hand someone a "try `npm install @prisma-next/postgres@dev` to get the bleeding edge" link without producing a `latest`-tagged release every commit. They are not promised to be stable and may be yanked freely.
- **`beta`** — reserved for hand-cut release candidates ahead of significant changes. Routine releases do not use this tag.

The `pr` dist-tag was used historically to publish per-PR previews; PR previews now go through [`pkg.pr.new`](https://pkg.pr.new) ([`.github/workflows/preview-publish.yml`](../../.github/workflows/preview-publish.yml)) instead. The legacy `pr` tag is left as-is on the registry for now; cleanup is out of scope for this page.

## Who can publish

Publishing requires:

- **Membership in the maintainer team** (see [Governance](./governance.md)) — pushing to `main` or merging a `bump-minor` PR is restricted to maintainers.
- **A green run of the [`Publish to npm`](../../.github/workflows/publish.yml) workflow.** The workflow uses [npm OIDC trusted publishing](https://docs.npmjs.com/generating-provenance-statements) — no long-lived `NPM_TOKEN` exists in repository secrets, so a leaked secret cannot be used to publish out-of-band.
- The workflow only publishes from `main` (or, in `dry-run` mode, from any branch — see below).

The `if:` condition on the `publish` job in `publish.yml` enforces the `main`-only constraint for real publishes. Dry-runs are permitted from any branch so maintainers can validate the pipeline before merging changes that touch publishing; every step that would mutate external state (`npm publish`, GitHub Release creation) is independently guarded by `dry-run != 'true'`.

## Procedure: cut the next minor

The release cadence is one PR per minor. A maintainer:

1. **Pulls `main`** locally (any worktree; the script reads from `git show HEAD:package.json` so the working tree state doesn't matter).
2. **Runs the `publish-npm-version` skill** (see [`.agents/skills/publish-npm-version/SKILL.md`](../../.agents/skills/publish-npm-version/SKILL.md)). The skill drives `pnpm bump-minor` and opens a PR in the maintainer's name; using a skill rather than a GitHub workflow ensures the PR carries real maintainer credentials so CI runs on it normally (PRs opened by `GITHUB_TOKEN` from a workflow do not trigger downstream workflows).
3. **Reviews and merges the PR.** This is the gate where humans verify there are no in-flight breaking changes that need release-notes attention. The merge itself is the publish trigger: the resulting push to `main` carries the bumped root `version`, the publish workflow detects the change, and publishes `<version>` under dist-tag `latest` plus a matching GitHub Release. No separate dispatch step is required.

If the publish needs to be re-run (transient registry failure, etc.), a maintainer can dispatch the [`Publish to npm`](../../.github/workflows/publish.yml) workflow from `main` with `dist-tag=latest` and `dry-run=false`; the workflow re-publishes the version currently committed at HEAD. This is the same path used to cut a hand-rolled `beta` (`dist-tag=beta`).

The dry-run path of the same workflow can be invoked from any branch (`dry-run=true`, the input default) to validate that the publish pipeline still works after touching `publish.yml`, `set-version.ts`, `determine-version.ts`, or any of the build scripts. A dry-run exercises `pnpm publish --dry-run` against every workspace package, runs the `check:publish-deps` gate, and skips the registry publish + GitHub Release.

## Procedure: emergency patch

Patches are not part of the routine cadence, but if a freshly-published `latest` ships a regression that must be addressed before the next minor:

1. Branch from `main` (this procedure assumes `main` is still on the same minor that needs the patch — maintenance branches for older minors are out of scope; see [Non-goals](#non-goals) below).
2. Land the fix as a small PR.
3. On a follow-up PR, run `node scripts/set-version.ts <major>.<minor>.<patch+1>` to advance every workspace package to the patch version.
4. Merge to `main`. The merge changes the root `version` and auto-publishes `latest` via the same path as a minor bump — no separate dispatch is required.

The skill is not used for patches because the bump shape is different (`patch+1`, not `minor+1`); the explicit `set-version.ts` invocation is the procedure.

## Non-goals

- **Maintenance branches for older minors.** If a critical bug is found in `0.7.x` after `0.8.0` has shipped, this procedure does not cover it. The team would cut a maintenance branch by hand, but no tooling supports that flow today.
- **Pre-release / release-candidate cadence.** The `beta` dist-tag exists, but cutting beta releases is hand-edited rather than scripted. If a beta cadence becomes routine, that's a follow-up.
- **Independent per-package versioning.** Lockstep is the invariant. Per-package versions would require redesigning `set-version.ts` and the publish flow.

## Why a skill, not a workflow

An earlier sketch had a GitHub workflow open the bump PR. Two reasons we landed on a maintainer-side skill instead:

- **PRs opened by `GITHUB_TOKEN` do not trigger downstream workflows.** This is GitHub's default behaviour to prevent infinite workflow loops. A bump PR opened by a workflow would not run CI, which defeats the point of the PR.
- **Audit trail.** A skill runs as the invoking maintainer; the resulting commit + PR carries real maintainer attribution. A workflow-opened PR carries `github-actions[bot]` attribution, which obscures who decided to cut the release.

The skill remains thin (it just orchestrates the same `pnpm bump-minor` + `git` + `gh pr create` calls a maintainer would run by hand) so that the underlying procedure is always available without it.
