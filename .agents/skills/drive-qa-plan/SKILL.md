---
name: drive-qa-plan
description: Author a manual-QA script (markdown document) that accompanies a spec, exercises the system end-to-end the way a real user would, and probes behaviour CI cannot meaningfully cover. Use when a spec has shipped (or is about to) and the implementer asks for a "manual QA script", "QA walkthrough", "manual test plan", "QA checklist", or "manual regression doc", or when a user surfaced a bug that needs a re-enactment scenario beyond the unit-test gates that fix it. Authoring only; executing the script and writing the run report is the `drive-qa-run` skill's job.
---

# Write a manual QA script

> **Manual QA does not run our tests. It does what a user would do, watches what they would see, and judges what tests can't.**

A good manual-QA script is a structured accompaniment to a spec: it walks a human through the live system the way a user would drive it, and surfaces failures CI cannot catch (diagnostic clarity, end-to-end journey breaks, regressions of the original-bug-report flow, gate-of-gate sanity). It is **not** a checklist of `pnpm test` invocations dressed up in prose, and it is **not** the record of a particular QA pass — the latter is the *report*, produced by the runner skill against this script.

## When to Use

- A spec just shipped (or is shipping) and the implementer asks for "manual QA", "a QA script", "a QA walkthrough", or "a manual test plan" to accompany it.
- A user-reported bug has been fixed and you need a documented re-enactment of the originally-failing flow alongside the regression tests.
- A guardrail (lint, strict throw, CI job) was added by a PR and you need to document how a human verifies it actually gates regressions, not just that it passes today.
- A change touched a developer-facing CLI / SDK / UI and you want a journey-level smoke test alongside the unit + e2e tests.

## When Not to Use

- You're *executing* an existing manual-QA script and writing the run report. → `drive-qa-run`.
- You're writing **unit, integration, or e2e tests**. Those are CI artefacts; this skill is for the human-driven accompaniment. If the scenario can be expressed cleanly as a test, write the test instead.
- You're writing a **release runbook** or **deployment checklist** (operational, not behavioural). Different shape.
- The spec is purely internal-refactor with no user-observable surface change. There may be nothing for manual QA to add; say so explicitly and skip.
- The change has no spec or acceptance criteria yet. A QA script without ACs is a free-text test plan, not a verifiable accompaniment — get the spec first.

## Key Concepts

