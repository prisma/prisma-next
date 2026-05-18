---
name: drive-plan-slice
description: >
  Decompose a slice spec into a sequence of dispatches with per-dispatch DoR-ready scope,
  sizing (S/M/L/XL), and "done when" gates. Enforces the two-cap sizing system: PR-cap
  at the slice (one PR per slice) and M-cap at the dispatch (one M-sized chunk per
  dispatch; L/XL dispatches are refused with a re-decomposition request). Use after
  drive-specify-slice has settled the slice spec. Outputs the slice plan inline in the
  slice spec or as projects/<project>/slices/<slice>/plan.md. Split from drive-create-
  plan; the project variant is drive-plan-project.
metadata:
  version: "2026.5.18"
  split_from: drive-create-plan
---

# Drive: Plan Slice

Decompose a slice into the sequence of dispatches that delivers it. A slice plan answers:

1. **What dispatches make up this slice?** A list of dispatches, each one ready to brief to an implementer (per-dispatch DoR).
2. **In what order?** Dispatches inside a slice are typically sequential (each one builds on the last); parallel-within-slice is rare and usually means the slice should be split.
3. **At what size?** Each dispatch is M-sized or smaller (the M-cap). L/XL dispatches are refused; re-decompose into multiple Ms.

The slice plan is the artefact `drive-build-workflow` reads to pilot the dispatch loop.

## When to use

- After `drive-specify-slice` has produced `projects/<project>/slices/<slice>/spec.md` (or the inline orphan-mode equivalent).
- When picking up a slice whose plan needs re-decomposition (e.g. a dispatch came back L/XL and needs splitting).

**Do not use this skill for:**

- Project-level planning (slice composition + stack/parallel) — that's `drive-plan-project`.
- The slice spec — that's `drive-specify-slice`.
- The actual delivery loop — that's `drive-build-workflow`.

## Pre-conditions

- Slice spec exists (`projects/<project>/slices/<slice>/spec.md` for in-project; held content for orphan).
- Slice scope is concrete (named files / surfaces / behaviours).
- Slice-DoD lists the verifiable conditions the slice must meet.
- Optional: `drive/plan/README.md` exists with team-specific dispatch-sizing heuristics + DoR overlays + failure-mode catalogue.

## Post-conditions

- Slice plan written (inline in slice spec or as separate `plan.md` in slice directory).
- Each dispatch carries: name, intent (what changes; what stays the same), files-in-play, "done when" gates, sized S or M (the M-cap), per-dispatch DoR met.
- Sequence is acyclic; dependencies between dispatches named.
- No L or XL dispatches: those have been re-decomposed into multiple Ms.

## Project context

Load `drive/plan/README.md` at workflow step 1 if it exists. Look especially for: dispatch-sizing reference cases (with timings / line-count anchors), per-dispatch DoR overlays beyond the canonical defaults, the team's failure-mode catalogue (e.g. *"any dispatch touching `packages/3-...-extensions/*` needs a regenerate-fixtures gate"*).

## Workflow

### Step 1 — Load project context

Read `drive/plan/README.md` (and re-read the slice spec if not in context).

### Step 2 — Research codebase the slice will touch

Ground the dispatch boundaries in actual files. Use Grep / Read / Glob / SemanticSearch. For each surface in the slice spec's scope, identify the concrete files / packages / tests / fixtures that change. Without this, dispatch boundaries get drawn at the wrong joints.

### Step 3 — Decompose into dispatches

Walk the slice scope. For each chunk of work:

- Is it a coherent, M-sized (or smaller) change with a clear "done when"? → **a dispatch**.
- Is it L or XL? → **decompose further** into multiple Ms with explicit handoff state.

Default sequencing: each dispatch builds on the previous. Common shapes:

- **Sandwich**: contract / interface dispatch first; implementation dispatch; call-site / consumer migration dispatch.
- **Test-first**: write the failing test (dispatch 1); implement (dispatch 2); regenerate fixtures + final review (dispatch 3).
- **Migration-shaped**: feature flag / nullable column (dispatch 1); dual-write / dual-read (dispatch 2); migrate consumers (dispatch 3); remove old path (dispatch 4) — though this shape often signals the slice should be a project with multiple slices.

A typical slice has 1-3 dispatches. More than 4 usually means the slice should be split (re-triage as project).

### Step 4 — Size each dispatch (S/M/L/XL)

Apply the team's calibration (in `drive/plan/README.md` if present; otherwise the defaults below).

**Default sizing reference (override in `drive/plan/README.md`):**

- **S (≤ 30 min implementer time)**: one file, ≤ ~50 LoC diff, no new design decisions, no fixture regeneration.
- **M (≤ 2 hr implementer time)**: 2-4 files, ≤ ~200 LoC diff, fits in one agent session, optional fixture regeneration.
- **L (> 2 hr)**: REFUSED. Re-decompose into multiple Ms.
- **XL (> 4 hr)**: REFUSED. Re-decompose; if it can't decompose into Ms cleanly, the slice itself is mis-shaped — re-triage.

**Sizing process:**

1. Estimate first based on files touched + LoC.
2. Cross-check against the team's reference cases.
3. If estimate is L or XL, decompose further or escalate.

### Step 5 — Per-dispatch DoR

For each dispatch, walk the per-dispatch DoR (per [`projects/drive-domain-model/principles/definition-of-ready.md`](/projects/drive-domain-model/principles/definition-of-ready.md) § Per-dispatch DoR). For each item, either confirm it's met or fix it before declaring the dispatch ready.

