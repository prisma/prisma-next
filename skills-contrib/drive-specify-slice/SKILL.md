---
name: drive-specify-slice
description: >
  Capture a slice's chosen design + coherence rationale as a slice spec. Carries the
  design shape this slice converges on, why these changes hang together as one reviewable
  PR, slice-specific done conditions (only what's not implied by CI / reviewer / project-
  DoD), and pre-investigated edge cases (often empty). Two modes: in-project
  (projects/<project>/slices/<slice>/spec.md) or orphan (inline in PR description).
metadata:
  version: "2026.5.28"
  split_from: drive-create-spec
---

> **Execution mode: orchestrator-direct.** This atomic skill is invoked by the Orchestrator directly. Running it does NOT change the Orchestrator's role — the file-path boundary, stop-and-delegate triggers, and escape-hatch criterion from the active workflow skill remain in force.
>
> Read-only codebase investigation (Grep / Read / Glob / SemanticSearch) is **permitted and expected** — the skill body requires grounding plans in actual codebase state. If the skill's body asks for work that requires running builds/tests or writing files outside `projects/<current-project>/` — **STOP. Dispatch.** See [`drive/roles/README.md`](../../drive/roles/README.md).

# Drive: Specify Slice

Capture a slice's chosen design as either `projects/<project>/slices/<slice>/spec.md` (in-project mode) or as inline content for the PR description (orphan mode). A slice spec carries:

- **Chosen design** — the shape this slice converges on. Not a survey of alternatives — the decided shape, expressed concretely (named surfaces, key interfaces, a small worked example if useful).
- **Coherence rationale** — why these changes hang together as one reviewable PR rather than splitting across two. Often one sentence; *"this slice migrates all call sites of `X` to the new API"* is a coherence claim.
- **Scope** — what's in (the surfaces this slice changes); what's deliberately out (adjacent surfaces other slices will pick up).
- **Pre-investigated edge cases** — only the ones already known from outside the codebase (a user's prior bug, a known footgun, a calibration entry matching this slice's shape). **Often empty.** Discovery happens at dispatch time, by the implementer's grep pre-flight; pre-naming what the implementer would discover anyway makes the spec longer without adding information.
- **Slice-specific done conditions** — only what's NOT implied by CI-green + reviewer-accept + the project-DoD floor. Often a single line (*"snapshot fixtures regenerated and committed"*).

The spec is the *contract* the slice plan + dispatch loop work against.

## When to use

- After `drive-start-workflow` routes to a **slice** verdict (orphan or in-project sub-mode).
- When a mid-flight scope shift produces a new slice that needs its own spec.

**Do not use this skill for:**

- Project-level specs — that's `drive-specify-project`.
- Facilitating design discussion — that's `drive-discussion`.
- Decomposing the slice into dispatches — that's `drive-plan-slice`.
- Direct changes — they have no spec; intent goes in the PR body via `drive-pr-description`.

## Pre-conditions

- The triage verdict is **slice** (orphan or in-project), OR the slice has surfaced mid-flight in an existing project.
- For in-project mode: `projects/<project>/spec.md` exists; the slice fits within its purpose + non-goals.
- The chosen design is settled enough to write down (no major fork-in-the-road questions pending).

## Post-conditions

- Either `projects/<project>/slices/<slice>/spec.md` exists (in-project) OR the slice spec content is captured for inline insertion into the PR description (orphan).
- Chosen design is expressed concretely (named surfaces, key interfaces, worked example if useful).
- Coherence rationale stated.
- Scope (in + deliberately out) is bounded by named surfaces, not abstractions.
- Slice-DoD lists only the slice-specific items (CI + reviewer + project-DoD inherited, not restated).
- Pre-investigated edge cases listed (often empty — say so explicitly if so).

## Project context

Load `drive/spec/README.md` at workflow step 1 if it exists. The team's slice-spec conventions — repo-specific patterns, common scope traps, slice-DoD overlay items.

## Workflow

### Step 1 — Load project context

Read `drive/spec/README.md` and, if in-project, glance at `projects/<project>/spec.md` to confirm the slice fits the parent's purpose + non-goals.

### Step 2 — Mode pick (in-project vs orphan)

- **In-project**: target file is `projects/<project>/slices/<slice>/spec.md`. Create the directory if missing.
- **Orphan**: target is the PR description body. No `projects/<x>/`. The slice spec content gets injected by `drive-pr-description` at PR-open time.

### Step 3 — Confirm scope fits one PR

Would the resulting PR be reviewable in one sitting (~30 min) and rollback-able as one unit? Per invariant I1, a slice delivers exactly one PR.

If bigger than one PR: route back to `drive-start-workflow` (likely outcome: promote to project).

If smaller than slice-shaped (trivial enough for direct change): re-triage as direct change.

### Step 4 — Research codebase state

Look up the surfaces the slice will touch. Use Grep / Read / Glob / SemanticSearch. Ground claims about what exists today, what call sites would change, what tests would be affected. This is what makes the chosen-design section in Step 5 grounded; it's also what reveals whether the slice has surface uncertainty that should trip a discussion-mode signal back at triage.

### Step 5 — Draft the spec

Use the **Slice Spec Template** below. Drafting order:

