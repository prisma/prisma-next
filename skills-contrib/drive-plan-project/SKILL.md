---
name: drive-plan-project
description: >
  Compose a project's slices into a sequenced project plan. Each entry carries
  outcome + builds-on + hands-to + focus. Parallelisation is surfaced explicitly;
  the default is parallel, not serial. Use after drive-specify-project has settled
  the spec. Outputs projects/<project>/plan.md. Hands off to drive-deliver-workflow.
metadata:
  version: "2026.5.28"
---

> **Execution mode: orchestrator-direct.** Atomic skill invoked by the Orchestrator
> directly. Read-only codebase investigation (Grep / Read / Glob / SemanticSearch)
> is permitted and expected. If the body would require running builds/tests or
> writing files outside `projects/<current-project>/` — **STOP. Dispatch.** See
> [`drive/roles/README.md`](../../drive/roles/README.md).

# Drive: Plan Project

A project is composed of **slices**, never direct changes. The plan answers three questions:

1. **What slices make up this project?** A list, sized **1–4** (5+ flags for re-boundary; coordination cost scales nonlinearly).
2. **In what order — and what can run in parallel?** Default to parallel. The most common throughput killer is serializing work the dependency graph would allow to parallelise.
3. **What does each slice deliver to the next?** Per-entry handoff contracts — the stable state this slice leaves for downstream slices to consume.

The plan does **not** decompose each slice into dispatches — that's `drive-plan-slice`'s job, run when the slice is picked up.

The plan template lives at [`./templates/plan.template.md`](./templates/plan.template.md). Fill it; don't author from scratch.

## Workflow

### Step 1 — Load context

Read `drive/plan/README.md` and `drive/project/README.md` if they exist; re-read `projects/<project>/spec.md`. The team-specific sequencing patterns, parallelisation heuristics, and Linear-sync conventions live in those READMEs.

### Step 2 — Ground in the codebase

Look up the packages, IR shapes, test infrastructure, and call sites the plan will touch. "I'm not sure how many call sites this touches" as a planning hole is not acceptable — search. Slice boundaries depend on accurate cost / blast-radius estimation; estimates ungrounded in the codebase produce slices that don't survive contact with the code.

### Step 3 — Decompose into slices, checking slice-INVEST

Walk the project's cross-cutting requirements + transitional-shape constraints. Name each chunk's outcome — what's true after this slice lands. Apply **slice-INVEST** (full definitions in [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md); this-repo specialisations in [`drive/calibration/sizing.md`](../../drive/calibration/sizing.md)):

- **Independent** — ships as one PR without needing a sibling slice to merge concurrently.
- **Negotiable** — the outcome can be delivered by several plausible dispatch sequences.
- **Valuable** — closes a real gap in the project's purpose; not "preparation for slice 3."
- **Estimable** — slice-DoD conditions are binary and verifiable at PR-merge time.
- **Small** — **manageable in a single code review.** One reviewer reads the PR in one sitting, holds the coherence, and reaches a verdict without re-orienting mid-review. The test is *coherence*, not LoC.
- **Testable** — slice-DoD + project-DoD floor compose into a passable bar at PR-open time.

Failure modes and the fix:

- Fails *Small* or *Estimable* → split into two slices with an explicit hand-off.
- Fails *Independent* or *Valuable* → re-shape (may be two slices, or may not be a slice at all).
- Turns out to be a 30-second-verifiable diff with no dependency on other slices → re-route to `drive-triage-work`; it's a direct change that escaped triage.

**Sweet spot: 1–4 slices.** 5+ usually means two projects in a trenchcoat — stop and consider whether this is one project or two.

### Step 4 — Sequence: stack vs parallel

For each slice, fill **builds on** (direct dependencies only — don't transitively list grandparents) and **hands to** (the named stable state downstream slices consume). Then group:

- **Stack** — ordered list; each item builds on the previous's hand-off.
- **Parallel** — groups with no inter-group dependencies. **Default to parallel.** If the dependency graph is permissive, the plan should be permissive too.

A typical project plan is one stack thread + 1–2 parallel groups, or all-parallel if the slices are independent.

### Step 5 — Linear sync

For each slice, create (or align with) a Linear issue under the project's Linear Project via Linear MCP. Record the issue ID in the plan entry. If the project has no Linear Project, surface this and route back to `drive-start-workflow` — Linear-Project creation is part of the promote / new-project ceremony.

### Step 6 — Fill the template

Open [`./templates/plan.template.md`](./templates/plan.template.md) and fill it from the data assembled in steps 3–5.

> **Emit `plan-authored` or `plan-amended`** (immediately after writing `projects/<project>/plan.md`). Existence-check on `PLAN_PATH`: file present before write → `plan-amended` with `bytes_delta`, `reason`; else → `plan-authored`. Payload: `plan_kind: "project"`, `byte_length`, `slice_count`, `dispatch_count: null`, `dispatch_size_distribution: null`, `open_items_count`, plus envelope fields. Default `reason`: `"operator-correction"`; `"replan-from-discussion"` / `"falsified-assumption"` when caller signals. See the `drive-record-traces` skill — `events.md` § `plan-authored` / `plan-amended` and `emission.md` § Existence-check pattern + § Append protocol.

### Step 7 — Sanity-check, then hand off

Before handing off:

- Each slice passes slice-INVEST (especially *Small* = manageable in a single code review).
- Slice count ≤ 4 (over: re-consider project boundary).
- Stack is acyclic (no A→B→A).
- Anything sequenced that could be parallel? — un-sequence it.
- Every project-DoD condition reachable from the slice set.

Hand off to `drive-deliver-workflow`.

## Pitfalls

1. **Slices that are actually their own projects.** Symptom: a "slice" fails slice-INVEST's *Small* — one reviewer can't hold its coherence in one sitting — or fails *Independent* by needing concurrent sibling work. Re-triage as project (promote).
2. **Listing direct changes in the project plan.** A direct change is an alternative to a project (chosen at triage), not a unit inside one. If a chunk would be a 30-second-verifiable diff with no dependency, route it through `drive-triage-work` as its own direct change.
3. **Sequencing that collapses parallelisation opportunities.** Default to parallel unless there's a real dependency. Plans that sequence everything serially lose throughput their dependency graph would allow.
4. **Per-slice DoD coverage maps inherited from the old template.** The project-DoD is checked at close-out directly; restating it per slice is noise. Drop it.
5. **Per-slice "Files in play" or "Predicted size" entries.** That's slice-author work, done at slice-pickup time. Including it here pretends the project plan can predict slice-internals; it can't.
6. **Linear issues missing.** Slices without Linear issues are invisible to the wider team's observability. Sync issues at planning time, not at slice-pickup time.
7. **Plan written over an unsettled spec.** Symptom: the purpose statement is fuzzy; non-goals keep shifting; DoD conditions feel made up. Route back to `drive-specify-project` (which routes back to `drive-discussion`).
8. **5+ slices accepted without questioning project boundary.** The 1–4-slice sweet spot exists because coordination overhead scales nonlinearly with slice count. A 6-slice project is two 3-slice projects in a trenchcoat.

## References

- [`./templates/plan.template.md`](./templates/plan.template.md) — the fillable template.
- [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md) — slice-INVEST; the "manageable in a single code review" framing.
- [`drive/calibration/sizing.md`](../../drive/calibration/sizing.md) — this repo's slice-shape patterns (clean vs mis-sized).
- [`docs/drive/model.md`](../../docs/drive/model.md) § Slice — invariants I1 (one PR per slice), I2 (scope discipline).