Canonical per-dispatch DoR items (specialise in `drive/plan/README.md`):

- [ ] Intent statement clear: what changes; what stays the same.
- [ ] Files-in-play named (concrete paths).
- [ ] "Done when" gates explicit (CI command? regenerate-fixtures? lint? typecheck? intent-validation criteria?).
- [ ] Predicted size is S or M (no L/XL — re-decompose if so).
- [ ] Failure modes from `drive/plan/README.md` catalogue considered.
- [ ] Edge cases (from slice spec) covered by this dispatch's "done when" OR explicitly named as "covered by dispatch X."
- [ ] No silent design decisions assumed (anything that's not pinned → flag to operator pre-dispatch).

### Step 6 — Draft the plan

Write the slice plan inline in the slice spec (under a `## Dispatch plan` heading) or as `projects/<project>/slices/<slice>/plan.md`. Use the **Slice Plan Template** below.

### Step 7 — Sanity checks

- Each dispatch sized S or M (no L/XL).
- Each dispatch's "done when" is binary + verifiable.
- Each edge case from the slice spec is covered by some dispatch's "done when" (or explicitly deferred).
- Slice-DoD's conditions are reachable from the dispatch sequence.

### Step 8 — Hand off

Hand off to `drive-build-workflow` to pilot the dispatch loop.

## Slice Plan Template

```markdown
## Dispatch plan

_(In-slice-spec section, OR `projects/<project>/slices/<slice>/plan.md`.)_

### Dispatch 1: <name>

**Intent.** _What changes. What stays the same. (1-3 sentences.)_

**Files in play.** `path/to/file.ts`, `path/to/test.ts`, _..._

**"Done when":**

- [ ] _Test command passes: `pnpm test:packages -- <pkg>`_
- [ ] _Lint clean: `pnpm lint -- <pkg>`_
- [ ] _Typecheck clean: `pnpm typecheck -- <pkg>`_
- [ ] _Intent-validation: diff matches the intent stated above (no scope creep)._
- [ ] _Edge cases covered: <list from slice spec>._
- [ ] _(Optional) Fixtures regenerated; `pnpm fixtures:check` clean._

**Size.** M.

**DoR confirmed:** [✓]

### Dispatch 2: <name>

_..._
```

## Pitfalls

1. **L/XL dispatch accepted "just this once."** The M-cap is what keeps WIP inspection cheap and dispatch failures recoverable. An L dispatch that fails leaves a large chunk of half-done work; re-running it is expensive. Always re-decompose.
2. **Dispatch boundary drawn at the wrong joint.** Symptom: dispatch 2 has to undo something dispatch 1 set up. The joint should be a "stable state" the next dispatch builds on. If you can't articulate the stable state, the joint is wrong.
3. **"Done when" gates that aren't actually binary.** "Code reviewed" isn't binary unless the review surface is named (which review? which verdict?). "CI green" is binary; "Tests look right" isn't.
4. **Sizing ungrounded in the team's calibration.** Sizing labels (S/M/L/XL) only mean something when calibrated against reference cases. Without calibration, "M" drifts; the team starts accepting effective-Ls as Ms.
5. **Per-dispatch DoR skipped because "it's obvious."** When DoR feels redundant, it's usually because the operator has carried the state in their head; the implementer doesn't have that state. The DoR is the handover protocol; skipping it costs the next dispatch in rework.
6. **Edge cases from the slice spec not mapped to any dispatch.** If an edge case has no covering dispatch, the slice ships without that edge handled — and the slice-DoD's edge-case condition fails late.

## Checklist

- [ ] Loaded `drive/plan/README.md` (if exists); slice spec re-read
- [ ] Researched codebase the slice will touch; concrete file lists for each surface
- [ ] Decomposed into S/M dispatches (no L/XL)
- [ ] Each dispatch sized against team's calibration
- [ ] Per-dispatch DoR walked; each item met or fixed
- [ ] Plan drafted using template
- [ ] Each slice-spec edge case mapped to a covering dispatch (or explicit deferral)
- [ ] Slice-DoD's conditions reachable from the dispatch sequence

## Related skills

- `drive-specify-slice` — produces the slice spec this plan decomposes; runs before
- `drive-plan-project` — composes slices into project sequencing; the parent layer
- `drive-build-workflow` — pilots the dispatch loop this plan defines
- `drive-discussion` — fires when decomposition surfaces load-bearing design questions
- `drive-qa-plan` ([PR #93](https://github.com/prisma/ignite/pull/93)) — the manual-QA dispatch's plan, woven into the slice plan when applicable

## References

- [`projects/drive-domain-model/model.md`](/projects/drive-domain-model/model.md) § Slice; § Dispatch; § Layer 3 — sizing discipline
- [`projects/drive-domain-model/workflow.md`](/projects/drive-domain-model/workflow.md) § Dispatch loop
- [`projects/drive-domain-model/principles/decomposition-and-cost.md`](/projects/drive-domain-model/principles/decomposition-and-cost.md) — two-cap sizing system
- [`projects/drive-domain-model/principles/definition-of-ready.md`](/projects/drive-domain-model/principles/definition-of-ready.md) § Per-dispatch DoR
- [`projects/drive-domain-model/principles/brief-discipline.md`](/projects/drive-domain-model/principles/brief-discipline.md) — how dispatch intent + files-in-play feed the brief
- [`projects/drive-domain-model/design-decisions.md`](/projects/drive-domain-model/design-decisions.md) § 17 — split rationale
