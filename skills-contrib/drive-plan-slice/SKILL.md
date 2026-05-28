---
name: drive-plan-slice
description: >
  Decompose a slice spec into a sequence of dispatches. Each dispatch entry carries
  outcome + builds-on + hands-to + focus. Each dispatch passes dispatch-INVEST (Independent,
  Negotiable, Valuable, Estimable, Small, Testable — see docs/drive/principles/sizing.md);
  dispatches that fail Small or Estimable get re-decomposed before the slice plan ships.
  Target ≤ ~10 dispatches per slice. Use after drive-specify-slice has settled the slice
  spec. Outputs the slice plan inline in the slice spec or as
  projects/<project>/slices/<slice>/plan.md.
metadata:
  version: "2026.5.28"
  split_from: drive-create-plan
---

> **Execution mode: orchestrator-direct.** This atomic skill is invoked by the Orchestrator directly. Running it does NOT change the Orchestrator's role — the file-path boundary, stop-and-delegate triggers, and escape-hatch criterion from the active workflow skill remain in force.
>
> Read-only codebase investigation (Grep / Read / Glob / SemanticSearch) is **permitted and expected** — the skill body requires grounding plans in actual codebase state. If the skill's body asks for work that requires running builds/tests or writing files outside `projects/<current-project>/` — **STOP. Dispatch.** See [`drive/roles/README.md`](../../drive/roles/README.md).

# Drive: Plan Slice

Decompose a slice into the sequence of dispatches that delivers it. The plan answers:

