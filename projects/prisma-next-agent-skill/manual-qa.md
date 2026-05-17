# Manual QA — TML-2535 (agent-skill distribution fix + cluster move)

> **Be the user installing Prisma Next from scratch, the contributor onboarding the repo for the first time, and the extension author wiring up CI.** Verify the agent-skill distribution actually delivers the artefacts the spec promises against real artefacts a human would touch.
>
> **Out of scope of this script.**
> - Re-running our unit / integration / e2e test suites and confirming they're green. CI does that on every push; re-running locally only proves your machine matches CI.
> - Re-running `pnpm lint:deps` / `pnpm typecheck` / `pnpm fixtures:check` against the clean tree. Same — CI's job.
> - Manually exercising the `pkg.pr.new` install path. We deleted it for cause; there is nothing to QA.
>
> **Spec:** [`spec.md`](./spec.md), [`specs/usage-skill.spec.md`](./specs/usage-skill.spec.md), [`specs/upgrade-skill.spec.md`](./specs/upgrade-skill.spec.md), [`specs/init-integration.spec.md`](./specs/init-integration.spec.md)
> **Plan:** [`plans/distribution-fix-plan.md`](./plans/distribution-fix-plan.md)
> **PR:** https://github.com/prisma/prisma-next/pull/519

## Table of contents

| #  | Scenario                                                          | What it proves                                                                                                              | Covers                          |
| -- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1  | Re-enact the originally-failing install command                   | The `npx skills add @prisma-next/skills` form is not what the docs / init now drive users to                                | AC-DIST-4                       |
| 2  | End-to-end `prisma-next init` against a fresh project             | Init exits zero; the union of three subpath installs lands the expected 12 skills, no contributor leak                      | AC-DIST-1, AC-DIST-2, AC-R2-1, AC-R2-2 |
| 3  | Negative control — contributor-leak guardrail                     | A fake skill planted in `skills-contrib/` does not leak through the user-facing install URL; opt-in URL still installs it   | AC-DIST-2, AC-DIST-5            |
| 4  | Negative control — subpath URL guardrail                          | The `/skills` subpath is what scopes discovery; a bare-repo install installs a different (wider) set                        | AC-DIST-2                       |
| 5  | Local-dev contributor setup re-enactment                          | `pnpm install` symlinks `.agents/skills` and `.claude/skills` at `skills-contrib/`; agents pick up contributor skills locally | AC-DIST-5 (local-dev path)      |
| 6  | Upgrade-skill journey — install + read SKILL.md as a fresh user   | The upgrade subpath URL installs the renamed skill; the SKILL.md it ships tells the user a re-install URL that actually works | AC-R2-1 (judgement)             |
| 7  | `prisma-next-check-pins` from `@prisma-next/extension-author-tools` | The bin still works after the package rename; it fires on a range pin with a useful diagnostic                              | AC-R2-3 (negative control)      |
| 8  | Negative control — `pnpm check:upgrade-coverage` after the move   | The coverage gate fires on a substrate diff, naming the new skill-cluster directory                                         | AC-R2-1 (negative control)      |
| 9  | Judgement — install-summary legibility                            | The end-of-init summary reads cleanly with three install commands stitched together                                         | AC-R2-2 (judgement)             |
| 10 | Exploratory charter — init flag combinations                      | Probe `--no-skill` / `--no-install` / `--target mongo` paths for diagnostics that read poorly                               | (no AC; charter)                |

> Scenarios marked **(negative control)** plant a violation, observe the gate fire, then restore. Scenarios marked **(judgement)** require human evaluation that no test can assert. Scenarios marked **(exploratory)** are time-boxed charters with no scripted steps.

## Pre-flight

1. Working tree is on the PR branch (`tml-2535-bug-dont-use-npm-to-publish-skills`) and clean — `git status` reports nothing modified, no untracked files outside the usual `.agents/skills/`, `.claude/skills/`, `wip/`, `test/integration/.tmp/` set.
2. `pnpm install && pnpm build` has been run at least once on this branch (the postinstall script symlinks `.agents/skills/` and `.claude/skills/` into `skills-contrib/`, and the CLI build produces the binary the integration tests exec).
3. Set a workspace-root variable for use throughout:

   ```bash
   export PN_REPO=$(git -C $(pwd) rev-parse --show-toplevel)
   ```

4. Set up a tmpdir scratchpad you'll reuse across scenarios and clean at the end:

   ```bash
   export PN_QA_TMP=$(mktemp -d -t pn-qa-XXXXXXXX)
   echo "scratchpad at $PN_QA_TMP"
   ```

5. Confirm the renamed package's bin is on the workspace `node_modules/.bin/`:

   ```bash
   ls -l "$PN_REPO"/node_modules/.bin/prisma-next-check-pins
   ```

   It should resolve to `packages/0-shared/extension-author-tools/bin/prisma-next-check-pins.mjs`. If it doesn't, re-run `pnpm install`.

## Scenario 1 — Re-enact the originally-failing install command

