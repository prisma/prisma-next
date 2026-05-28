---
name: drive-plan-slice
description: >
  Decompose a slice spec into a sequence of dispatches. Each dispatch entry carries
  outcome + builds-on + hands-to + focus. Target ≤ 10 M-sized dispatches; M-cap enforced
  at the dispatch (L/XL dispatches are refused with a re-decomposition request). Use
  after drive-specify-slice has settled the slice spec. Outputs the slice plan inline in
  the slice spec or as projects/<project>/slices/<slice>/plan.md.
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
3. **At what size?** Each dispatch is M-sized or smaller (the M-cap). L/XL dispatches are refused; re-decompose into multiple Ms.

The slice plan is the artifact `drive-build-workflow` reads to pilot the dispatch loop. **Handoff contracts catch non-linear dependencies** — dispatch N may depend on N-2's hand-off, not N-1's; explicit `builds on` per dispatch surfaces this where order alone hides it.

## When to use

- After `drive-specify-slice` has produced the slice spec.
- When picking up a slice whose plan needs re-decomposition (e.g. a dispatch came back L/XL and needs splitting).

**Do not use this skill for:**

- Project-level planning — that's `drive-plan-project`.
- The slice spec — that's `drive-specify-slice`.
- The actual delivery loop — that's `drive-build-workflow`.

## Pre-conditions

- Slice spec exists (`projects/<project>/slices/<slice>/spec.md` for in-project; held content for orphan).
- Slice scope is concrete (named surfaces).
- Slice-DoD lists the verifiable conditions the slice must meet.
- Optional: `drive/plan/README.md` exists with team-specific dispatch-sizing heuristics; `drive/calibration/sizing.md` exists with the team's S/M/L/XL reference cases.

## Post-conditions

- Slice plan written (inline in slice spec under `## Dispatch plan` or as separate `plan.md` in slice directory).
- Each dispatch entry carries outcome / builds-on / hands-to / focus.
- Each dispatch sized S or M (no L/XL).
- Sequence is acyclic; non-linear handoffs surfaced via `builds on` entries.

## Project context

Load `drive/plan/README.md` + `drive/calibration/sizing.md` at workflow step 1 if they exist. The team's calibration is the ground truth for what S / M means in this codebase.

## Workflow

### Step 1 — Load project context

Read `drive/plan/README.md` + `drive/calibration/sizing.md` (re-read the slice spec if not in context).

### Step 2 — Research codebase the slice will touch

Ground the dispatch boundaries in actual files. Use Grep / Read / Glob / SemanticSearch. For each surface in the slice spec's scope, identify the concrete files / packages / tests / fixtures that change. Without this, dispatch boundaries get drawn at the wrong joints.

### Step 3 — Decompose into dispatches

Walk the slice scope. For each chunk of work:

- Is it a coherent, M-sized (or smaller) change with a clear outcome? → **a dispatch**.
- Is it L or XL? → **decompose further** into multiple Ms with explicit hand-off state.

**Sizing target:** ≤ 10 M-dispatches per slice. If you find yourself listing more, the slice itself is probably mis-shaped — re-triage as project.

**Default sequencing:** each dispatch builds on the previous's hand-off. Common shapes:

- **Sandwich**: contract / interface dispatch first; implementation dispatch; call-site / consumer migration dispatch.
- **Test-first**: write the failing test (dispatch 1); implement (dispatch 2); regenerate fixtures + final review (dispatch 3).
- **Migration-shaped**: nullable column / feature flag (dispatch 1); dual-write or dual-read (dispatch 2); migrate consumers (dispatch 3); remove old path (dispatch 4) — though this shape often signals the slice should be a project with multiple slices.

### Step 4 — Size each dispatch (S/M; refuse L/XL)

Apply the team's calibration (`drive/calibration/sizing.md` if present; otherwise the defaults below).

**Default sizing (override in `drive/calibration/sizing.md`):**

- **S (≤ 30 min implementer time)**: one file, small diff, no new design decisions, no fixture regeneration.
- **M (≤ 2 hr implementer time)**: 2–4 files, ~200 LoC diff, fits in one agent session, optional fixture regeneration.
- **L (> 2 hr)**: REFUSED. Re-decompose into multiple Ms.
- **XL (> 4 hr)**: REFUSED. Re-decompose; if it can't decompose into Ms cleanly, the slice itself is mis-shaped — re-triage.

Sizing process:

1. Estimate based on files touched + LoC + cognitive complexity (new design decisions, layer-crossings).
2. Cross-check against the team's reference cases in `drive/calibration/sizing.md`.
3. If estimate is L or XL, decompose further or escalate.

