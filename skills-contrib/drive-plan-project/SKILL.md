---
name: drive-plan-project
description: >
  Compose a project's slices into a sequenced project plan. Each entry carries outcome +
  builds-on + hands-to + focus. Parallelisation opportunities must be surfaced explicitly.
  Use after drive-specify-project has settled the project spec. Outputs
  projects/<project>/plan.md.
metadata:
  version: "2026.5.28"
  split_from: drive-create-plan
---

> **Execution mode: orchestrator-direct.** This atomic skill is invoked by the Orchestrator directly. Running it does NOT change the Orchestrator's role — the file-path boundary, stop-and-delegate triggers, and escape-hatch criterion from the active workflow skill remain in force.
>
> Read-only codebase investigation (Grep / Read / Glob / SemanticSearch) is **permitted and expected** — the skill body requires grounding plans in actual codebase state. If the skill's body asks for work that requires running builds/tests or writing files outside `projects/<current-project>/` — **STOP. Dispatch.** See [`drive/roles/README.md`](../../drive/roles/README.md).

# Drive: Plan Project

Compose a project into its sequence of slices. The plan answers:

1. **What slices make up this project?** A list, sized 1–4 (5+ flagged for re-boundary).
2. **In what order — and what can run in parallel?** Planning bias is sequential by default; a project plan that doesn't surface parallel branches misses real schedule wins.
3. **What does each slice deliver to the next?** Per-entry handoff contracts — *what state does this slice leave for downstream slices to build on?*

A project is composed of slices, never direct changes. Direct changes are an alternative to a project, chosen at triage time, and never appear in a project plan. The plan also does NOT decompose each slice into dispatches — that's `drive-plan-slice`'s job, run when the slice is picked up.

## When to use

- After `drive-specify-project` has produced `projects/<project>/spec.md`.
- When picking up an existing project whose plan needs re-sequencing (e.g. mid-flight scope shift, slice dependencies discovered late).

**Do not use this skill for:**

- Slice-level dispatch planning — that's `drive-plan-slice`.
- The project spec — that's `drive-specify-project`.
- Direct changes — a direct change is an alternative to a project (chosen at triage), not a unit inside one. Direct changes have no plan; intent goes in the PR body. If you find yourself with a 30-second-verifiable diff and no project context, re-route to `drive-triage-work`.

## Pre-conditions

- `projects/<project>/spec.md` exists, with purpose + non-goals + project-DoD pinned.
- The operator (or `drive-discussion`) has converged on a rough decomposition of the project into slice-sized units.
- Optional: `drive/plan/README.md` exists with team-specific sequencing heuristics + parallelisation patterns; `drive/calibration/sizing.md` exists with the team's INVEST rubric and slice-shape reference patterns.

## Post-conditions

- `projects/<project>/plan.md` exists; lists each slice with outcome, builds-on, hands-to, focus, Linear issue.
- Parallelisation is explicit — the plan names which slices can proceed independently and which must stack.
- Each slice passes slice-INVEST (see [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md)) — in particular, *Small* meaning **manageable in a single code review**.
- Slice count is in the 1–4 sweet spot (5+ flagged for project re-boundary).
- Linear Project has corresponding issues for each slice (created via Linear MCP if missing).

## Project context

Load `drive/plan/README.md` + `drive/project/README.md` at workflow step 1 if they exist. Team-specific patterns: common sequencing traps, parallelisation heuristics, Linear-sync conventions, the team's calibration for stack vs parallel grouping.

## Workflow

### Step 1 — Load project context

Read `drive/plan/README.md` + `drive/project/README.md` and re-read `projects/<project>/spec.md` if not already loaded.

### Step 2 — Research codebase the plan will touch

Before sequencing, look up the packages, IR shapes, test infrastructure, and call sites the plan will touch. Use Grep / Read / Glob / SemanticSearch. Slice boundaries depend on accurate cost / blast-radius estimation; estimates ungrounded in the codebase produce slices that don't survive contact with the code. **"I'm not sure how many call sites this touches" as a planning hole is not acceptable** — search.

### Step 3 — Decompose the project into slices

