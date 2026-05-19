# Manual QA report — TML-2535 (agent-skill distribution fix + cluster move) — 2026-05-17

> **Script:** `projects/prisma-next-agent-skill/manual-qa.md` (commit `8e32189b459451a8f54a034bb5fa2d6e68719f47` at run time)
> **Runner:** claude-sonnet-46-subagent
> **Environment:** macOS darwin 25.3.0, Node v24.13.0, pnpm v10.27.0, branch `tml-2535-bug-dont-use-npm-to-publish-skills` @ `8e32189b459451a8f54a034bb5fa2d6e68719f47`
> **Started:** 2026-05-17T08:42:00Z
> **Finished:** 2026-05-17T09:25:00Z
> **Verdict:** ❌ Fail

## Summary

Two ⚠️ High findings and several 📝 Follow-ups. The core skill-distribution mechanism (subpath scoping, contributor-leak prevention, postinstall symlinks, upgrade-skill SKILL.md, and the `prisma-next-check-pins` binary) all work correctly. However, `prisma-next init` exits non-zero (exit 5) on a fresh consumer project due to a contract-emit failure unrelated to this PR's changes — the npm-published `@prisma-next/postgres@0.8.0` package does not export `serializeContract`, causing init to fail before the skill-install step. Additionally, the `--no-install` / `--no-skill` skip warnings reference a single legacy-form install URL instead of the three-cluster multi-install commands this PR adds. The `prisma-next-check-pins` bin is not accessible at `node_modules/.bin/` without the package being in root `devDependencies`.

## Findings

### F-1 — ⚠️ High — `prisma-next init` exits non-zero on fresh consumer project; skill install never reached

**Scenario:** 2 — End-to-end `prisma-next init` against a fresh project (also affects scenarios 9, 10)
**Step:** Step 3 (`node "$PN_REPO/packages/.../cli.js" init --target postgres --authoring psl --yes`)
**Oracle:** Init exits with code 0; 12 skills installed under `.agents/skills/`.

**Observed:**
```
{
  "ok": false,
  "code": "PN-CLI-5008",
  "domain": "CLI",
  "severity": "error",
  "summary": "Failed to emit contract",
  "why": "`prisma-next contract emit` failed: Cannot read properties of undefined (reading 'serializeContract')",
  "fix": "Inspect your contract file, fix the underlying issue, then re-run `pnpm prisma-next contract emit`. Pass `-v` for the full error happened.",
  "meta": {
    "filesWritten": [
      "prisma/contract.prisma",
      "prisma-next.config.ts",
      "prisma/db.ts",
      "prisma-next.md",
      ".env.example",
      "tsconfig.json",
      ".gitignore",
      ".gitattributes",
      "package.json"
    ],
    "cause": "Cannot read properties of undefined (reading 'serializeContract')"
  }
}
init exit: 5
```

**Expected (per script):** Exit code 0; `ls .agents/skills/ | wc -l` reports 12.

**Reproduction:**
- `git rev-parse HEAD` → `8e32189b459451a8f54a034bb5fa2d6e68719f47`
- `git status` at failure → clean (only pre-existing untracked files)
- Mutated files: none in the repo; fresh tmpdir only
- Exact command: `PRISMA_NEXT_SKILLS_BASE="$PN_REPO" SKILLS_AGENT_AUTO=cursor-cli node "$PN_REPO/packages/1-framework/3-tooling/cli/dist/cli.js" init --target postgres --authoring psl --yes`

**Notes:** The init command installs `@prisma-next/postgres@^0.8.0` from the npm registry (version 0.8.0). Inspecting the installed package, its root does not export `serializeContract` — the function is missing from the npm-published artefact. The local workspace version has the full source, but the fresh project gets the npm version. This appears to be a pre-existing issue predating this PR's changes (the PR is about skill distribution, not contract emit). However, it blocks verification of the skill install flow. Root cause: the npm-published `@prisma-next/postgres@0.8.0` is missing the `serializeContract` export that `prisma-next contract emit` requires.