1. **At a glance.** 1–2 sentences: what this slice changes and what it unblocks. Concrete (name the surface), not abstract.
2. **Chosen design.** The shape — not alternatives, the decided shape. Mermaid for state / flow; code snippets when they convey an interface or schema clearly; ASCII tables for before/after data shapes.
3. **Coherence rationale.** Often one sentence: why these changes are one PR not two.
4. **Scope.** In: named surfaces, files, behaviours. Out: adjacent surfaces deliberately left for other slices.
5. **Pre-investigated edge cases.** Only the ones already known from outside-codebase sources. Often empty — say so explicitly (*"None pre-investigated; implementer's dispatch-time grep is the discovery mechanism"*).
6. **Slice-specific done conditions.** Only the items NOT implied by CI-green + reviewer-accept + project-DoD. Often a single line.
7. **Open questions.** Residual design-level questions for slice execution. Each with a working position.

### Step 6 — Write / inject

In-project: write `projects/<project>/slices/<slice>/spec.md`. Orphan: hold the content for `drive-pr-description` to inject into the PR body.

### Step 7 — Hand off

Hand off to `drive-plan-slice` for dispatch decomposition.

## Slice Spec Template

```markdown
# Slice: <slice-name>

_(For in-project slices: parent project `projects/<project>/`. Outcome this slice contributes to the project: `<one line>`.)_

## At a glance

_1–2 sentences: what this slice changes and what it unblocks. Concrete (name the surface), not abstract._

## Chosen design

_The shape this slice converges on. Not alternatives — the decided shape. Concrete: name surfaces, sketch interfaces, show a worked before/after example if useful. Mermaid welcome for state / flow._

## Coherence rationale

_Why these changes hang together as one reviewable PR rather than splitting across two. Often one sentence._

## Scope

**In:** _Named surfaces, files, behaviours that change._

**Out:** _Adjacent surfaces deliberately left for other slices or future work._

## Pre-investigated edge cases

_Edge cases already known from outside-codebase sources (a user's prior bug, a known footgun, a calibration entry matching this slice's shape). Often empty — say so explicitly if so._

| Edge case | Disposition | Notes |
|---|---|---|
| _..._ | _..._ | _..._ |

_or: None pre-investigated. The implementer's dispatch-time grep is the discovery mechanism; new edge cases surfaced at dispatch time amend the spec via `drive-discussion` per invariant I12._

## Slice-specific done conditions

_Only the items NOT implied by CI-green + reviewer-accept + project-DoD floor. Often a single line._

- [ ] _Slice-specific condition (e.g. "snapshot fixtures regenerated and committed", "manual-QA run report attached", "the call-site grep returns zero results")._

## Open Questions

_Residual questions for slice execution. Each with a working position._

1. _Question._ Working position: _..._

## References

- Parent project: `projects/<project>/spec.md` (in-project mode only)
- Linear issue: _link_
- Relevant ADRs / standards: _..._
```

## Pitfalls

1. **Scope that spans more than one PR.** Slice is one PR. If the scope can't be delivered as one reviewable + rollback-able PR, the slice isn't slice-shaped — re-triage as project / promote.
2. **Pre-walking edge cases the implementer would discover anyway.** The implementer's dispatch-time grep finds the call sites. Pre-name only what the team's calibration catalogue or outside-codebase knowledge already taught.
3. **Slice-DoD restating CI + reviewer + project-DoD items.** Those are inherited. The slice-DoD is for what's slice-specific only.
4. **Chosen design framed as a survey of alternatives.** A slice spec is post-discussion; the alternatives belong in the design-decisions record (if the decision deserved one), not in the slice spec.
5. **In-project slice that doesn't fit parent's purpose.** If the slice's scope sits outside the parent's purpose, it's a new project (or orphan slice), not an in-project slice. Re-triage.
6. **Orphan-mode slice that's actually project-sized.** Orphan slices are still ≤ 1 PR. If you're tempted to write a multi-PR plan inline in the PR description, it's a project, not an orphan slice.
7. **Edge cases that surface during execution and don't go through `drive-discussion`.** Per invariant I12, the slice spec is the contract; new edge cases discovered during execution that aren't pre-investigated amend the spec via design discussion rather than getting silently handled.

## Checklist

- [ ] Loaded `drive/spec/README.md` (if exists)
- [ ] Mode chosen (in-project vs orphan)
- [ ] Scope fits one PR (re-triaged if not)
- [ ] Researched codebase state the slice will touch
- [ ] Chosen design expressed concretely (named surfaces, interfaces, worked example)
- [ ] Coherence rationale stated
- [ ] Scope: in + deliberately out (named surfaces, not abstractions)
- [ ] Pre-investigated edge cases listed (or explicit "None pre-investigated")
- [ ] Slice-DoD: only slice-specific items (CI / reviewer / project-DoD inherited)
- [ ] Spec written (in-project) or held for PR injection (orphan)

## Related skills

- `drive-start-workflow` — routes to this skill via the **slice** verdict
- `drive-discussion` — fires when design questions surface during drafting; resolves then hands back
- `drive-plan-slice` — decomposes the slice spec into dispatches; runs after this skill
- `drive-build-workflow` — pilots the dispatch loop the slice plan defines
- `drive-pr-description` — for orphan-mode slices, injects the slice spec into the PR body
- `drive-specify-project` — project-level variant; different template (durable system intent, not chosen design)
- `drive-qa-plan` + `drive-qa-run` — manual-QA discipline referenced in slice-DoD where applicable

## References

- [`docs/drive/design-decisions/2026-05-28-artefact-cascade-redesign.md`](../../docs/drive/design-decisions/2026-05-28-artefact-cascade-redesign.md) — the redesign that dropped the pre-named-edge-cases requirement, made slice-DoD inheritance-aware, and introduced the coherence-rationale section
- [`docs/drive/model.md`](/docs/drive/model.md) § Slice (unit); § Layer 5 — invariants I1 + I12
- [`docs/drive/principles/definition-of-ready.md`](/docs/drive/principles/definition-of-ready.md) § Slice DoR
