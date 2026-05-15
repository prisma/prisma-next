# Summary

Move the Prisma Next monorepo from publish-time version determination to package.json-as-source-of-truth versioning. Every publishable workspace package's `version` field reflects the current in-flight minor on `main`; a dedicated *version-bump PR* is the only way to advance the minor. `publish.yml` reads the version from `package.json` rather than computing it via `scripts/determine-version.ts` against npm dist-tags. This change is a prerequisite for the upgrade-skill mechanism ([`upgrade-skill.spec.md`](upgrade-skill.spec.md)) — agents writing breaking-change PRs need to know which version their work targets, and the only repo state that's available to a PR author is `package.json` on the branch.

# Context

## At a glance

Today, the version of every package on `main` is `0.0.1` — the placeholder value. The actual version is computed at publish time by `scripts/determine-version.ts`, which calls `npm view @prisma-next/contract dist-tags.latest`, adds a `+1` to the minor, and feeds the result through `scripts/set-version.ts` to rewrite every `package.json` *during the publish job* (the rewrite is never committed back to `main`). An agent or developer reading any `package.json` on any branch sees `0.0.1` and has no idea whether the next release will be `0.7.0` or `0.8.0`.

The new model:

```text
                 Today                              New
─────────────────────────────────  ─────────────────────────────────
package.json on main:              package.json on main:
  "version": "0.0.1"                 "version": "0.7.0"

publish.yml steps:                 publish.yml steps:
  1. determine-version.ts            1. read version from package.json
     (queries npm)                      (target = "0.7.0")
  2. set-version.ts <computed>       2. compute publish version per event:
  3. pnpm -r publish                    push:main → "0.7.0-dev.${run}"
                                        workflow_dispatch+stable → "0.7.0"
                                        workflow_dispatch+input → use input
                                     3. set-version.ts <publish version>
                                     4. pnpm -r publish

Bumping the minor:                 Bumping the minor:
  (implicit, computed by               version-bump PR:
   determine-version.ts at each          - runs `pnpm bump-minor` locally
   publish — never visible              - commits the set-version.ts result
   on main)                              (every publishable package.json
                                          updated)
                                       - merges to main
                                       (no other changes in that PR)
```

The user-facing trace, from an agent's perspective:

```text
# Agent on a feature branch:

agent> reads ./package.json → "version": "0.7.0"
agent> reads main's package.json → "version": "0.7.0"
agent> Both at 0.7. My breaking-change recipe goes in recipes/0.6-to-0.7/.

# Three weeks later, after main bumped to 0.8:

agent> reads ./package.json → "version": "0.7.0" (my branch is stale)
agent> reads main's package.json → "version": "0.8.0"
agent> Main has advanced past my branch's minor. Rebasing...
agent> After rebase: ./package.json → "0.8.0"
agent> recipes/0.6-to-0.7/ is frozen (per upgrade-skill.spec.md FR-FREEZE).
agent> Moving my recipe entry from 0.6-to-0.7/ to 0.7-to-0.8/.
```

This spec ships the version-source-of-truth refactor. The freeze rule that consumes it lives in [`upgrade-skill.spec.md`](upgrade-skill.spec.md) and gates recipe-directory modifications based on `main`'s `package.json`.

## Problem

Three concrete consequences of publish-time-only versioning today:

**1. PR authors can't know what version their change ships in.** A breaking change PR may sit open for several weekly releases (some breaking PRs need cross-package coordination, some are large enough to want soak time on the `dev` tag). During the PR's lifetime, the published minor on `main` may advance once or twice. The PR author has no signal — `package.json` says `0.0.1`, the release tags are off-tree. The upgrade-skill mechanism is unbuildable without this signal: a recipe lives at `recipes/<prev>-to-<current>/`, and `<current>` must be derivable from repo state on the PR branch.