**What you're proving from the user's seat:** A user reading old docs / Slack threads / Linear tickets who runs `npx skills add @prisma-next/skills --all` does not get a working install. We did not (and cannot) fix the upstream `vercel-labs/skills` parsing of `@a/b` identifiers as a GitHub `owner/repo`; what we fixed is that the docs no longer drive anyone here. This is the "did we route around the bug we reported" check.

**Covers:** AC-DIST-4

**Oracle:** The CI ripgrep gate (AC-DIST-4 implementation) returns zero matches for the broken command in tracked files. The user-side observation: running the broken command from a fresh tmpdir does not produce a Prisma-Next-shaped install (it either fails or installs from a non-Prisma-Next GitHub repo named `prisma-next/skills`, depending on how the upstream CLI happens to interpret `@prisma-next/skills` today).

**Preconditions:**

- `PN_QA_TMP` is set (pre-flight step 4).
- Network access available (this scenario hits npm + GitHub).

### Steps

1. Move into a fresh sub-tmpdir so the install lands in isolation:

   ```bash
   mkdir -p "$PN_QA_TMP/scenario-1"
   cd "$PN_QA_TMP/scenario-1"
   ```

2. Run the historically-broken command:

   ```bash
   npx -y skills add @prisma-next/skills --all -a cursor-cli 2>&1 | tee scenario-1.log
   ```

3. Observe what landed (if anything):

   ```bash
   ls -la .agents/skills/ 2>/dev/null || echo "no .agents/skills/"
   ```

4. Now run the *new* canonical command for comparison:

   ```bash
   rm -rf .agents/skills/ .claude/skills/
   npx -y skills add prisma/prisma-next/skills --all -a cursor-cli 2>&1 | tee scenario-1-new.log
   ls -la .agents/skills/
   ```

### What you should see

- The first command (`@prisma-next/skills`) either errors out, installs from an unrelated GitHub repo, or installs zero skills — read the log to see how upstream interpreted the identifier today. The point is *not* what specifically fails; the point is that this command is not the one to give users.
- The second command (`prisma/prisma-next/skills`) installs the 10 user-facing skills under `.agents/skills/` (10 directories, one per skill).
- Confirm via `rg -l 'npx skills add @prisma-next/skills'` from `$PN_REPO` that no tracked file under `packages/`, `docs/`, `projects/`, `examples/`, `skills/`, or the root mentions the broken form. (`skills-contrib/` and `wip/` are allowed to mention it for archival reasons; cross-check excluded paths against the PR diff.)

### Failure modes

- The broken command lands skills under `.agents/skills/` and a fresh user could plausibly believe their install worked. (Implies the upstream CLI shipped a fix and the spec amendment is now outdated.)
- The new canonical command produces fewer than 10 skills, more than 10 skills, or a different set than the immediate children of `$PN_REPO/skills/` (excluding `extension-author/` and `upgrade/`).
- An `rg` sweep from `$PN_REPO` finds the broken command in any tracked file outside `skills-contrib/`, `wip/`, or this QA script itself.

### Restore

```bash
cd "$PN_REPO"
rm -rf "$PN_QA_TMP/scenario-1"
git -C "$PN_REPO" status --short
```

`git status` should be unchanged.

## Scenario 2 — End-to-end `prisma-next init` against a fresh project

**What you're proving from the user's seat:** A user who runs `prisma-next init` on a fresh project gets all three skill clusters installed end-to-end (usage + upgrade + extension-author), with no contributor leak, and the install summary tells them what just happened. This is the developer-journey smoke test for the round-2 multi-cluster wiring — three install commands stitched into one user-visible step.

**Covers:** AC-DIST-1, AC-DIST-2, AC-R2-1, AC-R2-2

**Oracle:** The set of directory names in `.agents/skills/` after init exits equals the set produced by enumerating immediate children of `$PN_REPO/skills/`, `$PN_REPO/skills/upgrade/`, and `$PN_REPO/skills/extension-author/` that contain a `SKILL.md`. Today that's 12 skills. The init's stdout summary names three install commands.

**Preconditions:**

- `PN_QA_TMP`, `PN_REPO` are set.
- The CLI build is fresh: `pnpm --filter @prisma-next/cli build` from `$PN_REPO` (so `node_modules/.bin/prisma-next` reflects this branch).

### Steps

1. Create a fresh consumer project:

   ```bash
   mkdir -p "$PN_QA_TMP/scenario-2"
   cd "$PN_QA_TMP/scenario-2"
   pnpm init >/dev/null
   echo '{}' > pnpm-lock.yaml  # placeholder so init's PM detection lands on pnpm
   ```

2. Point the install URL at the local working tree (otherwise init goes to the public GitHub URL, which 404s for any unpushed branch):

   ```bash
   export PRISMA_NEXT_SKILLS_BASE="$PN_REPO"
   export SKILLS_AGENT_AUTO=cursor-cli   # skip per-agent prompt under non-interactive init
   ```

