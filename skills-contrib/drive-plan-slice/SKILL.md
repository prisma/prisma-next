---
name: drive-plan-slice
description: >
  Decompose a slice spec into the sequence of dispatches that delivers it. Each
  entry carries outcome + builds-on + hands-to + focus. Every dispatch passes
  dispatch-INVEST (logical coherence, not file count); dispatches that fail Small
  or Estimable get re-decomposed before the plan ships. Target ≤ ~10 dispatches.
  Use after drive-specify-slice has settled the slice spec. Outputs the slice plan
  inline in the spec or as projects/<project>/slices/<slice>/plan.md. Hands off
  to drive-build-workflow.
metadata:
  version: "2026.5.28"
---

> **Execution mode: orchestrator-direct.** Atomic skill invoked by the Orchestrator
> directly. Read-only codebase investigation (Grep / Read / Glob / SemanticSearch)
> is permitted and expected. If the body would require running builds/tests or
> writing files outside `projects/<current-project>/` — **STOP. Dispatch.** See
> [`drive/roles/README.md`](../../drive/roles/README.md).

# Drive: Plan Slice

The slice plan is the artifact `drive-build-workflow` reads to pilot the dispatch loop. It answers:

1. **What dispatches make up this slice?** Each entry carries outcome + builds-on + hands-to + focus.
2. **In what order?** Dispatches inside a slice are typically sequential — each builds on the previous's hand-off. Parallel-within-slice is rare and usually means the slice should be split.
3. **Is each dispatch well-sized?** Each passes **dispatch-INVEST**. The check is *logical coherence* — one outcome the executor can hold, deliver, and verify — never file count, LoC, or time-box.

**Handoff contracts catch non-linear dependencies.** Dispatch N may depend on N-2's hand-off, not N-1's; explicit `builds on` surfaces this where order alone hides it.

The plan template lives at [`./templates/plan.template.md`](./templates/plan.template.md). Fill it; don't author from scratch.

## Workflow

### Step 1 — Load context

Read `drive/plan/README.md` + `drive/calibration/sizing.md` if they exist; re-read the slice spec. The calibration is the ground truth for what dispatch-INVEST looks like in this codebase.

### Step 2 — Ground in the codebase

For each surface in the slice spec's scope, identify the concrete files / packages / tests / fixtures that change. Use Grep / Read / Glob / SemanticSearch. Without this, dispatch boundaries get drawn at the wrong joints.

### Step 3 — Decompose into candidate dispatches

Walk the slice scope. For each chunk, name the outcome — what's true after this lands. If you can name one outcome in one sentence, that's a candidate dispatch. If you need multiple sentences, that's multiple dispatches.

Common shapes:

- **Sandwich** — contract / interface dispatch first; implementation dispatch; consumer-migration dispatch.
- **Test-first** — failing test (1); implement (2); fixtures + final review (3).
- **Migration-shaped** — nullable column / flag (1); dual-write (2); migrate consumers (3); remove old path (4). This shape often signals the slice should be a project with multiple slices.

**Sizing target: ≤ ~10 dispatches per slice.** More usually means the slice is mis-shaped — re-triage as project.

### Step 4 — Check each dispatch against dispatch-INVEST

Walk the dispatch-INVEST checklist (full definitions in [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md); this-repo specialisations in [`drive/calibration/sizing.md`](../../drive/calibration/sizing.md)):

- **Independent** — produces a usable hand-off without concurrent work elsewhere.
- **Negotiable** — outcome named; implementation path is the executor's discovery.
- **Valuable** — moves the slice's outcome materially.
- **Estimable** — a binary `Completed when` checklist can be written.
- **Small** — brief + references fit in the executor's context.
- **Testable** — a small set of gates verifies the outcome.

If any letter fails, the dispatch isn't shaped yet:

