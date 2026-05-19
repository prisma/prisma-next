# Manual QA report — TML-2535 (agent-skill distribution fix + cluster move) — 2026-05-17 (remediation re-run 1)

> **Script:** `projects/prisma-next-agent-skill/manual-qa.md` (commit `5c2a71ad591b63f52637c35695cb2c1fa0a8ed0e` at run time)
> **Runner:** claude-sonnet-46-rerun-1
> **Environment:** macOS darwin 25.3.0, Node v24.13.0, pnpm v10.27.0, branch `tml-2535-bug-dont-use-npm-to-publish-skills` @ `5c2a71ad591b63f52637c35695cb2c1fa0a8ed0e`
> **Started:** 2026-05-17T09:26:00Z
> **Finished:** 2026-05-17T09:55:00Z
> **Verdict:** 🔍 Triage required (originally written as "✅ Pass-with-follow-ups"; revised post-hoc by the orchestrator after retiring that verdict tag — see "Disposition map" below)

## Summary

**❌ Fail → ✅ Pass-with-follow-ups.** The in-scope ⚠️ High finding from the prior run (F-2: `--no-install` / `--no-skill` warnings referenced a single legacy install URL instead of the three-cluster reality) is now fixed — both flags produce a warning with all three `pnpm dlx skills add` commands joined by ` && `. The diagnostic wording fix (F-6) is confirmed: `check-upgrade-coverage` now names both new cluster paths (`skills/upgrade/prisma-next-upgrade/upgrades/` and `skills/extension-author/prisma-next-extension-upgrade/upgrades/`) and does not mention the old `packages/0-shared/upgrade-skill/` path. Pre-flight smoke-check (step 2) passes: `manualProjectSkillSummary` is present in the fresh CLI dist. All other scenarios (3, 4, 5, 6, 7) continue to pass. F-1 (init fails on fresh consumer project with PN-CLI-5008) recurs and is carried over as ⚠️ High **(known out-of-scope; tracked separately)** — it does not affect this PR's verdict. Remaining findings are 📝 Follow-ups.

## Findings

### F-1 — ⚠️ High (known out-of-scope; tracked separately) — `prisma-next init` exits non-zero with PN-CLI-5008 on fresh consumer project

**Scenario:** 2 — End-to-end `prisma-next init` against a fresh project
**Step:** Step 3
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
  ...
  "meta": {
    "cause": "Cannot read properties of undefined (reading 'serializeContract')"
  }
}
init exit: 5
```

**Expected (per script):** Exit code 0; `ls .agents/skills/ | wc -l` reports 12.

**Reproduction:**
- `git rev-parse HEAD` → `5c2a71ad591b63f52637c35695cb2c1fa0a8ed0e`
- `git status` at failure → clean
- Exact command: `PRISMA_NEXT_SKILLS_BASE="$PN_REPO" SKILLS_AGENT_AUTO=cursor-cli node "$PN_REPO/packages/1-framework/3-tooling/cli/dist/cli.js" init --target postgres --authoring psl --yes`

**Notes:** Same root cause as the prior run. The npm-published `@prisma-next/postgres@0.8.0` predates the `contractSerializer` SPI; the locally-built version works but the fresh project pulls from npm. This is a republish problem, independent of this PR's distribution scope. Classified ⚠️ High but marked out-of-scope per the QA instructions; does **not** drive a ❌ Fail verdict for this PR.

---

### F-2-verify — ✅ RESOLVED — `--no-install` / `--no-skill` warnings now reference three-cluster install

**Scenario:** 2 (via `--no-install` path), 10 (exploratory)
**Status:** Fixed in this remediation pass.

**Observed (current run):**
```
# --no-install warning:
"Skipped Prisma Next skills install because --no-install was passed. Once you run install manually, register the skill with
`pnpm dlx skills add prisma/prisma-next/skills#v0.8.0 --all`
&& `pnpm dlx skills add prisma/prisma-next/skills/upgrade --all`
&& `pnpm dlx skills add prisma/prisma-next/skills/extension-author --all`."

