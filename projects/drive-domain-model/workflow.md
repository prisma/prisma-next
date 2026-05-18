# Drive ↔ Agile Workflow Map

This file is the spine for the rest of this methodology project. Every subsequent doc (DoR, DoD, brief discipline, retro, role mapping) refers back to it; every new or augmented skill plugs into a phase named here.

## Framing

Drive is a **Kanban-shaped process with selected Scrum, XP, and Specification-by-Example rituals layered on**. Naming the lineage explicitly is load-bearing — it sets expectations about what we are and aren't adopting from each tradition:

- **Kanban (the substrate).** Continuous flow over sprint cadence; WIP limits as a structural rule (the size cap is our WIP-shape rule); pull over push; throughput as the diagnostic; explicit policies. This matches `drive-process.md`'s existing posture (no sprints, project throughput as the unit, WiP as a diagnostic).
- **Scrum (selected rituals).** Definition of Ready + Definition of Done as living team artefacts; retros as the team's learning ritual; relative estimation; explicit role taxonomy. We do **not** adopt sprints, story-point velocity-as-commitment, sprint planning ceremonies, or sprint-boundaried retros — those are calendar-based rituals incompatible with continuous flow.
- **XP (selected practices).** Pair-style continuous WIP inspection during a dispatch; spikes as a first-class dispatch type; tests-first; collective code ownership across the agent team.
- **Specification by Example / Example Mapping (brief discipline).** Pre-named examples and edge cases in every brief; acceptance criteria as scenarios; the brief as the team's running specification.

Two clarifications about what this methodology contributes beyond picking from the menu:

1. **Continuous improvement is trigger-based, not periodic.** Retros run when something is learned, not on a calendar. (See [`principles/protocol-as-memory.md`](principles/protocol-as-memory.md).)
2. **Velocity is observed, not promised.** Sizing exists for dispatch-shape discipline (a refusal mechanism, not a scheduling mechanism). The team accrues empirical throughput per model tier over time; that surface is the calibration's model-tier routing table, not a velocity chart.

## Lifecycle

Phases in rows. Bold = new (this project adds it); plain = exists today; italic = exists but gets augmented.

| Phase / ritual | Agile parallel (lineage) | Drive skill(s) | Cadence | Role (today → eventual) | Artefact | Gated by |
|---|---|---|---|---|---|---|
| **Shape** (lane refinement, project discovery) | Continuous backlog refinement (Kanban) | `drive-discussion` (mode); no dedicated skill | Continuous | Human PO | Loose notes; sometimes a draft project folder | — |
| Plan: scaffold | — | `drive-create-project` | Per project | Maker (TL+PO hat) → orchestrator agent | `projects/<x>/` skeleton | — |
| Plan: spec | Story writing + Example Mapping (SBE) | *`drive-create-spec`* + **brief discipline additions** | Per project | Maker (PO hat) → orchestrator agent | `spec.md` | — |
| Plan: plan | Sprint-planning + relative estimation (Scrum) + WIP-cap commitment (Kanban) | *`drive-create-plan`* + **sizing step** + **DoR gate per task** | Per project | Maker (TL hat) → orchestrator agent | `plan.md` (every task ≤ M, DoR satisfied, DoD declared) | DoR met for every task; no L/XL pickable |
| **Spike** | Spike (XP / Scrum) | **`drive-spike`** (new) | Per planning unknown | TL → Dev | `spikes/<date>-<q>.md` artefact | Spike-DoR; spike-DoD = artefact actionable |
| Execute: brief + pick | Story kickoff + pull (XP + Kanban) | *`drive-orchestrate-plan`* + **brief template** | Per dispatch | TL | Dispatch brief | DoR pre-flight checklist |
| Execute: implement | The work | *`drive-orchestrate-plan`* (implementer) | Per dispatch | Dev | Commits | Wall-clock time-box per size |
| Execute: **WIP inspection** | Pair-programming review (XP) / WIP-flow inspection (Kanban) | *`drive-orchestrate-plan`* + **WIP-inspection step** | ≤ 5 min within each dispatch | TL | Inspection note (light; promoted to a finding on drift) | — |
| Execute: close dispatch | Acceptance test (XP / SBE) | *`drive-orchestrate-plan`* (reviewer) | Per dispatch | QA | Reviewer verdict + refreshed review artefacts | DoD post-flight checklist |
| **Project-health rollup** | Daily scrum + WIP-board review (Scrum + Kanban) | **`drive-health-check`** (new) | Per work session + per milestone + unattended triggers | TL → PO | Rollup (short, written) | — |
| Review (PR) | Code review + acceptance testing | `drive-code-review`, `drive-pr-walkthrough`, `drive-pr-local-review`, `review-{fetch,triage,implement}-phase` | Per PR | QA + senior human | Review artefacts | DoD-equivalent at PR scope |
| Ship | Release planning + release | `drive-create-deployment-plan` | Per project | Maker + Product | Deployment plan + shipped change | — |
| **Retro (trigger-based)** | Sprint retro / blameless post-mortem | **`drive-retro`** (new) | Trigger-based: post-mortem, dispatch failure, milestone close, project close | SM → orchestrator agent | Protocol update OR calibration update OR ADR (if neither, retro failed) | — |
| Close project | Sprint review + delivery review | `drive-close-project` | Per project | Maker + team | Migrated docs + deleted project folder | Final retro complete |

