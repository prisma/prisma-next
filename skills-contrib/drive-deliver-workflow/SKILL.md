---
name: drive-deliver-workflow
description: >
  Workflow skill. Pilots a project end-to-end: open the project (health rollup) →
  slice-by-slice (each via drive-build-workflow) → health checks on cadence →
  retros on triggers → mandatory final retro → drive-close-project. Use when a
  project spec + project plan exist and you want the project driven to its
  close-out. Returns when project DoD is met and projects/<project>/ has been
  removed.
metadata:
  version: "2026.5.28"
---

> **Execution mode: orchestrator-direct.** This workflow skill puts you in the
> Orchestrator role (see [`drive/roles/README.md`](../../drive/roles/README.md)).
> Your verbs: **delegate**, **synthesize**, **coordinate**, **decide**, and
> **author** project / slice artifacts directly.
>
> **File-path boundary:** your file writes only land inside
> `projects/<current-project>/`. Writing elsewhere is the signal to **delegate**.
> Reads outside the project directory are fine; writes are not.
>
> **Stop-and-delegate triggers:** if you are about to call `Read` / `Grep` /
> `Glob` on source code, `Shell` for build/test/lint, or `Write` / `StrReplace`
> on a file outside `projects/<current-project>/` — **STOP. Dispatch.** Escape
> hatch (rare, brief, navigational): act directly when no dispatch shape serves
> and the action is one or two tool calls of coordination, not production.

# Drive: Deliver Workflow

Pilots a project from `project spec + plan exist` to `project closed`. Calls atomic + workflow skills as steps in its loop — this skill is the conductor, not the implementer.

```text
project spec + plan exist
        │
        ▼
  open project — drive-check-health (opening rollup)
        │
        ▼
  for each slice in plan order (stack / parallel):
        ├─→ drive-build-workflow  (pilots dispatch loop; auto-opens the slice PR at DoD)
        │       │
        │       └─→ slice merged → drive-check-health (per-slice rollup)
        │                        + drive-run-retro (on triggers from drive-build-workflow)
        │
        └─→ mid-flight scope shift → drive-start-workflow re-triage (promote / demote / discuss)
        │
        ▼
  all slices delivered or deferred
        │
        ▼
  drive-check-health (closing rollup)
        │
        ▼
  drive-run-retro (mandatory final retro per invariant I10)
        │
        ▼
  drive-close-project (verifies project DoD; migrates long-lived docs; deletes projects/<x>/)
```

## Workflow

### Step 1 — Load context + open the project

Read `drive/project/README.md` and `drive/health/README.md` if they exist — they carry the team's project-level conventions (slice-composition patterns, parallel-execution heuristics, status-update cadence, health-check thresholds).

Run `drive-check-health` in **opening-rollup mode**: surface slice progress, drifted slices, dispatch throughput so far (if resuming), calibration signals, recommended next pick. Display the rollup to the operator (interactive) or log to the status surface (unattended).

### Step 2 — Pick the next slice

Per the project plan's stack / parallel ordering:

- A slice is **ready** when its stack dependencies are delivered, its dispatch breakdown is sized, and parallelisation isn't blocked.
- If no slice is ready → surface to operator: blocked-on-input or blocked-on-prerequisite.

### Step 3 — Run the slice

Invoke `drive-build-workflow` on the picked slice. It pilots the dispatch loop and returns when one of:

- **Slice DoD met** — the slice loop has auto-pushed and opened the slice PR autonomously (per `drive-build-workflow`'s own behavioural rules). `drive-deliver-workflow` does **not** halt for an extra operator gate between slice-SATISFIED and PR-open.
- **Stop-condition fired** — design discussion required, assumption falsified, dispatch-INVEST refusal that needs replanning. Escalate to operator via `drive-discussion`; resume on operator-authorised plan amendment.

### Step 4 — On slice merge: health check + maybe retro

- Run `drive-check-health` in **session-bookend mode** after each slice merges. Updates recommended-next-pick + drift signals.
- If `drive-build-workflow` surfaced a retro trigger (dispatch failure, drift event, scope-shift escapee), invoke `drive-run-retro`. The retro is not done until its output lands in a memory-strong surface (canonical skill update / `drive/<category>/README.md` update / ADR).

### Step 5 — Handle mid-flight scope shifts

If the operator or `drive-check-health` detects:

| Signal | Route to | Likely outcome |
|---|---|---|
| Project growing past its spec scope | `drive-start-workflow` (mid-flight) | New project, or separate orphan slice |
| Project shrinking below its spec scope (remaining work fits one PR) | `drive-start-workflow` (mid-flight) | Demote |
| Spec assumption falsified | `drive-discussion` | Spec amendment (per invariant I12 — no silent agent-side amendments) |

Loop back to Step 2 until all slices are delivered or explicitly deferred (in `projects/<project>/deferred.md`).

### Step 6 — Project close

When all slices are delivered or deferred:

1. **Closing `drive-check-health`** — final project-DoD readiness check.
2. **Mandatory final `drive-run-retro`** — surface project-level learnings; land them in canonical surface / project context / ADR. **The retro is not done until the output lands.** Per invariant I10, project DoD requires this retro.
3. **`drive-close-project`** — verifies project DoD (refuses to close if unmet), migrates long-lived docs into `docs/`, strips repo-wide references to `projects/<project>/**`, deletes `projects/<project>/`, marks the Linear Project Completed.

### Step 7 — Return

Project closed: Linear Project Completed; on-disk project artefacts removed; long-lived docs landed in `docs/`.

## Unattended mode

- **Step 3** (per-slice loop) runs unattended per `drive-build-workflow § Unattended mode`.
- **Step 5** mid-flight scope shifts always halt and notify in unattended mode — operator authorisation is required for promote / demote / spec amendment.
- **Step 6** close-out: the final retro requires operator participation (the team-context / ADR judgment calls aren't safe to defer to an agent alone). Halt before `drive-close-project` and notify.

## Pitfalls

1. **Slice picked while its stack dependencies haven't merged.** Symptom: the slice's brief references "the foo helper introduced in slice 3" which doesn't exist yet. Always check stack dependencies before picking.
2. **Health check skipped between slices.** Drift compounds invisibly. The cadence (per `drive/health/README.md` overlays) is per-slice-merge in interactive mode, on-trigger in unattended.
3. **Retro deferred to "later" rather than fired on trigger.** The trigger is the signal; deferring means the next slice runs with the lesson unrecorded.
4. **Mandatory final retro skipped at project close.** Per invariant I10, the retro is part of project DoD. `drive-close-project` refuses to close without it; bypassing the gate breaks the protocol-as-memory loop.
5. **Project close-out that deletes `projects/<project>/` without migrating long-lived docs.** Migration is mandatory; the `docs/`-landing is part of close-out per `drive-close-project`'s checklist.
6. **No mid-flight scope-shift detection.** Symptom: the project grows past its spec scope across multiple slices; nobody re-triages; the project becomes shaped wrong for its actual work. `drive-check-health` is the canonical detection vehicle; this workflow runs it on every slice merge.

## References

- [`drive/project/README.md`](../../drive/project/README.md) — project-level conventions, slice-composition patterns.
- [`drive/health/README.md`](../../drive/health/README.md) — project-health rollup cadence overlays.
- [`drive/retro/README.md`](../../drive/retro/README.md) — mandatory-final-retro mechanics and landing surfaces.
- [`docs/drive/model.md`](../../docs/drive/model.md) § Layer 5 — invariants I10 (mandatory final retro), I12 (no silent agent-side amendments).
- `skills-contrib/drive-build-workflow/`, `drive-check-health/`, `drive-run-retro/`, `drive-close-project/`, `drive-start-workflow/`, `drive-discussion/` — the skills this workflow conducts.