Init does succeed with `--no-install`: `PRISMA_NEXT_SKILLS_BASE="$PN_REPO" SKILLS_AGENT_AUTO=cursor-cli node ".../cli.js" init --target postgres --authoring psl --yes --no-install` exits 0 but skips both package install AND skill install.

---

### F-2 — ⚠️ High — `--no-install` / `--no-skill` skip warnings reference a single outdated URL, missing the three-cluster multi-install reality

**Scenario:** 10 (exploratory probe, also relevant to scenario 9 failure mode)
**Step:** `init --target postgres --authoring psl --yes --no-install` and `init ... --yes --no-install --no-skill`
**Oracle:** From scenario 9 failure modes: "The `--no-skill` skip warning still references the singular form, missing the round-2 multi-source reality."

**Observed:**
```
# --no-install warning:
"Skipped Prisma Next skills install because --no-install was passed. Once you run install manually, register the skill with `pnpm dlx skills add prisma/prisma-next#v0.8.0 --all`."

# --no-skill warning:
"Skipped Prisma Next skills install (--no-skill). To install later, run `pnpm dlx skills add prisma/prisma-next#v0.8.0 --all` in this project."
```

**Expected (per script):** Warnings should reflect the three-cluster install: base skills + upgrade + extension-author. A fresh user following the single command in the warning will only get the 10 base skills and miss the upgrade and extension-author clusters.

**Reproduction:**
- `git rev-parse HEAD` → `8e32189b459451a8f54a034bb5fa2d6e68719f47`
- `git status` at failure → clean
- Exact command: `PRISMA_NEXT_SKILLS_BASE="$PN_REPO" SKILLS_AGENT_AUTO=cursor-cli node "$PN_REPO/packages/.../cli.js" init --target postgres --authoring psl --yes --no-install`

**Notes:** This is a code gap — the `--no-install` / `--no-skill` warning string in the CLI source was not updated to reflect the round-2 three-cluster install change. The warning should list all three `skills add` commands (or reference `prisma-next init` as the canonical re-run). Grep for `prisma-next#v0.8.0` in the CLI source to locate the string.

---

### F-3 — 📝 Follow-up — Pre-flight step 5: `prisma-next-check-pins` not accessible at `node_modules/.bin/` after `pnpm install`

**Scenario:** Pre-flight step 5
**Step:** `ls -l "$PN_REPO/node_modules/.bin/prisma-next-check-pins"`

**Observed:**
```
ls: /Users/wmadden/Projects/prisma/prisma-next-ws/main/node_modules/.bin/prisma-next-check-pins: No such file or directory
```

**Expected (per script):** Bin resolves to `packages/0-shared/extension-author-tools/bin/prisma-next-check-pins.mjs`.

**Reproduction:**
- `git rev-parse HEAD` → `8e32189b459451a8f54a034bb5fa2d6e68719f47`
- After running `pnpm install` from repo root
- The bin works when invoked directly: `node packages/0-shared/extension-author-tools/bin/prisma-next-check-pins.mjs`

**Notes:** `@prisma-next/extension-author-tools` is not in the root `package.json` `devDependencies`, so its bin is not hoisted to the workspace root's `node_modules/.bin/`. pnpm only hoists bins for workspace packages that are direct dependencies of the consuming package. The bin IS discoverable via package-local invocation or after an extension author installs it as a `devDependency` in their own project (the intended usage). The pre-flight step 5 guidance is misleading. Scenario 7 was still executed using the direct path and confirmed the bin works correctly.

---

### F-4 — 📝 Follow-up — Scenario 5 step 2 names `commit-as-you-go` which is not in `skills-contrib/`

**Scenario:** 5 — Local-dev contributor setup re-enactment
**Step:** Step 2 (`diff "$PN_REPO/.agents/skills/commit-as-you-go/SKILL.md" ...`)

**Observed:**
```
diff: /Users/wmadden/Projects/prisma/prisma-next-ws/main/.agents/skills/commit-as-you-go/SKILL.md: No such file or directory
```

