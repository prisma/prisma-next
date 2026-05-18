# Drive ↔ Agile workflow map

The operational layer on top of [`model.md`](model.md). Every subsequent doc (principles, calibration, skill restructure) refers back to it; every new or augmented skill plugs into a phase named here.

Vocabulary in this doc tracks `model.md` (slice, dispatch, direct change, agile orchestrator, triage, design discussion). Where a phase serves a unit, the unit is named.

## Framing

Drive is a **Kanban-shaped process with selected Scrum, XP, and Specification-by-Example rituals layered on**. Naming the lineage explicitly is load-bearing — it sets expectations about what we are and aren't adopting from each tradition:

- **Kanban (the substrate).** Continuous flow over sprint cadence; WIP limits as a structural rule (the size caps are our WIP-shape rule — PR-cap on slices, M-cap on dispatches); pull over push; throughput as the diagnostic; explicit policies. This matches `drive-process.md`'s existing posture (no sprints, project throughput as the unit, WIP as a diagnostic).
- **Scrum (selected rituals).** Definition of Ready + Definition of Done as living team artefacts; retros as the team's learning ritual; relative estimation; explicit role taxonomy. We do **not** adopt sprints, story-point velocity-as-commitment, sprint planning ceremonies, or sprint-boundaried retros — those are calendar-based rituals incompatible with continuous flow.
- **XP (selected practices).** Pair-style continuous WIP inspection during a dispatch; spikes as a first-class brief-type; tests-first; collective code ownership across the agent team.
- **Specification by Example / Example Mapping (brief discipline).** Pre-named examples and edge cases in every brief; acceptance criteria as scenarios; the brief as the team's running specification.

Two clarifications about what this methodology contributes beyond picking from the menu:

1. **Continuous improvement is trigger-based, not periodic.** Retros run when something is learned, not on a calendar. (See [`principles/protocol-as-memory.md`](principles/protocol-as-memory.md).)
2. **Velocity is observed, not promised.** Sizing exists for dispatch-shape discipline (a refusal mechanism, not a scheduling mechanism). The team accrues empirical throughput per model tier over time; that surface is the calibration's model-tier routing table, not a velocity chart.

## Lifecycle

