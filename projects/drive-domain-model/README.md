# Drive domain model + agile orchestration

A consolidated effort that pins Drive's domain model, threads dispatch-level Agile discipline into the workflows where agent execution happens, restructures the canonical `drive-*` skill family against the pinned model, and rewrites the Drive process documentation.

This project absorbs two predecessor projects:

- **`drive-domain-model`** (the units project) — pinned PR / Slice / Project / Dispatch / Direct change as units with explicit invariants and workflows.
- **`agile-agent-orchestration`** (the methodology project) — adapted Kanban + selected Scrum / XP / SBE rituals (DoR / DoD / WIP-inspection / brief / retro / sizing) for agent teams.

Both turned out to address one cluster of failure modes (fuzzy units + unbounded agent dispatches) and to fit one operational shape, so we consolidated and now deliver them together.

## Motivation

Agent-driven development exhibits the same failure modes as human team development — estimation drift, scope creep, spec drift, context loss between hand-offs, coordination overhead — but faster, and without the organic memory transmission that human teams rely on to learn from mistakes. The protocol adapts well-established Agile practices to a setting where the team is composed of an operator + an orchestrator agent + one or more implementer/reviewer subagents, and where institutional memory must live in written rituals rather than shared experience.

Today's canonical Drive skill family has two compounding failure modes that share a structural fix:

1. **Fuzzy units.** "Project," "milestone," "task," "plan," and "spec" each float across scopes. The Linear sync workflow operates on units that aren't pinned; what gets synced where is unanswerable except by reference to the original author's mental model.
2. **Unbounded dispatches.** Agent sessions run feature-sized scopes without orchestrator inspection. Drift passes validation gates while violating the spec.

This project pins the units, adds Triage as the universal entry point, threads dispatch-level discipline into the workflows where it matters, and ships the changes back into canonical Drive.

## Status

Active. Substantive consolidation in progress. See [`design-decisions.md`](design-decisions.md) for the chronological record of shaping decisions.

## Documents

Read in this order:

1. [`spec.md`](spec.md) — what this project delivers (problem, approach, FRs, ACs, open questions)
2. [`model.md`](model.md) — the pinned domain model (vocabulary, roles, workflows, invariants, persistence shape, Linear sync)
3. [`workflow.md`](workflow.md) — the Drive ↔ Agile lifecycle map (operational layer on top of `model.md`)
4. [`design-decisions.md`](design-decisions.md) — chronological decisions log
5. [`principles/`](principles/) — per-principle deep-dives:
   - [`protocol-as-memory.md`](principles/protocol-as-memory.md) — why agent teams must capture lessons in rituals
   - [`decomposition-and-cost.md`](principles/decomposition-and-cost.md) — why smaller dispatches enable cheaper tiers
   - [`spikes.md`](principles/spikes.md) — time-boxed investigations with artefact output (now a brief-type variant)
   - [`roles-and-personas.md`](principles/roles-and-personas.md) — the three-role + one-persona mapping
   - [`brief-discipline.md`](principles/brief-discipline.md) — Example Mapping in every dispatch brief
   - [`definition-of-ready.md`](principles/definition-of-ready.md) — gate shape at three scopes
   - [`definition-of-done.md`](principles/definition-of-done.md) — gate shape at three scopes (includes manual QA per [PR #93](https://github.com/prisma/ignite/pull/93))
   - [`retro.md`](principles/retro.md) — trigger-based retro template
6. [`calibration/prisma-next.md`](calibration/prisma-next.md) — worked-example calibration for the `prisma-next` repo
7. [`skill-restructure.md`](skill-restructure.md) — workflow → skill map + the proposed restructure (stacks on PR #93)
8. [`plan.md`](plan.md) — execution plan for landing this work

## Base assumption

All canonical-side work proposed here stacks on top of [`prisma/ignite#93`](https://github.com/prisma/ignite/pull/93), which ships:

- The **project-context convention** (`drive/<category>/README.md` read by drive-* skills as workflow step 1).
- The **manual-QA pair** (`drive-qa-plan` + `drive-qa-run`) — the judgement layer on top of CI.
- Three **meta-skills** (`drive-bootstrap-context`, `drive-reconcile-skills`, `drive-update-skills`).

Several docs in this project reference that surface as already-existing. See `skill-restructure.md` § "Base assumption" for the integration details.

## How this project relates to others

This is a **methodology + framework project**. Its output is:

- A pinned domain model that any project can adopt (`model.md`).
- A general protocol that any team can adopt by writing project-specific calibrations (rubric anchors, DoD checklists, failure-mode catalogues). Calibration is per-repo; the protocol is universal.
- A restructured canonical `drive-*` skill family (ships in the upstream `prisma/ignite` repo across multiple PRs).
- A rewritten `drive-process.md` (also upstream in `prisma/ignite`).

The protocol is being developed in the context of the `prisma-next` project, which serves as the first calibration example. Prisma-next-specific calibrations eventually live in `prisma-next`'s `docs/`, not here.

### Relationship with the existing `drive-*` skills

Today's `drive-*` skill family operates on fuzzy units and skips dispatch-level discipline. This project fixes both. See [`spec.md`](spec.md) § "Restructure the canonical drive-* skill family" and (upcoming) `skill-restructure.md` for the full plan. In summary:

- **Split** `drive-create-spec` → `drive-project-specify` + `drive-slice-specify`.
- **Split** `drive-create-plan` → `drive-project-plan` + `drive-slice-plan`.
- **Augment** `drive-orchestrate-plan` (slice-scope only): per-dispatch DoR / DoD; WIP-inspection cadence; brief template; L/XL refusal; design-discussion stop-condition.
- **Augment** `drive-close-project`: mandatory final retro.
- **Promote** `drive-discussion` (mode) to first-class cross-cutting workflow.
- **New** `drive-triage-work` (entry point + mid-flight scope re-evaluator).
- **New** `drive-health-check` (project rollup; session-bookended or trigger-fired).
- **New** `drive-retro-run` (trigger-based retro template).
- **Retire** "milestone" and "task" as Drive vocabulary; "step" demotes to implementer-internal.
- **Stack on PR #93**: the manual-QA pair + project-context convention are treated as the canonical baseline; slice and project DoD reference them directly.

### Eventual home

When the methodology stabilises, it lives in the centralised `drive/agile` skill namespace (alongside the rest of the `drive-*` family). Project-specific calibrations live in each adopting repo's `docs/`. See [`spec.md`](spec.md) and `model.md` § "Implications for existing canonical Drive."

## Reference clones

`reference/ignite/` is a local clone of the canonical skills repo for browsing. Gitignored; not committed.