3. Run init in non-interactive mode:

   ```bash
   "$PN_REPO/node_modules/.bin/prisma-next" init --target postgres --authoring psl --yes 2>&1 | tee scenario-2.log
   echo "init exit: $?"
   ```

4. Inspect what landed:

   ```bash
   ls .agents/skills/ | sort
   ls .agents/skills/ | wc -l
   ```

5. Inspect the SKILL.md frontmatter for two of the freshly-installed skills (one from each cluster):

   ```bash
   head -10 .agents/skills/prisma-next-quickstart/SKILL.md
   head -10 .agents/skills/prisma-next-upgrade/SKILL.md
   head -10 .agents/skills/prisma-next-extension-upgrade/SKILL.md
   ```

### What you should see

- Init exits with code 0 (echoed after the run).
- `ls .agents/skills/ | wc -l` reports 12.
- The set of directory names equals the union of immediate-child skill-bearing directories under `$PN_REPO/skills/` (10 names, including `prisma-next` and `prisma-next-quickstart`), `$PN_REPO/skills/upgrade/` (`prisma-next-upgrade`), and `$PN_REPO/skills/extension-author/` (`prisma-next-extension-upgrade`).
- None of the names match a directory under `$PN_REPO/skills-contrib/` (e.g. `babysit`, `commit-as-you-go`, `record-upgrade-instructions`).
- Each `SKILL.md` head shows valid YAML frontmatter (a `name:` and a `description:` field). `prisma-next-upgrade/SKILL.md` says "ensure this skill is installed at `@latest`" and the install URL it advertises is `npx skills add prisma/prisma-next/skills/upgrade --all`, not anything mentioning `@prisma-next/upgrade-skill`.
- `scenario-2.log` shows three `pnpm dlx skills add` invocations with the expected subpath suffixes (`/skills`, `/skills/upgrade`, `/skills/extension-author`).

### Failure modes

- Init exits non-zero.
- The installed skill set is missing one of the three clusters' contents (e.g. only 10 skills land — upgrade or extension-author silently dropped).
- Any contributor skill (a name that exists under `$PN_REPO/skills-contrib/`) appears in `.agents/skills/`.
- A skill name appears with a malformed frontmatter (no `description:` line) — this would mean the upstream CLI silently dropped a YAML-broken skill, mirroring the `prisma-next-quickstart` bug we fixed mid-PR.
- The log shows fewer than three `dlx skills add` invocations.

### Restore

```bash
cd "$PN_REPO"
unset PRISMA_NEXT_SKILLS_BASE SKILLS_AGENT_AUTO
rm -rf "$PN_QA_TMP/scenario-2"
git -C "$PN_REPO" status --short
```

`git status` should be unchanged.

## Scenario 3 — Negative control: contributor-leak guardrail

**What you're proving from the user's seat:** A contributor who adds a new skill under `skills-contrib/` does not accidentally publish it to every Prisma Next user. The user-facing install URL must not pick it up. The opt-in URL `npx skills add prisma/prisma-next/skills-contrib --all` *does* still pick it up (the contributor onboarding path still works).

**Covers:** AC-DIST-2 (defence-in-depth on top of the integration test); AC-DIST-5 (the explicit opt-in path).

**Coverage boundary:** This proves directory-placement scoping works for one planted skill at the immediate-child level of `skills-contrib/`. It does *not* prove every conceivable layout (deeply-nested, frontmatter-only, agent-plugin grouping) is filtered identically — that surface belongs to upstream CLI tests.

**Oracle:** The installed skill set after `prisma/prisma-next/skills` does not contain `__qa-leak-probe`. The installed skill set after `prisma/prisma-next/skills-contrib` does contain it.

**Preconditions:**

- `PN_QA_TMP`, `PN_REPO` are set.
- A clean working tree.

### Steps