Phases in rows. Bold = new (this project adds it); plain = exists today; italic = exists but gets augmented. Workflow column maps to the eight workflows in [`model.md`](model.md#workflows).

| Phase / ritual | Workflow | Agile parallel (lineage) | Drive skill(s) | Cadence | Role + persona (today → eventual) | Artefact | Gated by |
|---|---|---|---|---|---|---|---|
| **Triage** | Triage | Backlog refinement + sizing (Kanban) | **`drive-triage-work`** (new) | Per entry point + mid-flight | Agile orchestrator (operator → orchestrator agent) | One of eight triage verdicts (§ Triage outputs) | — |
| **Design discussion** (cross-cutting) | Design discussion | Three Amigos / collaborative refinement (SBE) | `drive-discussion` (mode) | On trigger (pre-spec, mid-spec, mid-flight assumption-falsification, mid-flight obstacle, explicit) | Operator + agile orchestrator (collaboratively) | Spec edit + plan edit + `design-decisions.md` entry | — |
| **Direct change: do** | Direct change execution | "Just commit it" (cowboy Kanban — but bounded by triage verdict) | — (no Drive skill; `gh pr create` after edit) | Per direct change | Implementer (operator → agent) | One PR; intent in PR body | — |
| Plan: scaffold project | Project initiation | — | `drive-create-project` | Per project | Project owner + agile orchestrator (operator → operator-lite + orchestrator agent) | `projects/<x>/` skeleton | — |
| Plan: project spec | Project initiation | Story writing + Example Mapping (SBE) | **`drive-project-specify`** (new — split from `drive-create-spec`) | Per project | Project owner (often with design-discussion participation) | `projects/<x>/spec.md` (purpose, scope boundary, project-DoD) | — |
| Plan: project plan | Project initiation | Release planning + WIP-cap commitment (Kanban) | **`drive-project-plan`** (new — split from `drive-create-plan`) | Per project | Project owner | `projects/<x>/plan.md` (slice + direct-change composition; stack/parallel) | — |
| Plan: slice spec | Slice initiation | Story writing + Example Mapping (SBE) | **`drive-slice-specify`** (new — split from `drive-create-spec`) | Per slice | Implementer | Slice spec (in-project: `projects/<x>/slices/<s>/spec.md`; orphan: inline in PR description) | — |
| Plan: slice plan | Slice initiation | Sprint planning + relative estimation (Scrum) | **`drive-slice-plan`** (new — split from `drive-create-plan`) + **sizing step** + **DoR-per-dispatch gate** | Per slice | Implementer (often with agile-orchestrator review) | Slice plan: dispatch sequence; every dispatch ≤ M; DoR + DoD declared per dispatch | DoR met for every dispatch; no L/XL dispatch pickable |
| Spike (brief-type variant) | Slice execution (single-dispatch slice plan) OR Triage spike-first | Spike (XP / Scrum) | *`drive-orchestrate-plan`* (single dispatch with spike-flavoured brief) | Per planning unknown | Implementer | `projects/<x>/spikes/<date>-<q>.md` artefact (dispatch-scope) OR a doc PR (slice-scope) | Spike-DoR; spike-DoD = artefact is actionable |
| Execute: brief + dispatch | Slice execution | Story kickoff + pull (XP + Kanban) | *`drive-orchestrate-plan`* + **brief template** | Per dispatch | Agile orchestrator delegates → implementer executes | Dispatch brief; commits | DoR pre-flight checklist |
| Execute: **WIP inspection** | Slice execution | Pair-programming review (XP) / WIP-flow inspection (Kanban) | *`drive-orchestrate-plan`* + **WIP-inspection step** | ≤ 5 min within each dispatch | Agile orchestrator | Inspection note (light; promoted to a finding on drift) | — |
| Execute: close dispatch | Slice execution | Acceptance test (XP / SBE) | *`drive-orchestrate-plan`* (reviewer subagent) | Per dispatch | Reviewer | Reviewer verdict + refreshed review artefacts | DoD post-flight checklist |
| **Project-health rollup** | Cross-cutting | Daily scrum + WIP-board review (Scrum + Kanban) | **`drive-health-check`** (new) | Session-bookended (interactive) + per-slice + unattended triggers (§ Cadence below) | Agile orchestrator (operator + orchestrator agent) | Rollup (short, written) | — |
| Review (PR) | Slice review | Code review + acceptance testing | `drive-review-code`, `drive-pr-walkthrough`, `drive-pr-local-review`, `review-{fetch,triage,implement}-phase` | Per PR | Reviewer (distinct from implementer) + senior operator | Review artefacts | DoD-equivalent at PR scope |
| **Promotion** | Triage → promotion workflow | Refactor to project as scope grows | (Linear MCP calls; orchestrated by `drive-triage-work` in mid-flight mode) | Per promotion event | Agile orchestrator + operator (authorisation) | Linear Project created; original ticket moved-in + Done; folder scaffold | Operator confirms |
| **Demotion** | Triage → demotion workflow | Right-sizing down as scope shrinks | (Linear MCP calls; orchestrated by `drive-triage-work` in mid-flight mode) | Per demotion event | Agile orchestrator + operator (authorisation) | Surviving Linear issue; Linear Project Cancelled/Completed; folder retired | Operator confirms |
| Slice closure | Slice closure | Acceptance + handoff | (Falls out of merge; `drive-health-check` may fire as session-bookend) | Per slice merge | Implementer + project owner (if in-project) | PR merged; slice marked delivered; deferred candidates recorded; retro fires if learning surfaced | — |
| Ship | (Project closure) | Release planning + release | `drive-create-deployment-plan` | Per project (where applicable) | Project owner + Product | Deployment plan + shipped change | — |
| **Retro (trigger-based)** | Cross-cutting | Sprint retro / blameless post-mortem | **`drive-retro-run`** (new) | Trigger-based: post-mortem, dispatch failure, slice close (if learning), project close (mandatory) | Agile orchestrator | Protocol update OR calibration update OR ADR (if neither, retro failed) | — |
| Close project | Project closure | Sprint review + delivery review | `drive-close-project` + mandatory final retro | Per project | Project owner | Migrated docs + deleted project folder; deferred-work bundle | Final retro complete (mandatory step) |

## Triage outputs

Triage is one workflow; its single decision tree produces one of eight verdicts. The skill (`drive-triage-work`) routes each verdict to its downstream workflow:

| Verdict | Routes to | Notes |
|---|---|---|
| Direct change | "Direct change: do" row | No spec / no plan / no dispatch ceremony. |
| Orphan slice | Slice initiation (orphan mode) | Slice spec inline in PR description; no `projects/<x>/`. |
| In-project slice | Slice initiation (in-project mode) | Slice spec + plan under `projects/<project>/slices/<slice>/`. |
| New project | Project initiation | Full ceremony: scaffold → project spec → project plan. |
| Promote | Promotion workflow (Linear pattern 2) | Ticket-becomes-project; original ticket moved into new Linear Project + marked Done. |
| Demote | Demotion workflow | Project → slice or direct change; Linear Project Cancelled/Completed; surviving issue stands alone. |
| Spike first | Single-dispatch slice plan with spike-flavoured brief | Re-triage on artefact. |
| Defer | Record in `projects/<x>/deferred.md` or operator scratch | Out-of-scope for current work; not silently lost. |

## Reading the map

A few patterns worth surfacing because they shape downstream docs:

1. **Triage is the universal entry point AND mid-flight re-evaluator.** Every entry into Drive runs `drive-triage-work` first. Mid-flight scope shifts (in either direction) re-run triage, which is what surfaces promotion and demotion verdicts. Triage is the structural lever — without it, the canonical's project-shape gravity is the path of least resistance.
2. **Design discussion is cross-cutting, not a phase.** It fires on multiple triggers across the lifecycle and is the resolution mechanism for assumption-falsification, obstacle emergence, and pre-spec shaping. Per invariant I12, every spec/plan amendment after the first dispatch starts is the output of a design discussion (or an operator-authorised edit) — silent agent-side amendments are forbidden.
3. **DoR and DoD each gate three scopes.** DoR gates project (light), slice (one PR's worth before initiation closes), and dispatch (every brief before the implementer starts). DoD gates dispatch (every closeout), slice (review-clean + intent-validated), and project (final acceptance + mandatory retro). The general skill carries the gate *shape*; the calibration carries the gate *content*.
4. **WIP inspection is the only sub-dispatch inspection ritual.** Anything finer competes with the implementer's flow. The cadence is ≤ 5 min during every dispatch.
5. **Two project-level rituals: health-check (forward) and retro (backward).** Different triggers, different consumers. Health-check is "are we on track?"; retro is "what did we learn?"
6. **Direct change has no Drive-skill execution.** Triage routes to `gh pr create`. Drive observes the outcome only via merge; the PR description + commit *is* the artefact.
7. **Role + persona wearing is explicit per cell.** Today the operator wears project owner + agile orchestrator persona + implementer (sometimes). The orchestrator agent wears agile orchestrator during the dispatch loop; the implementer subagent wears implementer; the reviewer subagent wears reviewer. As confidence accrues, the orchestrator agent eventually wears agile orchestrator at all scopes (triage, dispatch loop, retro running, protocol maintenance) and the operator's residual role becomes design-level (project spec authoring, design-discussion participation, falsified-assumption escalation). The "today → eventual" column records the trajectory. Full mapping in [`principles/roles-and-personas.md`](principles/roles-and-personas.md) (upcoming).

## Project-health rollup cadence

The health-check ritual deserves a specific cadence note because "daily" doesn't translate to agent teams.

- **Interactive mode → session-bookended.** When an operator sits down to drive the project, the orchestrator presents a health rollup *before* asking what to push on; at session end, the orchestrator writes a session-end rollup. The work session is the unit, not the calendar day.
- **Unattended mode → trigger-based.** No operator session boundary; instead: every slice merge (hooks into the slice-closure workflow), after N consecutive dispatches without slice progress (drift alarm; N to be calibrated, default 3), on any escalation-worthy event (e.g. design-discussion required → unattended-mode stop-condition).

Per-dispatch is too noisy (polling cadence); per-project alone is too coarse (drift compounds in between).

## Cadence summary (what fires when)

| Cadence | Rituals |
|---|---|
| Per entry point | `drive-triage-work` |
| Per direct change | Edit → `gh pr create` → review → merge |
| Per project | `drive-create-project`, `drive-project-specify`, `drive-project-plan`, `drive-create-deployment-plan` (if applicable), `drive-close-project` (with mandatory final retro) |
| Per slice | `drive-slice-specify`, `drive-slice-plan`, `drive-orchestrate-plan` (loop), `drive-review-code`, `drive-pr-walkthrough`, `drive-pr-description` |
| Per dispatch (inside the orchestrate loop) | DoR pre-flight → brief assembly → delegate → WIP inspection (≤ 5 min) → DoD post-flight → reviewer verdict |
| Session-bookended (interactive) | `drive-health-check` (open + close) |
| Trigger-fired (any mode) | `drive-discussion`, `drive-retro-run`, mid-flight `drive-triage-work` (for promotion / demotion / surfaced scope) |
| Mandatory at project close | Final `drive-retro-run` (if it didn't produce a protocol/calibration/ADR update, retro failed) |

## Skill surface (forward look)

The map exposes three new skills, four split-from-old skills, two augmentations, and a promotion of an existing mode skill. Full detail in [`skill-restructure.md`](skill-restructure.md) (upcoming):

- **New skills.** `drive-triage-work`, `drive-health-check`, `drive-retro-run`.
- **Split from `drive-create-spec`.** `drive-project-specify`, `drive-slice-specify`.
- **Split from `drive-create-plan`.** `drive-project-plan`, `drive-slice-plan`.
- **Augmented.** `drive-orchestrate-plan` (per-dispatch DoR / DoD; WIP-inspection step; brief template; L/XL refusal; design-discussion stop-condition), `drive-close-project` (mandatory final retro).
- **Promoted to first-class.** `drive-discussion` (was a mode skill; now an explicit cross-cutting workflow).
- **Spike retires as a separate skill.** Becomes a brief-type variant inside `drive-orchestrate-plan` (a single-dispatch slice plan with a spike-flavoured brief, whose DoD is "the artefact is actionable" rather than "code is committed"). See [`principles/spikes.md`](principles/spikes.md).
- **One always-applied rule.** Carries the hard invariants (size caps at both scopes, WIP-inspection cadence, no-silent-amendments) so they're strong memory and skills can reference rather than re-state.

## Status

Living document. Updates here are load-bearing for every other doc in this project — any change to the map cascades into the principle docs, the skill restructuring plan, and the calibration.