## Reading the map

A few patterns worth surfacing because they shape downstream docs:

1. **DoR and DoD each gate three scopes.** DoR gates plan (every task before the plan is finalised), dispatch (every brief before the implementer starts), and spike. DoD gates dispatch (every implementer closeout), PR (review-clean), and project (final acceptance). The general skill carries the gate *shape*; the calibration carries the gate *content*.
2. **WIP inspection is the only sub-dispatch inspection ritual.** Anything finer competes with the implementer's flow.
3. **Two project-level rituals: health-check (forward) and retro (backward).** Different triggers, different consumers. Health-check is "are we on track?"; retro is "what did we learn?"
4. **Role wearing is explicit per cell.** Today the human wears PO + SM + TL; the orchestrator agent wears TL during execution; the implementer wears Dev; the reviewer wears QA. As we delegate up, the orchestrator agent eventually wears SM (retros, protocol maintenance) and PO-lite (intent-validation against the spec). The human's residual role becomes spec-level + assumption-invalidation escalation. The "today → eventual" column records the trajectory. The full mapping will live in `principles/roles.md` (upcoming).

## Project-health rollup cadence

The health-check ritual deserves a specific cadence note because "daily" doesn't translate to agent teams.

- **Interactive mode → session-bookended.** When a human sits down to drive the project, the orchestrator presents a health rollup *before* asking what to push on; at session end, the orchestrator writes a session-end rollup. The work session is the unit, not the calendar day.
- **Unattended mode → trigger-based.** No human session boundary; instead: every milestone close (hooks into the existing milestone-sync task from `drive-create-plan`); after N consecutive dispatches without milestone progress (drift alarm; N to be calibrated); on any escalation-worthy event.

Per-task is too noisy (polling cadence); per-milestone alone is too coarse (drift compounds in between).

## Skill surface (forward look)

The map exposes three new skills and a handful of augmentations. They will be detailed separately under their own design before any of them is drafted. In summary:

- **New skills.** `drive-spike`, `drive-health-check`, `drive-retro`.
- **Augmentations.** `drive-create-plan` (sizing-discipline step; refuse-to-finalize-with-L/XL); `drive-orchestrate-plan` (DoR pre-flight, WIP-inspection step, DoD post-flight, brief template integration); `drive-create-spec` (Example Mapping additions to acceptance criteria).
- **One always-applied rule.** Carries the hard invariants (size cap, WIP-inspection cadence, intent-validation requirement) so they're strong memory and skills can reference rather than re-state.

## Status

Living document. Updates here are load-bearing for every other doc in this project — any change to the map cascades into the principle docs, the skill set, and the calibration.