**2. Tooling that depends on the current version is brittle.** `examples/*/package.json` declare their `@prisma-next/*` dependencies as `workspace:*` — fine for the monorepo, opaque to anything that wants to know what version those examples are pinned to (release notes, dependency dashboards, AI agents reasoning about user-shaped problems). External readers see `workspace:*` and have to guess.

**3. The `determine-version.ts` script is doing two jobs.** It both *computes the next minor* (a release-cadence decision the team should be making deliberately) and *constructs the publish version* (a per-event mechanical task: `-dev.${N}`, `-pr.${N}.${B}`, etc.). The two jobs have different cadences and different decision-makers; conflating them in one script means the cadence decision is implicit in the npm dist-tag state. Making the cadence decision explicit (via a version-bump PR) cleans up the script's responsibility to per-event mechanics only.

The cost of the change is bounded: it's a refactor of `publish.yml`, a small extension to `set-version.ts` (already exists), one new workspace script (`pnpm bump-minor`), and an initial commit that sets every `package.json` to the current target minor. No new infrastructure.

## Approach

Four mechanisms; each lands on this branch ([`tml-2514`](https://linear.app/prisma-company/issue/TML-2514)) before the upgrade-skill mechanism does.

**(A) `package.json.version` is the source-of-truth.** Every publishable workspace package's `version` field contains the **current in-flight minor**'s zero-patch form, e.g. `"0.7.0"`. All publishable packages move in lockstep (private packages — examples, test fixtures — are skipped by `set-version.ts`'s existing private filter). The initial set-up commit on this branch moves every publishable package from `0.0.1` to whatever the current target minor is (likely `0.7.0`, see Open Questions).

**(B) The version-bump PR pattern.** Advancing the minor is its own PR. Mechanics:

1. Maintainer runs `pnpm bump-minor` on a fresh branch. The script reads the current version from the root `package.json`, computes `${major}.${minor+1}.0`, and runs `scripts/set-version.ts <next-version>` against the workspace.
2. The script's diff is committed and pushed; the PR is opened.
3. The PR contains *only* the version-bump diff — every publishable `package.json` updated, nothing else. Easy to review.
4. CI runs the standard suite (typecheck, tests, lints, dependency-cruiser). The PR is mechanically clean.
5. Merge → `main`'s `package.json` now reflects the new minor → the recipe-freeze rule in the upgrade-skill spec kicks in for the previous minor's recipe directory.

A maintainer opens a version-bump PR when the team is ready to start the next minor — typically right after the previous minor's stable release has shipped. The PR is short-lived (minutes to hours; no review controversy).

**(C) `publish.yml` reads the version from `package.json`.** The workflow's `Determine version` step is replaced. New shape, per trigger:

| Trigger | Construction | dist-tag |
|---|---|---|
| `push: main` | `<pkg.json.version>-dev.${nextBuildNumber}` | `dev` |
| `pull_request` | `<pkg.json.version>-pr.${prNumber}.${nextBuildNumber}` | `pr` |
| `workflow_dispatch` with `inputs.version` empty | `<pkg.json.version>` | from `inputs.dist-tag` (default `latest`) |
| `workflow_dispatch` with `inputs.version` set | `inputs.version` (escape hatch) | from `inputs.dist-tag` |

`scripts/determine-version.ts` is retained but slimmed: it consumes the base version from `package.json` rather than from npm dist-tags, and produces only the per-event suffix logic. Its npm-dist-tag lookups are reduced to the *build-number* lookup (`getLatestDevVersion`, `getPrVersions`) — those still consult npm to find the next available `-dev.N` / `-pr.N.B` slot. The base-version lookup is gone.

For the `workflow_dispatch` stable-release path, the workflow validates that `inputs.version` (if provided) matches the major + minor of `package.json` — preventing a publish at `0.8.0` while `main` still says `0.7.0`. Mismatch fails the workflow with a clear error.

**(D) `pnpm bump-minor` workspace script.** A new workspace script that wraps `scripts/set-version.ts` with the increment-the-minor logic. Implementation: ~20 lines of TypeScript that reads `package.json`, computes the next minor, invokes `set-version.ts`. The script's intent is documentation as much as ergonomics — the existence of the script tells a maintainer "this is how you advance the minor; there's no other right way."

### What stays unchanged

- **`set-version.ts`** continues to do exactly what it does today: walk the workspace, update every non-private `package.json` to the version it's handed. Both `publish.yml` and `bump-minor` call it.
- **The `pnpm -r publish` invocation** in `publish.yml` is unchanged. It still publishes every non-private workspace package, including the upgrade-skill packages from [`upgrade-skill.spec.md`](upgrade-skill.spec.md).
- **`-dev.N` and `-pr.N.B` build-number allocation** continues to consult npm dist-tags via `determine-version.ts`. The mechanism for "the next available dev build number" doesn't change.
- **Patch releases.** Today, patches are handled via `workflow_dispatch` with an explicit `inputs.version=0.7.1`. That path continues to work — the input-override clause in (C) covers it. The team rarely (if ever) does patch releases in `0.x`; the spec doesn't add ceremony for it.

### Initial state setup

The branch this spec lands on (`tml-2514`) includes an initial commit that:

1. Sets every publishable `package.json`'s `version` to the current in-flight minor (likely `0.7.0` — see Open Questions; the implementer reads the latest stable from npm and picks `${minor+1}.0`).
2. Updates `publish.yml` to the new shape from (C).
3. Adds `pnpm bump-minor` script to the root `package.json`.

The initial state setup is one commit, reviewed as part of this branch's PR. After it lands, the upgrade-skill mechanism PR (also on this branch) can assume the new model.

# Requirements

## Functional Requirements

### Version source-of-truth

- **FR1.** Every publishable workspace package's `package.json` `version` field contains the current in-flight minor's zero-patch form (e.g. `"0.7.0"`). All publishable packages share the same value; `scripts/set-version.ts` is the only sanctioned way to update them.
- **FR2.** Private packages (`"private": true` in their `package.json`) are exempt from this rule — `set-version.ts`'s existing `pkg.private` skip filter is preserved unchanged.
- **FR3.** A new workspace script `pnpm bump-minor` exists at the root `package.json`. Running it: (a) reads the current version from the root or a designated source `package.json`, (b) computes the next minor (`${major}.${minor+1}.0`), (c) invokes `scripts/set-version.ts <next-version>` against the workspace. Output is the diff a maintainer commits and pushes; the script does not auto-commit, does not auto-push, does not open a PR.

### Publish workflow

- **FR4. Version source.** The `Determine version` step in `.github/workflows/publish.yml` reads the base version from a designated source `package.json` — implementer's choice of canonical source (proposed: the root `package.json` if the root has a `version`, otherwise a specific publishable package like `@prisma-next/cli`'s `package.json`). The choice must be unambiguous and a one-liner to read.
- **FR5. Per-event publish version construction.** The publish version is derived from the base version + the event type:
  - `push: main` → `<base>-dev.${buildNumber}` where `buildNumber` is the next available dev build for `<base>` (consult npm dist-tag `dev` as today, via `determine-version.ts`'s `getLatestDevVersion`).
  - `pull_request` → `<base>-pr.${prNumber}.${buildNumber}` where `buildNumber` is the next available pr build (consult npm `pr` dist-tag versions as today, via `determine-version.ts`'s `getPrVersions`).
  - `workflow_dispatch` with `inputs.version` empty → `<base>` (the base version as-is, intended for stable releases).
  - `workflow_dispatch` with `inputs.version` set → `inputs.version` (escape hatch; takes precedence).
- **FR6. Minor-mismatch guard.** When `workflow_dispatch` provides `inputs.version`, the workflow validates that the major and minor of `inputs.version` match `<base>`'s major and minor. Mismatch fails the workflow with a structured error naming both values and instructing the maintainer to either land a version-bump PR or correct the input. (Patch differences are allowed — `inputs.version=0.7.1` against `base=0.7.0` is fine.)
- **FR7. set-version invocation.** The workflow continues to call `scripts/set-version.ts <publish-version>` before `pnpm -r publish`, as today. The script's output (every publishable `package.json` rewritten to the publish version) is *not* committed back to `main` — it's a publish-time-only mutation, scoped to the workflow run.
- **FR8. dist-tag mapping.** The dist-tag is determined by event type, matching today's behaviour:
  - `push: main` → `dev`
  - `pull_request` → `pr`
  - `workflow_dispatch` → from `inputs.dist-tag` (default `latest`)

### `scripts/determine-version.ts`

- **FR9.** The script is retained but reduced in scope: it no longer calls `getLatestStableVersion()` or `calculateNextStableVersion()`. It receives the base version from the calling workflow step (env var `INPUT_BASE_VERSION` or equivalent; implementer's choice). Its remaining responsibility is the per-event suffix logic (`-dev.${N}`, `-pr.${N}.${B}`).
- **FR10.** The script's `workflow_dispatch` branch continues to honour `INPUT_VERSION` as today; the minor-mismatch guard from FR6 may be implemented inside the script or as a separate workflow step (implementer's choice).

## Non-Functional Requirements

- **NFR1. Backward compatibility for publish output.** Published versions must continue to follow the existing semver shapes: `<x>.<y>.<z>` for stable, `<x>.<y>.<z>-dev.<n>` for dev, `<x>.<y>.<z>-pr.<n>.<b>` for PR builds, `<x>.<y>.<z>-beta.<n>` for beta (if used). No existing consumer of a Prisma Next package sees a version shape change.
- **NFR2. Atomic version updates.** A version-bump PR updates every publishable package's `version` in one commit. Mixed states (some at `0.7.0`, some at `0.8.0`) on `main` are forbidden by construction — the bump PR either lands fully or doesn't land at all.
- **NFR3. Idempotency of `pnpm bump-minor`.** Running `pnpm bump-minor` twice in a row produces the same diff the second time as the first (i.e., the second run does not advance further). The script reads the version and increments deterministically; the second run on the already-bumped tree reads the bumped value and produces the *next* increment — which is *not* idempotent. **NFR3 is therefore the weaker form: re-running on an already-staged-but-uncommitted tree should produce no additional changes.** The implementer enforces this by reading the base version from a committed-to-disk source (the root `package.json` on the current commit, not the index).

  Wait — re-reading: idempotency of "I ran bump-minor, committed, then ran bump-minor again" should advance to the next minor (that's the intended use). So NFR3 is about *single-run* idempotency: running `pnpm bump-minor` without committing, then running it again, must not double-advance. Implementer reads from `git show HEAD:package.json` or equivalent.

- **NFR4. No publish-pipeline regressions.** The refactored `publish.yml` produces output (published packages, GitHub Releases, npm dist-tag updates) byte-equivalent to the current workflow for the same trigger + inputs. Demonstrated by running the workflow once in dry-run mode and diffing the resulting registry state against a baseline (mechanical: same publish version, same dist-tag, same provenance attestation).
- **NFR5. Documentation surface.** The repo gains a short release-process doc (e.g. `docs/release-process.md` or an entry in the existing onboarding docs) describing the bump-PR pattern: when to open one, what it contains, what NOT to combine with it. One screen of content.

## Non-goals

- **Maintenance branches for older minors.** If `0.8.0` ships and a critical bug is found in `0.7.x`, the fix lands as a `0.7.1` patch via the `workflow_dispatch` escape hatch (FR5's last row), against a maintenance branch the team cuts manually. This spec does not codify the maintenance-branch workflow; it's a known escape hatch that consumes the existing tooling. If the team starts patching old minors regularly, that's a separate spec.
- **Automated bump-PR creation.** The version-bump PR is opened by a maintainer running `pnpm bump-minor` locally. No GitHub Action auto-creates the bump-PR on a schedule; the cadence is a deliberate team decision per minor, not a calendar event.
- **Semver-major bumps.** When Prisma Next reaches `1.0.0`, the bump-PR pattern advances the major as well. The mechanics are identical (read current, compute next, run `set-version.ts`); the same `pnpm bump-minor` script may be extended with `pnpm bump-major` or the team may decide majors are handled by direct `pnpm exec set-version.ts <new-major>` invocations. This spec does not pre-commit to either.
- **Per-package independent versioning.** The monorepo's discipline is and continues to be lockstep versioning across all publishable packages. Per-package independent versions would require redesigning `set-version.ts` and the publish flow; out of scope here.
- **Replacing `set-version.ts`.** The existing script is fit for purpose; this spec extends its use, not its shape.
- **Backporting recipe coverage to pre-0.6 versions.** Already covered as a non-goal in [`upgrade-skill.spec.md`](upgrade-skill.spec.md).

# Acceptance Criteria

- [ ] **AC1. Initial version state visible on main.** After this spec's PR merges, every publishable workspace `package.json` `version` is the current in-flight minor (e.g. `"0.7.0"`). Private packages remain at whatever value they had before. Covers FR1, FR2.
- [ ] **AC2. Bump-minor script.** `pnpm bump-minor` reads the current version, computes `${major}.${minor+1}.0`, and rewrites every publishable `package.json` to the new value. Running it on a `0.7.0` tree produces a diff to `0.8.0` across all publishable packages. The script does not auto-commit; the maintainer reviews and commits manually. Covers FR3.
- [ ] **AC3. Single-run idempotency.** Running `pnpm bump-minor` twice without committing in between produces the same diff both times (the second run does not advance to `0.9.0`). Covers NFR3.
- [ ] **AC4. Publish workflow — `push: main`.** A push to `main` with `package.json` at `0.7.0` produces a publish at `0.7.0-dev.${N}` tagged `dev`, where `N` is the next build number after the current `dev` tag on npm. Verified by running the workflow on a feature branch with `act` or against a staging registry; or by inspecting workflow log output against a real run. Covers FR4, FR5, FR8.
- [ ] **AC5. Publish workflow — workflow_dispatch stable.** A `workflow_dispatch` run with `inputs.version` empty and `inputs.dist-tag=latest` against a tree at `0.7.0` publishes `0.7.0` to npm tagged `latest`, and creates a GitHub Release `v0.7.0`. Matches the existing stable-publish flow byte-for-byte. Covers FR4, FR5, FR8.
- [ ] **AC6. Publish workflow — minor-mismatch guard.** A `workflow_dispatch` run with `inputs.version=0.8.0` against a tree at `0.7.0` fails the workflow with a structured error naming both versions and pointing at the bump-PR pattern. No package reaches the registry. Covers FR6.
- [ ] **AC7. Publish workflow — input override.** A `workflow_dispatch` run with `inputs.version=0.7.1` against a tree at `0.7.0` publishes `0.7.1` (patch is allowed; only major/minor mismatch is blocked). Covers FR5, FR6 (the patch-allowance carve-out).
- [ ] **AC8. PR build versions.** A pull-request workflow run against PR #999 with the base tree at `0.7.0` publishes `0.7.0-pr.999.${N}` tagged `pr`, where `N` is the next available pr build for `0.7.0-pr.999`. Covers FR5, FR8.
- [ ] **AC9. determine-version.ts slimming.** The script no longer calls `getLatestStableVersion()` or `calculateNextStableVersion()`. The remaining call sites consult npm only for the `dev` and `pr` build-number lookups. Demonstrated by inspecting the script's source against the new shape. Covers FR9.
- [ ] **AC10. Release-process doc.** The repo contains a short release-process doc describing the bump-PR pattern, when to open one, and what NOT to combine with it. Linked from the contributor onboarding. Covers NFR5.

# Other Considerations

## Security

No new security surface. The publish flow's existing OIDC trusted-publishing setup is preserved unchanged; the only change is *which file the publish version comes from*, not *who is allowed to publish*. The bump-PR is a normal PR subject to the existing CODEOWNERS / branch-protection rules.

A minor consideration: now that `package.json` on every branch advertises the target minor, an external observer can read the version off a public branch and infer the team's release-cadence trajectory. This is information leakage the team is comfortable with — the version is also visible in GitHub Releases, the npm dist-tag history, and the conversation in public issues.

## Cost

- **CI cost.** Negligible. The new `Determine version` step is a one-liner reading a `package.json` field; the existing `determine-version.ts` becomes shorter, not longer.
- **Maintenance cost.** Each minor cycle costs the team a 1-PR-shaped bump-PR. Maintainer time per PR: <5 minutes (`pnpm bump-minor && git commit && gh pr create`). The PR's review is trivial — a mechanical diff across N package.jsons.
- **Migration cost.** One-time: this spec's PR includes the initial version-state commit and the workflow refactor. Estimated under a day of engineering time.

## Observability

- **Workflow logs.** The refactored `Determine version` step logs both `<base>` and the computed publish version, so anyone debugging a publish can see the derivation. Existing GitHub Actions log retention covers this.
- **Bump-PR visibility.** Every bump-PR is a public PR with a conventional title (recommended: `chore: bump to 0.8.0`). The PR title + the diff together are the audit trail for "when did the minor advance."

## Data Protection

Not applicable. The spec touches `package.json` files only; no personal data flows through the changed code paths.

## Analytics

Not applicable. The spec is build-tooling-shaped; analytics belong to the consuming application layer.

# References

- [TML-2514](https://linear.app/prisma-company/issue/TML-2514) — parent ticket for the agent-skill project this spec belongs to.
- [`upgrade-skill.spec.md`](upgrade-skill.spec.md) — the spec that consumes this one. Recipe directory keying and the recipe-freeze rule both depend on the package.json-versioning model this spec establishes.
- [`.github/workflows/publish.yml`](../../../.github/workflows/publish.yml) — the workflow this spec refactors.
- [`scripts/determine-version.ts`](../../../scripts/determine-version.ts) — the script this spec slims.
- [`scripts/set-version.ts`](../../../scripts/set-version.ts) — the script this spec consumes from a new entrypoint (`pnpm bump-minor`) but does not modify.

# Open Questions

1. **Designated source `package.json` for the version read.** The implementer picks one of:
   - The root `package.json` — currently `"@prisma-next/monorepo"`, marked `"private": true`. Adding a `version` field to a private package is unconventional but fine if scoped to "internal source of truth." **Default.**
   - The `package.json` of a stable publishable package (e.g. `@prisma-next/cli`). Avoids touching the root; downside is the choice of "which package" is somewhat arbitrary.
   - A new dedicated `VERSION` file at the repo root.

   The choice is internal to the workflow; consumers don't see it. **Default: root `package.json` `version` field.**

2. **Initial minor value.** When this spec's PR lands, what value goes into every publishable `package.json`? Today's `npm view @prisma-next/contract dist-tags.latest` is `0.6.1` (per the upgrade-skill spec's reference to PN at `0.6.1`). The implementer reads the actual current `latest` tag, computes `${minor+1}.0` = likely `0.7.0`, and uses that. **Default: read at implementation time; use `${current_latest_minor + 1}.0`.**

3. **`pnpm bump-minor` source for "current version".** The script can read the current version from (a) the root `package.json` (in step with Open Question 1), or (b) `npm view ... dist-tags.latest` (decouples the script from the source-of-truth choice). **Default: same source as the workflow (Open Question 1's resolution).** Keeping them aligned avoids divergence.

4. **Behaviour when `workflow_dispatch` runs against a `package.json` containing a pre-release suffix.** This is unlikely in practice — `main` should never carry a pre-release suffix in `package.json` under the new model — but the workflow may receive a runtime where someone manually edited the version. Default: the minor-mismatch guard treats pre-release as "minor matches if the major.minor matches the input, ignoring the pre-release suffix." Implementer to confirm.
