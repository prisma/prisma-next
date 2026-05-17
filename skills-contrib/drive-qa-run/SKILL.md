---
name: drive-qa-run
description: Execute an existing manual-QA script (produced by `drive-qa-plan`) end-to-end and produce a structured run report. Use when the user asks to "run manual QA", "execute the QA script", "do the QA walkthrough", "walk through the manual tests", "QA this PR", "run the QA pass and report", or hands you a path to a `manual-qa.md` and asks for results. Authoring the script in the first place is the `drive-qa-plan` skill's job.
---

# Run a manual QA script

> **You are the runner. Drive the live system through the script's scenarios — in parallel where the isolation tags allow — observe everything verbatim, capture findings as they happen, classify their severity, and produce a report someone can act on.**

A manual-QA run is the *execution* artefact for a script produced by `drive-qa-plan`. The runner's job is not to grade the script — it's to drive the live system through it (autonomously; no human in the loop), capture what happened, classify findings by severity in the runtime context (release stage, blast radius, surrounding state), and assemble a report keyed to the script's acceptance-criteria coverage map.

"Manual" here describes *what is being run* (the live system end-to-end, against real artefacts) and *what kind of inference* the runner brings (judgement against an explicit oracle). It does **not** mean "human-driven". The runner is autonomous and parallelises wherever the script's isolation tags permit.

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
- **Parallelise by default; isolation tags are the schedule.** Each scenario carries an isolation tag (`tmpdir` / `workspace` / `read-only` / `external`). The runner builds a DAG from those tags + scenarios' Preconditions and dispatches concurrently up to a global concurrency cap (default 5; lower for `external`). State-mutators don't serialise — they isolate. `workspace` scenarios get their own `git worktree`; `tmpdir` scenarios get their own `$PN_QA_TMP/scenario-N`; `read-only` scenarios share. The runner that ignores the tags and runs serially out of caution defeats the script's own design.
- **Dependencies are explicit, not implicit.** A scenario that reads another scenario's output (logs, planted artefacts, populated state) declares the dependency in its Preconditions block by name (e.g. "scenario 2 completed"). The runner waits. Scenarios that don't declare a dependency are independent and dispatch concurrently — even if they appear later in the script's numbering.
- **Restore inside the isolation context, before reclaiming it.** Per-scenario isolation prevents cross-scenario leakage structurally — every `workspace` scenario has its own worktree; every `tmpdir` scenario has its own scratch dir. The runner still runs each scenario's Restore step inside its own context and verifies clean (`git status` in a worktree, or removes the tmpdir): that's the evidence the script's claimed cleanup actually fires, and it keeps the worktree mergeable into a final clean state when the run finishes. Cross-scenario state leakage is no longer the failure mode it was when scenarios ran serially against a shared workspace; *intra-scenario* dirty cleanup is what the Restore step now exists to catch.
- **Author-bias is real even for LLM runners.** A runner that authored both the implementation and the QA script tends to confirm rather than probe. When the runner is an LLM agent, dispatch the QA pass as a *separate* agent invocation than the implementation work — fresh-context approximates fresh-eyes. When the runner is a human, run the QA pass on a different day than the script-author wrote the script.
- **Exploratory scenarios respect the time budget.** When the script includes a charter ("explore for 30 minutes"), stop when the timer rings even if you have ideas left. Log unused ideas as candidate scenarios for the next round and keep moving. Charters parallelise alongside other scenarios; the time budget is the charter's own wallclock cap, not a serial-execution slot.

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

| # | Scenario | Isolation | Wallclock | Result | Findings |
| - | -------- | --------- | --------- | ------ | -------- |
| 1 | <title>  | tmpdir    | 12s       | ✅ pass | —        |
| 2 | <title>  | workspace | 47s       | ❌ fail | F-1, F-3 |
| 3 | <title>  | read-only | 3s        | ✅ pass-with-follow-ups | F-4 |
| 4 | Exploratory: <charter> | tmpdir | 30m | (notes; see below) | F-5 |
| 5 | <title>  | tmpdir    | —         | ⏸ not dispatched (blocked by F-1) | — |

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

