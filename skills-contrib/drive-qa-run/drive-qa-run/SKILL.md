---
name: drive-qa-run
description: Execute an existing manual-QA script (produced by `drive-qa-plan`) end-to-end and produce a structured run report. Use when the user asks to "run manual QA", "execute the QA script", "do the QA walkthrough", "walk through the manual tests", "QA this PR", "run the QA pass and report", or hands you a path to a `manual-qa.md` and asks for results. Authoring the script in the first place is the `drive-qa-plan` skill's job.
---

# Run a manual QA script

> **You are the user. Drive the system through the script's scenarios, observe everything, capture findings honestly, classify their severity, and produce a report someone can act on.**

A manual-QA run is the *execution* artefact for a script produced by `drive-qa-plan`. The runner's job is not to grade the script — it's to drive the live system through it, capture what happened, classify findings by severity in the runtime context (release stage, blast radius, surrounding state), and assemble a report keyed to the script's acceptance-criteria coverage map.

## When to Use

- The user hands you a path to an existing `manual-qa.md` and asks for results.
- The user says "run the QA", "execute the QA script", "QA this PR", "walk through the manual tests", or any close paraphrase.
- A QA pass is needed before merging or releasing and a script already exists.
- You've just finished `drive-qa-plan` for a spec and the user immediately asks to run it.

## When Not to Use

- A manual-QA script for the project doesn't exist yet. → `drive-qa-plan` first; then run it.
- The user asks for "test results" generically — confirm whether they mean *manual-QA execution* or *CI results*. CI results are not this skill's lane.
- The user wants to *modify* the script while running it. Modifying mid-run conflates script-author and runner roles. Note the proposed change as a finding ("script should also cover X"), keep running against the current script, and route the script-change request back through `drive-qa-plan` after the run completes.
- The user wants a release runbook executed (operational steps, deploys, smoke checks against prod). Different skill family.

## Key Concepts