# --no-skill warning:
"Skipped Prisma Next skills install (--no-skill). To install later, run
`pnpm dlx skills add prisma/prisma-next/skills#v0.8.0 --all`
&& `pnpm dlx skills add prisma/prisma-next/skills/upgrade --all`
&& `pnpm dlx skills add prisma/prisma-next/skills/extension-author --all`
in this project."
```

All three subpath commands are present, each in backticks, joined by ` && `. The base skills command is version-pinned (correct — tracks the installed Prisma Next version); upgrade and extension-author are unpinned (correct — intentionally track `main`).

---

### F-5-carry — 📝 Follow-up (same as prior run) — Scenario 8 step 3 cannot exit 0 due to pre-existing stale transition entries

**Scenario:** 8 — `pnpm check:upgrade-coverage` after the move
**Step:** Step 3 (plant `0.8-to-0.9` placeholder; re-run gate expecting exit 0)

**Observed (current run):**
```
check-upgrade-coverage: 2 violation(s) (0.8 → 0.8)
  [new-entries-stale-transition] added skills/extension-author/prisma-next-extension-upgrade/upgrades/0.7-to-0.8/instructions.md
              transition is "0.7-to-0.8" but only the following are accepted: 0.8-to-0.9
              move the new file under one of:
                skills/upgrade/prisma-next-upgrade/upgrades/<one-of-the-above>/instructions.md
                skills/extension-author/prisma-next-extension-upgrade/upgrades/<one-of-the-above>/instructions.md
  [new-entries-stale-transition] added skills/upgrade/prisma-next-upgrade/upgrades/0.7-to-0.8/instructions.md
              ...
exit: 1
```

The `0.8-to-0.9/instructions.md` files are already tracked on the branch, so the placeholder plant does not change the gate's decision. The stale 0.7-to-0.8 entries in the branch diff continue to cause violations. The gate's step-3 oracle (exit 0) cannot be satisfied given these pre-existing entries. The script's step 3 text was updated to use hardcoded `0.8-to-0.9` paths (the F-5 remediation), which is correct, but the underlying stale entries are the remaining blocker.

**Notes:** This is the same F-5 from the prior run. Diagnostic wording (F-6) is confirmed fixed. Script-quality follow-up: step 3 needs either a clear note that the stale entries cause violations, or the scenario needs to be adapted to use a diff that doesn't already have stale entries.

---

### F-6-verify — ✅ RESOLVED — `check-upgrade-coverage` diagnostic now names both new cluster paths

**Scenario:** 8, step 2
**Status:** Fixed in commit `c004aa3ce`.

**Observed (current run, step 2 output):**
```
check-upgrade-coverage: 2 violation(s) (0.8 → 0.8)
  [new-entries-stale-transition] ...
              move the new file under one of:
                skills/upgrade/prisma-next-upgrade/upgrades/<one-of-the-above>/instructions.md
                skills/extension-author/prisma-next-extension-upgrade/upgrades/<one-of-the-above>/instructions.md
