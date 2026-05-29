---
name: drive-check-health
description: >
  Run a project-health rollup at one of three cadence points: session-bookend
  (start / end), per-slice-merge (after each slice's DoD), or trigger-fired
  (operator-requested or surfaced by drift signals). Surfaces progress, drift
  signals, dispatch throughput, calibration story, and recommended next pick.
  Atomic skill — primary output is the rollup. Downstream skill recommendations
  are surfaced; auto-invoke only in unattended mode with operator policy.
metadata:
  version: "2026.5.28"
---

> **Execution mode: orchestrator-direct.** Atomic skill invoked by the Orchestrator
> directly. Outputs land in `projects/<current-project>/rollups/` or the
> conversation surface. If the body would require running builds/tests or
> writing files outside `projects/<current-project>/` — **STOP. Dispatch.** See
> [`drive/roles/README.md`](../../drive/roles/README.md).

# Drive: Check Health

A rollup answers five questions:

- **Where is the project?** Slices delivered / in flight / not started; direct changes done.
- **Where is it drifting?** Dispatches that failed dispatch-INVEST in flight; slices that failed slice-INVEST (coherence broke down); scope-shift candidates.
- **How fast is it going?** Dispatch throughput, failure rate, review-round distribution.
- **What's the calibration story?** Predictions vs actuals; retro-trigger frequency; spike outcomes that re-shaped the plan.
- **What should we pick next?** Recommended slice / direct change, given dependencies, parallelisation, and operator availability.

The rollup template lives at [`./templates/rollup.template.md`](./templates/rollup.template.md). Fill it; don't author from scratch.

## Cadences

Three canonical cadences (team overlays in `drive/health/README.md`):

| Cadence | When | Mode |
|---|---|---|
| **Session-bookend** | Start + end of a Drive session on the project | Most common in interactive |
| **Per-slice-merge** | After each slice merges, before picking the next | Surfaces drift between slices |
| **Trigger-fired** | Operator request OR a `drive-build-workflow` stop-condition OR cron-fired in unattended | On-demand |

**Skip the rollup if no decisions hang on it.** Health checks have a purpose — cadence without trigger value is theatre.

## Workflow

### Step 1 — Load context

Read `drive/health/README.md` if it exists. Look for rollup template overlays, drift-signal thresholds specific to the team, pick-next heuristics, common false-positives (signals the team has decided to ignore in this repo).

### Step 2 — Gather state

Read:

- `projects/<project>/spec.md § Project-DoD` (for DoD coverage).
- `projects/<project>/plan.md` (for slice composition + sequencing).
- Linear Project state (issue statuses for slices + direct changes; use Linear MCP).
- Recent slice retros (`projects/<project>/retros.md` if present) for context on what's been learned.
- Recent `code-review.md` round entries for in-flight slices (drift / throughput signals).
- Unattended-mode rollups: also read `wip/unattended-decisions.md` for decisions the orchestrator made without the operator that the operator should be aware of.

### Step 3 — Compute the rollup

Fill the sections of [`./templates/rollup.template.md`](./templates/rollup.template.md).

**Drift signals.** Look for:

- **Dispatches that failed dispatch-INVEST in flight** — outcome fuzzier than the brief named, or scope expanded beyond the brief. Likely sizing miscalibration or under-specified outcome.
- **Slices that failed slice-INVEST in flight** — coherence broke down (a reviewer can't hold the PR's concerns together; the dispatch sequence drifted across unrelated outcomes). Candidate for promote.
- **Slices whose dispatch count exceeded the plan** — if actual > 2× planned, flag.
- **Failed-dispatch rate** — > 30% of recent dispatches required ANOTHER ROUND NEEDED (or worse) → calibration issue.
- **Long-running in-flight slice** — > N days (threshold in `drive/health/README.md`) → surface as warning or scope-shift-candidate.

Assign severity per signal:

- **Informational** — surface but no action needed.
- **Warning** — pattern emerging; consider retro at next merge.
- **Scope-shift-candidate** — recommend `drive-start-workflow` mid-flight for re-triage.

### Step 4 — Render the rollup

Interactive: display in chat. Unattended: write to `projects/<project>/rollups/<timestamp>.md` and emit a notification surface for the operator to read on return.

> **Emit `health-check-fired`:** Fields: `cadence` (`"opening-rollup" | "per-slice-merge" | "closing-rollup" | "session-bookend" | "trigger-fired"` — read from the invoking context; whichever cadence point called this health check), `drift_signal_count` (integer ≥ 0 — total drift signals surfaced in this rollup), `max_drift_severity` (`"none" | "low" | "medium" | "high"` — the highest-severity signal in the rollup), `recommended_next` (string describing the recommended next pick, or `null` if none), plus envelope fields (`event_id`, `schema_version: "1"`, `ts`, `project_run_id`, `orchestrator_agent_id`). See the `drive-record-traces` skill — `events.md` § `health-check-fired` for the payload schema and `emission.md` § Append protocol for the file-append mechanics.

### Step 5 — Downstream skill recommendations (policy-gated)

The rollup is complete after Step 4. This step **recommends only** unless unattended policy explicitly allows auto-invoke:

| Signal | Recommend | Unattended |
|---|---|---|
| Scope-shift candidate | `drive-start-workflow` for mid-flight re-triage | Halt and surface unless policy permits auto-invoke |
| Retro trigger (not already retroed) | `drive-run-retro` | Auto-invoke OK |
| Project-DoD coverage gap | `drive-plan-project` to amend the plan | Surface |
| Recommended next pick | Present for operator confirmation | Log and proceed to `drive-build-workflow` only if operator policy allows |

## Pitfalls

1. **Rollup without action.** A rollup that doesn't change what happens next is theatre. Always include "recommended next pick" + any triggers; if neither fires anything, the rollup wasn't worth running.
2. **Drift signals reported without severity.** Without severity, every signal looks equally urgent; the operator can't prioritise.
3. **Cadence followed without trigger value.** Per-slice-merge rollups are cheap; session-bookend rollups are cheap. Mid-day cron rollups without a drift signal are expensive — only fire them if the project has a high failure rate that benefits from continuous oversight.
4. **Throughput shown without context.** *"5 dispatches/day"* means nothing without the team's normal range. Anchor in `drive/health/README.md`'s baseline.
5. **Pick-next ignoring dependencies.** If the recommended next pick depends on an in-flight slice, the recommendation is wrong. Always trace dependencies.
6. **Long-running in-flight slice silently accepted.** If a slice has been in flight for > N days, that's a scope-shift candidate, not just an informational signal.

## References

- [`./templates/rollup.template.md`](./templates/rollup.template.md) — the fillable rollup template.
- [`drive/health/README.md`](../../drive/health/README.md) — project-health cadence overlays, drift thresholds, pick-next heuristics.
- [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md) — INVEST at three altitudes (dispatch / slice / project), referenced by the drift signals.
- `skills-contrib/drive-deliver-workflow/`, `drive-run-retro/`, `drive-start-workflow/`, `drive-plan-project/`, `drive-close-project/` — the skills this rollup recommends downstream.
