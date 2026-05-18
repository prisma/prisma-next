---
name: drive-health-check
description: >
  Run a project-health rollup at any of three cadence points: session-bookend (start /
  end), per-slice-merge (after each slice's DoD), or trigger-fired (operator-requested
  or surfaced by drift signals). Surfaces project progress, drifted slices, dispatch
  throughput, scope-shift candidates, and recommended next pick. Atomic skill called by
  drive-deliver-workflow (cadence-driven) or invoked directly. Cadence is operator-set
  in interactive mode; on-trigger in unattended mode.
metadata:
  version: "2026.5.18"
---

# Drive: Health Check

Run a project-health rollup. Atomic skill — does one thing: produces a rollup.

A rollup answers:

- **Where is the project?** Slices delivered, slices in flight, slices not yet started, direct changes done.
- **Where is it drifting?** Dispatches that crossed the M-cap unexpectedly; slices whose PR scope grew past the PR-cap; scope-shift candidates (in-flight unit that should triage as promote / demote).
- **How fast is it going?** Dispatch throughput across the recent window (e.g. dispatches/day; failed-dispatch rate; review-round count distribution).
- **What's the calibration story?** Slice-size predictions vs actuals; retro-trigger frequency; spike outcomes that re-shaped the plan.
- **What should we pick next?** Recommended slice / direct change to pick up, given dependencies, parallelisation, and operator availability.

## When to use

Three canonical cadences (per [`projects/drive-domain-model/workflow.md`](/projects/drive-domain-model/workflow.md) § Project-health rollup cadence):

1. **Session-bookend.** At the start of a Drive session on the project (opening rollup) and at the end (closing rollup). Most common cadence for interactive operators.
2. **Per-slice-merge.** After each slice merges, refresh the rollup before picking the next slice. Surfaces drift between slices.
3. **Trigger-fired.** On operator request OR surfaced by drift signals (a stop-condition in `drive-build-workflow`; an operator-flagged surprise; cron-fired in unattended mode).

**Do not use this skill for:**

- Per-event retrospectives — that's `drive-retro-run`.
- Project close-out verification — that's `drive-close-project` (although the final rollup before close fires here).
- CI / build / test health — different domain; use the team's CI dashboards.
- Cadence-based-only rollups without operator value — health checks have a purpose; if no decisions hang on the rollup, skip it.

## Pre-conditions