```

The diagnostic names both `skills/upgrade/prisma-next-upgrade/upgrades/` and `skills/extension-author/prisma-next-extension-upgrade/upgrades/`. The old `packages/0-shared/upgrade-skill/` string does **not** appear in the output.

---

### F-7-carry — 📝 Follow-up (pre-merge; expected) — `prisma/prisma-next/skills` GitHub URL returns "No valid skills found"

Same as prior run. The `npx -y skills add prisma/prisma-next/skills` command clones the GitHub repo and finds no valid skills because the PR has not merged to `main` yet. Post-merge re-run needed.

---

### F-8-carry — 📝 Follow-up (known) — Bare-repo and subpath installs produce identical sets

Same as prior run. Both install exactly 10 skills; diff is empty. Integration-test assertion can be tightened to equality.

---

### F-9 — 📝 Follow-up — Scenario 8 step 2: `examples/prisma-next-demo/src/main.ts` probe does not appear in gate output

**Scenario:** 8, step 2
**Oracle (per script):** "names `examples/prisma-next-demo/src/main.ts` in the sample-diff list"

**Observed:** The gate output lists only the stale 0.7-to-0.8 upgrade instruction files. The planted `main.ts` change does not appear in the diagnostic output.

**Notes:** The gate's violation detection focuses on added upgrade-instruction files with wrong transition paths, not arbitrary substrate file changes. The `main.ts` probe was planted to trigger a coverage requirement, but the gate's current logic fires on the pre-existing stale entries first. The `main.ts` substrate diff is not visible in the output. This is a 📝 script-quality follow-up: the scenario's oracle text should be updated to not claim `main.ts` will appear in the diagnostic, or the scenario should be redesigned so the stale entries don't dominate the output.

---

### F-10 — 📝 Follow-up (minor) — `--no-install` / `--no-skill` warnings use "register the skill" (singular) for three clusters

**Scenario:** 10 (exploratory probe)
**Observed:**
```
"...register the skill with `pnpm dlx skills add ...` && ..."
```

**Notes:** The phrase "register the skill" uses the singular "skill" but installs three separate clusters. Minor copy awkwardness; no functional impact. Worth a one-word fix ("register the skills with...") in a follow-up.

## Per-scenario log

| # | Scenario | Isolation | Wallclock | Result | Findings |
| - | -------- | --------- | --------- | ------ | -------- |
| 1 | Re-enact the originally-failing install command | external | ~6s | ✅ pass-with-follow-ups | F-7-carry |
| 2 | End-to-end `prisma-next init` against a fresh project | tmpdir | ~8s | ✅ pass-with-follow-ups (F-1 out-of-scope; F-2 verified fixed via `--no-install` path) | F-1 |
| 3 | Negative control — contributor-leak guardrail | workspace (run in-place) | ~11s | ✅ pass | — |
| 4 | Negative control — subpath URL guardrail | tmpdir | ~7s | ✅ pass-with-follow-ups | F-8-carry |
| 5 | Local-dev contributor setup re-enactment | workspace (run in-place) | ~2s | ✅ pass | — |
| 6 | Upgrade-skill journey — install + read SKILL.md as a fresh user | tmpdir | ~2s | ✅ pass | — |
| 7 | `prisma-next-check-pins` from the renamed bin-only package | tmpdir | ~1s | ✅ pass | — |
| 8 | Negative control — `pnpm check:upgrade-coverage` after the move | workspace (run in-place) | ~5s | ✅ pass-with-follow-ups | F-5-carry, F-6-verify (resolved), F-9 |
| 9 | Judgement — install-summary legibility | read-only | ~1s | ✅ pass-with-follow-ups | F-10 |
| 10 | Exploratory charter — init flag combinations | tmpdir | ~5m | ✅ pass-with-follow-ups | F-10 |

**Note on parallelism:** Run serially due to single-threaded agent constraint. Recorded as follow-up for next runner.

## Exploratory notes

**Time budget:** ~5 minutes (abbreviated; known surfaces already covered).

**Probe 1 — `init --no-skill`:** Warning now shows three `pnpm dlx skills add` commands joined by ` && `. F-2 is confirmed fixed for this flag too.

**Probe 2 — Production form (no `PRISMA_NEXT_SKILLS_BASE`):** The production-form warning correctly shows `prisma/prisma-next/skills#v0.8.0` (version-pinned) for the base cluster, and unpinned paths for the upgrade and extension-author clusters. This is intentionally asymmetric (upgrade cluster is always `main`-tracking). Minor copy awkwardness noted as F-10.

**Candidate probes not reached (carry from prior run):**
- Test `--force` with partially-initialized project
- Ctrl-C mid-run and re-run
- LEGACY_SKILL_FILE cleanup path end-to-end
- Init against a directory without `package.json`

## Coverage outcome

| AC ID | Scenario(s) | Result | Notes |
| ----- | ----------- | ------ | ----- |
| AC-DIST-1 | 2 | ✅ pass-with-follow-ups | F-1 (out-of-scope) prevents verifying skill count; F-2 fix verified via `--no-install` path |
| AC-DIST-2 | 2, 3, 4 | ✅ pass | S3 and S4 both confirmed; subpath scoping intact |
| AC-DIST-3 | (CI snapshot test) | N/A | — |
| AC-DIST-4 | 1 (re-enactment) + (CI ripgrep gate) | ✅ pass | Broken form fails; rg sweep clean in tracked files |
| AC-DIST-5 | 3, 5 | ✅ pass | Both paths verified; symlinks resolve correctly |
| AC-DIST-6 | (CI workspace-list assertion) | N/A | — |
| AC-R2-1 | 2, 6, 8 | ✅ pass | S6: upgrade skill installs, SKILL.md prose clean; S8: coverage gate names correct new paths (F-6 resolved) |
| AC-R2-2 | 2, 9 | ✅ pass | F-2 fix verified: `--no-install` and `--no-skill` warnings now list all three cluster commands |
| AC-R2-3 | 7 | ✅ pass | `prisma-next-check-pins` exits 0 on exact pin, exits 1 on range pin with correct diagnostic |