**Expected (per script):** Files are identical (no diff output).

**Notes:** The script references `commit-as-you-go` as a sample skill in `skills-contrib/`, but `commit-as-you-go` does not exist under `skills-contrib/` on this branch. The actual contrib skills include `adr-review`, `ast-visitor-pattern`, etc. The symlink and re-fire parts of scenario 5 passed correctly; only this step's sample filename is stale. This is a script-quality issue for `drive-qa-plan` to fix in a future revision.

---

### F-5 — 📝 Follow-up — Scenario 8 step 3 cannot satisfy the gate due to pre-existing stale upgrade entries

**Scenario:** 8 — Negative control: `pnpm check:upgrade-coverage` after the move
**Step:** Step 3 (plant placeholder; re-run gate expecting exit 0)

**Observed:**
```
# After planting placeholder in skills/upgrade/prisma-next-upgrade/upgrades/0.7-to-0.8/:
check-upgrade-coverage: 2 violation(s) (0.8 → 0.8)
  [new-entries-stale-transition] added skills/extension-author/prisma-next-extension-upgrade/upgrades/0.7-to-0.8/instructions.md
              transition is "0.7-to-0.8" but only the following are accepted:
                0.8-to-0.9
  [new-entries-stale-transition] added skills/upgrade/prisma-next-upgrade/upgrades/0.7-to-0.8/instructions.md
              transition is "0.7-to-0.8" but only the following are accepted:
                0.8-to-0.9
exit: 1
```

**Expected (per script):** Step 3 exits zero after placeholder is planted.

**Notes:** The gate fires because the PR branch already contains stale upgrade instruction files (`0.7-to-0.8` transition entries, which are stale when the in-flight version is `0.8-to-0.9`). The `IN_FLIGHT` regex extraction from the log points to `0.7-to-0.8` (the stale path that appears in the error), not `0.8-to-0.9` (the correct in-flight path). Adding a placeholder to the already-stale directory doesn't satisfy the gate. The gate DID fire non-zero as expected, the new path prefix (`skills/upgrade/prisma-next-upgrade/`) is correct, and `packages/0-shared/upgrade-skill/` does NOT appear. Only the step-3 oracle (expecting exit 0 after placeholder) could not be verified. The script should be updated to use `0.8-to-0.9` as the expected in-flight directory for the current 0.8.x branch.

---

### F-6 — 📝 Follow-up — `check-upgrade-coverage.mjs` error message guides to `packages/0-shared/<skill>/` (old path pattern) instead of `skills/upgrade/<skill>/`

**Scenario:** 8
**Step:** Step 2 output analysis

**Observed:**
```
move the new file under packages/0-shared/<skill>/upgrades/<one-of-the-above>/
```

**Notes:** The diagnostic copy in `scripts/check-upgrade-coverage.mjs` still uses `packages/0-shared/<skill>/upgrades/` as the guidance destination. After the cluster move, the correct location is `skills/upgrade/prisma-next-upgrade/upgrades/` or `skills/extension-author/prisma-next-extension-upgrade/upgrades/`. A contributor reading this message would be directed to the wrong directory. Worth updating the diagnostic alongside the stale-transition violations.

---

### F-7 — 📝 Follow-up — `prisma/prisma-next/skills` GitHub URL shows "No valid skills found" pre-merge

**Scenario:** 1 — Re-enact the originally-failing install command
**Step:** Step 4 (run new canonical command against GitHub)

**Observed:**
```
npx -y skills add prisma/prisma-next/skills --all -a cursor-cli
◇  Repository cloned
◇  No skills found

No valid skills found. Skills require a SKILL.md with name and description.
exit: 1
```

**Notes:** This is expected pre-merge behavior — the GitHub main branch doesn't yet reflect this PR's SKILL.md changes. The network path is only meaningful post-merge. The local-clone path (used in scenarios 3, 4, 6) works correctly. This finding is a reminder to re-run scenario 1's step 4 post-merge to confirm the canonical GitHub URL works end-to-end.

