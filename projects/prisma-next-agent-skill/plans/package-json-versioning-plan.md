# Plan — `package.json`-versioning refactor

Execution plan for [`../specs/package-json-versioning.spec.md`](../specs/package-json-versioning.spec.md). Output of a `principal-engineer` + `oss-specialist` discussion captured on 2026-05-14; see the bottom of this file for decisions and amendments to the spec that emerged from that discussion. The spec amendments land as part of this PR.

Linear ticket: [TML-2518](https://linear.app/prisma-company/issue/TML-2518/packagejson-versioning-refactor).

## Summary

Move Prisma Next from publish-time version determination to root-`package.json`-as-source-of-truth. Every workspace package's `version` field — publishable *and* private, plus the root — carries the current in-flight minor in lockstep. `publish.yml` reads what it publishes from root; advancing the minor is a deliberate bump-PR opened by a maintainer. The policy lives in a new `docs/oss/versioning.md`; a maintainer skill wraps the operational procedure.

The refactor is a prerequisite for TML-2515 (the upgrade-skill mechanism): recipe-directory keying needs the in-flight version readable from any PR branch's `package.json`.

## Shipping strategy

Single PR, single milestone. The refactor is internally cohesive — splitting it across multiple PRs would leave intermediate states where the publish workflow's assumptions don't match the repo's state. Within the PR, work is sequenced into 9 small commits (T1–T9) that are individually reviewable; see *Tasks* below.

The PR is safe to deploy at the merge commit: the next `push: main` after merge publishes `0.7.0-dev.N` (where N is the next dev-build slot), which is the team's current `dev`-channel trajectory anyway (npm dist-tag `dev` is already `0.7.0-dev.2`).

## Collaborators

- Maintainers of Prisma Next (the audience of the new skill and the OSS-posture doc).
- TML-2515 implementer (the recipe-directory keying depends on the new model landing first).

## Test design

Acceptance criteria from the spec, mapped to test cases. AC numbering matches the spec; **(AMENDED)** marks ACs adjusted by the discussion's spec amendments (D2/D4/D5/D8).

| AC | Test case | Type | How it's exercised |
|---|---|---|---|
| AC1 | After PR merges, every workspace `package.json` (publishable, private, and root) has `"version": "0.7.0"` | manual + grep | After T6, grep `package.json` files for the version field; confirm 81/81 packages at `0.7.0`; spot-check the root |
| AC2 | `pnpm bump-minor` on a `0.7.0` tree produces a diff to `0.8.0` across every package | unit (vitest) + manual smoke | `computeNextMinor("0.7.0") === "0.8.0"` (unit); validation gate runs `pnpm bump-minor` against the post-T6 tree, verifies the diff, then `git restore .` |
| AC3 | Single-run idempotency of `pnpm bump-minor` | unit (vitest) | `computeNextMinor` is pure and reads the input version as an argument; same input → same output. The wrapper script reads the input version from `git show HEAD:package.json` (not the working tree, not the index) per T4, so two consecutive runs without a commit yield identical diffs |
| AC4 | `push: main` → `<base>-dev.N` | dry-run + unit (vitest) | Unit: `determineDevVersion("0.7.0", existingDevTag)` returns expected suffix. Dry-run: trigger `workflow_dispatch` against `tml-2518` with `dry-run: true`; inspect computed version + pnpm-publish-dry-run output in logs |
| AC5 | `workflow_dispatch` empty input → `<base>` | dry-run | Same dry-run mechanism; confirm logged "would publish 0.7.0 tagged latest" + `pnpm -r publish --dry-run` succeeds |
| AC6 **(REMOVED — D5)** | Minor-mismatch guard | — | No longer applicable; `inputs.version` removed |
| AC7 **(REMOVED — D5)** | Input override for patch | — | No longer applicable; `inputs.version` removed |
| AC8 **(REMOVED — D4)** | PR build versions | — | No longer applicable; `pull_request` flow dropped |
| AC9 **(AMENDED)** | `determine-version.ts` slimming | code review + structural | Source no longer imports/calls `getLatestStableVersion`, `calculateNextStableVersion`, `getPrVersions`, `parsePrBuildNumber`, `findNextPrBuildNumber`, `determinePrVersion`; only `getLatestDevVersion` remains as the npm-dist-tag call. `parseVersion` is moved to `determine-version-utils.ts` |
| AC10 **(AMENDED)** | Release-process doc | manual | `docs/oss/versioning.md` exists, covers policy + maintainer procedure, linked from `docs/oss/README.md`, `docs/README.md`, and `AGENTS.md` |

Additional tests not derived from an AC but justified by the refactor:

| Concern | Test case | Type |
|---|---|---|
| Pre-release suffix tolerance in `parseVersion` | `parseVersion("0.7.0-foo")` returns `{ major: 0, minor: 7, patch: 0 }` (suffix-tolerant); pairs with `computeNextMinor` producing `"0.8.0"` | unit (vitest) |
| Base-version format guard (F7) | `determine-version.ts` rejects a base that doesn't match `/^\d+\.\d+\.\d+$/` with a clear error message; tested via the pure helper `assertCanonicalBase` (extracted to utils for testability) | unit (vitest) |
| `set-version.ts` reaches every workspace package | After `node scripts/set-version.ts 0.7.0`, all 81 packages from `pnpm list -r --json` (61 publishable + 20 private including root) carry `"version": "0.7.0"` | manual verification post-T6 |
| `parsePrBuildNumber` / `findNextPrBuildNumber` removal | Their `describe` blocks in `determine-version-utils.test.ts` are deleted; remaining tests pass | vitest |

## Milestones

### M1 — Ship the refactor (single milestone)

#### Deliverables

1. **`docs/oss/versioning.md`** (new). Same shape as `docs/oss/supply-chain.md` (policy + the *why* + pointers to enforcement). Covers: lockstep-across-all-packages rule, root as source-of-truth, the bump-PR pattern, the relationship to TML-2515's recipe-directory keying, the maintainer's "how to publish a release" procedure. Per discussion D8: ADRs are architectural; OSS posture is project-management — this is the latter.
2. **`.agents/skills/publish-npm-version/SKILL.md`** (new). Short, wraps the procedure from `docs/oss/versioning.md`; does not restate policy. Encodes the **correct release flow direction** (per F4): publish current main version as stable → then open a bump-PR to start the next minor. Skill steps:
   1. Confirm main carries the version to be published (e.g. `0.7.0`).
   2. Trigger `gh workflow run publish.yml --field dist-tag=latest` (or other dist-tag if the maintainer specified).
   3. Wait for / verify the publish workflow succeeded; check the GitHub Release was created.
   4. Prompt the maintainer to start the next minor.
   5. If yes: create branch `chore/bump-to-${next}`, run `pnpm bump-minor`, commit, push, `gh pr create` linking to `docs/oss/versioning.md`.
3. **Scripts.**
   - `scripts/determine-version-utils.ts` — **move in** `parseVersion` from `determine-version.ts` (F3); add `computeNextMinor`; add `assertCanonicalBase` (F7); remove `parsePrBuildNumber` and `findNextPrBuildNumber`. Keep `getLatestDevVersion`-related helpers (none in this file currently; `getLatestDevVersion` itself stays in `determine-version.ts` since it does I/O).
   - `scripts/determine-version-utils.test.ts` — add cases for `parseVersion` (with suffix-tolerance), `computeNextMinor`, `assertCanonicalBase`; remove cases for `parsePrBuildNumber` and `findNextPrBuildNumber`.
   - `scripts/determine-version.ts` — slim: read `<base>` from root `package.json.version`; assert canonical shape; emit `<base>` (workflow_dispatch) or `<base>-dev.N` (push:main). Remove (F2): the `pull_request` switch case, `getLatestStableVersion`, `calculateNextStableVersion`, `getPrVersions`, `determinePrVersion`, the inline `parseVersion` (extracted). Keep `getLatestDevVersion`, `determineDevVersion`, `writeGitHubOutput`. Workflow_dispatch case becomes: `if (!INPUT_TAG) throw; result = { version: base, tag: INPUT_TAG };` — no more `INPUT_VERSION`.
   - `scripts/bump-minor.ts` (new) — read root `package.json.version`, validate via `assertCanonicalBase`, compute next minor via `computeNextMinor`, spawn `node scripts/set-version.ts <next>`. Idempotent per AC3 because input comes from disk.
   - `scripts/set-version.ts` — drop the `pkg.private` skip (D2); walk every package returned by `pnpm list -r --json`. Update the script's log output accordingly.
4. **Root `package.json`.** Add `"version": "0.7.0"` and a new `"bump-minor": "node scripts/bump-minor.ts"` script entry.
5. **`.github/workflows/publish.yml`** refactor.
   - Drop `inputs.version` input. Keep `inputs.dist-tag` (default `latest`). Add `inputs.dry-run` boolean (default `false`).
   - **Relax `if: github.ref == 'refs/heads/main'` (F1)** to `if: github.ref == 'refs/heads/main' || (github.event_name == 'workflow_dispatch' && inputs.dry-run)`. This is the one breach of "byte-equivalent for same-input" — it's the necessary affordance for AC4/AC5 dry-run validation on `tml-2518`. Documented in the YAML with a comment.
   - Replace the inline shell branch on `INPUT_VERSION` with `node scripts/determine-version.ts` for all event types.
   - Dry-run mode (F5): replace `pnpm -r publish ...` with `pnpm -r publish --dry-run ...` (exercises pack + manifest validation without hitting the registry); replace `gh release create` with `echo "Would create release v$VERSION"` (no harmless dry-run flag).
   - Keep everything else byte-equivalent (concurrency, OIDC `id-token: write`, NPM provenance, `Check publish dependency specifiers`, GitHub Release idempotency on rerun).
6. **Initial-state commit.** Every `package.json` in the workspace (61 publishable + 20 private including root = 81 packages) gets `"version": "0.7.0"`.
7. **`AGENTS.md`** — add "OSS posture" to the Start Here section (links to `docs/oss/README.md` and `docs/oss/versioning.md`). Discovered during the discussion: the file isn't currently mentioned in `AGENTS.md`.
8. **`docs/README.md`** — add the new `versioning.md` entry under "OSS posture".
9. **`docs/oss/README.md`** — add `versioning.md` to the pages list and audience map.
10. **Spec amendments** to `projects/prisma-next-agent-skill/specs/package-json-versioning.spec.md`:
    - **D2:** FR2 inverted (`set-version.ts` walks *every* package, not only publishables). FR7 wording cascades — "every publishable" → "every workspace" (F8).
    - **D4:** Drop FR5's `pull_request` row, AC8, and associated helper code.
    - **D5:** Drop FR5's input-set row, FR6, AC6, AC7, FR10, and the minor-mismatch guard.
    - **D6:** Add a new FR documenting the `dry-run` input.
    - **D8:** AC10 wording updated — doc lives at `docs/oss/versioning.md`, not `docs/release-process.md`.

#### Validation gate

The PR is considered done when:

- `pnpm install --frozen-lockfile` passes after T6.
- `pnpm typecheck` passes (catches malformed `package.json` across the 81 files touched in T6).
- `pnpm test:packages` passes (includes the vitest cases for `determine-version-utils.ts`).
- `pnpm lint:packages && pnpm lint:deps && pnpm lint:manifests && pnpm lint:workflows && pnpm lint:docs` all pass.
- `pnpm build` succeeds across the workspace.
- **Manual smoke for AC2 (F6):** run `pnpm bump-minor` against the post-T6 tree; verify the diff is `0.7.0 → 0.8.0` across all 81 packages; `git restore .` to revert.
- **Dry-run of `publish.yml`** triggered against `tml-2518` (via `workflow_dispatch` with `dry-run: true`) reports the expected computed versions for `0.7.0` stable and `0.7.0-dev.N` dev paths, and `pnpm -r publish --dry-run` succeeds (covers AC4, AC5).
- The spec at `specs/package-json-versioning.spec.md` reflects the five amendments (D2, D4, D5, D6, D8) and re-reads as consistent.

#### Accepted residual risk

The live `pnpm publish` against the npm registry is never exercised on this PR. First production execution is the next `push: main` after merge (publishes `0.7.0-dev.N`). Mitigation: `pnpm -r publish --dry-run` in dry-run mode exercises pack, manifest validation, and dependency-specifier rewriting — everything except the registry handshake. If a regression bites, the publish.yml refactor is a single-commit revert away.

## Tasks

Each task ≈ one commit in the final PR. Sequenced so each commit is reviewable in isolation.

### T1 — Drop the dead `pull_request → -pr.N.B` flow

- From `scripts/determine-version.ts`: remove the `pull_request` switch case, `getPrVersions()` (line 30), `determinePrVersion()` (line 46), and the import of `findNextPrBuildNumber` from utils (F2).
- From `scripts/determine-version-utils.ts`: remove `parsePrBuildNumber` and `findNextPrBuildNumber`, plus the `PR_VERSION_PATTERN` and `assertNumericPrNumber` private helpers they depend on.
- From `scripts/determine-version-utils.test.ts`: remove the `describe('parsePrBuildNumber', ...)` and `describe('findNextPrBuildNumber', ...)` blocks.
- After this task, `determine-version.ts` still computes `<base>` via npm dist-tag round-trip (the slimming happens in T5) — the workflow continues to function unchanged for `push:main` and `workflow_dispatch` events.
- Covers: D4. Unblocks: AC9.

### T2 — Extend `set-version.ts` to walk private packages

- Remove the `if (pkg.private)` skip in `scripts/set-version.ts`.
- Adjust the script's banner comment + the `Skipping private package` log path (eliminated) accordingly.
- Update the `skippedCount` accounting (drops to 0 / removed).
- Covers: D2. Unblocks: AC1, AC2.

### T3 — Move `parseVersion` to utils + add `computeNextMinor`, `assertCanonicalBase`

- **Move** `parseVersion` from `scripts/determine-version.ts` (line 36) to `scripts/determine-version-utils.ts` as an exported function (F3). Import it back into `determine-version.ts`.
- Add `computeNextMinor(version: string): string` to utils — uses `parseVersion`; returns `${major}.${minor + 1}.0`.
- Add `assertCanonicalBase(base: string): void` to utils — throws with a clear error if `base` doesn't match `/^\d+\.\d+\.\d+$/` (F7).
- Add vitest cases in `determine-version-utils.test.ts` for: `parseVersion("0.7.0")`, `parseVersion("0.7.0-foo")` suffix tolerance, `computeNextMinor("0.7.0") === "0.8.0"`, `assertCanonicalBase("0.7.0")` returns without throwing, `assertCanonicalBase("0.7.0-foo")` throws with a recognisable message.
- Covers: D3. Unblocks: AC2, AC3.

### T4 — Add `scripts/bump-minor.ts` and `pnpm bump-minor`

- Create `scripts/bump-minor.ts`. Implementation sketch (~20 lines):
  1. Read the root version from **HEAD** via `execSync('git show HEAD:package.json')` (not from disk). This is the spec's NFR3 resolution — single-run idempotency on an uncommitted bumped tree comes from anchoring the read to `HEAD`, not the working tree.
  2. Validate via `assertCanonicalBase(pkg.version)`.
  3. Compute `next = computeNextMinor(pkg.version)`.
  4. Spawn `node scripts/set-version.ts <next>` via `node:child_process`.
- Add `"bump-minor": "node scripts/bump-minor.ts"` to root `package.json` `scripts` (the script entry is added now; the actual `version` field on root is added in T6).
- AC3 trace: run 1 reads HEAD (0.7.0), writes 0.8.0 to disk; run 2 reads HEAD (still 0.7.0 because no commit yet), writes 0.8.0 to disk again → identical diff. ✓ After the maintainer commits the bump, a subsequent invocation reads HEAD (0.8.0) and advances to 0.9.0 — which is the intended path-forward semantics for the next minor cycle.
- Covers: FR3, NFR3, AC2, AC3.

### T5 — Slim `scripts/determine-version.ts` to read base from root

- Add a `readBaseFromRoot()` helper at the top of the script: read root `package.json`, return `version` field. Call `assertCanonicalBase(base)` immediately to fail fast on malformed input (F7).
- Remove (F2): `getLatestStableVersion()`, `calculateNextStableVersion()`, the inline `parseVersion` (already moved by T3).
- Rewrite the switch:
  - `push` → `determineDevVersion(base)` (unchanged signature, unchanged call to `getLatestDevVersion`).
  - `workflow_dispatch` → `if (!INPUT_TAG) throw; result = { version: base, tag: INPUT_TAG };` (no `INPUT_VERSION` handling).
  - `pull_request` → already removed by T1; deleting the case is a no-op here.
- The script's logging line `Latest stable version: ...` becomes `Base version (from root package.json): ...`. The `Base version for dev builds: ...` log line stays, computed as `base`.
- Add a unit test or two via the utils module: `assertCanonicalBase("0.7.0-pr.1.1")` throws — provides the regression hook for the format guard.
- Covers: D1, D5, F7, FR4, AC9.

### T6 — Initial-state commit: set every `package.json` to `0.7.0`

- Run `node scripts/set-version.ts 0.7.0` against the tree (T2 already made it walk private packages, including the root).
- Verify (via `pnpm list -r --json` post-edit) that all 81 packages, including `@prisma-next/monorepo` (root), now carry `"version": "0.7.0"`.
- Run `pnpm install` (no `--frozen-lockfile`) to refresh the lockfile if needed; workspace-protocol deps should resolve identically (`workspace:*` → `link:`), so the lockfile should not actually change — but verify.
- Commit the resulting diff (large but mechanical: ~81 files).
- Covers: D9, AC1.
- **Checkpoint 3 (optional high-reasoning review)** sits here — the diff is mechanical, but a sanity-check pass before the commit is cheap insurance against `set-version.ts` having missed a package or written corrupt JSON.

### T7 — Refactor `.github/workflows/publish.yml`

- Drop `inputs.version`. Keep `inputs.dist-tag` (default `latest`). Add `inputs.dry-run` boolean (default `false`).
- **Relax the `if:` on the `publish` job (F1):** `if: github.ref == 'refs/heads/main' || (github.event_name == 'workflow_dispatch' && inputs.dry-run)`. With an explanatory comment: dry-run is the affordance that lets `publish.yml`-touching PRs validate the refactor before merge; otherwise the job would silently skip on non-`main` dispatches. **Security note** (for checkpoint 2 review): `workflow_dispatch` is gated by GitHub's actor permissions (write access to the repo), so the dry-run path is reachable only by users who already could push to `main`. The dry-run never invokes `npm publish` (uses `--dry-run`) or `gh release create`, so the elevated permissions (`id-token: write`, `contents: write`) carry no realised privilege in this code path. Confirm at checkpoint 2.
- Replace the inline shell branch on `INPUT_VERSION` in the `Determine version` step with a single `node scripts/determine-version.ts` call. The script handles all event types now.
- In the `Publish packages` step: change `pnpm -r publish --access public --tag "..."` to `pnpm -r publish --access public --tag "..." ${{ inputs.dry-run && '--dry-run' || '' }}` (F5).
- In the `Create GitHub Release for stable publishes` step: add `if: steps.version.outputs.tag == 'latest' && !inputs.dry-run` (the latter half is new); in dry-run mode, echo `"Would create release v$VERSION"`.
- Preserve byte-equivalent for same-input (non-dry-run): concurrency group, OIDC `id-token: write`, `NPM_CONFIG_PROVENANCE`, `Check publish dependency specifiers`, `Create GitHub Release` idempotency-on-rerun semantics.
- Covers: D5, D6, F1, F5, FR4, FR5 (remaining rows), AC4, AC5.
- **Checkpoint 2 (high-reasoning review required)** sits here — this is the one task that can break real publishes. Detailed YAML review + dry-run validation pass before declaring the gate met.

### T8 — Write `docs/oss/versioning.md` and the maintainer skill

- Write `docs/oss/versioning.md` covering: lockstep rule + root-as-source-of-truth + bump-PR pattern + maintainer procedure + cross-link to TML-2515's upgrade-skill mechanism.
- Write `.agents/skills/publish-npm-version/SKILL.md` (short; wraps the procedure with the correct flow direction per F4 — release current main first, then bump for next minor).
- Update `docs/oss/README.md`: add `versioning.md` to the pages list + audience map.
- Update `docs/README.md`: add `versioning.md` entry under "OSS posture".
- Update `AGENTS.md`: add an "OSS posture" line in the Start Here section pointing at `docs/oss/README.md` + `docs/oss/versioning.md`.
- Covers: D7, D8, F4, AC10.

### T9 — Amend the in-repo spec

- Apply the five spec amendments (D2, D4, D5, D6, D8) to `projects/prisma-next-agent-skill/specs/package-json-versioning.spec.md`:
  - **D2:** FR2 inverted; FR7 wording widened from "publishable" to "every workspace package" (F8).
  - **D4:** FR5 `pull_request` row removed; AC8 removed; mention of `getPrVersions` in FR5 narrative removed.
  - **D5:** FR5 input-set row removed; FR6 removed entirely; FR10 removed entirely; AC6 removed; AC7 removed.
  - **D6:** New FR added documenting the `dry-run` input on `workflow_dispatch`.
  - **D8:** AC10 wording updated — doc lives at `docs/oss/versioning.md`.
- Update Open Questions: OQ4 marked moot (no minor-mismatch guard remains); OQ1 resolved (root `package.json.version`); OQ2 resolved (`0.7.0`); OQ3 resolved (root `package.json`).

## Checkpoints (high-reasoning escalation points)

I'm operating in medium reasoning effort. Three points where I'll ask the user to upgrade me to high reasoning before proceeding:

1. **Checkpoint 1 — Plan validation, before any code lands.** A high-reasoning pass over this plan against the spec ACs/FRs (post-amendment), confirming completeness and catching gaps before implementation starts. Triggered: immediately, once the user reviews and approves this plan.
2. **Checkpoint 2 — `publish.yml` refactor review (T7).** This is the one task that can break real releases. High-reasoning review of the YAML diff + the slimmed `determine-version.ts` + a walked dry-run validating AC4/AC5. Triggered: after I've written the changes locally, before the dry-run is kicked off.
3. **Checkpoint 3 — Initial-state commit (T6, optional).** ~80 mechanical file changes. A sanity-check pass before staging the commit, in case `set-version.ts` missed a package or produced malformed JSON. Triggered: after running `set-version.ts 0.7.0` and before `git add`.

## Decisions and spec amendments (from the discussion)

Captured here in summary form; the full reasoning is in the discussion transcript (chat).

| # | Decision | Spec impact |
|---|---|---|
| D1 | Root `package.json.version` as single source-of-truth | Resolves Open Q1 (default option chosen) |
| D2 | `set-version.ts` walks every package, public *and* private | Inverts FR2 |
| D3 | Three thin scripts (utils + workflow entrypoint + bump entrypoint); tests next to source | Within spec |
| D4 | Drop the `pull_request → -pr.N.B` flow entirely (dead code since Jan 2026) | Drops FR5 PR row, AC8, helpers + tests |
| D5 | Drop `inputs.version` from `workflow_dispatch`; publish is "what root says, no overrides" | Drops FR5 input-set row, FR6, AC6, AC7, minor-mismatch guard |
| D6 | Add `dry-run` boolean input to `workflow_dispatch` as a permanent operability tool | Adds a new FR (record in amended spec) |
| D7 | No GitHub workflow for the bump; maintainer skill wraps `pnpm bump-minor` locally | Within spec (skill is non-spec'd ergonomic) |
| D8 | Policy lives in `docs/oss/versioning.md`; not an ADR | Amends AC10 wording |
| D9 | Initial minor is `0.7.0` (verified against `npm view`) | Resolves Open Q2 |

## Open questions (none blocking)

All open questions from the spec are either resolved by the decisions above or dissolved by the amendments (the pre-release-suffix questions, OQ4 and OQ1's edge case, become moot once the minor-mismatch guard is removed). If a need for patch publishes (`0.7.1`) emerges before TML-2515 ships, the response is to add a `pnpm bump-patch` skill in a follow-up — not to re-introduce `inputs.version`.

## Checkpoint 1 findings (high-reasoning validation pass)

Performed 2026-05-14 in high-reasoning mode before any code lands. Findings F1–F9 below are folded into the deliverables/tasks above; F10 is recorded as accepted residual risk under the validation gate.

- **F1 — Dry-run blocked by `if: github.ref == 'refs/heads/main'`.** Folded into T7's `if:` relaxation. Without this, AC4/AC5 dry-run validation on `tml-2518` would silently skip.
- **F2 — Dead-code removal in `determine-version.ts`.** Folded into T1: `getPrVersions`, `determinePrVersion`, and the `findNextPrBuildNumber` import all go.
- **F3 — Extract, don't recreate `parseVersion`.** Folded into T3: the function moves from `determine-version.ts` to utils.
- **F4 — Skill flow direction.** Folded into the skill deliverable: publish current main first, *then* open the bump-PR for the next minor.
- **F5 — Dry-run uses `pnpm publish --dry-run`, not an echo-only skip.** Folded into T7. Exercises pack + manifest validation without registry handshake.
- **F6 — Validation gate runs `pnpm bump-minor` smoke.** Folded into the validation gate.
- **F7 — Base-version format guard in `determine-version.ts`.** Folded into T3 (`assertCanonicalBase` in utils) and T5 (call site).
- **F8 — FR7 wording cascade from D2.** Folded into T9's spec-amendment list.
- **F9 — Deliverable 1 reworded** from the negation form to the OSS-posture artifact.
- **F10 — Live `pnpm publish` never exercised on this PR.** Documented in the validation gate as accepted residual risk; mitigated by `--dry-run` exercising pack. First production execution is the next `push: main` after merge.
