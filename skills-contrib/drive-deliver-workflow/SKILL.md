---
name: drive-deliver-workflow
description: >
  Workflow skill. Pilots a project's lifecycle end-to-end: project init (after
  drive-start-workflow routes to new-project / promote) → slice-by-slice (each via
  drive-build-workflow) → health checks on cadence → retros on triggers → mandatory final
  retro → project close. Use when a project spec + project plan exist and you want the
  project driven to its close-out. Calls drive-create-project, drive-specify-project,
  drive-plan-project, drive-build-workflow, drive-check-health, drive-run-retro,
  drive-close-project.
metadata:
  version: "2026.5.18"
---

# Drive: Deliver Workflow

Pilots a project from project-spec-exists state to project-DoD-met state. Workflow skill — invoked top-down and returns when the project's DoD is met (or the project is closed via explicit close-project call).

> **You are an Orchestrator.** This workflow skill puts you in the Orchestrator role for its entire body (see [`drive/roles/README.md`](../../drive/roles/README.md) for the canonical role definition). Your verbs: **delegate**, **synthesize**, **coordinate**, **decide**, and **author** project / slice artifacts directly.
>
> **File-path boundary:** your file writes only land inside `projects/<current-project>/`. Writing to `src/`, `tests/`, `docs/`, `skills-contrib/`, `drive/`, `.cursor/`, or any other path is the signal that the work must be **delegated** to an Executor with the spec as their input contract. Reads outside the project directory are fine; writes are not.
>
> **Stop-and-delegate triggers:** if you are about to call `Read`/`Grep`/`Glob` on source code, `Shell` for build/test/lint, or `Write`/`StrReplace` on a file outside `projects/<current-project>/` — **STOP. Dispatch.** See [`drive/roles/README.md § DO-NOT enumeration`](../../drive/roles/README.md#do-not-enumeration-for-the-orchestrator) for the full list.
>
> **Escape hatch** (rare, brief, navigational): you may act directly when no dispatch shape serves, the action is a single tool call or two, and the purpose is coordination rather than production. Log the use so the pattern stays visible.

The loop:

```text
project spec + plan exist
        │
        ▼
  for each slice in the plan, in stack/parallel order:
        │
        ├─→ drive-build-workflow  (pilots the slice's dispatch loop to slice DoD)
        │       │
        │       └─→ slice merged → drive-check-health (session-end rollup)
        │
        ├─→ retros fire on triggers from drive-build-workflow
        │       (dispatch failure / drift / scope-shift escapee)
        │
        └─→ drive-check-health fires on slice merges + drift alarms
        │
        ▼
  all slices delivered → drive-check-health (project rollup)
        │
        ▼
  drive-run-retro (mandatory final retro per project DoD invariant I10)
        │
        ▼
  drive-close-project (verifies project DoD; refuses to delete projects/<x>/ if unmet)
```

## When to use

Use **when a project has a spec + plan and you want it driven to delivery**:

- After `drive-start-workflow` routes to "new project" or "promote" and the project spec + project plan have landed.
- When picking up a paused project: the spec + plan exist; you want to resume slice-by-slice execution.

**Do not use this skill for:**

- The dispatch loop inside a single slice — that's `drive-build-workflow`.
- Triaging an entry point or mid-flight scope shift — that's `drive-start-workflow`.
- A project that doesn't have a project plan yet — invoke `drive-plan-project` first (or use `drive-start-workflow` if scoping hasn't happened).

## Pre-conditions

