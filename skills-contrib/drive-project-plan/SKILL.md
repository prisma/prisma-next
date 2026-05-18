---
name: drive-project-plan
description: >
  Compose a project's slices + direct changes into a sequenced project plan with stack
  (delivery order) and parallel (independent) groupings. Use after drive-project-specify
  has settled the project spec. Outputs projects/<project>/plan.md listing each slice +
  direct change with its purpose, scope, dependencies, and target Linear issue. Split
  from drive-create-plan; the slice variant is drive-slice-plan.
metadata:
  version: "2026.5.18"
  split_from: drive-create-plan
---

# Drive: Project Plan

Compose a project into its sequence of slices + direct changes. A project plan answers two questions:

1. **What units of work make up this project?** A list of slices + direct changes, each with a purpose, scope, and Linear issue.
2. **In what order?** Stack (must-deliver-in-sequence) vs parallel (can-deliver-independently). Plus dependencies between them.

The plan does NOT decompose each slice into dispatches — that's `drive-slice-plan`'s job, fired when the slice is picked up.

## When to use

- After `drive-project-specify` has produced `projects/<project>/spec.md`.
- When picking up an existing project whose plan needs re-sequencing (e.g. mid-flight scope shift, slice dependencies discovered late).

**Do not use this skill for:**

- Slice-level dispatch planning — that's `drive-slice-plan`.
- The project spec — that's `drive-project-specify`.
- Direct-change planning — direct changes have no plan; intent goes in the PR body.

## Pre-conditions

- `projects/<project>/spec.md` exists, with purpose + scope + project-DoD pinned.
- The operator (or `drive-discussion`) has converged on a rough decomposition of the project into slice-sized units.
- Optional: `drive/plan/README.md` exists with team-specific sequencing heuristics + parallelisation patterns.

## Post-conditions

- `projects/<project>/plan.md` exists and lists each slice + direct change with: name, purpose, scope, dependencies, target Linear issue, stack-or-parallel position.
- Each unit is sized correctly (slice ≤ 1 PR; direct change ≤ 30-second-verifiable diff). Oversized units have been re-triaged (likely outcome: split into smaller slices or promoted to its own project).
- Stack ordering is acyclic; parallel groups have no inter-group dependencies.
- Linear Project has corresponding issues for each unit (created via Linear MCP if missing).

## Project context

Load `drive/plan/README.md` + `drive/project/README.md` at workflow step 1 if they exist. These carry team-specific patterns — common sequencing traps, parallelisation heuristics, Linear-sync conventions for slice issues, the team's calibration for stack vs parallel grouping.

## Workflow

### Step 1 — Load project context

Read `drive/plan/README.md` + `drive/project/README.md` (and re-read `projects/<project>/spec.md` if not already loaded in context).

### Step 2 — Research codebase the plan will touch

Before sequencing slices, look up the packages, IR shapes, test infrastructure, and call sites the plan will touch. Use Grep / Read / Glob / SemanticSearch. Plans depend on accurate cost / blast-radius estimation; estimates ungrounded in the codebase produce slice boundaries that don't survive contact with the code. **"I'm not sure how many call sites this touches" as a planning hole is not acceptable** — search.

### Step 3 — Decompose the project into slices + direct changes

Walk the project's functional requirements + acceptance criteria. For each chunk of work:

- Is it ≤ 30-second-verifiable diff? → **direct change**.
- Is it ≤ 1 PR worth of work with a coherent purpose? → **slice**.
- Is it bigger than that? → **needs further decomposition** (split into multiple slices) OR **needs re-triage as its own project** (if the chunk has its own purpose that exceeds this project's).

Default to fewer-but-coherent slices over many-but-trivial slices. A typical project has 2-6 slices + a handful of direct changes.

### Step 4 — Identify dependencies + sequencing

For each slice / direct change, name the things it depends on:

- **Inside this project**: which other slices need to land first? (A depends on B if A's implementation needs B's API / behaviour / migration.)
- **Outside this project**: which other projects, libraries, infra changes, decisions need to land first?

Group units into:

- **Stack**: ordered list; each item depends on the previous.
- **Parallel**: groups with no inter-group dependencies; each parallel group can proceed independently.

A typical project plan has one stack thread + 1-2 parallel groups, OR all-parallel if the slices are independent.

### Step 5 — Linear sync

For each slice + direct change, create (or align with existing) Linear issue under the project's Linear Project. Use Linear MCP tools. Record the issue ID in the plan entry for that unit.

If the project has no Linear Project yet: surface this and route back to `drive-start-workflow` to scaffold it (this is part of the promote / new-project ceremony).

### Step 6 — Draft the plan

Write `projects/<project>/plan.md` using the **Project Plan Template** below.

### Step 7 — Sanity checks

- Each slice ≤ 1 PR worth? (If any are over: split.)
- Each direct change ≤ 30-second-verifiable? (If any are over: re-classify as slice.)
- Stack acyclic? (No A→B→A loops.)
- Project-DoD's verifiable conditions covered by the slices + direct changes? (If any DoD condition isn't covered by any unit, the plan is incomplete.)