Walk the project's cross-cutting requirements + transitional-shape constraints. Name each chunk's outcome — what's true after this slice lands. Apply **slice-INVEST** to each candidate (see [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md); per-altitude rubric specialised for this codebase at [`drive/calibration/sizing.md`](../../drive/calibration/sizing.md)):

- **Independent** — ships as one PR without needing a sibling slice to merge concurrently.
- **Negotiable** — the slice's outcome can be delivered by several plausible dispatch sequences.
- **Valuable** — closes a real gap in the project's purpose; not "preparation for slice 3."
- **Estimable** — slice-DoD conditions are binary and verifiable at PR-merge time.
- **Small** — **manageable in a single code review.** One reviewer reads the PR in one sitting, holds the coherence, and reaches a verdict without re-orienting mid-review. The test is *coherence*, not LoC.
- **Testable** — slice-DoD + project-DoD floor compose into a passable bar at PR-open time.

If a candidate fails Small or Estimable, split it into two slices with an explicit hand-off. If it fails Independent or Valuable, re-shape it (it may be two slices, or it may not be a slice at all).

If a chunk turns out to be a 30-second-verifiable diff with no dependency on other slices, that's a sign this chunk shouldn't be in the project — re-route to `drive-triage-work`; it's probably a direct change that escaped triage.

**Sweet spot: 1–4 slices per project.** Fewer is fine (a one-slice project warranted by design depth). 5+ slices probably means two projects — the coordination overhead and branch-stacking cost of a long project chain dominates the value. If you find yourself listing 5+ slices, stop and consider whether this is one project or two.

### Step 4 — Identify dependencies + parallelisation

For each slice:

- **Builds on** — which other slices (inside or outside this project) must land first for this one to be coherent? Direct dependencies only — don't transitively list grandparents.
- **Hands to** — what state does this slice leave for downstream slices to consume? (The next slice's `builds on` should reference this hand-off.)

Then group:

- **Stack** — ordered list; each item builds on the previous's hand-off.
- **Parallel** — groups with no inter-group dependencies; each parallel group can proceed independently. **Default to parallel.** If the dependency graph is permissive, the plan should be permissive too — serializing work that could parallelise is the most common throughput killer.

A typical project plan has one stack thread + 1–2 parallel groups, OR all-parallel if the slices are independent.

### Step 5 — Linear sync

For each slice, create (or align with existing) Linear issue under the project's Linear Project. Use Linear MCP tools. Record the issue ID in the plan entry.

If the project has no Linear Project yet: surface this and route back to `drive-start-workflow` to scaffold it (this is part of the promote / new-project ceremony).

### Step 6 — Draft the plan

Write `projects/<project>/plan.md` using the **Project Plan Template** below.

### Step 7 — Sanity checks

- Each slice passes slice-INVEST (in particular, Small = manageable in a single code review)?
- Slice count ≤ 4? (If over: probably two projects.)
- Stack acyclic? (No A→B→A loops.)
- Parallelisation maximised? (Anything sequenced that could be parallel?)
- Every project-DoD condition reachable from the slices?

### Step 8 — Hand off

Hand off to `drive-deliver-workflow` to pilot delivery.

## Project Plan Template

```markdown
# <project-name> — Plan

**Spec:** `projects/<project>/spec.md`
**Linear Project:** _link_

## At a glance

_1–2 sentences: what slices make up this project, in what shape (stack-heavy / parallel-heavy / mixed)._

## Composition

### Stack (deliver in order)

1. **Slice `<name>`** — Linear: `<issue>`
   - **Outcome:** _What this slice makes true for the system._
   - **Builds on:** _None / external dependency / earlier stack item._
   - **Hands to:** _The state this slice leaves for downstream units to consume._
   - **Focus:** _What's in scope here; adjacent surfaces deliberately handled by other slices._

2. **Slice `<name>`** — Linear: `<issue>`
   - **Outcome:** _..._
   - **Builds on:** _Slice 1's `<hand-off>`._
   - **Hands to:** _..._
   - **Focus:** _..._

### Parallel group A (independent of stack and group B)

- **Slice `<name>`** — Linear: `<issue>`
  - **Outcome:** _..._
  - **Builds on:** _None._
  - **Hands to:** _..._
  - **Focus:** _..._

### Parallel group B (independent of stack and group A)

- **Slice `<name>`** — Linear: `<issue>`
  - **Outcome:** _..._
  - **Builds on:** _None._
  - **Hands to:** _..._
  - **Focus:** _..._

## Dependencies (external)

_Other projects, libraries, infra changes, or decisions this project depends on. Each with current status._

- [ ] _Dependency_ — _status / blocker note._

## Sequencing rationale

_Where the sequencing isn't obvious from the dependency graph: why is it shaped this way? (Transitional-shape constraints from the spec; deploy-without-downtime requirements; reviewer-bandwidth pacing; etc.) Skip if the order follows directly from "builds on" entries._
```

## Pitfalls

1. **Slices that are actually their own projects.** Symptom: a "slice" in the plan fails slice-INVEST's *Small* — one reviewer cannot hold its coherence in one sitting — or fails *Independent* by needing concurrent sibling work. Re-triage as project (promote).
2. **Listing direct changes in the project plan.** A direct change is an alternative to a project (chosen at triage), not a unit inside one. If a chunk of work would be a 30-second-verifiable diff with no dependency on other slices, it doesn't belong in this plan — route it back through `drive-triage-work` as its own direct change.
3. **Sequencing that collapses parallelisation opportunities.** Default to parallel unless there's a real dependency. Project plans that sequence everything serially lose the throughput their dependency graph would allow.
4. **Per-slice DoD coverage maps inherited from the old template.** The project-DoD is checked at close-out directly; restating it per slice is noise. Drop it.
5. **Per-slice "Files in play" or "Predicted size" entries.** Those are slice-author work, done at slice-pickup time. Including them here pretends the project plan can predict slice-internals; it can't.
6. **Linear issues missing.** Slices without Linear issues are invisible to the wider team's observability. Sync issues at planning time, not at slice-pickup time.
7. **Plan written over an unsettled spec.** Symptom: the purpose statement is fuzzy; non-goals keep shifting; DoD conditions feel made up. Route back to `drive-specify-project` (which routes back to `drive-discussion`).
8. **Plan with 5+ slices accepted without questioning project boundary.** The 1–4-slice sweet spot exists because coordination overhead scales nonlinearly with slice count. A 6-slice project is two 3-slice projects in a trenchcoat.

## Checklist

- [ ] Loaded `drive/plan/README.md` + `drive/project/README.md` (if exist)
- [ ] Researched codebase the plan will touch
- [ ] Decomposed into slices (no direct changes in the plan)
- [ ] Each slice passes slice-INVEST (Small = manageable in a single code review)
- [ ] Slice count ≤ 4 (if over: re-consider project boundary)
- [ ] Each entry has outcome / builds-on / hands-to / focus
- [ ] Parallelisation explicit; default-to-parallel applied
- [ ] Stack acyclic
- [ ] Linear issues created / aligned for each slice
- [ ] Plan drafted using template

## Related skills

- `drive-specify-project` — produces the spec this plan composes
- `drive-plan-slice` — decomposes each slice into dispatches; runs when the slice is picked up
- `drive-deliver-workflow` — pilots the project plan to delivery
- `drive-discussion` — fires when sequencing decisions surface design questions that need a decision before planning continues
- `drive-start-workflow` — handles mid-flight scope shifts that require re-planning

## References

- [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md) — sizing principle (logical coherence; INVEST at three altitudes; slice-Small = manageable in a single code review)
- [`drive/calibration/sizing.md`](../../drive/calibration/sizing.md) — this codebase's INVEST rubric and slice-shape reference patterns
- [`docs/drive/design-decisions/2026-05-28-artifact-cascade-redesign.md`](../../docs/drive/design-decisions/2026-05-28-artifact-cascade-redesign.md) — the redesign that introduced outcome / builds-on / hands-to / focus entries, required explicit parallelisation, and pinned the 1–4-slice sweet spot
- [`drive/plan/README.md`](../../drive/plan/README.md) — stack vs parallel heuristics
- [`drive/project/README.md`](../../drive/project/README.md) — slice-composition patterns for this repo