- *Small* fails (too big) → split into two with an explicit hand-off, OR sharpen the outcome to a coherent subset.
- *Estimable* fails (can't write a binary checklist) → outcome is fuzzy; sharpen it.
- *Valuable* fails ("preparation for the next dispatch only") → bundle into the dispatch that consumes it.
- *Independent* fails (depends on concurrent work) → re-sequence or re-decompose.

**Do not size by file count or LoC.** A 200-file mechanical codemod with one outcome passes *Small* cleanly; a 3-file change with three outcomes fails *Small* even though the diff is tiny. Cross-check against the dispatch-shape patterns in `drive/calibration/sizing.md` — recognised passes ("mechanical fan-out / codemod"; "surgical substrate change") and recognised mis-sizings ("substrate change + consumer migration in one dispatch"; "mechanical fan-out + design judgment in one dispatch").

### Step 5 — Surface handoff contracts

For each dispatch, fill `builds on` and `hands to` explicitly. Two checks:

- **Linearity** — does each dispatch's `builds on` reference the immediately-prior dispatch's `hands to`? If not, surface the non-linear dependency so the brief-assembler knows the executor needs context from dispatch N-2's hand-off, not just N-1's.
- **Completeness** — does the final dispatch's `hands to` add up to the slice-DoD? If a slice-DoD condition isn't reachable from the dispatch sequence, the plan is incomplete.

### Step 6 — Fill the template, then hand off

Open [`./templates/plan.template.md`](./templates/plan.template.md). Write inline in the slice spec (under `## Dispatch plan`) or as `projects/<project>/slices/<slice>/plan.md`. Hand off to `drive-build-workflow`.

> **Emit `plan-authored` or `plan-amended`** (immediately after writing the dispatch plan). **Two write modes:** inline — plan under `## Dispatch plan` in `projects/<project>/slices/<slice>/spec.md`, set `plan_path` to that spec path; separate — `projects/<project>/slices/<slice>/plan.md`. Existence-check on `PLAN_PATH`: file present before write → `plan-amended` (`bytes_delta`, `reason`, `dispatches_added`, `dispatches_removed`, `dispatches_resized`); else → `plan-authored` (`dispatch_count`, `dispatch_size_distribution`, `open_items_count`). Default `reason`: `"operator-correction"`; use `"dispatch-added"` / `"dispatch-removed"` / `"dispatch-resize"` when `drive-build-workflow` replan signals; `"replan-from-discussion"` / `"falsified-assumption"` when caller signals. See [`docs/drive/trace-events.md`](../../docs/drive/trace-events.md) § `plan-authored` / `plan-amended` and [`docs/drive/trace-emission.md` § Existence-check pattern](../../docs/drive/trace-emission.md#existence-check-pattern-for--authored-vs--amended-events) + § Append protocol.

## Pitfalls

1. **Sizing on file count or LoC instead of outcome coherence.** A 200-file mechanical codemod is one logical unit; a 3-file change with three outcomes is three. Apply dispatch-INVEST.
2. **Outsized dispatch accepted "just this once."** *Small* exists to keep WIP inspection cheap and dispatch failures recoverable. A dispatch that fails *Small* and ships anyway leaves a large chunk of half-done work when it goes wrong; re-running it is expensive. Always re-decompose.
3. **Dispatch boundary drawn at the wrong joint.** Symptom: dispatch 2 has to undo something dispatch 1 set up. The hand-off should be a *stable state* the next dispatch builds on. If you can't articulate the stable state, the joint is wrong.
4. **Inheriting per-dispatch DoR / DoD checklists from the old template.** Those belong in the brief now (and even there, they thin out — see `drive-build-workflow`). The slice plan tells the brief-assembler *what the dispatch must accomplish*; the brief-assembler turns that into operational metadata.
5. **Inheriting per-dispatch "Files in play" from the old template.** That's implementer discovery work. Listing files in the plan pretends the planner knows them all; usually they don't.
6. **Outcome that isn't binary.** *"Code reviewed"* isn't binary unless the review surface is named. *"CI green for `pnpm test:packages -- <pkg>`"* is binary; *"Tests look right"* isn't.
7. **INVEST applied ungrounded in the team's calibration.** The letters mean things specific to this codebase — `drive/calibration/sizing.md` is what *Small* and *Testable* concretely look like here. Without it, INVEST drifts to whatever the planner imagines.
8. **Hand-off contracts that are empty or vague.** *"Dispatch 1 hands to dispatch 2"* isn't a hand-off; the named state (*"the `Foo` interface is exported and tests cover the round-trip"*) is.

## References

- [`./templates/plan.template.md`](./templates/plan.template.md) — the fillable template.
- [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md) — dispatch-INVEST; logical coherence over logistical footprint.
- [`drive/calibration/sizing.md`](../../drive/calibration/sizing.md) — this repo's dispatch-shape patterns (clean vs mis-sized).
- [`skills-contrib/drive-build-workflow/SKILL.md`](../drive-build-workflow/SKILL.md) — the dispatch loop this plan feeds.