---

### F-8 — 📝 Follow-up — Scenario 4 diff is empty; bare-repo and subpath installs now produce identical sets

**Scenario:** 4 — Negative control: subpath URL guardrail

**Observed:**
```
# Both installed exactly 10 skills
# diff installed-subpath.txt installed-bare.txt
# (empty — no difference)
```

**Notes:** Per the script's "What you should see": "The `diff` is either empty (the upstream CLI's bare-path discovery is now subpath-equivalent — note this in the report so we can tighten the integration test) or shows the bare form is wider." The diff is empty, meaning upstream's bare-path discovery is now scoped equivalently to the subpath form. The integration test for this scenario can be tightened to assert equality rather than a subset relationship.

## Per-scenario log

| # | Scenario | Result | Findings |
| - | -------- | ------ | -------- |
| 1 | Re-enact the originally-failing install command | ✅ pass-with-follow-ups | F-7 |
| 2 | End-to-end `prisma-next init` against a fresh project | ❌ fail | F-1 |
| 3 | Negative control — contributor-leak guardrail | ✅ pass | — |
| 4 | Negative control — subpath URL guardrail | ✅ pass-with-follow-ups | F-8 |
| 5 | Local-dev contributor setup re-enactment | ✅ pass-with-follow-ups | F-4 |
| 6 | Upgrade-skill journey — install + read SKILL.md as a fresh user | ✅ pass | — |
| 7 | `prisma-next-check-pins` from the renamed bin-only package | ✅ pass-with-follow-ups | F-3 |
| 8 | Negative control — `pnpm check:upgrade-coverage` after the move | ✅ pass-with-follow-ups | F-5, F-6 |
| 9 | Judgement — install-summary legibility | ❌ fail (blocked by F-1; init fails before skill install summary) | F-1 |
| 10 | Exploratory charter — init flag combinations | ✅ pass-with-follow-ups | F-2, + see exploratory notes |

## Exploratory notes

**Time budget:** Approximately 25 minutes of the 30-minute budget used.

**Probe 1 — `init --no-skill`:** Fails at contract emit (same as standard init). Logs `PN-CLI-5008`. `--no-skill` is processed after the contract emit step, so the contract-emit failure prevents reaching the `--no-skill` warning.

**Probe 2 — Invalid `PRISMA_NEXT_SKILLS_BASE`:** Init ignores an invalid PRISMA_NEXT_SKILLS_BASE when it fails at contract emit first. Could not observe the diagnostic for a bad base path because the earlier failure gates it.

**Probe 3 — `init --no-install`:** Exits 0. This flag skips both the `pnpm install` step and the skill install. The warning message references a single install URL (`pnpm dlx skills add prisma/prisma-next#v0.8.0 --all`) — missing the three-cluster form. Filed as F-2.

**Probe 4 — `init --no-install --no-skill`:** Exits 0. The `--no-skill` warning mirrors the `--no-install` warning: single URL, same problem as F-2.

**Probe 5 — `init --target mongo --authoring ts --no-install`:** The `--no-install` warning is identical for mongo target — same single-URL problem. The multi-cluster issue (F-2) is target-independent.

**Probe 6 — `LEGACY_SKILL_FILE` cleanup check:** Inspected compiled init source. `LEGACY_SKILL_FILE = ".agents/skills/prisma-next/SKILL.md"` exists and the cleanup runs if that file is present. Could not trigger it since init fails at contract emit before the cleanup runs on re-init.

**Probe 7 — Partial init (existing `prisma-next.config.ts`):** Attempted init against a project already containing `prisma-next.config.ts`. Fails with an error (PN-CLI-500x series) about conflicting files. Not fully explored due to time; the `--force` flag was not tested.