- `projects/<project>/spec.md` exists with: purpose statement, scope boundary, project-DoD.
- `projects/<project>/plan.md` exists with: slice + direct-change composition; stack / parallel sequencing.
- Project DoR has been met (per `drive/spec/README.md` overlays and § Project DoR in `drive-specify-project`).
- An associated Linear Project exists (per `drive-start-workflow`'s new-project / promote setup) — for status tracking.

## Post-conditions

- Every slice in the plan has been delivered (merged) OR explicitly deferred (in `projects/<project>/deferred.md`).
- Project DoD met (per `principles/definition-of-done.md` § Project DoD).
- Mandatory final retro complete (output landed in canonical / `drive/<category>/README.md` / ADR).
- `drive-close-project` has run; `projects/<project>/` has been deleted; long-lived docs migrated.
- Linear Project marked Completed (or Cancelled if demoted mid-flight).

## Project context

Load `drive/project/README.md` at workflow step 1 if it exists. This carries the team's project-level conventions — slice-composition patterns, parallel-execution heuristics, status-update cadence, health-check thresholds. Also load `drive/health/README.md` since this workflow fires health checks on cadence.

## Workflow

### Step 1 — Load project context

Read `drive/project/README.md` + `drive/health/README.md` if they exist.

### Step 2 — Open the project

- Run `drive-check-health` in opening-rollup mode: surface slice progress, drifted slices, dispatch throughput so far (if resuming), calibration signals, recommended next pick.
- Display the rollup to the operator (interactive) or log to status surface (unattended).

### Step 3 — Pick the next slice

Per the project plan's stack / parallel ordering:

- If a slice is ready to start (its dependencies in the stack are delivered, its dispatch breakdown is sized, parallelisation isn't blocked), pick it.
- If no slice is ready, surface to operator: blocked-on-input or blocked-on-prerequisite.

For each picked slice:

### Step 4 — Run the slice via `drive-build-workflow`

Invoke `drive-build-workflow` on the picked slice. It pilots the dispatch loop and returns when the slice's DoD is met (slice merged) or the slice's stop-condition fires (design discussion required; assumption falsified; L/XL refusal that needs replanning).

If `drive-build-workflow` returns with a stop-condition: escalate to operator via `drive-discussion`; resume on operator-authorised plan amendment.

### Step 5 — On slice merge: health check + maybe retro

- Run `drive-check-health` in session-bookend mode after each slice merges (updates the project's recommended-next-pick + drift signals).
- If `drive-build-workflow` surfaced a retro trigger (dispatch failure, drift event, scope-shift escapee), invoke `drive-run-retro`. The retro is not done until its output lands in a memory-strong surface (canonical update / `drive/<category>/README.md` update / ADR).

### Step 6 — Loop to next slice

Return to Step 3. Continue until all slices in the plan have been delivered or explicitly deferred.

### Step 7 — Mid-flight scope shifts

If during the loop the operator (or `drive-check-health`) detects:

- **Project growing past its spec scope** → invoke `drive-start-workflow` in mid-flight mode for re-triage (likely outcome: a new project or a separate orphan slice, depending on the new work's shape).
- **Project shrinking below its spec scope** (remaining work fits one PR) → invoke `drive-start-workflow` in mid-flight mode (likely outcome: **Demote**).
- **Spec assumption falsified** → invoke `drive-discussion`; spec amendment per invariant I12 (no silent agent-side amendments).

### Step 8 — Project close

When all slices in the plan are delivered or deferred:

- Run `drive-check-health` in closing-rollup mode: final project-DoD readiness check.
- Run `drive-run-retro` in mandatory-final-retro mode: surface project-level learnings; land them in canonical / project-context / ADR. **The retro is not done until the output lands.** Per invariant I10, project DoD requires this retro.
- Run `drive-close-project`: verifies project DoD (refuses to close if unmet), migrates long-lived docs into `docs/`, strips repo-wide references to `projects/<project>/**`, deletes `projects/<project>/`, marks the Linear Project Completed.

### Step 9 — Hand off

Return control with: project closed (Linear Project Completed; on-disk artefacts removed; long-lived docs landed in `docs/`).

## Unattended mode

If invoked without an operator session:

- Step 4 can run unattended (dispatch loops run unattended per `drive-build-workflow` § Unattended mode).
- Step 7 mid-flight scope shifts always halt and notify in unattended mode (operator authorisation required for promote / demote / spec amendment).
- Step 8 close-out: the final retro requires operator participation (the team-context / ADR judgment calls aren't safe to defer to an agent alone); halt before close-project in unattended mode and notify.

## Pitfalls

1. **Slice picked while its dependencies in the stack haven't merged.** Symptom: the slice's brief references "the foo helper introduced in slice 3" which doesn't exist yet. Always check stack dependencies before picking.
2. **Health check skipped between slices.** Drift compounds invisibly. The cadence (per `drive/health/README.md` overlays) is per-slice-merge in interactive mode, on-trigger in unattended.
3. **Retro deferred to "later" rather than fired on trigger.** The trigger is the signal; deferring means the next slice runs with the lesson unrecorded.
4. **Mandatory final retro skipped at project close.** Per invariant I10, the retro is part of project DoD. `drive-close-project` refuses to close without it; bypassing the gate breaks the protocol-as-memory loop.
5. **Project close-out that deletes `projects/<project>/` without migrating long-lived docs.** Migration is mandatory; the `docs/`-landing is part of close-out per `drive-close-project`'s checklist.
6. **No mid-flight scope-shift detection.** Symptom: the project grows past its spec scope across multiple slices; nobody re-triages; the project becomes shaped wrong for its actual work. `drive-check-health` is the canonical detection vehicle; this workflow runs it on every slice merge.

## Checklist

- [ ] Loaded `drive/project/README.md` + `drive/health/README.md` (if exist)
- [ ] Opening `drive-check-health` ran; rollup surfaced
- [ ] Slice-by-slice loop: each slice's `drive-build-workflow` ran to DoD or stop-condition
- [ ] `drive-check-health` ran after each slice merge
- [ ] `drive-run-retro` fired on every retro trigger from `drive-build-workflow`
- [ ] Mid-flight scope shifts handled via `drive-start-workflow` re-triage
- [ ] Closing `drive-check-health` ran; project DoD ready
- [ ] Mandatory final `drive-run-retro` ran; output landed in memory-strong surface
- [ ] `drive-close-project` ran; project closed; Linear Project Completed

## Related skills

- `drive-start-workflow` — routes the entry point that produced this workflow's project; also handles mid-flight scope shifts during this workflow
- `drive-build-workflow` — pilots each slice's dispatch loop; this workflow calls it in a loop
- `drive-check-health` — opening / closing rollups + per-slice-merge cadence + drift detection
- `drive-run-retro` — fires on triggers from `drive-build-workflow` + mandatory at project close
- `drive-close-project` — final atomic skill at project close; verifies project DoD
- `drive-create-deployment-plan` — called by this workflow when the project ships a deployable artefact
- `drive-post-update` — periodic project status updates (Linear / wider team) on operator-set cadence
- `drive-discussion` — fires on scope-shift / assumption-falsification triggers during the loop

## References

- [`drive/project/README.md`](../../drive/project/README.md) — project-level conventions, slice-composition patterns
- [`drive/health/README.md`](../../drive/health/README.md) — project-health rollup cadence overlays
- [`drive/spec/README.md`](../../drive/spec/README.md) — project DoR / DoD authoring overlays
- [`drive/retro/README.md`](../../drive/retro/README.md) — mandatory-final-retro mechanics and landing surfaces
- [`drive/README.md`](../../drive/README.md) — protocol-as-memory; operators can run atomic skills manually without this workflow