- **Script vs report.** This skill produces the *script* — the durable test plan that lives alongside the spec and is re-run on every relevant change. The report (what was found, severity-classified, with reproduction artefacts) is produced by `drive-qa-run` per execution. Conflating the two leads to scripts that pre-classify findings before they're observed and scripts that get edited destructively when a QA round fills them in.
- **Manual QA's comparative advantage over CI is judgement, not throughput.** CI checks exit codes and structural shapes. Humans judge diagnostic clarity, output legibility, whether a generated file *looks right*, whether the developer journey *feels right*. Scenarios should call out what the QA person is *looking at*, not just what they're *running*.
- **Re-enact the motivating bug report.** If the spec exists because of a specific user-reported failure, the script must include the literal CLI / UI flow that produced it, against the artefacts that produced it. This is the strongest possible "did we fix what was reported" check and the one CI cannot credibly own (CI never saw the failure, otherwise it wouldn't have shipped).
- **Negative controls are the only honest way to prove a guard.** When a spec adds a gate (a strict throw, a lint, a CI job that fails on regression), running the gate against today's clean tree only proves CI did its job. The user-meaningful version is to *plant a violation, observe the gate fire with a useful diagnostic, restore*. This is the one legitimate place a QA scenario executes something the PR shipped — and it's exercising the gate's gate-ness, not its coverage of today's tree.
- **Name the oracle for every scenario.** The oracle is the source-of-truth you're comparing observed behaviour against. Tests have implicit oracles (the assertion). Manual scenarios benefit from making the oracle explicit: without it, "did the CLI output look right?" is unfalsifiable. Common oracles: the spec's stated behaviour, the file the user just authored, the originally-failing flow's expected response, the rule file as a fresh-developer would read it.
- **Exploratory charters catch what scripts can't.** Scripted scenarios catch *known unknowns* — failure modes the author anticipated. **Exploratory** scenarios (charter + time-box) catch *unknown unknowns* by inviting the runner to probe combinations the script didn't enumerate. Every non-trivial QA script should include at least one charter-style scenario.
- **State + cleanup discipline is explicit.** Manual QA mutates DBs, files, sometimes processes. Every scenario that touches state must state its restoration step and a `git status` (or equivalent) check so the QA round doesn't leave the tree dirty for the next reader.
- **Negative-control scenarios state their coverage boundary.** Proving a guard fires on one corrupted input only proves the gate works for that instance. The scenario must explicitly name the class boundary it covers and what's outside ("this proves the strict throw fires on a missing `kind`; it does not prove every possible malformed shape is rejected — only the one we constructed").
- **Be honest about coverage gaps.** Not every AC has a meaningful manual-QA scenario. Marking ACs as N/A with a one-line rationale ("pure unit-test infrastructure; CI covers it") is better than padding the script with scenarios that re-run tests to keep the matrix full. The N/A entries are part of the script's contract.
- **TOC-first structure.** Readers should grasp scope in the first ~50 lines. Provide a table of contents up front that summarises each scenario in one line and names the ACs it covers — so a reader can decide what to skip without scrolling.
- **The reader does not have the spec open.** A QA runner picking up the script weeks later, or a reviewer skimming the PR, needs the *minimum context to make the scenarios legible* embedded in the script itself. That's the "What this script is testing" block — bug + fix + manual-QA-vs-CI delta — derived from the spec's Summary so the reader isn't forced to context-switch to a separate doc just to know what's being tested. A link to the spec is not a substitute; it is the source the section is derived from.

## The litmus test for every scenario

Before adding a scenario, ask:

> **"What does this scenario let a human catch that CI can't?"**

If the answer is "nothing" — if it's "run our tests and check they're green" or "re-run our lint against the clean tree" — the scenario does not belong in the script. The six legitimate answers are:

1. **Re-enacts the originally-failing user flow** against real artefacts (CI doesn't have the bug surface; that's why the bug shipped).
2. **Negative control for a guardrail** (plant a violation, observe the gate fire, restore).
3. **Observable-quality judgement** the test can't easily assert (diagnostic copy, output legibility, file-shape inspection).
4. **End-to-end developer-journey smoke** (multi-command sequence the user would actually run, not the synthetic seam a test exercises).
5. **Human read of durable docs / rule files** for coherence and currency.
6. **Exploratory probe** of unanticipated state combinations (charter + time-box; surfaces unknown unknowns).

If a scenario doesn't fall into one of those buckets, write a test instead.

## Document skeleton (TOC-first)

Every manual-QA script follows this structure. Aim for ~300–500 lines for a single-PR-sized spec; longer specs split into multiple scripts (one per milestone) rather than one giant file.

```markdown
# Manual QA — <TICKET-ID> (<short title>)

> **Be the user.** <One-line frame for the doc: what the reader is doing.>
>
> **Out of scope of this script.** <Explicit list of what NOT to do — re-run our tests, re-run CI lints against clean tree, etc.>
>
> **Spec:** `<path>`
> **Plan:** `<path>` (if any)
> **PR:**  `<URL>`

## What this script is testing

**The bug / motivation.** <One paragraph derived from the spec's Summary / Background: what was broken, what user-facing flow triggered it, and why it shipped. If this work isn't fixing a bug, replace with "**The change**: <what behaviour this PR adds or alters and what user-facing surface it touches>".>

**The fix / what changed.** <One short paragraph or a numbered list — 3–5 bullets max — of the substantive changes the PR makes, in the *user's* mental model, not the implementer's. "We added a strict throw at the deserializer and a lint that rejects the bypass pattern" not "we removed line 129 of `sql-storage.ts`".>

**Why manual QA matters here.** <One paragraph naming the specific gaps the scripted tests / CI cannot meaningfully close — the things a human's judgement is the only honest oracle for. This is the bridge between the spec and the litmus test; every scenario below should target one of the gaps named here.>

## Table of contents

| # | Scenario | What it proves | Covers |
| - | -------- | -------------- | ------ |
| 1 | <Short verb-phrase title> | <One-line user-facing claim> | AC-1, AC-4 |
| 2 | <…> | <…> | AC-2 |
| N | Exploratory: <charter> | Probe unanticipated states | (no AC; charter) |

> Scenarios marked **(negative control)** plant a violation, observe the gate fire, then restore. Scenarios marked **(judgement)** require human evaluation that no test can assert. Scenarios marked **(exploratory)** are time-boxed charters with no scripted steps.

## Pre-flight

<Numbered list of setup steps + a clean-tree baseline check.>

## Scenario 1 — <Verb-phrase title>

**What you're proving from the user's seat:** <One paragraph; tie back to the litmus test.>

**Covers:** AC-N (, AC-M)

**Oracle:** <The source-of-truth you're comparing observed behaviour against. Examples: "the `end-contract.json` written in step 4 should structurally match the strict-shape schema in `validators.ts`"; "the diagnostic should name the entry by the name in `contract.prisma:23`"; "exit code should match the originally-passing run on `main`".>

**Preconditions:**
- <Environment / state requirements>
- <Prereq scenarios, if any>

### Steps

<Numbered, copy-pasteable shell commands or UI actions. Real, not sketched.>

### What you should see

- <Observable 1>
- <Observable 2 — call out what the human is *looking at*, not just exit codes>

### Failure modes (anything matching these = a finding the runner will classify)

- <Failure-mode category 1; do NOT pre-classify severity — that's the runner's job>
- <Failure-mode category 2>

### Restore (if scenario mutates state)

<Restoration steps + `git status` check.>

## Scenario N — Exploratory: <charter statement>

**Charter.** <"Explore <target> with <resources> to discover <information>." E.g. "Explore the `migration` CLI surface with the demo contract for 30 minutes; discover behaviours that surprise you, diagnostics that read poorly, or state combinations the scripted scenarios skipped.">

**Covers:** (no specific AC; surfaces unknowns)

**Time budget:** <e.g. 30 minutes>. Stop when the timer rings even if you have ideas left — log them as candidate scenarios for a future round.

**Notes capture:** Write what you tried, what surprised you, and anything that "felt off" but you can't yet name. Findings get classified in the report the same way scripted-scenario findings do.

## Scenarios deliberately not in this script

| AC | Why it's not a manual-QA scenario |
| -- | --------------------------------- |
| AC-X | <One-line rationale, usually "CI covers it; re-running here adds nothing"> |

## Sign-off coverage map

| AC ID | Scenario(s) covering it |
| ----- | ----------------------- |
| AC-1  | 1, 3                    |
| AC-N  | (CI; not manual-QA scope) — see "Scenarios deliberately not in this script" |
```

The sign-off coverage map shows *which* scenarios cover *which* ACs. Result columns (pass/fail/N/A) are filled in by the runner's report, not by the script.

## Workflow

### 1. Read project context

Before anything else, load this project's drive `qa` context. Read `drive/qa/README.md` at the repo root.

**Hard-error contract.** If `drive/qa/README.md` does not exist, do not proceed. Tell the operator the file is missing and offer to invoke `drive-bootstrap-context` inline (or ask them to run it). The README captures project-specific facts the generic skill cannot know — consumer audiences, substrate locations, known coverage-gate gaps, the fixture catalogue — and every subsequent step depends on them. Proceeding without it produces scripts that miss whole audiences or paper over known gate gaps.

If the README exists but a project-specific fact you need is missing or stale, surface it now. When the run completes, append the new facts to `drive/qa/README.md` (see the Checklist) so the next run inherits them.

### 2. Read the spec, the plan, and the PR diff

Before drafting, anchor on:

- **The acceptance criteria.** These are the rows of the sign-off coverage map. If the spec doesn't list them in a numbered/IDed form, ask the implementer to add them before writing QA — a QA script without enumerable ACs is unverifiable.
- **The originally-failing flow (if any).** If the spec opens with "user reported X crashes when doing Y", that flow becomes a dedicated scenario.
- **The guardrails the PR shipped.** Strict throws, lints, CI jobs — each one earns a negative-control scenario with an explicit coverage-boundary statement.
- **The user-facing surfaces touched.** CLIs, UIs, generated files. These are the journey-test surface.

Locate the example app or demo the user would actually exercise. Manual QA against synthetic fixtures is a code smell — if the spec is about a CLI, find the demo that uses the CLI; if it's about an SDK, find the example that imports the SDK.

### 3. Inventory candidate scenarios against the litmus test

For each AC and each guardrail in the PR, ask "what does manual QA let a human catch that CI can't?". Map each AC to one of:

- A user-facing scenario from the six legitimate answers (re-enactment, negative control, judgement, journey smoke, durable-doc read, exploratory probe).
- An **N/A** with a rationale (it's pure unit-test infrastructure, or a lint over today's clean tree, or anything else where CI is the natural enforcement seam and the human adds nothing).

It is *correct and expected* for some ACs to come out N/A. If you find you've labelled every AC with a scenario, re-check — you've probably padded the script with "run our tests" rituals.

### 4. Draft the TOC first

Write the TOC table before any scenario body. It forces the script into a one-line-summary-per-scenario shape and lets you sanity-check coverage at a glance. The columns are mandatory: number, scenario name (verb phrase), one-line claim, AC IDs covered. If two TOC rows would have the same one-line claim, you have one scenario with two write-ups — collapse them.

### 5. Write the "What this script is testing" block before the scenarios

Derive it from the spec's Summary / Background. Three paragraphs (or short blocks):

1. **The bug / motivation** — what was broken (or what behaviour the PR adds), described in the user's mental model, not the implementer's. If the spec opens with an originally-failing flow, name the exact flow and the error the user saw.
2. **The fix / what changed** — the substantive changes in 3–5 bullets, framed by user-observable surface ("we now throw a strict diagnostic at the deserializer"), not by file/line ("we removed line 129 of `sql-storage.ts`").
3. **Why manual QA matters here** — the specific gaps that scripted tests / CI cannot meaningfully close. This is the bridge between the spec's intent and the script's litmus test; every scenario you write should target one of the gaps you name in this paragraph.

If you find yourself unable to write paragraph 3 — i.e. you can't name a gap that CI doesn't already cover — that's a signal the entire script may be redundant. Re-read the "When Not to Use" section.

### 6. Write each scenario in the canonical shape

Each scripted scenario has exactly these subsections, in this order:

1. **What you're proving from the user's seat** — one paragraph; tie it back to one of the six litmus-test answers.
2. **Covers** — AC IDs.
3. **Oracle** — the source-of-truth comparison standard. Especially load-bearing on judgement scenarios.
4. **Preconditions** — environment + state + prereq scenarios. Bulleted, scannable.
5. **Steps** — numbered, copy-pasteable, real. No sketches like "run the CLI command" — paste the actual command.
6. **What you should see** — observables, including what the human is *looking at*. Call out diagnostic copy, file shape, output legibility — anything tests can't easily assert.
7. **Failure modes** — explicit failure categories that constitute a finding. **Do not pre-classify severity** — severity is a property of *what was found* in a runtime context, and it belongs in the runner's report.
8. **Restore** (if and only if the scenario mutates state) — restoration steps + a `git status` check.

For exploratory scenarios, the shape is different: charter, covers, time budget, notes-capture instruction. No steps, no failure modes (the runner discovers them).

### 7. Add the "Scenarios deliberately not in this script" table

This is load-bearing. It documents which ACs you chose *not* to cover and why. A future reader (or a different QA round) will check it before assuming a coverage gap means an oversight.

Common entries:

| AC kind | Typical rationale |
| ------- | ----------------- |
| "All unit/integration tests pass" | CI runs this on every push. Re-running locally proves only your machine matches CI. |
| "Lint over today's tree is clean" | Re-running the lint against the current branch only proves CI did its job. See the negative-control scenario for the user-meaningful version. |
| "Fixtures exist on disk" | Pure test infrastructure. `ls`-ing the fixture directory is not a QA pass. |
| "Type-check passes" | Same. Compile-time gate, not a user observation. |

### 8. Build the sign-off coverage map

The coverage map mirrors the TOC's AC mapping verbatim. Every AC appears exactly once. N/A rows point at the "deliberately not in this script" table. **No result column** — the report owns results.

### 9. Place the script in the canonical location

By convention this repo's project artefacts live at `projects/<project-name>/`. Manual-QA scripts go at `projects/<project-name>/manual-qa.md`. If the project has multiple milestones with materially different QA shape, prefer `projects/<project-name>/manual-qa/<milestone>.md` and link them from a slim index. Reports (one per QA pass) accumulate at `projects/<project-name>/manual-qa-reports/<YYYY-MM-DD>-<runner>.md` — owned by `drive-qa-run`.

## Common Pitfalls

1. **Conflating script with report.** Symptom: severity tags ("blocker", "high") on failure modes in the script; a "Result" column in the sign-off matrix; the doc gets edited destructively when a QA round fills it in. Fix: severity belongs in the runner's report; the script enumerates failure-mode *categories*, not severities. Results never live in the script.
2. **The "re-run the test suite" antipattern.** Symptom: every scenario's "Steps" is a single `pnpm test ...` invocation. Cause: the author treated the script as a CI checklist rather than a user walkthrough. Fix: apply the litmus test to each scenario; delete any whose answer is "nothing — CI covers it" and add the rationale to the "deliberately not in this script" table.
3. **Gate over today's clean tree masquerading as a QA scenario.** Symptom: a scenario "verifying the lint" that runs `pnpm lint:foo` and asserts exit 0. Fix: convert to a negative control — plant a violation, observe the gate fire, restore. Add the coverage-boundary statement so the reader knows which slice of the bug class the scenario actually probes.
4. **Missing oracle.** Symptom: "What you should see" lists outputs but doesn't say what to compare them against. Worst on judgement scenarios where "looks right" is in the eye of the beholder. Fix: every scenario names its oracle explicitly. If you can't name one, the scenario isn't probing anything falsifiable and is probably a test in disguise.
5. **No observation hooks.** Symptom: scenario lists commands but its "What you should see" is "no errors". Fix: name the specific things the human is looking *at* — the diagnostic copy, the file shape, the output legibility. The oracle tells the runner what to compare; "what you should see" tells them where to look.
6. **Missing preconditions.** Symptom: a scenario implicitly assumes a previous one ran, or assumes an env var is set, with no callout. Fix: every scenario's preconditions are explicit and bulleted. If a scenario truly depends on the previous one, name it in the preconditions list.
7. **Missing restore step.** Symptom: a scenario mutates `.env`, the demo DB, or a tracked file, and doesn't say how to put it back. Fix: every state-mutating scenario ends with explicit restoration + a `git status` check.
8. **Pretending every AC has a meaningful manual scenario.** Symptom: the coverage map has zero N/A rows and one of the scenarios is "verify type-check passes". Fix: honest N/A is better than padded scenarios.
9. **TOC written after the scenarios.** Symptom: the TOC row summaries don't match the scenario bodies, or rows are missing. Cause: TOC was bolted on at the end. Fix: write TOC first; scenarios are the expansion.
10. **No exploratory scenario.** Symptom: the script enumerates everything the author thought of; nothing invites the runner to look beyond. Fix: add at least one charter scenario with a time budget. Unknown unknowns are the whole point of charters.
11. **Pre-classifying severity in failure modes.** Symptom: "Red flag (blocker): the original bug returns". Fix: the script-author doesn't know the runtime context (release stage, blast radius, surrounding changes) at execution time. Enumerate the failure category; let the runner classify in the report.
12. **Using `wip/` for the script.** Symptom: the file lands at `wip/manual-qa.md`. Cause: the author treated it as scratch. Fix: manual-QA scripts are durable artefacts that ship alongside the spec — they belong in `projects/<project>/` (tracked) and travel with the PR. `wip/` is gitignored and the script would vanish.
13. **Spec link without spec summary.** Symptom: the script jumps from the frame block straight to the TOC, with only a `**Spec:** <path>` link. A reader who hasn't opened the spec sees a TOC of scenarios with no context for *why* they exist. Fix: write the "What this script is testing" block (bug + fix + manual-QA-vs-CI delta), derived from the spec's Summary. The link to the spec stays — but it points at the source the section was derived from, not at a doc the reader has to context-switch into.
14. **Skipping the project-context read** or **not writing back surfaced facts**. Symptom: the script reaches scenario authoring without a consistent view of the project's audiences / substrates, OR a fact the operator had to feed mid-skill never makes it back to `drive/qa/README.md`. The next run repeats the same correction loop. Fix: step 1 is non-negotiable — if the file is missing, stop and bootstrap. At the end of the run, audit for project-specific facts that surfaced; append any to `drive/qa/README.md` so the next run inherits them.

## What this skill doesn't do

- **Execute the QA itself.** This skill produces the script; `drive-qa-run` drives it and produces a report. Keep them separate.
- **Generate ACs from a spec that lacks them.** If the spec has no enumerable acceptance criteria, ask the implementer to add them first.
- **Replace the spec's own test-design table.** The plan's "Test Design" table (AC × TC × test type) is for the automated suite. The manual-QA script is the human-driven accompaniment, not a substitute.
- **Classify findings or own pass/fail outcomes.** Severity classification, finding capture, and verdict assembly live in the runner skill's report.

## Reference Files

- `drive-qa-run/SKILL.md` — the sibling skill that executes scripts produced by this one and writes the report.
- `skills-best-practices/SKILL.md` — for `description:` matcher discipline, the SKILL.md skeleton conventions, and the "What X doesn't do yet" pattern.

## Checklist

- [ ] Read `drive/qa/README.md` before starting; if missing, ran `drive-bootstrap-context` and filled in audiences / substrates / gate gaps before authoring scenarios.
- [ ] Script lives at `projects/<project-name>/manual-qa.md` (or per-milestone equivalent), not `wip/`.
- [ ] First page gives a reader the full scope: frame paragraph + "Out of scope of this script" + spec/plan/PR links + **"What this script is testing"** block + TOC table.
- [ ] **"What this script is testing"** has three blocks — bug/motivation, fix/what changed, why manual QA matters — and is derived from the spec's Summary, not a stand-in link.
- [ ] TOC table has one row per scenario with: number, verb-phrase title, one-line claim, AC IDs covered.
- [ ] Every scripted scenario has all seven sections: What you're proving, Covers, **Oracle**, **Preconditions**, Steps, What you should see, Failure modes (+ Restore if state-mutating).
- [ ] At least one **exploratory charter** scenario with a time budget.
- [ ] Every scenario passes the litmus test ("what does this let a human catch that CI can't?") with one of the six legitimate answers.
- [ ] At least one scenario re-enacts the originally-failing user flow if the spec opened with a bug report.
- [ ] Every guardrail added by the PR (strict throw, lint, CI job) has a negative-control scenario with a **coverage-boundary statement**.
- [ ] Every state-mutating scenario has an explicit restore step + `git status` check.
- [ ] "Failure modes" sections enumerate categories only — **no severity pre-classification** anywhere in the script.
- [ ] "Scenarios deliberately not in this script" table documents every N/A AC with a one-line rationale.
- [ ] Sign-off coverage map has every AC appearing exactly once; **no result column** (results live in the report).
- [ ] Did NOT include any scenario whose body is "re-run our test suite and confirm it's green."
- [ ] At the end of the run, audited for project-specific facts that surfaced during authoring; appended any to `drive/qa/README.md` so the next run inherits them.