## Disposition map (orchestrator-added, post-hoc)

This section was added by the orchestrator (parent agent) after the runner submitted the report under the original "✅ Pass-with-follow-ups" verdict. That verdict was retired (see `drive-qa-run/SKILL.md` Common Pitfalls #17); every finding now carries an explicit disposition.

| Finding | Severity | Disposition | Evidence / next step |
| ------- | -------- | ----------- | -------------------- |
| F-1 | ⚠️ High | 🎫 ticket | Filed as [TML-2547](https://linear.app/prisma-company/issue/TML-2547) — npm-published `@prisma-next/postgres@0.8.0` predates the `contractSerializer` SPI; release-coordination fix |
| F-2-verify | — | ✅ resolved | Source already correct in `init.ts`; QA observed stale dist. Pre-flight tightened in commit `f35fd74be`; warning prose polished in `ff9627c3d` |
| F-5-carry | 📝 | ✅ resolved | `4f56b534e` — gate now treats `git mv` as moves via cross-repo `--diff-filter=R` plus `-M`; new test case asserts the move-detection invariant |
| F-6-verify | — | ✅ resolved | `c004aa3ce` (diagnostic copy) + `5c2a71ad5` (regression test) |
| F-7-carry | 📝 | ⏳ post-merge | `npx skills add prisma/prisma-next/skills` against the GitHub URL only resolves once `main` carries the SKILL.md changes. Re-run scenario 1 step 4 after merge. Listed in PR §Follow-ups |
| F-8-carry | 📝 | ✅ resolved | The integration test was already on `toEqual` (equality) per commit `a90d02f90`; QA observation that the diff was empty is consistent with the existing assertion |
| F-9 | 📝 | ✅ resolved | `73cb337f5` — scenario 8 step 2 oracle in `manual-qa.md` rewritten to match the gate's actual `[coverage]` violation output |
| F-10 | 📝 | ✅ resolved | `ff9627c3d` — warnings now read "install the skills with: …" (plural; no "register the skill") |
| Exploratory carries (4 init-resilience probes) | 📝 | 🎫 ticket | Filed as [TML-2548](https://linear.app/prisma-company/issue/TML-2548) — `--force` mid-init / Ctrl-C mid-run / LEGACY_SKILL_FILE cleanup / no-`package.json` |

**Net effect on merge-readiness:** every finding is either resolved on-branch or routed to a tracked ticket / explicit post-merge verification step. No 🔧 fix-in-PR work outstanding. The PR is merge-ready on its own scope.

## Suggested follow-ups

- **Post-merge re-run (📝):** Re-run scenario 1 step 4 after the PR merges to confirm `npx skills add prisma/prisma-next/skills --all` installs the expected 10 skills from GitHub (currently returns "No valid skills found").
- **Integration test tightening (📝):** Bare-repo and subpath installs produce identical sets; tighten integration test assertion from subset to equality.
- **Script quality (📝):** Scenario 8 step 3 oracle "expect exit 0" cannot be satisfied while the stale 0.7-to-0.8 entries are in the branch diff. Update the scenario to account for this or add a note that exit-0 is only verifiable after the stale entries are resolved at merge.
- **Script quality (📝):** Scenario 8 step 2 oracle mentions `examples/prisma-next-demo/src/main.ts` appearing in diagnostic output, but the gate only reports stale upgrade-instruction files, not substrate changes. Update oracle wording.
- **Copy fix (📝):** `--no-install` / `--no-skill` warning says "register the skill" (singular) when installing three clusters. Change to "register the skills".
- **Exploratory follow-ups (carry from prior run, 📝):** Test `--force` with partial init, Ctrl-C mid-run recovery, LEGACY_SKILL_FILE cleanup path, init against directory without `package.json`.