1. Plant the leak probe (untracked, gitignore won't fire because `skills-contrib/` is tracked):

   ```bash
   mkdir -p "$PN_REPO/skills-contrib/__qa-leak-probe"
   cat > "$PN_REPO/skills-contrib/__qa-leak-probe/SKILL.md" <<'EOF'
   ---
   name: __qa-leak-probe
   description: >-
     QA leak probe. If you see this in a user-facing skill install, the
     directory-placement scoping for skills-contrib/ failed.
   ---
   # leak probe
   EOF
   ```

2. Run the user-facing install URL against a fresh tmpdir:

   ```bash
   mkdir -p "$PN_QA_TMP/scenario-3a"
   cd "$PN_QA_TMP/scenario-3a"
   "$PN_REPO/node_modules/.bin/skills" add "$PN_REPO/skills" --all -a cursor-cli 2>&1 | tee scenario-3a.log
   ls .agents/skills/ | sort > installed-user.txt
   ```

3. Run the contributor opt-in URL against a different fresh tmpdir:

   ```bash
   mkdir -p "$PN_QA_TMP/scenario-3b"
   cd "$PN_QA_TMP/scenario-3b"
   "$PN_REPO/node_modules/.bin/skills" add "$PN_REPO/skills-contrib" --all -a cursor-cli 2>&1 | tee scenario-3b.log
   ls .agents/skills/ | sort > installed-contrib.txt
   ```

4. Compare:

   ```bash
   grep -c '^__qa-leak-probe$' "$PN_QA_TMP/scenario-3a/installed-user.txt" || echo "absent (expected)"
   grep -c '^__qa-leak-probe$' "$PN_QA_TMP/scenario-3b/installed-contrib.txt" || echo "absent (unexpected)"
   ```

### What you should see

- `installed-user.txt` does **not** contain `__qa-leak-probe`. The first `grep -c` exits non-zero and prints `absent (expected)`.
- `installed-contrib.txt` **does** contain `__qa-leak-probe`. The second `grep -c` prints `1`.

### Failure modes

- The leak probe appears in the user-facing install. The directory-placement guard has regressed; root-cause before merging anything else (likely an upstream CLI behaviour change or a misplaced priority-discovery directory).
- The leak probe does *not* appear in the contributor install. The opt-in path is broken; contributors will silently lose access to internal skills.

### Restore

```bash
rm -rf "$PN_REPO/skills-contrib/__qa-leak-probe"
rm -rf "$PN_QA_TMP/scenario-3a" "$PN_QA_TMP/scenario-3b"
git -C "$PN_REPO" status --short
```

`git status` should be unchanged.

## Scenario 4 — Negative control: subpath URL guardrail

**What you're proving from the user's seat:** The `/skills` subpath in the install URL is what scopes the upstream CLI's discovery to the user-facing cluster. If init were ever changed to ship a bare-repo URL (`prisma/prisma-next` without the subpath), the consumer's install set would be different — the upstream CLI also walks the `.agents/skills/` priority directory under whatever root it's given, and a bare-repo install does (or did) walk it. This scenario establishes empirically that the subpath form is the load-bearing piece, with a coverage statement.

**Covers:** AC-DIST-2

**Coverage boundary:** This proves the subpath form scopes discovery for the layout *as of this branch*. It does not prove every possible bare-repo layout would leak the same set, and it does not prove `--full-depth` can be safely added. Rerun this scenario whenever upstream's `discoverSkills` priority list changes.

**Oracle:** The set of skills installed by `npx skills add <clone>/skills --all` against a fresh tmpdir is a strict subset of (or equal to) the set installed by `npx skills add <clone> --all` (bare path). The difference, if any, is contributor or out-of-cluster content.

**Preconditions:**

- `PN_QA_TMP`, `PN_REPO` are set.
- A `git clone --depth 1 --no-local` of the working tree at HEAD has been built (the integration test does this; for QA we'll reuse the same incantation):

   ```bash
   export PN_QA_CLONE="$PN_QA_TMP/clone"
   git clone --depth 1 --no-local -q "$PN_REPO" "$PN_QA_CLONE"
   ```

### Steps

1. Subpath form (the production install):

   ```bash
   mkdir -p "$PN_QA_TMP/scenario-4-subpath"
   cd "$PN_QA_TMP/scenario-4-subpath"
   "$PN_REPO/node_modules/.bin/skills" add "$PN_QA_CLONE/skills" --all -a cursor-cli 2>&1 | tee scenario-4-subpath.log
   ls .agents/skills/ | sort > installed-subpath.txt
   ```

2. Bare-repo form (the URL we are *not* shipping):

   ```bash
   mkdir -p "$PN_QA_TMP/scenario-4-bare"
   cd "$PN_QA_TMP/scenario-4-bare"
   "$PN_REPO/node_modules/.bin/skills" add "$PN_QA_CLONE" --all -a cursor-cli 2>&1 | tee scenario-4-bare.log
   ls .agents/skills/ | sort > installed-bare.txt
   ```

3. Diff the two sets:

   ```bash
   diff "$PN_QA_TMP/scenario-4-subpath/installed-subpath.txt" "$PN_QA_TMP/scenario-4-bare/installed-bare.txt"
   ```

### What you should see

- The subpath install contains exactly the 10 user-facing skills.
- The bare install contains the 10 user-facing skills *plus* potentially additional content the bare-repo discovery picks up (the exact set depends on upstream's priority-dir list as of the version installed; common additions are skills found under `.agents/skills/` if upstream still walks it).
- The `diff` is either empty (the upstream CLI's bare-path discovery is now subpath-equivalent — note this in the report so we can tighten the integration test) or shows the bare form is wider, which is the result this scenario was authored to demonstrate.

### Failure modes

- The subpath install lands more skills than the user-facing 10. Means the priority-dir traversal for `<clone>/skills` recurses further than expected; needs investigation before merge.
- The bare install lands fewer skills than the subpath install. Means upstream's discovery is now more conservative; not a problem but the integration-test expectations should be tightened to match.
- Either invocation exits non-zero.

### Restore

```bash
rm -rf "$PN_QA_TMP/scenario-4-subpath" "$PN_QA_TMP/scenario-4-bare"
# Keep $PN_QA_CLONE around — scenarios 6 and 8 reuse it.
```

## Scenario 5 — Local-dev contributor setup re-enactment

**What you're proving from the user's seat:** A new contributor who clones the repo and runs `pnpm install` for the first time gets `.agents/skills/` and `.claude/skills/` populated as symlinks to `skills-contrib/`, so their local agent runtime sees the contributor skill set without any extra step.

**Covers:** AC-DIST-5 (local-dev path; the published-consumer path is in scenario 3)

**Oracle:** `.agents/skills` and `.claude/skills` resolve (via `readlink`) to `$PN_REPO/skills-contrib/`. Reading a contributor SKILL.md *through* the symlink yields the same content as reading it directly from `skills-contrib/`.

**Preconditions:**

- A clean working tree.
- The repo has been freshly checked out, or you can run `pnpm install` again to re-fire the postinstall.

### Steps

1. Inspect the symlinks:

   ```bash
   readlink "$PN_REPO/.agents/skills"
   readlink "$PN_REPO/.claude/skills"
   ```

2. Walk one symlink to a contributor SKILL.md:

   ```bash
   ls "$PN_REPO/.agents/skills/" | head -5
   diff "$PN_REPO/.agents/skills/commit-as-you-go/SKILL.md" \
        "$PN_REPO/skills-contrib/commit-as-you-go/SKILL.md"
   ```

3. Re-fire the postinstall on a system that does *not* yet have the symlinks (simulate by removing them first):

   ```bash
   rm -rf "$PN_REPO/.agents/skills" "$PN_REPO/.claude/skills"
   pnpm --dir "$PN_REPO" exec node scripts/setup-contrib-skills.mjs
   ls -la "$PN_REPO/.agents/skills" "$PN_REPO/.claude/skills"
   ```

### What you should see

- Both `readlink`s resolve to relative paths ending in `skills-contrib`.
- The two `diff`-ed SKILL.md files are identical (no output from `diff`).
- The re-fire step recreates both symlinks; `ls -la` shows them with `->` arrows pointing into `skills-contrib`.

### Failure modes

- Either symlink is missing after `pnpm install` (the postinstall hook didn't fire, or fired with an error). Causes: hook misnamed in `package.json`; the script throws on platforms without symlink support.
- The symlink resolves to something other than `skills-contrib/` (e.g. an old `.agents/skills/` directory predating the move). Means the script didn't replace a stale target.
- The re-fire step lands a directory rather than a symlink (the script's `ensureSymlink` fell back to copying).

### Restore

The script is idempotent; re-running `pnpm install` (or `pnpm setup:contrib-skills`) restores the canonical state. `.agents/skills` and `.claude/skills` are gitignored, so a stray non-canonical state won't pollute `git status` — confirm anyway:

```bash
git -C "$PN_REPO" status --short
```

## Scenario 6 — Upgrade-skill journey: install + read SKILL.md as a fresh user

**What you're proving from the user's seat:** A user who is told (by docs, by an agent, by a Linear ticket) "install the upgrade skill" can run a single command, get the renamed `prisma-next-upgrade` skill, and the SKILL.md it ships will tell them a re-install URL that actually works against the new distribution. Catches the class of bug where doc text and shipped behaviour drift apart.

**Covers:** AC-R2-1 (cluster move) + judgement (SKILL.md prose / install-URL freshness)

**Oracle:** The SKILL.md's Step 0 install URL exactly matches the URL the user just ran. No mention of `@prisma-next/upgrade-skill` (the dead npm package name) survives anywhere in the SKILL.md or its README.

**Preconditions:**

- `PN_QA_CLONE` from scenario 4 is still on disk (or re-create it via `git clone --depth 1 --no-local -q "$PN_REPO" "$PN_QA_CLONE"`).
- A fresh tmpdir.

### Steps

1. Install just the upgrade cluster from the local clone, mirroring what `init` does for that source:

   ```bash
   mkdir -p "$PN_QA_TMP/scenario-6"
   cd "$PN_QA_TMP/scenario-6"
   "$PN_REPO/node_modules/.bin/skills" add "$PN_QA_CLONE/skills/upgrade" --all -a cursor-cli 2>&1 | tee scenario-6.log
   ```

2. Inspect what landed:

   ```bash
   ls .agents/skills/
   cat .agents/skills/prisma-next-upgrade/SKILL.md | head -30
   ```

3. Pull the install URL the SKILL.md advertises (Step 0) and confirm it matches what you ran (modulo the local-clone substitution):

   ```bash
   grep -A1 'npx skills add' .agents/skills/prisma-next-upgrade/SKILL.md
   ```

4. Sanity-check the README that travels with the skill:

   ```bash
   cat .agents/skills/prisma-next-upgrade/README.md | head -40
   ```

### What you should see

- One skill landed: `prisma-next-upgrade`.
- SKILL.md frontmatter has `name: prisma-next-upgrade`, the description starts with "Upgrade Prisma Next in your app".
- The install URL Step 0 advertises is `npx skills add prisma/prisma-next/skills/upgrade --all` (production form). The README's Installation section advertises the same URL.
- Neither file mentions `@prisma-next/upgrade-skill` (the deleted npm package name) or `@prisma-next/extension-upgrade-skill` as something the user installs from npm. The extension-upgrade *skill* may be referenced as a sibling skill (correct); the *package* name should not appear.
- The README's "What this skill does" / Step 0 prose is internally consistent — Step 0's "exit and ask the user to re-install" instruction names a URL identical to the README's "Installation" section.

### Failure modes (judgement-heavy — call out anything that reads weirdly to a fresh user)

- The install URL in SKILL.md does not match what the user actually ran (drift between SKILL.md prose and shipped distribution).
- The SKILL.md still references the dead `@prisma-next/upgrade-skill` npm name in any prose that asks the user to *do* something (re-install, search npm, install via `pnpm add`).
- The README links go nowhere (relative `../` paths broken because the file moved).
- The Step 0 prose tells the user to re-install at `@latest` with a URL that doesn't exist.

### Restore

```bash
rm -rf "$PN_QA_TMP/scenario-6"
```

## Scenario 7 — `prisma-next-check-pins` from the renamed bin-only package

**What you're proving from the user's seat:** An extension author who installs `@prisma-next/extension-author-tools` as a `devDependency` (the new home of the `prisma-next-check-pins` bin) gets the same CI gate they had under `@prisma-next/extension-upgrade-skill`. The negative control fires on a range pin with a useful diagnostic.

**Covers:** AC-R2-3 (the bin-only npm package retains the bin and exits with a useful diagnostic on a range pin)

**Coverage boundary:** This proves the gate fires on a single `^` range pin in `peerDependencies`. The package's own unit tests (`packages/0-shared/extension-author-tools/test/check-pins.test.mjs`) cover the broader matrix (`~`, `*`, `workspace:`, `dependencies` vs `peerDependencies`, multi-version mismatch); this scenario does not re-prove that matrix end-to-end.

**Oracle:** Exit code is 0 on the exact-pin fixture and non-zero on the range-pin fixture. The non-zero output names `@prisma-next/contract` and the offending pin string.

**Preconditions:**

- `PN_QA_TMP` is set.
- `node_modules/.bin/prisma-next-check-pins` resolves to the renamed package (verified in pre-flight step 5).

### Steps

1. Create a fixture extension package:

   ```bash
   mkdir -p "$PN_QA_TMP/scenario-7"
   cd "$PN_QA_TMP/scenario-7"
   cat > package.json <<'EOF'
   {
     "name": "fixture-extension",
     "version": "0.1.0",
     "peerDependencies": {
       "@prisma-next/contract": "0.7.0"
     }
   }
   EOF
   ```

2. Run the gate against the exact-pin fixture:

   ```bash
   "$PN_REPO/node_modules/.bin/prisma-next-check-pins"
   echo "exit: $?"
   ```

3. Mutate to a range pin:

   ```bash
   sed -i.bak 's/"0.7.0"/"^0.7.0"/' package.json
   ```

4. Re-run the gate:

   ```bash
   "$PN_REPO/node_modules/.bin/prisma-next-check-pins" 2>&1 | tee scenario-7-fail.log
   echo "exit: $?"
   ```

### What you should see

- Step 2: exit code 0, no output (the gate is silent on success).
- Step 4: exit code non-zero. The output names `@prisma-next/contract` and the offending pin (`^0.7.0`), with prose recognisable to a CI failure log (not a stack trace, not a generic "validation failed").

### Failure modes

- Exit-zero on the range-pin fixture (the gate did not fire — defeats the whole point of the bin).
- The diagnostic does not name the offending dep / pin (a CI maintainer reading the log can't tell what to fix).
- The bin is missing or unresolvable (`prisma-next-check-pins: command not found`) — means the package rename's `bin` map did not propagate; re-run `pnpm install` and inspect `packages/0-shared/extension-author-tools/package.json`.

### Restore

```bash
rm -rf "$PN_QA_TMP/scenario-7"
```

## Scenario 8 — Negative control: `pnpm check:upgrade-coverage` after the move

**What you're proving from the user's seat:** The release-pipeline coverage gate that demands an upgrade-instructions entry for every substrate diff still fires after the cluster move — and names the new path (`skills/upgrade/prisma-next-upgrade/upgrades/<X>-to-<Y>/`) in its diagnostic, not the old `packages/0-shared/upgrade-skill/upgrades/...` path.

**Covers:** AC-R2-1 (the cluster move's coverage-gate dependency)

**Coverage boundary:** This proves the gate fires on a single fake substrate diff under `examples/` and names the new path. It does not re-prove every transition-directory edge case (rebase scenarios, publish-mode prev/head asymmetry) — those are covered by `scripts/check-upgrade-coverage.test.mjs` which CI runs on every push.

**Oracle:** Without an entry directory, the gate exits non-zero with a stderr that includes the substring `skills/upgrade/prisma-next-upgrade/upgrades/`. With a placeholder entry in that directory, the gate exits zero. After restoring, the gate behaves as it did at the start of the scenario.

**Preconditions:**

- A clean working tree.

### Steps

1. Plant a fake substrate diff:

   ```bash
   cd "$PN_REPO"
   echo '// QA-probe: trivial substrate diff' >> examples/prisma-next-demo/src/main.ts
   ```

2. Run the gate against the planted diff:

   ```bash
   pnpm check:upgrade-coverage --prev origin/main --head HEAD 2>&1 | tee /tmp/scenario-8-fail.log
   echo "exit: $?"
   ```

3. Plant a placeholder entry in the directory the diagnostic named:

   ```bash
   IN_FLIGHT=$(rg -o 'skills/upgrade/prisma-next-upgrade/upgrades/[0-9.]+-to-[0-9.]+' /tmp/scenario-8-fail.log | head -1)
   mkdir -p "$IN_FLIGHT"
   cat > "$IN_FLIGHT/instructions.md" <<'EOF'
   ---
   from: "0.7"
   to: "0.8"
   changes: []
   ---
   QA placeholder; will be removed in restore.
   EOF
   pnpm check:upgrade-coverage --prev origin/main --head HEAD 2>&1 | tee /tmp/scenario-8-pass.log
   echo "exit: $?"
   ```

### What you should see

- Step 2: exit non-zero. Stderr includes `skills/upgrade/prisma-next-upgrade/upgrades/<from>-to-<to>/` (the new path) and names `examples/prisma-next-demo/src/main.ts` in the sample-diff list. **Critically: the path does not say `packages/0-shared/upgrade-skill/`** — that string appearing would mean the script didn't get repointed.
- Step 3: exit zero. Stdout reports coverage satisfied.

### Failure modes

- Step 2 stderr names `packages/0-shared/upgrade-skill/...` — the regex / constants in `scripts/check-upgrade-coverage.mjs` did not get updated alongside the move.
- Step 2 exits zero (the gate is no longer enforcing coverage at all).
- Step 3 still exits non-zero after the placeholder is in place — the gate's "directory exists" check is not finding the freshly-created path.

### Restore

```bash
git -C "$PN_REPO" restore examples/prisma-next-demo/src/main.ts
rm -rf "$IN_FLIGHT"
git -C "$PN_REPO" status --short
```

`git status` should be unchanged. (The `IN_FLIGHT` directory is untracked, so the `rm` is sufficient — no `git restore` needed there.)

## Scenario 9 — Judgement: install-summary legibility

**What you're proving from the user's seat:** When `init` runs three skill-install subprocesses in sequence, the user-visible summary line is something a human can read and act on. This is the kind of thing CI cannot meaningfully assert — the unit tests cover the data shape (three commands, each in backticks, joined by some separator), but only a human can say whether the result is *legible*.

**Covers:** AC-R2-2 (judgement)

**Oracle:** A fresh user (imagine an SRE pasting init's output into Slack to ask for help) can answer two questions from the summary alone: (a) which install commands ran; (b) which one would they re-run if they suspected a regression. If the answer to either question is "I'd have to read the source", the summary is not legible enough.

**Preconditions:**

- Scenario 2 has been run (or you've kept its `scenario-2.log`).

### Steps

1. Re-open the log:

   ```bash
   less "$PN_QA_TMP/scenario-2/scenario-2.log"
   ```

2. Find the line that begins `Registered Prisma Next skills (project level) — ran` and the lines around it.

3. Read the line out loud. If you trip over it, that's data.

### What you should see

- The summary names all three subpath commands, each formatted as code.
- The separator between commands is something a reader can scan (a comma, a newline, a bullet — not three commands jammed together with no whitespace).
- The verb tense is past-perfect: the commands ran, no ambiguity about whether init is reporting a plan or a result.
- If the user's package manager is something other than pnpm, the `dlx skills add` form switches accordingly (`npx skills add ...`, `bunx skills add ...`, etc.) — re-run scenario 2 with `--pm yarn` or similar to spot-check this surface if you have time.

### Failure modes (judgement-heavy — name what reads weirdly even if it parses)

- The summary is one line of three concatenated commands with no visual separator, hard to scan.
- The summary names a command that doesn't actually match what init ran (e.g. shows the production GitHub URL even though `PRISMA_NEXT_SKILLS_BASE` redirected to a local clone).
- The summary buries one of the three commands behind a different sentence ("…and also installed the upgrade skill") in a way that makes it less obvious to retry.
- The `--no-skill` skip warning still references the singular form (e.g. "run `<one command>` to install later"), missing the round-2 multi-source reality.

(No state-mutation; no Restore step.)

## Scenario 10 — Exploratory charter: init flag combinations

**Charter.** "Explore `prisma-next init` against fresh tmpdirs for 30 minutes, varying the flag matrix (`--target`, `--authoring`, `--no-skill`, `--no-install`, missing lockfile, missing `package.json`, mid-run interruption with Ctrl-C). Discover diagnostics that read poorly, install-summary text that contradicts itself across flag combinations, and any state combination the scripted scenarios skipped."

**Covers:** (no specific AC; surfaces unknowns)

**Time budget:** 30 minutes. Stop when the timer rings even if you have more ideas — log them as candidate scenarios for a future round.

**Notes capture.** For each probe:

- The flags / state you set up.
- What you ran.
- What you saw (paste the relevant stdout/stderr fragment).
- What surprised you (or felt off, even if you can't yet name why).

Findings get classified in the report the same way scripted-scenario findings do.

Suggested probes (cover what looks easiest first; jump around as the surface invites):

- `prisma-next init --no-skill` — does the warning text read cleanly given the round-2 multi-cluster reality?
- `prisma-next init --no-install` — same warning text path but with a different reason.
- `prisma-next init --target mongo --authoring ts` — does the install summary still name three subpath URLs, or does it skip / change one?
- Run `init` in a directory that's a partially-initialised Prisma Next project (e.g. has `prisma-next.config.ts` already) — does init re-install the skill clusters idempotently or refuse?
- Run `init` against a directory where `.agents/skills/prisma-next/` is a leftover hand-rolled stub (the `LEGACY_SKILL_FILE` cleanup path); confirm the cleanup still fires.
- Ctrl-C `init` mid-run; re-run; observe whether the partial state confuses it.
- Run `init` with `PRISMA_NEXT_SKILLS_BASE` set to a path that doesn't exist; observe the diagnostic.

## Scenarios deliberately not in this script

| AC                                                              | Why it's not a manual-QA scenario                                                                                                                                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-DIST-3 (snapshot of `formatSkillInstallCommand` per PM)      | Pure unit-test surface. The five PM-shape assertions live in `packages/1-framework/3-tooling/cli/test/commands/init/agent-skill-install.test.ts`; CI runs them on every push. A human eyeballing the same string adds nothing. |
| AC-DIST-4 (regex sweep over tracked files)                      | `rg` is the canonical mechanism. CI greps as part of lint. Re-running it locally only proves the local tree matches CI; the user-meaningful version (the *re-enactment*) is scenario 1.                                |
| AC-DIST-6 (workspace-list assertion that `@prisma-next/skills` is gone) | Pure structural check. `pnpm m ls --json` is the canonical surface; CI catches drift. A human listing workspaces adds nothing.                                                                                          |
| `pnpm test:integration` ran end-to-end on this branch           | CI runs it on the PR. Local re-runs of the workspace-wide integration suite carry the pre-existing Postgres-connection instability flagged in `wip/unattended-decisions.md` decision 4 — false-positive risk outweighs signal. |
| `pnpm lint:deps` clean on this branch                           | Layering check is structural; CI runs it. The negative-control version (introducing a layering violation and watching it fire) belongs to a different project's QA, not this one.                                       |
| `pnpm typecheck` clean on this branch                           | Compile-time gate. CI runs it. Same reasoning as `lint:deps`.                                                                                                                                                           |
| Every prior transition's upgrade instructions still apply correctly | Out of this PR's scope. The cluster move only changed the *home* of the upgrade-instructions content; the bodies are identical to what shipped pre-move. Re-validating bodies belongs to the upgrade-skill project's own QA. |

## Sign-off coverage map

| AC ID       | Scenario(s) covering it                                              |
| ----------- | -------------------------------------------------------------------- |
| AC-DIST-1   | 2                                                                    |
| AC-DIST-2   | 2, 3, 4                                                              |
| AC-DIST-3   | (CI snapshot test) — see "Scenarios deliberately not in this script" |
| AC-DIST-4   | 1 (re-enactment) + (CI ripgrep gate)                                 |
| AC-DIST-5   | 3 (published-consumer opt-in path), 5 (local-dev path)               |
| AC-DIST-6   | (CI workspace-list assertion) — see "Scenarios deliberately not in this script" |
| AC-R2-1     | 2 (smoke), 6 (judgement read-through), 8 (coverage gate path)        |
| AC-R2-2     | 2 (three subpaths invoked), 9 (summary legibility judgement)         |
| AC-R2-3     | 7 (negative control on the renamed bin)                              |

> AC-R2-1, AC-R2-2, AC-R2-3 are introduced by the round-2 amendments documented in [`spec.md` § Falsified assumptions (round 2)](./spec.md#falsified-assumptions-round-2--metadatainternal-true-is-not-a-defence) and [`specs/upgrade-skill.spec.md` § Amendments (round 2)](./specs/upgrade-skill.spec.md#amendments-round-2--distribution-fix-follow-on). They are not in the original distribution-fix-plan AC list because the plan predated their discovery.

## Post-flight cleanup

After all scenarios complete:

```bash
rm -rf "$PN_QA_TMP"
git -C "$PN_REPO" status --short
```

`git status` should report the working tree exactly as it was at pre-flight step 1. If it does not, find the scenario whose Restore step you skipped and re-run it.
