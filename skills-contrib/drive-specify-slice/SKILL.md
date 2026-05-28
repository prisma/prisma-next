---
name: drive-specify-slice
description: >
  Capture a slice's chosen design + coherence rationale as a slice spec. Two
  modes: in-project (writes projects/<project>/slices/<slice>/spec.md) or orphan
  (content injected by drive-pr-description into the PR body). Carries the
  decided design shape, why these changes hang together as one reviewable PR,
  slice-specific done conditions (only what's not implied by CI / reviewer /
  project-DoD), and pre-investigated edge cases (often empty). Hands off to
  drive-plan-slice.
metadata:
  version: "2026.5.28"
---

> **Execution mode: orchestrator-direct.** Atomic skill invoked by the Orchestrator
> directly. Read-only codebase investigation (Grep / Read / Glob / SemanticSearch)
> is permitted and expected. If the body would require running builds/tests or
> writing files outside `projects/<current-project>/` — **STOP. Dispatch.** See
> [`drive/roles/README.md`](../../drive/roles/README.md).

# Drive: Specify Slice

The slice spec is the **contract** that the slice plan + dispatch loop work against. It carries the decided design shape and the coherence rationale (slice-INVEST's *Small* check, in prose). It is **post-discussion** — alternatives belong in the design-decisions record, not here.

The spec template lives at [`./templates/spec.template.md`](./templates/spec.template.md). Fill it; don't author from scratch.

## Two modes

| Mode | Target file | When |
|---|---|---|
| **In-project** | `projects/<project>/slices/<slice>/spec.md` | The slice lives inside a project with an existing project spec. |
| **Orphan** | PR description body (injected by `drive-pr-description` at PR-open time) | Standalone slice with no parent project. No `projects/<x>/`. |

## Workflow

### Step 1 — Load context

Read `drive/spec/README.md` if it exists. For in-project mode, glance at `projects/<project>/spec.md` to confirm the slice fits the parent's purpose + non-goals.

### Step 2 — Confirm the slice is slice-shaped

Apply slice-INVEST (see [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md)). The *Small* check is: **manageable in a single code review**. One reviewer holds the slice's coherence in one sitting; the diff is rollback-able as one unit.

- Bigger than that → re-triage; likely outcome: promote to project.
- Smaller than slice-shaped (one trivial change) → re-triage as direct change.

### Step 3 — Ground in the codebase

Look up the surfaces the slice will touch. Use Grep / Read / Glob / SemanticSearch. Ground claims about what exists today, what call sites would change, what tests would be affected. This is what makes the chosen-design section grounded; it also surfaces whether the slice has enough uncertainty to trip a discussion-mode signal back at triage.

### Step 4 — Fill the template

Open [`./templates/spec.template.md`](./templates/spec.template.md) and fill it in this order: At a glance → Chosen design → Coherence rationale → Scope (in + deliberately out) → Pre-investigated edge cases → Slice-specific done conditions → Open questions → References.

**Pre-investigated edge cases is often empty.** Pre-name only what outside-codebase knowledge (a user's prior bug, a known footgun, a calibration-catalogue entry) already taught — not what the implementer's dispatch-time grep would find anyway.

**Slice-DoD is usually one line.** CI-green + reviewer-accept + the project-DoD floor cover the rest; don't restate them.

### Step 5 — Write or inject

- **In-project**: write `projects/<project>/slices/<slice>/spec.md`. Create the directory if missing.
- **Orphan**: hold the content for `drive-pr-description` to inject at PR-open time.

> **Emit `spec-authored` or `spec-amended`** (**in-project mode only** — orphan mode skips this emit; the spec lives in the PR description body, not on disk). After writing `projects/<project>/slices/<slice>/spec.md`, existence-check on `SPEC_PATH`: file present before write → `spec-amended` (`bytes_delta`, `reason`, `sections_changed`); else → `spec-authored`. Payload: `spec_kind: "slice"`, `edge_cases_count` from the pre-investigated edge cases table, `open_questions_count`, `dod_items_count`, plus envelope fields. Default `reason`: `"operator-correction"`; `"replan-from-discussion"` / `"falsified-assumption"` when the caller signals. See [`docs/drive/trace-events.md`](../../docs/drive/trace-events.md) § `spec-authored` / `spec-amended` and [`docs/drive/trace-emission.md` § Existence-check pattern](../../docs/drive/trace-emission.md#existence-check-pattern-for--authored-vs--amended-events) + § Append protocol.

### Step 6 — Hand off

Hand off to `drive-plan-slice` for dispatch decomposition.

## Pitfalls

1. **Scope that doesn't fit a single code review.** Slice is one PR, one reviewer sitting, one rollback unit. Larger than that → re-triage as project / promote.
2. **Pre-walking edge cases the implementer would discover anyway.** The implementer's dispatch-time grep finds the call sites. Pre-name only what outside-codebase knowledge already taught.
3. **Slice-DoD restating CI + reviewer + project-DoD items.** Those are inherited. The slice-DoD line(s) are for what's slice-specific only.
4. **Chosen design framed as a survey of alternatives.** A slice spec is post-discussion; alternatives belong in the design-decisions record if the decision deserved one.
5. **In-project slice that doesn't fit parent's purpose.** If scope sits outside the parent's purpose, it's a new project (or orphan slice), not an in-project slice. Re-triage.
6. **Orphan slice that's actually project-sized.** Orphan slices are still one PR. If you're tempted to write a multi-PR plan inline in the PR description, it's a project, not an orphan slice.
7. **Edge cases that surface during execution and don't go through `drive-discussion`.** Per invariant I12, the spec is the contract; new edge cases discovered during execution amend the spec via design discussion rather than getting silently handled.

## References

- [`./templates/spec.template.md`](./templates/spec.template.md) — the fillable template.
- [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md) — slice-INVEST; the "manageable in a single code review" framing.
- [`drive/calibration/sizing.md`](../../drive/calibration/sizing.md) — this repo's slice-shape patterns (clean vs mis-sized).
- [`docs/drive/model.md`](../../docs/drive/model.md) § Slice — invariants I1 (one PR per slice), I12 (spec is the contract).