- **The script is the test plan; the report is the result.** Never edit the script during a run. Findings, severity, and verdict live in a separate report document. The script stays clean so the next run starts from the same canonical state.
- **Observe, don't paraphrase.** When capturing what happened, paste the actual command and the actual output. "It worked" is not an observation; the exit code, the printed envelope, and the file shape are. Future readers (including the implementer fixing a finding) need verbatim evidence, not your summary.
- **Severity belongs to the report, not the script.** The script's "Failure modes" section enumerates categories of finding the author anticipated. *You* classify each observed finding's severity in the runtime context — what's a blocker in pre-release may be a follow-up in alpha. Use the rubric below.
- **Capture artefacts on every finding.** Without verbatim repro material, a finding is gossip. Capture the command (from shell history, not from the script — they can drift), full output, `git rev-parse HEAD`, `git status` at the moment of failure, and any mutated files (zip migration directories, copy log dumps).
- **Restore between scenarios; verify clean.** State leakage between scenarios produces false findings ("scenario 4 broke" → actually scenario 3 didn't clean up). Every state-mutating scenario has a restore step in the script; run it, then `git status` (and any environment-equivalent check — DB schema, env vars) before the next scenario.
- **Fresh eyes find more.** Author bias makes the script-author worse at finding bugs in their own script's blind spots. Ideally, run the QA with someone (or some-LLM-pass) who did not author the change. Failing that, run it the morning after writing it — sleep-distance approximates fresh-eyes.
- **Exploratory scenarios respect the time budget.** When the script includes a charter ("explore for 30 minutes"), stop when the timer rings even if you have ideas left. Log unused ideas as candidate scenarios for the next round and keep moving. Exploratory scenarios that overrun starve the structured ones.

## Severity rubric

Apply at finding-classification time, not at script-write time. The rubric is calibrated for an in-progress codebase; release-stage context shifts the thresholds.

| Tag | Meaning | Examples |
| --- | ------- | -------- |
| 🛑 **Blocker** | The originally-fixed bug class returns; data loss; corruption of durable artefacts; crash with no usable diagnostic on a documented happy path. | TML-2536's `PN-CLI-4999` reappearing on the demo; `migration apply` corrupting `migration.json`. |
| ⚠️ **High** | User-visible regression with a workaround; new bug that affects a documented flow; documented diagnostic copy is misleading or wrong. | A new error envelope omits the offending entry name; a CLI command exits non-zero on a documented no-op flow but a flag works around it. |
| 📝 **Follow-up** | Non-blocking quality issue; ugly output; minor diagnostic copy improvement; missing convenience; doc drift the runner happened to notice. | Diagnostic mentions an internal symbol name a user wouldn't recognise; verbose output buries the actionable line; a scripted scenario is mildly out of date. |

Two cross-cutting rules:

- **Original-bug regressions are always 🛑 Blocker**, regardless of release stage. The whole point of the QA pass is to confirm the original bug stays fixed.
- **Negative-control scenario fails** (the gate doesn't fire on a planted violation) are 🛑 Blocker too — the regression-prevention story has failed.

## The report skeleton

Reports live at `projects/<project-name>/manual-qa-reports/<YYYY-MM-DD>-<runner-handle>.md`. One report per run. Reports accumulate (never overwrite) so the QA history is auditable.

```markdown
# Manual QA report — <TICKET-ID> (<short title>) — <YYYY-MM-DD>

> **Script:** `projects/<project>/manual-qa.md` (commit `<sha>` at run time)
> **Runner:** <name or LLM session id>
> **Environment:** <OS, Node version, branch + commit, any other relevant facts>
> **Started / finished:** <ISO timestamps>
> **Verdict:** ✅ Pass / ✅ Pass-with-follow-ups / ❌ Fail

## Summary

<2–4 sentences. State the verdict and the headline reason. If 🛑 Blocker findings exist, name them. If 📝 Follow-ups outnumber acted-on scenarios meaningfully, note that.>

## Findings

<One subsection per finding. Numbered F-1, F-2 …. Order by severity (🛑 first), then by scenario number.>

### F-1 — 🛑 Blocker — <one-line description>

**Scenario:** <N — Scenario title>
**Step:** <which step number, or "exploratory probe at minute X">
**Oracle:** <copied from script; what we were comparing against>
**Observed:**
\`\`\`
<verbatim command + output>
\`\`\`

**Expected (per script):** <copied from the script's "What you should see" or oracle>
**Reproduction:**
- `git rev-parse HEAD` → `<sha>`
- `git status` at failure → <state>
- Mutated files (if any): <list, with zip path under `manual-qa-reports/artefacts/F-1/`>
- Exact command: `<paste from shell history>`
**Notes:** <runner judgement; suggested next step; cross-refs to related findings>

### F-2 — ⚠️ High — <…>

…

### F-3 — 📝 Follow-up — <…>

…

## Per-scenario log

| # | Scenario | Result | Findings |
| - | -------- | ------ | -------- |
| 1 | <title>  | ✅ pass | —        |
| 2 | <title>  | ❌ fail | F-1, F-3 |
| 3 | <title>  | ✅ pass-with-follow-ups | F-4 |
| 4 | Exploratory: <charter> | (notes; see below) | F-5 |

## Exploratory notes (if any exploratory scenario was run)

<Free-form prose. What you tried, what surprised you, anything that "felt off" but you can't yet name. Findings discovered here are filed in the Findings section above; this is the unfiltered record.>

## Coverage outcome

| AC ID | Scenario(s) | Result | Notes |
| ----- | ----------- | ------ | ----- |
| AC-1  | 1, 3        | ✅ pass | — |
| AC-2  | 5           | ❌ fail | F-1 (script's negative control did not fire) |
| AC-N  | (CI; not manual-QA scope) | N/A | — |

## Suggested follow-ups

<Bulleted list — usually a mix of: file these findings as tickets; consider these script improvements; consider these test additions to close gaps the QA round surfaced.>
```

## Workflow

### 1. Read the whole script before running anything

Read the entire `manual-qa.md` end-to-end first. Note:

- Total number of scenarios + estimated time (charters add their time budget directly).
- Which scenarios mutate state (you'll need to restore).
- Which scenarios are negative controls (extra care: do not skip the restore).
- Which scenarios depend on which (preconditions block).

If anything in the script is unclear or stale, **do not modify the script** — note it as a 📝 Follow-up finding for `drive-qa-plan` to revise after the run.

### 2. Set up the environment per the script's pre-flight

Run the pre-flight steps verbatim. Confirm:

- Clean tree (`git status`).
- All declared environment requirements met (env vars, DB reachable, etc.).
- Recommended fresh-eyes condition met to whatever degree is practical.

Create the report file's skeleton now (header block with runner identity, environment, start timestamp). You'll fill in findings as you go.

### 3. Execute scenarios in script order, one at a time

For each scenario:

1. Read its **Preconditions** block. Confirm each one before proceeding.
2. Note the **Oracle** explicitly — you'll need it when classifying any observation as a finding.
3. Run **Steps** verbatim from the script, *not* from memory. Copy-paste from the doc.
4. Capture observed output verbatim from your shell. Don't paraphrase. If output is long, paste enough to evidence the assertion (the "What you should see" item the output corresponds to) plus surrounding context.
5. Compare against **What you should see**. For each item:
   - Match → continue.
   - Mismatch → log a finding (see step 5 of this workflow).
6. Compare against **Failure modes**. Any matching observation is a finding by definition.
7. Run the **Restore** step. Verify `git status` is clean (and any environment-equivalent checks); only then advance.

For exploratory scenarios:

1. Read the **Charter**.
2. Start a timer for the **Time budget**.
3. Probe the system following the charter. Take notes as you go — what you tried, what surprised you, anything that felt off.
4. Stop when the timer rings. Whatever findings you have, file them. Whatever ideas you didn't get to, log as candidate scenarios in the report's "Suggested follow-ups" section.

### 4. Capture findings as they happen, not at the end

When you observe a failure-mode match or a mismatch with "What you should see":

1. **Capture the artefacts immediately**: exact command (from shell history), full output (stdout + stderr), `git rev-parse HEAD`, `git status`, any mutated files (zip into `manual-qa-reports/artefacts/F-N/`).
2. **Classify severity** using the rubric. Original-bug regressions and failed negative controls are 🛑 Blocker, no exceptions. Otherwise judge based on user impact in the current release stage.
3. **Append the finding to the report's Findings section.** Don't batch finding-writing until end-of-run — the artefacts get colder by the minute and the context of *why* you classified it that way gets fuzzier.
4. **Decide: continue or stop?**
   - 🛑 Blocker → stop the run (assuming the blocker isn't isolated to one scenario). Continuing risks producing findings that are downstream artefacts of the blocker, not new bugs. Use judgement: a blocker in scenario 7 of 9 may still allow scenarios 8–9 to run if they're independent.
   - ⚠️ High → continue but flag in the report's Summary; consider whether downstream scenarios are still meaningful.
   - 📝 Follow-up → continue.

### 5. After the last scenario, assemble the report

1. Fill in the **Verdict** in the header block based on findings:
   - No findings → ✅ Pass
   - Only 📝 Follow-ups → ✅ Pass-with-follow-ups
   - Any ⚠️ High or 🛑 Blocker → ❌ Fail
2. Write the **Summary** (2–4 sentences; lead with the verdict and the headline reason).
3. Fill in the **Per-scenario log** table — one row per scenario, mark passed / failed / pass-with-follow-ups, list finding IDs.
4. Fill in the **Coverage outcome** table by walking the script's "Sign-off coverage map" row-by-row. Each AC inherits its result from the worst-severity finding in any of the scenarios that covered it (Blocker > High > Follow-up > Pass). N/A rows stay N/A.
5. Write **Suggested follow-ups** — typically a mix of: file these findings as tickets (with severity in the proposed title), consider these script improvements, consider these test additions to close gaps the QA round surfaced.
6. Set the **finished** timestamp.
7. Save the report to `projects/<project-name>/manual-qa-reports/<YYYY-MM-DD>-<runner>.md`. Add the artefacts directory at the sibling `manual-qa-reports/artefacts/F-N/` paths.

### 6. Hand off

Surface the report to the implementer / spec-author:

- If verdict is ✅ Pass, the response is the report path + a one-line confirmation.
- If verdict is ✅ Pass-with-follow-ups, list the 📝 findings briefly so the user can decide which to ticket immediately versus defer.
- If verdict is ❌ Fail, lead with the blockers and quote the headline observed-vs-expected diff verbatim. Don't editorialise; the runner's job is observation, not advocacy.

## Common Pitfalls

1. **Editing the script during a run.** Symptom: you notice a stale step or a typo, fix it in `manual-qa.md`, keep running. Now the script reflects the runner's interpretation, not the script-author's intent, and the next run can't be compared to this one. Fix: file the script-quality issue as a 📝 Follow-up finding for `drive-qa-plan` and keep running against the unmodified script.
2. **Paraphrasing observations.** Symptom: "It worked" / "Output looked right" / "Got an error". The implementer reading the report cannot reproduce or judge. Fix: verbatim command + verbatim output, every time. The report's bandwidth budget is large enough.
3. **Skipping the restore step.** Symptom: scenario N's behaviour looks wrong; turns out scenario N-1 left a half-mutated DB. Fix: every state-mutating scenario ends with restore + `git status` clean. No advance without confirmation.
4. **Batching finding-writing until the end.** Symptom: end-of-run, you remember "something failed in scenario 3 but I can't quite recall" — artefacts are gone, classification is fuzzy. Fix: capture and classify immediately; the report grows as you go.
5. **Pre-stage classifying** ("we're pre-1.0 so nothing is a blocker"). Symptom: every 🛑-shaped finding gets demoted to ⚠️ on the runner's "well it's only an alpha" reasoning. Fix: original-bug regressions and failed negative controls are 🛑 Blocker regardless of stage. Other severities flex by stage; those two don't.
6. **Continuing past a true blocker.** Symptom: scenario 4 surfaces a 🛑 Blocker; scenarios 5–9 dutifully run, produce a cascade of downstream findings, and the report buries the actual signal. Fix: when in doubt, stop after a blocker. Note the un-run scenarios in the per-scenario log as "not run; blocked by F-N".
7. **Treating the exploratory scenario as a stretch goal.** Symptom: exploratory charter is the last scenario, time has slipped, runner skips it. Fix: the charter is part of the script's coverage — skipping it means an entire class of findings goes uncollected. Either run it or explicitly note in the report that it was skipped and why (and budget for next round).
8. **Letting the exploratory scenario blow its budget.** Symptom: runner is on minute 90 of a 30-minute charter, has filed 5 follow-ups, hasn't started the final scripted scenario. Fix: respect the time budget; remaining ideas go in "Suggested follow-ups".
9. **Filing findings against the script when they belong to the system.** Symptom: "F-3 — script said `migration plan` is a no-op but actually proposed an operation". Cause: runner attributed an observed-vs-expected mismatch to script staleness instead of a behavioural regression. Fix: only when you've verified the script *is* stale (e.g. the spec changed) does the finding belong to the script. If the script reflects current spec and reality diverges, the finding belongs to the system.
10. **Confabulating cleanup.** Symptom: report says "restored to clean state" but `git status` was never actually run. Fix: paste the literal `git status` output (or its short form) into the report at the end of each state-mutating scenario, even when clean. Evidence over claims.
11. **Using `wip/` for the report.** Symptom: report lands at `wip/qa-report.md`. Cause: runner treated it as ephemeral. Fix: reports are durable audit trail. They belong at `projects/<project>/manual-qa-reports/`. `wip/` is gitignored and the report would vanish.

## What this skill doesn't do

- **Author the script.** That's `drive-qa-plan`. If no script exists, run that first.
- **Modify the script.** Script changes are notes for `drive-qa-plan`, never in-place edits during a run.
- **File the findings as tickets.** The report enumerates findings; ticketing is a separate user decision (sometimes with a separate skill, e.g. a Linear / GitHub Issues filer). The Suggested follow-ups section is the bridge.
- **Decide whether to merge / release.** The report's Verdict is the data point; the merge/release decision is the project owner's call.

## Reference Files

- `drive-qa-plan/SKILL.md` — the sibling skill that authors scripts this one executes. Sibling sections that constrain this skill: scenario shape (Oracle / Preconditions / Failure modes / Restore), failure-mode-vs-severity split, exploratory charter format.
- `skills-best-practices/SKILL.md` — for `description:` matcher discipline and SKILL.md shape conventions.

## Checklist

- [ ] Read the entire script before running anything; noted time budget, state mutations, scenario dependencies.
- [ ] Pre-flight executed verbatim; environment confirmed clean; report skeleton created with runner identity + start timestamp.
- [ ] Each scenario's preconditions verified before running its steps.
- [ ] Each scenario's oracle noted as a comparison standard, not glossed.
- [ ] Steps run verbatim from the script (copy-paste), never from memory.
- [ ] Observed output captured verbatim in the report, not paraphrased.
- [ ] Every state-mutating scenario ended with restore + `git status` clean before advancing.
- [ ] Each finding captured *immediately* with artefacts (command, full output, HEAD sha, status, mutated files).
- [ ] Each finding classified using the severity rubric — original-bug regressions and failed negative controls always 🛑 Blocker.
- [ ] Exploratory scenario run within its time budget; remaining ideas filed under Suggested follow-ups.
- [ ] Coverage outcome table walks every AC the script's coverage map enumerates; each AC inherits the worst-severity finding from its covering scenarios.
- [ ] Verdict in header matches the worst severity in Findings (Blocker → Fail, High → Fail, Follow-up only → Pass-with-follow-ups, none → Pass).
- [ ] Report saved to `projects/<project>/manual-qa-reports/<YYYY-MM-DD>-<runner>.md`, artefacts under sibling `artefacts/F-N/`.
- [ ] Did NOT edit the script in place; script-quality issues filed as 📝 Follow-up findings instead.