- `projects/<project>/spec.md` + `projects/<project>/plan.md` exist (or the orphan slice's equivalents).
- Linear Project (or comparable tracker) exists with issues for the project's slices + direct changes — used to read in-flight + done states without re-parsing PRs.
- Optional: `drive/health/README.md` exists with team-specific rollup template overlays, drift-signal thresholds, and pick-next heuristics.

## Post-conditions

- A rollup document produced (chat output in interactive mode; `projects/<project>/rollups/<timestamp>.md` in unattended mode).
- Drift signals surfaced (each with severity: informational / warning / scope-shift-candidate).
- If a scope-shift candidate fires: a recommendation to invoke `drive-start-workflow` mid-flight for re-triage.
- If a retro trigger fires: a recommendation to invoke `drive-retro-run`.
- Recommended next pick named (one or more candidate slices / direct changes, with rationale).

## Project context

Load `drive/health/README.md` at workflow step 1 if it exists. Look for: rollup template overlays, drift-signal thresholds, pick-next heuristics specific to the team, common false-positives (signals the team has decided to ignore in this repo).

## Workflow

### Step 1 — Load project context

Read `drive/health/README.md` if it exists.

### Step 2 — Gather state

Read:

- `projects/<project>/spec.md` § Project-DoD (for DoD coverage).
- `projects/<project>/plan.md` (for slice composition + sequencing).
- Linear Project state (issue statuses for slices + direct changes; use Linear MCP).
- Recent slice retros (`projects/<project>/retros.md` if present) for context on what's been learned.
- Recent code-review.md round entries for in-flight slices (drift / throughput signals).
- For unattended-mode rollups: `wip/unattended-decisions.md` (decisions the orchestrator made without the operator that the operator should be aware of).

### Step 3 — Compute the rollup

For each section of the rollup template:

#### Progress

- Slices: delivered (count + name), in flight (count + name + state), not started (count + name).
- Direct changes: done (count), in flight (count), not started (count).
- Project-DoD: condition-by-condition state — met / partially met (which slice will finish it) / not addressed.

#### Drift signals

- **Dispatches that crossed the M-cap unexpectedly.** Read recent slice retros + code-review.md round entries. If a dispatch's actual size exceeded prediction by > 50%, flag.
- **Slices whose PR scope grew past the PR-cap.** If a slice's PR diff is > N files / > N LoC (threshold in `drive/health/README.md`), flag — candidate for promote.
- **Slices whose dispatch count exceeded the plan.** If a slice's actual dispatch count is > 2× the planned count, flag — sizing miscalibration or scope creep.
- **Failed-dispatch rate.** If > 30% of recent dispatches required ANOTHER ROUND NEEDED (or worse), flag — calibration issue.
- **Long-running in-flight slice.** If a slice has been in flight for > N days (threshold in `drive/health/README.md`), flag.

Each drift signal carries a severity:

- **Informational** — surface but no action needed.
- **Warning** — pattern emerging; consider retro at next merge.
- **Scope-shift-candidate** — recommend `drive-start-workflow` mid-flight for re-triage.

#### Throughput

- Dispatches/day (or /week) across the rolling window (default 7 days).
- Median dispatch wallclock time.
- Review-round distribution (median rounds-to-satisfied per dispatch).

#### Calibration

- Slice-size predictions vs actuals (S/M predicted; what landed).
- Retro-trigger frequency (1/week ≈ healthy; 0 = check the team's actually firing them; > 3/week = something systemic is off).
- Spike outcomes that re-shaped the plan.

#### Recommended next pick

- Given delivered slices + dependencies + parallelisation, name one or more candidate slices/direct changes to pick up.
- For each: rationale (why this one, why now); operator-availability assumption (if any).
- If the project is blocked (no slice is ready): say so + name the blocker.

### Step 4 — Render the rollup

Interactive mode: display in chat. Unattended mode: write to `projects/<project>/rollups/<timestamp>.md` and emit a notification surface for the operator to read on return.

### Step 5 — Fire downstream skills on triggers

- **Scope-shift candidate** → recommend (or, in unattended mode, halt and surface for) `drive-start-workflow` mid-flight invocation for re-triage.
- **Retro trigger** (dispatch failure / drift event / scope-shift escapee surfaced in the rollup that wasn't already retroed) → recommend `drive-retro-run`.
- **Project-DoD coverage gap** (a DoD condition with no slice that will finish it) → recommend `drive-project-plan` to amend the plan.
- **Recommended next pick** → in interactive mode, present to operator for confirmation; in unattended mode, log and proceed to `drive-build-workflow` on the picked unit if the operator's policy allows.

## Rollup template

```markdown
# Project health rollup: <project-name>
**Cadence:** _<session-bookend / per-slice-merge / trigger-fired (reason)>_
**Date:** _<YYYY-MM-DD HH:MM>_

## Progress
- **Slices delivered:** _N / M_ — _<names>_
- **Slices in flight:** _<names + state>_
- **Slices not started:** _<names>_
- **Direct changes:** _<done / in flight / not started>_
- **Project-DoD coverage:** _<condition-by-condition>_

## Drift signals
- **[severity]** _<signal>_ — _<recommended action>_

## Throughput
- **Dispatches/day:** _N_ (rolling 7d)
- **Median dispatch wallclock:** _<duration>_
- **Median rounds-to-satisfied:** _N_

## Calibration
- **Size prediction accuracy:** _N% predicted-correctly across recent dispatches_
- **Retro-trigger frequency:** _N retros in rolling 7d_
- **Spike-driven re-plans:** _<count + outcomes>_

## Recommended next pick
1. **<slice / direct-change name>** — _<rationale>_
2. _(alternative)_ **<...>** — _<rationale>_

## Triggers
- _<recommended downstream skill invocations from § Step 5>_
```

## Pitfalls

1. **Rollup without action.** A rollup that doesn't change what happens next is theatre. Always include "recommended next pick" + any triggers; if neither fires anything, the rollup wasn't worth running.
2. **Drift signals reported without severity.** Without severity, every signal looks equally urgent; the operator can't prioritise.
3. **Cadence followed without trigger value.** Per-slice-merge rollups are cheap; session-bookend rollups are cheap. Mid-day cron rollups without a drift signal are expensive — only fire them if the project has a high failure rate that benefits from continuous oversight.
4. **Throughput shown without context.** "5 dispatches/day" means nothing without the team's normal range. Anchor in `drive/health/README.md`'s baseline.
5. **Pick-next ignoring dependencies.** If the recommended next pick depends on an in-flight slice, the recommendation is wrong. Always trace dependencies before recommending.
6. **Long-running in-flight slice silently accepted.** If a slice has been in flight for > N days, that's a scope-shift candidate, not just an informational signal. Surface as warning or scope-shift-candidate.

## Checklist

- [ ] Loaded `drive/health/README.md` (if exists)
- [ ] Gathered state from spec / plan / Linear / retros / code-reviews / unattended decisions
- [ ] Computed progress / drift signals / throughput / calibration
- [ ] Severities assigned to each drift signal
- [ ] Rendered rollup (chat OR `projects/<project>/rollups/<timestamp>.md`)
- [ ] Fired downstream skill recommendations per § Step 5
- [ ] Recommended next pick named with rationale

## Related skills

- `drive-deliver-workflow` — fires this skill on session-bookend + per-slice-merge cadences
- `drive-start-workflow` — invoked on scope-shift-candidate signals for mid-flight re-triage
- `drive-retro-run` — invoked on retro triggers surfaced in the rollup
- `drive-project-plan` — invoked on DoD-coverage-gap signals
- `drive-close-project` — fires the closing-rollup as part of close-out
- `drive-bootstrap-context` ([PR #93](https://github.com/prisma/ignite/pull/93)) — seeds `drive/health/README.md` if missing

## References

- [`projects/drive-domain-model/workflow.md`](/projects/drive-domain-model/workflow.md) § Project-health rollup cadence
- [`projects/drive-domain-model/model.md`](/projects/drive-domain-model/model.md) § Layer 4 — Project-health rollup
- [`projects/drive-domain-model/design-decisions.md`](/projects/drive-domain-model/design-decisions.md) § 10 — bookend cadence rationale
