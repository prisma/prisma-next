# Drive ↔ Agile workflow map

## At a glance

The operational layer on top of [`model.md`](model.md). Every drive-* skill plugs into one named phase here; every phase has a cadence (when it fires) and a role + persona (who runs it). The lifecycle table below is the source of truth — downstream docs (principles, project-context overlays) refer back to it.

Reading guide: skip to [the lifecycle table](#lifecycle) if you know the vocabulary; skip to [the cadence summary](#cadence-summary) if you want to know what fires when.

## Two skill tiers

Per [`model.md`](model.md#two-skill-tiers-workflow-and-atomic):

- **Workflow skills** (`drive-<verb>-workflow`) pilot a multi-step loop top-to-bottom. They call atomic skills as steps. Three of them — `drive-start-workflow` (triage + verdict setup), `drive-build-workflow` (slice implementation loop), `drive-deliver-workflow` (project lifecycle).
- **Atomic skills** do one bounded thing. Called by workflow skills or directly by the operator. Most skills are atomic.

The `Drive skill(s)` column in the lifecycle table below names the atomic skill that does the work of each phase; the workflow skill that pilots the phase appears as the row's outer container where relevant (Slice execution rows are piloted by `drive-build-workflow`; Project initiation / closure rows by `drive-deliver-workflow`; Triage by `drive-start-workflow`).

## Drive's Agile lineage (one sentence per influence)

- **Kanban (the substrate).** Continuous flow, WIP limits as a structural rule (our size caps are the WIP-shape rule — PR-cap on slices, M-cap on dispatches), pull over push, throughput as the diagnostic.
- **Scrum (selected rituals).** Definition of Ready + Definition of Done as living team artefacts; retros as the team's learning ritual; relative estimation; explicit role taxonomy. **Not adopted:** sprints, story-point velocity-as-commitment, sprint-boundaried rituals.
- **XP (selected practices).** Pair-style continuous WIP inspection during a dispatch; spikes as a first-class brief-type; tests-first; collective code ownership across the agent team.
- **Specification by Example / Example Mapping (brief discipline).** Pre-named examples and edge cases in every brief; acceptance criteria as scenarios.

Two clarifications about what this methodology contributes beyond picking from the menu:

1. **Continuous improvement is trigger-based, not periodic.** Retros run when something is learned, not on a calendar. (See [`principles/protocol-as-memory.md`](principles/protocol-as-memory.md).)
2. **Velocity is observed, not promised.** Sizing exists for dispatch-shape discipline (a refusal mechanism, not a scheduling mechanism). Empirical throughput per model tier accrues over time as the calibration's model-tier routing table.

## Lifecycle

Phases in rows. The Workflow column maps to the eight workflows in [`model.md`](model.md#layer-3-workflows).

| Phase / ritual | Workflow | Agile parallel | Drive skill(s) | Cadence | Role + persona | Artefact | Gated by |
|---|---|---|---|---|---|---|---|
| Triage | Triage | Backlog refinement + sizing (Kanban) | `drive-triage-work` | Per entry point + mid-flight | Agile orchestrator | One of eight triage verdicts (§ Triage outputs) | — |
| Design discussion (cross-cutting) | Design discussion | Three Amigos / collaborative refinement (SBE) | `drive-discussion` (mode) | On trigger (pre-spec, mid-spec, mid-flight assumption-falsification, mid-flight obstacle, explicit) | Operator + agile orchestrator (collaboratively) | Spec edit + plan edit + `design-decisions.md` entry | — |
| Direct change: do | Direct change execution | "Just commit it" (cowboy Kanban — but bounded by triage verdict) | — (no Drive skill; `gh pr create` after edit) | Per direct change | Implementer | One PR; intent in PR body | — |
| Plan: scaffold project | Project initiation | — | `drive-create-project` | Per project | Project owner + agile orchestrator | `projects/<x>/` skeleton | — |
| Plan: project spec | Project initiation | Story writing + Example Mapping (SBE) | `drive-specify-project` | Per project | Project owner (often with design-discussion participation) | `projects/<x>/spec.md` (purpose, scope boundary, project-DoD) | — |
| Plan: project plan | Project initiation | Release planning + WIP-cap commitment (Kanban) | `drive-plan-project` | Per project | Project owner | `projects/<x>/plan.md` (slice + direct-change composition; stack/parallel) | — |
| Plan: slice spec | Slice initiation | Story writing + Example Mapping (SBE) | `drive-specify-slice` | Per slice | Implementer | Slice spec (in-project: `projects/<x>/slices/<s>/spec.md`; orphan: inline in PR description) | — |
| Plan: slice plan | Slice initiation | Sprint planning + relative estimation (Scrum) | `drive-plan-slice` (with sizing step + DoR-per-dispatch gate) | Per slice | Implementer (often with agile-orchestrator review) | Slice plan: dispatch sequence; every dispatch ≤ M; DoR + DoD declared per dispatch | DoR met for every dispatch; no L/XL dispatch admitted |
| Spike (brief-type variant) | Slice execution (single-dispatch slice plan) OR Triage spike-first | Spike (XP / Scrum) | `drive-build-workflow` (single dispatch with spike-flavoured brief) | Per planning unknown | Implementer | `projects/<x>/spikes/<date>-<q>.md` artefact (dispatch-scope) OR a doc PR (slice-scope) | Spike-DoR; spike-DoD = artefact is actionable |
| Execute: brief + dispatch | Slice execution | Story kickoff + pull (XP + Kanban) | `drive-build-workflow` (brief template per `principles/brief-discipline.md`) | Per dispatch | Agile orchestrator delegates → implementer executes | Dispatch brief; commits | DoR pre-flight checklist |
| Execute: WIP inspection | Slice execution | Pair-programming review (XP) / WIP-flow inspection (Kanban) | `drive-build-workflow` (WIP-inspection step) | ≤ 5 min within each dispatch | Agile orchestrator | Inspection note (light; promoted to a finding on drift) | — |
| Execute: close dispatch | Slice execution | Acceptance test (XP / SBE) | `drive-build-workflow` (reviewer subagent) | Per dispatch | Reviewer | Reviewer verdict + refreshed review artefacts | DoD post-flight checklist |
| Project-health rollup | Cross-cutting | Daily scrum + WIP-board review (Scrum + Kanban) | `drive-check-health` | Session-bookended (interactive) + per-slice + unattended triggers (§ Project-health rollup cadence) | Agile orchestrator | Rollup (short, written) | — |
| Review (PR) | Slice review | Code review + acceptance testing | `drive-review-code`, `drive-pr-walkthrough`, `drive-pr-local-review`, `review-{fetch,triage,implement}-phase` | Per PR | Reviewer (distinct from implementer) + senior operator | Review artefacts | DoD-equivalent at PR scope |
| Manual QA: author script | Slice review | Acceptance-test authoring (XP / SBE — judgement layer beyond CI) | `drive-qa-plan` | Per slice that touches user-observable surface (else explicit N/A) | Implementer (typically) | `projects/<x>/manual-qa.md` script (in-project) or PR-inline QA section (orphan); project-specific context comes from `drive/qa/README.md` | Slice DoD requires it (or honest N/A) |
| Manual QA: run + report | Slice review | Acceptance-test execution + bug triage | `drive-qa-run` | Per slice (≥ 1 run before merge); re-runs on subsequent change | Reviewer or fresh-eyes runner (not script author when possible) | `projects/<x>/manual-qa-reports/<YYYY-MM-DD>-<runner>.md`; severity rubric (🛑 / ⚠️ / 📝) | Slice DoD: no unresolved 🛑 Blocker findings |
| Promotion | Triage → promotion workflow | Refactor to project as scope grows | (Tracker calls; orchestrated by `drive-triage-work` in mid-flight mode) | Per promotion event | Agile orchestrator + operator (authorisation) | Tracker project created; original ticket moved-in + Done; folder scaffold | Operator confirms |
| Demotion | Triage → demotion workflow | Right-sizing down as scope shrinks | (Tracker calls; orchestrated by `drive-triage-work` in mid-flight mode) | Per demotion event | Agile orchestrator + operator (authorisation) | Surviving tracker issue; tracker project Cancelled/Completed; folder retired | Operator confirms |
| Slice closure | Slice closure | Acceptance + handoff | (Falls out of merge; `drive-check-health` may fire as session-bookend) | Per slice merge | Implementer + project owner (if in-project) | PR merged; slice marked delivered; deferred candidates recorded; retro fires if learning surfaced | — |
| Ship | (Project closure) | Release planning + release | `drive-create-deployment-plan` | Per project (where applicable) | Project owner + Product | Deployment plan + shipped change | — |
| Retro (trigger-based) | Cross-cutting | Sprint retro / blameless post-mortem | `drive-run-retro` | Trigger-based: post-mortem, dispatch failure, slice close (if learning), project close (mandatory) | Agile orchestrator | Canonical-skill update OR `drive/<category>/README.md` update OR ADR (if neither, retro failed) | — |
| Close project | Project closure | Sprint review + delivery review | `drive-close-project` + mandatory final retro | Per project | Project owner | Migrated docs + deleted project folder; deferred-work bundle | Final retro complete (mandatory step) |

## Triage outputs

Triage is one workflow; its single decision tree produces one of eight verdicts. `drive-triage-work` routes each verdict to its downstream workflow.

| Verdict | Routes to | Notes |
|---|---|---|
| Direct change | "Direct change: do" row | No spec / no plan / no dispatch ceremony. |
| Orphan slice | Slice initiation (orphan mode) | Slice spec inline in PR description; no `projects/<x>/`. |
| In-project slice | Slice initiation (in-project mode) | Slice spec + plan under `projects/<project>/slices/<slice>/`. |
| New project | Project initiation | Full ceremony: scaffold → project spec → project plan. |
| Promote | Promotion workflow (Linear pattern) | Ticket-becomes-project; original ticket moved into new Linear Project + marked Done. |
| Demote | Demotion workflow | Project → slice or direct change; Linear Project Cancelled/Completed; surviving issue stands alone. |
| Spike first | Single-dispatch slice plan with spike-flavoured brief | Re-triage on artefact. |
| Defer | Record in `projects/<x>/deferred.md` or operator scratch | Out-of-scope for current work; not silently lost. |

## Project-health rollup cadence

The health-check ritual deserves a specific cadence note because "daily" doesn't translate to agent teams.

- **Interactive mode → session-bookended.** When an operator sits down to drive the project, the orchestrator presents a health rollup *before* asking what to push on; at session end, the orchestrator writes a session-end rollup. The work session is the unit, not the calendar day.
- **Unattended mode → trigger-based.** No operator session boundary; instead: every slice merge (hooks into the slice-closure workflow), after N consecutive dispatches without slice progress (drift alarm; N to be calibrated, default 3), on any escalation-worthy event (e.g. design-discussion required → unattended-mode stop-condition).

Per-dispatch is too noisy (polling cadence); per-project alone is too coarse (drift compounds in between).

## Cadence summary

| Cadence | Rituals |
|---|---|
| Per entry point | `drive-start-workflow` (pilots; calls `drive-triage-work` then verdict setup) |
| Per direct change | `drive-start-workflow` routes to `drive-pr-description` direct-change framing → edit → `gh pr create` → review → merge |
| Per project | `drive-deliver-workflow` (pilots; calls `drive-create-project`, `drive-specify-project`, `drive-plan-project`, `drive-create-deployment-plan` if applicable, `drive-close-project` with mandatory final retro) |
| Per slice | `drive-specify-slice`, `drive-plan-slice`, `drive-build-workflow` (pilots the dispatch loop, calling `drive-review-code`, `drive-pr-walkthrough`, `drive-pr-description`, `drive-qa-plan`, `drive-qa-run`) |
| Per dispatch (inside `drive-build-workflow`'s loop) | DoR pre-flight → brief assembly → delegate → WIP inspection (≤ 5 min) → DoD post-flight → reviewer verdict |
| Session-bookended (interactive) | `drive-check-health` (open + close) |
| Trigger-fired (any mode) | `drive-discussion`, `drive-run-retro`, mid-flight `drive-triage-work` (for promotion / demotion / surfaced scope) |
| Mandatory at project close | Final `drive-run-retro` (if it didn't produce a canonical / project-context / ADR update, retro failed) |

## Skill surface

Three workflow skills pilot the multi-step phases; atomic skills do the bounded work each phase calls for. Skill bodies live in [`skills-contrib/drive-*/SKILL.md`](../../skills-contrib/) (canonical source); the naming convention is in [`model.md`](model.md#naming-convention).

**Workflow tier:**

- **`drive-start-workflow`** — pilots triage + the verdict's setup chain.
- **`drive-build-workflow`** — pilots the slice's dispatch loop (per-dispatch DoR / DoD; WIP-inspection step; brief template; L/XL refusal; design-discussion stop-condition).
- **`drive-deliver-workflow`** — pilots a project's lifecycle (init → slices → health → retros → mandatory close retro).

**Atomic tier:**

- **Triage / health / retro.** `drive-triage-work`, `drive-check-health`, `drive-run-retro`.
- **Specs (per scope).** `drive-specify-project`, `drive-specify-slice`.
- **Plans (per scope).** `drive-plan-project`, `drive-plan-slice`.
- **Project boundary.** `drive-create-project`, `drive-close-project` (with mandatory-final-retro hook).
- **PR.** `drive-pr-description` (handles both slice and direct-change framings), `drive-pr-walkthrough`.
- **Review.** `drive-review-code`.
- **Manual QA.** `drive-qa-plan`, `drive-qa-run`.
- **Discussion.** `drive-discussion` (mode skill; fires on trigger from any workflow skill or operator invocation).
- **Deployment.** `drive-create-deployment-plan` (where applicable).
- **Spike.** Not a separate skill — a brief-type variant inside `drive-build-workflow`. The brief's DoD is "the artefact is actionable" rather than "code is committed." See [`principles/spikes.md`](principles/spikes.md).

Hard invariants (PR-cap on slices, M-cap on dispatches, WIP-inspection cadence, no-silent-amendments) live in an always-applied rule so the workflow + atomic skills can reference rather than re-state them.