**Candidate probes not reached (log for follow-ups):**
- Test `--force` flag with partially-initialized project
- Ctrl-C mid-run and re-run to verify partial-state handling
- Test `init` on a project without a `package.json`
- Test the LEGACY_SKILL_FILE cleanup path explicitly by seeding `.agents/skills/prisma-next/SKILL.md` and running init with `--no-install`

## Coverage outcome

| AC ID | Scenario(s) | Result | Notes |
| ----- | ----------- | ------ | ----- |
| AC-DIST-1 | 2 | ❌ fail | F-1: init fails before skill install; skill count unverifiable |
| AC-DIST-2 | 2, 3, 4 | ✅ pass | S3 (negative control) and S4 (subpath scope) both passed; S2 failed independently |
| AC-DIST-3 | (CI snapshot test) | N/A | — |
| AC-DIST-4 | 1 (re-enactment) + (CI ripgrep gate) | ✅ pass | `rg` sweep of `packages/`, `docs/`, `examples/`, `skills/` found zero matches; broken form only in transient `projects/` files (spec, plan, this QA script) |
| AC-DIST-5 | 3, 5 | ✅ pass | Both paths verified; symlinks resolve correctly; re-fire postinstall works |
| AC-DIST-6 | (CI workspace-list assertion) | N/A | — |
| AC-R2-1 | 2, 6, 8 | ✅ pass (partial) | S6: upgrade skill installs correctly, SKILL.md prose is clean; S8: coverage gate names correct new path; S2: blocked by F-1 |
| AC-R2-2 | 2, 9 | ❌ fail | F-1 prevents observing the three-install summary; F-2 shows `--no-install` warning is missing multi-cluster awareness |
| AC-R2-3 | 7 | ✅ pass | `prisma-next-check-pins` exits 0 on exact pin, exits 1 on range pin with correct diagnostic |

## Suggested follow-ups

- **File as ticket (⚠️ High):** Fix `--no-install` / `--no-skill` init warnings to reference the three-cluster install commands, not the single-cluster `prisma/prisma-next#v<version>` form. The fix is in the CLI init source — grep for `prisma-next#v` and `skills add` in `packages/1-framework/3-tooling/cli/src/commands/init/`.

- **Investigate (⚠️ High):** `prisma-next init` fails on fresh consumer projects with `PN-CLI-5008` because the npm-published `@prisma-next/postgres@0.8.0` package doesn't export `serializeContract`. Determine if this is a known gap in the published package, a version mismatch, or a regression. This blocks end-to-end init testing.

- **Script quality fix (📝):** Update scenario 5 step 2 to use an existing skill name in `skills-contrib/` (e.g. `adr-review`) instead of `commit-as-you-go` which no longer lives there.

- **Script quality fix (📝):** Update scenario 8 step 3 to use the in-flight transition directory (`0.8-to-0.9`) rather than relying on the regex extraction from the error log (which extracts the stale `0.7-to-0.8` path instead).

- **Integration test tightening (📝):** The bare-repo install now produces the same set as the subpath install (diff is empty). The integration test for scenario 4's assertion should be tightened to assert equality, not subset.

- **Diagnostic copy fix (📝):** Update `scripts/check-upgrade-coverage.mjs` error message to reference `skills/upgrade/<skill>/upgrades/` (the new path after cluster move) instead of `packages/0-shared/<skill>/upgrades/`.

- **Pre-flight fix (📝):** Update pre-flight step 5 guidance: `prisma-next-check-pins` is not in `node_modules/.bin/` unless `@prisma-next/extension-author-tools` is added to root `devDependencies`. Either add it as a root devDep or update the pre-flight to use the direct-path invocation.

- **Post-merge re-run (📝):** Re-run scenario 1 step 4 after the PR merges to confirm `npx skills add prisma/prisma-next/skills --all` installs the expected 10 skills from GitHub. Currently returns "No valid skills found" because the changes aren't on the default branch yet.

- **Exploratory follow-ups not reached:** Test `--force` with partial init, Ctrl-C mid-run recovery, LEGACY_SKILL_FILE cleanup path end-to-end, init against a directory without `package.json`.
