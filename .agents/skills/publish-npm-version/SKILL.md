---
name: publish-npm-version
description: >-
  Cuts the next minor release of Prisma Next: bumps the root package.json
  version, propagates it to every workspace package, and opens a PR titled
  "chore(release): bump to <next-version>". The maintainer reviews and merges
  the PR; a separate workflow_dispatch of `Publish to npm` then ships the
  new version. Use when a maintainer asks to "cut the next minor", "bump to
  the next version", "open a release PR", or "prepare a publish PR".
---

# Publish next npm version

## Audience

Maintainers of Prisma Next who have permission to push branches and open PRs
in the repository. The skill is invoked locally by the maintainer; it does
**not** run as a GitHub Action. Running locally is what makes the resulting PR
trigger CI normally — PRs opened by a workflow's `GITHUB_TOKEN` do not, which
defeats the point of cutting a reviewable release.

## Background reading

Read [`docs/oss/versioning.md`](../../../docs/oss/versioning.md) before
running this skill. It covers:

- The source-of-truth model (root `package.json` `version`).
- The lockstep guarantee (every workspace package matches the root).
- The dist-tag convention (`latest` / `dev` / `beta`).
- The full release procedure (this skill is step 2 of 4).
- The emergency-patch path (this skill does **not** handle patches).

This SKILL.md covers only the mechanics of step 2 — opening the bump PR.

## Pre-flight

Before invoking this skill, confirm:

1. The maintainer is on `main` with a clean working tree (`git status --short` is empty).
2. `git pull --ff-only origin main` succeeds.
3. There are no in-flight breaking changes that need to be called out in the
   release notes before the bump is cut. (If there are, surface them to the
   maintainer and wait for confirmation.)

If any precondition is unmet, stop and surface the issue. Do **not** try to
auto-resolve — a clean release branch is the maintainer's responsibility.

## Procedure

1. **Compute the target version.** Run `pnpm bump-minor` from the repo root.
   The script reads the root `package.json` `version` from `git show HEAD:package.json`
   (so the working tree state can't perturb the result), computes the next
   minor (`0.7.0` → `0.8.0`), and writes it to every workspace `package.json`
   via `scripts/set-version.ts`.

2. **Sanity-check the diff.** Confirm:
   - Every modified file is a `package.json`.
   - The diff is exactly `version` field changes (no other fields).
   - `pnpm-lock.yaml` is **not** modified (workspace-internal links use
     `workspace:*`, which doesn't carry a version, so the lockfile is
     unaffected by version bumps).

3. **Create a release branch.** Use the convention `release/<version>` (e.g.
   `release/0.8.0`). The branch name encodes the target version so reviewers
   can tell at a glance what the PR ships.

4. **Commit.** Use the message:

   ```
   chore(release): bump to <version>
   ```

   No body is required — the PR description will explain the bump in detail.

5. **Push the branch** to `origin`.

6. **Open the PR** with `gh pr create`. Use the title:

   ```
   chore(release): bump to <version>
   ```

   The body should:

   - State the previous and new version (`<previous> → <new>`).
   - Link to [`docs/oss/versioning.md`](../../../docs/oss/versioning.md)
     for context.
   - Surface any release-notes-worthy changes the maintainer flagged in
     the pre-flight check (or state explicitly that none were flagged).
   - Remind the merger that the **publish step is separate**: after this
     PR merges, dispatch the `Publish to npm` workflow from `main` with
     `dist-tag=latest` and `dry-run=false`.

7. **Stop and report the PR URL** to the maintainer. Do not merge the PR
   yourself; the merge is a human gate where someone confirms the release
   notes are acceptable.

## Idempotency

`pnpm bump-minor` is idempotent because it reads the root version from
`git show HEAD:package.json` rather than from the working tree. A maintainer
who runs the skill twice without committing in between still ends up with
the same target version, not a double-bump. If you find yourself in that
situation (working tree dirty with a previous bump), reset and re-run; do
not stack bumps.

## Out of scope

- **Publishing to npm.** The publish step is a separate dispatch of the
  `Publish to npm` workflow on `main`. This skill stops at "PR opened".
- **Patch releases.** Patches use a different bump shape (`patch+1` from
  a release tag); the manual procedure in `docs/oss/versioning.md`
  applies.
- **Pre-release / beta tags.** The `beta` dist-tag is hand-cut; this skill
  always advances to a stable minor.