### Step 5 — Surface handoff contracts

For each dispatch entry, fill `builds on` and `hands to` explicitly. Two checks:

- **Linearity check:** does each dispatch's `builds on` reference the immediately-prior dispatch's `hands to`? If not, the sequencing has a non-linear dependency the brief-assembler needs to know about (the executor needs context from dispatch N-2's hand-off, not just N-1's).
- **Completeness check:** does the final dispatch's `hands to` add up to the slice-DoD? If a slice-DoD condition isn't reachable from the dispatch sequence, the plan is incomplete.

### Step 6 — Draft the plan

Write the slice plan inline in the slice spec (under a `## Dispatch plan` heading) or as `projects/<project>/slices/<slice>/plan.md`. Use the **Slice Plan Template** below.

### Step 7 — Sanity checks

- Each dispatch sized S or M (no L/XL).
- Each dispatch's outcome is binary + observable.
- Slice-DoD's conditions reachable from the dispatch sequence.
- Total ≤ 10 dispatches.

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
- **Size:** S | M

### Dispatch 2: <name>

- **Outcome:** _..._
- **Builds on:** _Dispatch 1's `<hand-off>`._
- **Hands to:** _..._
- **Focus:** _..._
- **Size:** S | M

_(Repeat per dispatch; total ≤ 10.)_
```

## Pitfalls

1. **L/XL dispatch accepted "just this once."** The M-cap is what keeps WIP inspection cheap and dispatch failures recoverable. An L dispatch that fails leaves a large chunk of half-done work; re-running it is expensive. Always re-decompose.
2. **Dispatch boundary drawn at the wrong joint.** Symptom: dispatch 2 has to undo something dispatch 1 set up. The hand-off should be a *stable state* the next dispatch builds on. If you can't articulate the stable state, the joint is wrong.
3. **Inheriting per-dispatch DoR / DoD checklists from the old template.** Those belonged in the brief, where they go now (and even there, they thin out — see `drive-build-workflow` for the new brief shape). The slice plan tells the brief-assembler *what the dispatch must accomplish*; the brief-assembler turns that into operational metadata.
4. **Inheriting per-dispatch "Files in play" from the old template.** That's implementer discovery work. Naming files in the plan pretends the planner knows them all; usually they don't, and listing them creates a false sense of completeness.
5. **Outcome that isn't binary.** *"Code reviewed"* isn't binary unless the review surface is named. *"CI green for `pnpm test:packages -- <pkg>`"* is binary; *"Tests look right"* isn't.
6. **Sizing ungrounded in the team's calibration.** Sizing labels (S / M) only mean something when calibrated against reference cases. Without calibration, "M" drifts; the team starts accepting effective-Ls as Ms.
7. **Hand-off contracts that are empty or vague.** *"Dispatch 1 hands to dispatch 2"* isn't a hand-off; the named state (*"the `Foo` interface is exported and tests cover the round-trip"*) is. Hand-off is what makes the slice plan work as a contract between dispatches.

## Checklist

- [ ] Loaded `drive/plan/README.md` + `drive/calibration/sizing.md` (if exist); slice spec re-read
- [ ] Researched codebase the slice will touch; concrete file lists for each surface
- [ ] Decomposed into S/M dispatches (no L/XL)
- [ ] Each dispatch sized against team's calibration
- [ ] Each entry has outcome / builds-on / hands-to / focus
- [ ] Total ≤ 10 dispatches
- [ ] Hand-off contracts explicit (named stable state, not vague "passes to next")
- [ ] Slice-DoD's conditions reachable from the dispatch sequence

## Related skills

- `drive-specify-slice` — produces the slice spec this plan decomposes
- `drive-plan-project` — composes slices into project sequencing; the parent layer
- `drive-build-workflow` — pilots the dispatch loop this plan defines
- `drive-discussion` — fires when decomposition surfaces design questions that need a decision before decomposition continues
- `drive-qa-plan` — the manual-QA dispatch's plan, woven into the slice plan when applicable

## References

- [`docs/drive/design-decisions/2026-05-28-artifact-cascade-redesign.md`](../../docs/drive/design-decisions/2026-05-28-artifact-cascade-redesign.md) — the redesign that simplified slice-plan entries to outcome / builds-on / hands-to / focus and moved per-dispatch DoR into the brief
- [`drive/plan/README.md`](../../drive/plan/README.md) — two-cap sizing system, team-specific overlays
- [`drive/calibration/sizing.md`](../../drive/calibration/sizing.md) — S/M/L/XL reference cases for this repo
- [`drive-build-workflow/SKILL.md`](../drive-build-workflow/SKILL.md) — dispatch loop this plan feeds