1. **What dispatches make up this slice?** A list of dispatches; each entry carries outcome + builds-on + hands-to + focus.
2. **In what order?** Dispatches inside a slice are typically sequential (each builds on the previous's hand-off); parallel-within-slice is rare and usually means the slice should be split.
3. **Is each dispatch well-sized?** Each dispatch passes **dispatch-INVEST** (Independent, Negotiable, Valuable, Estimable, Small, Testable — see [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md)). The check is *logical coherence* — one outcome the executor can hold, deliver, and verify — not file count, LoC, or time-box. Dispatches that fail Small or Estimable get re-decomposed before the slice plan ships.

The slice plan is the artifact `drive-build-workflow` reads to pilot the dispatch loop. **Handoff contracts catch non-linear dependencies** — dispatch N may depend on N-2's hand-off, not N-1's; explicit `builds on` per dispatch surfaces this where order alone hides it.

## When to use

- After `drive-specify-slice` has produced the slice spec.
- When picking up a slice whose plan needs re-decomposition (e.g. a dispatch failed dispatch-INVEST during execution and needs splitting).

**Do not use this skill for:**

- Project-level planning — that's `drive-plan-project`.
- The slice spec — that's `drive-specify-slice`.
- The actual delivery loop — that's `drive-build-workflow`.

## Pre-conditions

- Slice spec exists (`projects/<project>/slices/<slice>/spec.md` for in-project; held content for orphan).
- Slice scope is concrete (named surfaces).
- Slice-DoD lists the verifiable conditions the slice must meet.
- Optional: `drive/plan/README.md` exists with team-specific dispatch-sizing heuristics; `drive/calibration/sizing.md` exists with the team's INVEST rubric and dispatch-shape reference patterns.

## Post-conditions

- Slice plan written (inline in slice spec under `## Dispatch plan` or as separate `plan.md` in slice directory).
- Each dispatch entry carries outcome / builds-on / hands-to / focus.
- Each dispatch passes dispatch-INVEST against the team's calibration.
- Sequence is acyclic; non-linear handoffs surfaced via `builds on` entries.

## Project context

Load `drive/plan/README.md` + `drive/calibration/sizing.md` at workflow step 1 if they exist. The team's calibration is the ground truth for what dispatch-INVEST looks like in this codebase — what shapes pass cleanly, what shapes signal mis-sizing.

## Workflow

### Step 1 — Load project context

Read `drive/plan/README.md` + `drive/calibration/sizing.md` (re-read the slice spec if not in context).

### Step 2 — Research codebase the slice will touch

Ground the dispatch boundaries in actual files. Use Grep / Read / Glob / SemanticSearch. For each surface in the slice spec's scope, identify the concrete files / packages / tests / fixtures that change. Without this, dispatch boundaries get drawn at the wrong joints.

### Step 3 — Decompose into dispatches

Walk the slice scope. For each chunk of work, name the outcome — what's true after this lands. If you can name one outcome in one sentence, that's a candidate dispatch. If you need multiple sentences, that's multiple dispatches.

**Sizing target:** ≤ ~10 dispatches per slice. If you find yourself listing more, the slice itself is probably mis-shaped — re-triage as project.

**Default sequencing:** each dispatch builds on the previous's hand-off. Common shapes:

- **Sandwich**: contract / interface dispatch first; implementation dispatch; call-site / consumer migration dispatch.
- **Test-first**: write the failing test (dispatch 1); implement (dispatch 2); regenerate fixtures + final review (dispatch 3).
- **Migration-shaped**: nullable column / feature flag (dispatch 1); dual-write or dual-read (dispatch 2); migrate consumers (dispatch 3); remove old path (dispatch 4) — though this shape often signals the slice should be a project with multiple slices.

### Step 4 — Check each dispatch against dispatch-INVEST

For each candidate dispatch, walk the dispatch-INVEST checklist (see [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md) for the full definitions; [`drive/calibration/sizing.md`](../../drive/calibration/sizing.md) for this-repo specialisations):

- **Independent** — produces a usable hand-off without concurrent work elsewhere.
- **Negotiable** — outcome named; implementation path is the executor's discovery.
- **Valuable** — moves the slice's outcome materially.
- **Estimable** — a binary `Completed when` checklist can be written.
- **Small** — brief + references fit in the executor's context.
- **Testable** — a small set of gates verifies the outcome.

If any letter fails, the dispatch isn't shaped yet. Fix and recheck:

- **Fails Small** (too big): split into two dispatches with explicit hand-off, OR sharpen the outcome to a coherent subset.
- **Fails Estimable** (can't write a binary checklist): outcome is fuzzy — sharpen it before dispatching.
- **Fails Valuable** ("preparation for the next dispatch only"): bundle it into the dispatch that consumes it.
- **Fails Independent** (depends on concurrent work): re-sequence or re-decompose.

**Do not size by file count or LoC.** A 200-file mechanical codemod with one outcome passes Small cleanly; a 3-file change with three outcomes fails Small even though the diff is tiny. The check is *outcome coherence*, not output footprint.

Cross-check candidate dispatches against the dispatch-shape patterns in `drive/calibration/sizing.md` — recognised passes ("mechanical fan-out / codemod"; "surgical substrate change") and recognised mis-sizings ("substrate change + consumer migration in one dispatch"; "mechanical fan-out + design judgment in one dispatch").

### Step 5 — Surface handoff contracts

For each dispatch entry, fill `builds on` and `hands to` explicitly. Two checks:

- **Linearity check:** does each dispatch's `builds on` reference the immediately-prior dispatch's `hands to`? If not, the sequencing has a non-linear dependency the brief-assembler needs to know about (the executor needs context from dispatch N-2's hand-off, not just N-1's).
- **Completeness check:** does the final dispatch's `hands to` add up to the slice-DoD? If a slice-DoD condition isn't reachable from the dispatch sequence, the plan is incomplete.

### Step 6 — Draft the plan

Write the slice plan inline in the slice spec (under a `## Dispatch plan` heading) or as `projects/<project>/slices/<slice>/plan.md`. Use the **Slice Plan Template** below.

### Step 7 — Sanity checks

- Each dispatch passes dispatch-INVEST (Independent, Negotiable, Valuable, Estimable, Small, Testable).
- Each dispatch's outcome is binary + observable.
- Slice-DoD's conditions reachable from the dispatch sequence.
- Total ≤ ~10 dispatches.

### Step 8 — Hand off

Hand off to `drive-build-workflow` to pilot the dispatch loop.

## Slice Plan Template

```markdown
## Dispatch plan

_(In-slice-spec section, OR `projects/<project>/slices/<slice>/plan.md`.)_

### Dispatch 1: <name>

- **Outcome:** _What this dispatch makes true. Binary + observable._
- **Builds on:** _None / external dependency / "the spec's chosen design"._
- **Hands to:** _The state this dispatch leaves for the next._
- **Focus:** _In-scope here; adjacent surfaces handled by other dispatches in this slice (or out-of-scope per spec)._

### Dispatch 2: <name>

- **Outcome:** _..._
- **Builds on:** _Dispatch 1's `<hand-off>`._
- **Hands to:** _..._
- **Focus:** _..._

_(Repeat per dispatch; total ≤ ~10.)_
```

## Pitfalls

1. **Sizing on file count or LoC instead of outcome coherence.** A 200-file mechanical codemod is one logical unit; a 3-file change with three outcomes is three. Apply dispatch-INVEST, not "is this S, M, or L."
2. **Outsized dispatch accepted "just this once."** Dispatch-INVEST's *Small* exists to keep WIP inspection cheap and dispatch failures recoverable. A dispatch that fails Small and ships anyway leaves a large chunk of half-done work when it goes wrong; re-running it is expensive. Always re-decompose.
3. **Dispatch boundary drawn at the wrong joint.** Symptom: dispatch 2 has to undo something dispatch 1 set up. The hand-off should be a *stable state* the next dispatch builds on. If you can't articulate the stable state, the joint is wrong.
4. **Inheriting per-dispatch DoR / DoD checklists from the old template.** Those belonged in the brief, where they go now (and even there, they thin out — see `drive-build-workflow` for the new brief shape). The slice plan tells the brief-assembler *what the dispatch must accomplish*; the brief-assembler turns that into operational metadata.
5. **Inheriting per-dispatch "Files in play" from the old template.** That's implementer discovery work. Naming files in the plan pretends the planner knows them all; usually they don't, and listing them creates a false sense of completeness.
6. **Outcome that isn't binary.** *"Code reviewed"* isn't binary unless the review surface is named. *"CI green for `pnpm test:packages -- <pkg>`"* is binary; *"Tests look right"* isn't.
7. **INVEST applied ungrounded in the team's calibration.** The letters mean things specific to this codebase — the calibration in `drive/calibration/sizing.md` is what *Small* and *Testable* concretely look like here. Without it, INVEST drifts to whatever the planner imagines.
8. **Hand-off contracts that are empty or vague.** *"Dispatch 1 hands to dispatch 2"* isn't a hand-off; the named state (*"the `Foo` interface is exported and tests cover the round-trip"*) is. Hand-off is what makes the slice plan work as a contract between dispatches.

## Checklist

- [ ] Loaded `drive/plan/README.md` + `drive/calibration/sizing.md` (if exist); slice spec re-read
- [ ] Researched codebase the slice will touch; concrete file lists for each surface
- [ ] Decomposed into candidate dispatches based on outcome coherence
- [ ] Each dispatch passes dispatch-INVEST against the team's calibration
- [ ] Each entry has outcome / builds-on / hands-to / focus
- [ ] Total ≤ ~10 dispatches
- [ ] Hand-off contracts explicit (named stable state, not vague "passes to next")
- [ ] Slice-DoD's conditions reachable from the dispatch sequence

## Related skills

- `drive-specify-slice` — produces the slice spec this plan decomposes
- `drive-plan-project` — composes slices into project sequencing; the parent layer
- `drive-build-workflow` — pilots the dispatch loop this plan defines
- `drive-discussion` — fires when decomposition surfaces design questions that need a decision before decomposition continues
- `drive-qa-plan` — the manual-QA dispatch's plan, woven into the slice plan when applicable

## References

- [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md) — sizing principle (logical coherence, not logistical footprint; INVEST at three altitudes)
- [`drive/calibration/sizing.md`](../../drive/calibration/sizing.md) — this codebase's INVEST rubric and dispatch-shape reference patterns
- [`docs/drive/design-decisions/2026-05-28-artifact-cascade-redesign.md`](../../docs/drive/design-decisions/2026-05-28-artifact-cascade-redesign.md) — the redesign that simplified slice-plan entries to outcome / builds-on / hands-to / focus and moved per-dispatch DoR into the brief
- [`drive/plan/README.md`](../../drive/plan/README.md) — team-specific sequencing + parallelisation overlays
- [`drive-build-workflow/SKILL.md`](../drive-build-workflow/SKILL.md) — dispatch loop this plan feeds