### Step 8 — Hand off

Hand off to `drive-deliver-workflow` to pilot delivery. Or, for operators running manually: `drive-build-workflow` per slice as they're picked up.

## Project Plan Template

```markdown
# Project Plan: <project-name>

**Spec:** `projects/<project>/spec.md`
**Linear Project:** _link_
**Purpose** _(from spec)_: _restate the 1-3 sentence purpose so the plan is self-anchoring_

## At a glance

_1-2 sentences: what slices + direct changes make up this project, in what shape (stack-heavy vs parallel-heavy)._

## Composition

### Stack (deliver in order)

1. **Slice `<name>`** — _purpose._ Scope: _files/surfaces._ Linear: `<issue>`. Depends on: _none._
2. **Slice `<name>`** — _purpose._ Scope: _..._ Linear: `<issue>`. Depends on: slice 1 (uses the foo helper introduced there).
3. ...

### Parallel group A (independent of stack + group B)

- **Slice `<name>`** — _purpose._ Scope: _..._ Linear: `<issue>`.
- **Direct change `<name>`** — _purpose._ Linear: `<issue>`.

### Parallel group B (independent of stack + group A)

- **Slice `<name>`** — _purpose._ Scope: _..._ Linear: `<issue>`.

## Dependencies (external)

_Other projects, libraries, infra, or decisions this project depends on. Each with current status._

- [ ] _Dependency_ — _status / blocker note._

## Project-DoD coverage map

_For each Project-DoD condition from the spec, name the slice(s) + direct change(s) that deliver it. Reveals plan gaps._

| Project-DoD | Delivered by |
|---|---|
| **PDoD1.** _condition_ | Slices 1, 2, parallel A |
| **PDoD2.** _condition_ | Slice 3 |
| _..._ | _..._ |

## Risks + open questions

_Plan-level risks (sequencing assumption that might not hold; parallelisation that might collide; external dependency that might slip). Open questions for design discussion if surfaced._

1. _Risk / question._

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/<project>/spec.md`
- [ ] Mandatory final retro complete; output landed in canonical / project-context / ADR
- [ ] Migrate long-lived docs into `docs/`
- [ ] Strip repo-wide references to `projects/<project>/**` (replace with canonical `docs/` links or remove)
- [ ] Delete `projects/<project>/`
- [ ] Linear Project marked Completed
```

## Pitfalls

1. **Slices that are actually their own projects.** Symptom: a "slice" in the plan would itself need 4+ dispatches with cross-area dependencies. Re-triage as project (promote).
2. **Direct changes that aren't 30-second-verifiable.** A direct change isn't a synonym for "small slice." If the diff isn't obviously-correct from reading any one chunk, it's a slice, not a direct change.
3. **Stack ordering that collapses parallelisation opportunities.** Default to parallel unless there's a real dependency. Sequencing serially when work could parallelise is the most common throughput killer.
4. **Plan that doesn't cover all Project-DoD conditions.** The coverage map is the gate — if a DoD condition has no delivering unit, the plan is incomplete.
5. **Linear issues missing.** Slices without Linear issues are invisible to the wider team's observability. Sync issues at planning time, not at slice-pickup time.
6. **Plan written over an unsettled spec.** Symptom: the purpose statement is fuzzy; scope keeps drifting; DoD conditions feel made up. Route back to `drive-project-specify` (which routes back to `drive-discussion`).

## Checklist

- [ ] Loaded `drive/plan/README.md` + `drive/project/README.md` (if exist)
- [ ] Researched codebase the plan will touch
- [ ] Decomposed into slices + direct changes
- [ ] Each unit sized correctly (slice ≤ 1 PR; direct change ≤ 30-sec)
- [ ] Dependencies identified; stack acyclic; parallel groups independent
- [ ] Linear issues created / aligned for each unit
- [ ] Plan drafted using template
- [ ] DoD coverage map filled (every PDoD covered by some unit)
- [ ] Sanity checks passed

## Related skills

- `drive-project-specify` — produces the spec this plan composes; runs before
- `drive-slice-plan` — decomposes each slice into dispatches; runs when the slice is picked up
- `drive-deliver-workflow` — pilots the project plan to delivery
- `drive-discussion` — fires when sequencing decisions surface load-bearing design questions
- `drive-start-workflow` — handles mid-flight scope shifts that require re-planning

## References

- [`projects/drive-domain-model/model.md`](/projects/drive-domain-model/model.md) § Project; § Layer 3 — sequencing
- [`projects/drive-domain-model/workflow.md`](/projects/drive-domain-model/workflow.md) § Stack vs parallel
- [`projects/drive-domain-model/principles/decomposition-and-cost.md`](/projects/drive-domain-model/principles/decomposition-and-cost.md) — sizing discipline this skill enforces
- [`projects/drive-domain-model/design-decisions.md`](/projects/drive-domain-model/design-decisions.md) § 17 — split rationale