- Total number of scenarios + each scenario's **isolation tag** (`tmpdir` / `workspace` / `read-only` / `external`).
- The **dependency graph**: which scenarios name another scenario in their Preconditions block.
- Which scenarios are **negative controls** (extra care: do not skip the Restore step inside the isolation context — its observable evidence is what proves the gate's gate-ness).
- Which scenarios are **exploratory charters** + their time budgets.

If a scenario lacks an isolation tag, treat it as `workspace` for safety this round and file a 📝 Follow-up against `drive-qa-plan`. **Do not modify the script** in place to add the missing tag.

If anything else in the script is unclear or stale, **do not modify the script** — note it as a 📝 Follow-up finding for `drive-qa-plan` to revise after the run.

### 2. Set up the environment per the script's pre-flight

Run the pre-flight steps verbatim. Confirm:

- Clean tree (`git status`).
- All declared environment requirements met (env vars, DB reachable, etc.).
- Recommended fresh-eyes condition met to whatever degree is practical.

Create the report file's skeleton now (header block with runner identity, environment, start timestamp). You'll fill in findings as you go.

### 3a. Plan the run — build the DAG and allocate isolation contexts

Walk every scenario; build a directed graph from:

- **Isolation tags** define the parallelism class.
- **Preconditions** that name another scenario by ID become DAG edges.

Allocate the isolation contexts up front:

- **Shared read-only clone** (`$PN_QA_CLONE`): create once via `git clone --no-local <workspace> $PN_QA_CLONE` (or whatever the pre-flight prescribes). Every `tmpdir` and `read-only` scenario reads from this clone.
- **Per-`workspace` scenario worktree**: for each `workspace` scenario, run `git worktree add --detach $PN_QA_WORKTREES/scenario-N HEAD`. Scenario N's Steps run inside that worktree; cleanup at end-of-run.
- **Per-`tmpdir` scenario scratch**: for each `tmpdir` and `read-only` scenario, allocate `$PN_QA_TMP/scenario-N`. Scenario N writes only inside this directory.
- **No special context for `external`**: the scenario hits the network as-is. The runner caps `external` concurrency separately to avoid rate-limits.

Decide the global concurrency cap. Default 5; lower if the workspace is small or CPU-bound, higher if scenarios are mostly I/O-bound. Cap `external` concurrency separately (default 2).

### 3b. Dispatch ready scenarios in parallel

Run the DAG forward:

- A scenario is *ready* when (a) all its declared dependency scenarios have finished and (b) the global cap (and the per-class `external` cap, if applicable) permit another in-flight scenario.
- Dispatch ready scenarios concurrently. For each in-flight scenario, the runner:
  1. Verifies its **Preconditions** inside the scenario's isolation context.
  2. Notes the **Oracle** explicitly — needed when classifying any observation as a finding.
  3. Runs **Steps** verbatim from the script (copy-paste from the doc, *not* from memory). All commands run inside the scenario's isolation context (worktree or tmpdir).
  4. Captures observed output verbatim. Don't paraphrase. Paste enough to evidence the assertion plus surrounding context.
  5. Compares against **What you should see** and **Failure modes**, filing findings as they happen (see step 4 of this workflow).
  6. Runs the **Restore** step inside the isolation context; verifies clean (`git status` in a `workspace` worktree, or confirms the tmpdir is the only mutated path).
  7. Reports completion + findings + wallclock to the orchestrator.
- The orchestrator advances the DAG: scenarios whose dependencies have just completed become ready and get dispatched, subject to the cap.

For **exploratory charters**: the in-flight runner starts a timer for the time budget and probes per the charter inside the scenario's isolation context. On timeout (or charter completion), reports findings + un-explored ideas. The charter scenario parallelises with everything else; its time budget is its own wallclock cap, not a serial-execution slot.

When the DAG is exhausted, tear down the worktrees (`git worktree remove --force` each) and copy any per-scenario artefacts that need to be preserved into the report's `manual-qa-reports/artefacts/F-N/` directories *before* removal — worktree paths are ephemeral.

### 4. Capture findings as they happen, not at the end

When you observe a failure-mode match or a mismatch with "What you should see":

1. **Capture the artefacts immediately**: exact command (from shell history), full output (stdout + stderr), `git rev-parse HEAD`, `git status`, any mutated files (zip into `manual-qa-reports/artefacts/F-N/`).
2. **Classify severity** using the rubric. Original-bug regressions and failed negative controls are 🛑 Blocker, no exceptions. Otherwise judge based on user impact in the current release stage.
3. **Append the finding to the report's Findings section.** Don't batch finding-writing until end-of-run — the artefacts get colder by the minute and the context of *why* you classified it that way gets fuzzier.
4. **Decide: continue dispatching or stop?**
   - 🛑 Blocker → stop dispatching *new* scenarios. Let in-flight scenarios complete in their own isolation contexts (their findings are still valuable; they're not downstream of this blocker because each ran in isolation). Mark un-dispatched scenarios in the per-scenario log as "⏸ not dispatched (blocked by F-N)". Do not pre-empt running scenarios — the orchestrator collects all in-flight results, then halts dispatch.
   - 🛑 Blocker on a *prerequisite*: any scenario whose precondition can no longer be satisfied (the dependency failed and produced the blocker) is automatically un-dispatched. Mark as "⏸ not dispatched (dependency F-N failed)".
   - ⚠️ High → continue dispatching; flag in the report's Summary.
   - 📝 Follow-up → continue dispatching.

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
12. **Serialising scenarios out of caution.** Symptom: runner dispatches scenarios one at a time even though they're tagged `tmpdir` or `read-only`. Cause: runner ignored the isolation tags. Fix: trust the tags. The cost of a mis-trusted tag is one false positive in the next QA round; the cost of pessimistic serialisation is every QA round taking 5x longer than it should. If the script genuinely under-tags, file that as a 📝 Follow-up against `drive-qa-plan` and run with the cautious schedule *this round only*.
13. **Running `workspace` scenarios in the live workspace.** Symptom: runner skips the `git worktree add` step and runs the planted-file scenario directly in the project root. Cause: runner conflated "the scenario tagged `workspace`" with "execute against the user's checkout". Fix: `workspace` means "needs its own working tree", which the runner manufactures via `git worktree`. The user's actual checkout stays clean throughout the run.
14. **Confusing isolation contexts in artefact paths.** Symptom: `manual-qa-reports/artefacts/F-3/` references a path under a worktree that's been removed by the time someone reads the report. Fix: copy artefacts into the durable `artefacts/F-N/` directory *before* tearing down the source worktree or tmpdir. Worktree paths are ephemeral; artefact directories are durable.
15. **Forgetting `--detach` on `git worktree add`.** Symptom: a `workspace` scenario's worktree is on a branch named after the scenario; if the scenario commits anything, the runner risks accidentally pushing it. Fix: `git worktree add --detach <path> HEAD`. The detach prevents accidental branch-tracking.
16. **Ignoring un-dispatched scenarios in the per-scenario log.** Symptom: report lists 8 of 10 scenarios as ✅ pass and silently omits the 2 that were blocked. Fix: every scenario the script lists appears in the per-scenario log. If un-dispatched, its row says so explicitly with the blocking finding ID.

## What this skill doesn't do

- **Author the script.** That's `drive-qa-plan`. If no script exists, run that first.
- **Modify the script.** Script changes are notes for `drive-qa-plan`, never in-place edits during a run.
- **File the findings as tickets.** The report enumerates findings; ticketing is a separate user decision (sometimes with a separate skill, e.g. a Linear / GitHub Issues filer). The Suggested follow-ups section is the bridge.
- **Decide whether to merge / release.** The report's Verdict is the data point; the merge/release decision is the project owner's call.

## Reference Files

- `drive-qa-plan/SKILL.md` — the sibling skill that authors scripts this one executes. Sibling sections that constrain this skill: scenario shape (Oracle / Preconditions / Failure modes / Restore), failure-mode-vs-severity split, exploratory charter format.
- `skills-best-practices/SKILL.md` — for `description:` matcher discipline and SKILL.md shape conventions.

## Checklist

- [ ] Read the entire script before running anything; noted isolation tags, dependency edges, time budgets.
- [ ] Pre-flight executed verbatim; environment confirmed clean; report skeleton created with runner identity + start timestamp.
- [ ] DAG built from isolation tags + Preconditions; concurrency caps decided (global + `external`); shared read-only clone created; `workspace` scenarios got fresh `git worktree` (with `--detach`); `tmpdir`/`read-only` scenarios got fresh scratch dirs.
- [ ] Ready scenarios dispatched in parallel up to the caps; orchestrator advanced the DAG as scenarios completed.
- [ ] Each scenario's preconditions verified inside its isolation context before running its Steps.
- [ ] Each scenario's oracle noted as a comparison standard, not glossed.
- [ ] Steps run verbatim from the script (copy-paste), never from memory; all commands ran inside the scenario's isolation context.
- [ ] Observed output captured verbatim in the report, not paraphrased.
- [ ] Every scenario's Restore step ran inside its isolation context; `git status` (or equivalent) captured as evidence.
- [ ] Each finding captured *immediately* with artefacts (command, full output, HEAD sha, status, mutated files), copied into `manual-qa-reports/artefacts/F-N/` *before* the source worktree/tmpdir was reclaimed.
- [ ] Each finding classified using the severity rubric — original-bug regressions and failed negative controls always 🛑 Blocker.
- [ ] On 🛑 Blocker: stopped dispatching new scenarios; let in-flight ones complete; un-dispatched scenarios marked "⏸ not dispatched (blocked by F-N)" or "⏸ not dispatched (dependency F-N failed)".
- [ ] Exploratory charter ran within its time budget; remaining ideas filed under Suggested follow-ups.
- [ ] Per-scenario log includes every scenario the script listed, with isolation tag + wallclock + result + finding IDs (or "⏸ not dispatched" with blocking finding ID).
- [ ] Coverage outcome table walks every AC the script's coverage map enumerates; each AC inherits the worst-severity finding from its covering scenarios.
- [ ] Verdict in header matches the worst severity in Findings (Blocker → Fail, High → Fail, Follow-up only → Pass-with-follow-ups, none → Pass).
- [ ] Report saved to `projects/<project>/manual-qa-reports/<YYYY-MM-DD>-<runner>.md`, artefacts under sibling `artefacts/F-N/`.
- [ ] Worktrees torn down with `git worktree remove --force`; tmpdirs cleaned up; user's checkout left clean.
- [ ] Did NOT edit the script in place; script-quality issues filed as 📝 Follow-up findings instead.
