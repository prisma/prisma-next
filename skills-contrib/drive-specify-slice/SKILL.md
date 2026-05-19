---
name: drive-specify-slice
description: >
  Capture a slice's design as an unambiguous slice spec. A slice spec carries the slice's
  scope (within its parent project's purpose if in-project, or standalone if orphan),
  slice-DoD, and Example-Mapping edge cases pre-named with dispositions. Use after
  drive-start-workflow routes to "orphan slice" or "in-project slice." Two modes: in-
  project (writes to projects/<project>/slices/<slice>/spec.md) or orphan (drafts the
  slice spec inline as the PR description body). Split from drive-create-spec; the
  project variant is drive-specify-project.
metadata:
  version: "2026.5.18"
  split_from: drive-create-spec
---

# Drive: Specify Slice

Capture a slice's design as either `projects/<project>/slices/<slice>/spec.md` (in-project mode) or as inline content for the PR description (orphan mode). A slice spec carries:

- **Scope** — what this slice changes, within (or in the absence of) a parent project's purpose. Scope is ≤ 1 PR worth of work.
- **Slice-DoD** — the verifiable conditions under which the slice merges.
- **Example-Mapping edge cases** — pre-named edge cases with their dispositions (handle / explicitly out / defer). This is the slice's promise about which corners it covers and which it leaves alone.
- **Approach** — the chosen shape at the level of "what changes where" + key trade-offs.

Slice specs are authored by the implementer (the person / agent who'll do the work), typically with agile-orchestrator review. The slice spec is the *contract* the slice plan + dispatch loop work against.

## When to use

- After `drive-start-workflow` routes to **orphan slice** (use orphan mode).
- After `drive-start-workflow` routes to **in-project slice** (use in-project mode).
- When mid-flight scope shift produces a new slice that needs its own spec.

**Do not use this skill for:**

- Project-level specs — that's `drive-specify-project` (purpose + scope boundary + project-DoD).
- Facilitating design discussion — that's `drive-discussion`.
- Decomposing the slice into dispatches with sizing + DoR — that's `drive-plan-slice`.
- Direct changes — they have no spec; intent goes in the PR body via `drive-pr-description`.

## Pre-conditions

- The triage verdict is orphan slice or in-project slice (or the slice has surfaced mid-flight in an existing project).
- For in-project mode: `projects/<project>/spec.md` exists; the slice fits within its purpose + scope.
- The implementer knows the rough shape of the work (no major design questions pending).

## Post-conditions

- Either `projects/<project>/slices/<slice>/spec.md` exists (in-project mode) OR the slice spec content is captured for inline insertion into the PR description (orphan mode).
- Scope is concrete (named files / surfaces / behaviours), ≤ 1 PR worth.
- Slice-DoD lists verifiable conditions (binary, observable, includes manual-QA where user-observable surface is touched OR explicit N/A with rationale).
- Edge cases pre-named with dispositions; new edge cases discovered during slice execution amend the spec via design-discussion (I12).
- Slice DoR (per [`docs/drive/principles/definition-of-ready.md`](/docs/drive/principles/definition-of-ready.md) § Slice DoR) is met or its gaps are recorded.

## Project context

Load `drive/spec/README.md` at workflow step 1 if it exists. This carries the team's slice-spec conventions — required sections, repo-specific edge-case patterns, slice-DoD overlay items, common scope traps.

## Workflow

### Step 1 — Load project context

Read `drive/spec/README.md` (and if in-project, glance at `projects/<project>/spec.md` to confirm the slice fits the parent's purpose + scope).

### Step 2 — Mode pick (in-project vs orphan)

- **In-project mode**: target file is `projects/<project>/slices/<slice>/spec.md`. Create the directory if missing. Reference the parent's purpose in the slice's scope section.
- **Orphan mode**: target is the PR description body. No `projects/<x>/`. The slice spec content gets injected by `drive-pr-description` at PR-open time.

### Step 3 — Confirm scope fits one PR

Sanity check: would the resulting PR be reviewable in one sitting (~30 min) and rollback-able as one unit? Per invariant I1, a slice delivers exactly one PR.

If the scope is bigger than one PR: route back to `drive-start-workflow` for re-triage (likely outcome: promote to project).

If the scope is smaller than slice-shaped (trivial enough for direct change): same — re-triage as direct change.

### Step 4 — Research codebase state

Look up the surfaces the slice will touch. Use Grep / Read / Glob / SemanticSearch. Ground claims about what exists today, what call sites would change, what tests would be affected. This is what makes the edge-case section in Step 6 grounded.

### Step 5 — Draft scope + approach

- **Scope.** Concrete: name the files / surfaces / behaviours that change. Bounded: list what's deliberately untouched.
- **Approach.** 1-3 paragraphs at the level of "what changes where." Mermaid welcome for state changes / flows. Code snippets when they convey an interface, schema, or algorithm clearly.

### Step 6 — Example-Mapping edge cases

The load-bearing section. For each edge case the slice touches:

- Name it (concrete: *"empty array input"*, *"unicode in field names"*, *"existing row with null value"*).
- Describe the disposition: **handle** (the slice will cover this case; the test will exist), **explicitly out** (this case is acknowledged but out of scope; documented in non-goals), or **defer** (this case will be handled in a follow-up slice).

This is the slice's promise. Per invariant I12, edge cases discovered during execution that aren't pre-named here amend the spec via `drive-discussion` rather than getting silently handled.

Pre-name 5-15 edge cases for a typical slice. Read `drive/plan/README.md`'s failure-mode catalogue (if it exists) for repo-specific patterns to consider.

### Step 7 — Draft slice-DoD

Verifiable, binary conditions. Examples:

- All "Done when" gates from the slice plan pass (CI green, lint clean, typecheck clean, fixtures regenerated).
- Every pre-named edge case handled per its disposition.
- Reviewer verdict accept on the slice review.
- Manual-QA script authored + at least one run report (if user-observable surface touched; else explicit N/A with rationale).
- Slice doesn't touch surfaces marked out-of-scope (anti-corruption check).

### Step 8 — Confirm DoR

Walk through Slice DoR (per [`docs/drive/principles/definition-of-ready.md`](/docs/drive/principles/definition-of-ready.md) § Slice DoR). Either confirm each item is met or record gaps as open questions.

### Step 9 — Write / inject

In-project: write `projects/<project>/slices/<slice>/spec.md`. Orphan: hold the content for `drive-pr-description` to inject into the PR body.

### Step 10 — Hand off

Hand off to `drive-plan-slice` for dispatch decomposition.

## Slice Spec Template

```markdown
# Slice: <slice-name>

_(For in-project slices: parent project `projects/<project>/`; this slice satisfies FRs / capabilities __ from the project spec.)_

## At a glance

_1-2 sentences: what this slice changes and what unblocks. Concrete (name the surface), not abstract._

## Scope

### In scope

_Files / surfaces / behaviours that change. Bounded list._

### Out of scope (this slice)

_Adjacent surfaces deliberately left alone. Future slices / direct changes may pick them up._

## Approach

_1-3 paragraphs. What changes where. Mermaid welcome for state / flow. Code snippets when they convey shape clearly. Mark illustrative snippets as such._

## Edge cases (Example-Mapping)

_Pre-named edge cases with dispositions. The slice's promise about which corners it covers._

| Edge case | Disposition | Notes |
|---|---|---|
| _Empty array input_ | Handle | _Test covers; default-empty behaviour preserved._ |
| _Unicode in field names_ | Explicitly out | _Out of scope this slice; rare in production; defer to follow-up if needed._ |
| _Existing row with null value_ | Defer | _Will be handled by slice X._ |
| _..._ | _..._ | _..._ |

## Slice Definition of Done

- [ ] **SDoD1.** All "Done when" gates from the slice plan pass (CI green; lint clean; typecheck clean; fixtures regenerated; intent-validation confirms diff matches brief intent).
- [ ] **SDoD2.** Every pre-named edge case handled per its disposition.
- [ ] **SDoD3.** Reviewer verdict: accept (on `projects/<project>/reviews/code-review.md` or the PR review surface for orphan slices).
- [ ] **SDoD4.** Manual-QA script in `projects/<project>/manual-qa.md` (or inline for orphan); ≥ 1 run report; no unresolved 🛑 Blocker findings. _(Or: explicit N/A with rationale if no user-observable surface touched.)_
- [ ] **SDoD5.** Slice doesn't touch surfaces listed as out-of-scope.
- [ ] **SDoD6.** _(Slice-specific.)_

## Open Questions

_Residual questions that need answering during or before slice execution. Each with a working position._

1. _Question._ Working position: _..._

## References

- Parent project: `projects/<project>/spec.md` (in-project mode only)
- Linear issue: _link_
- Relevant ADRs / standards: _..._
```

## Pitfalls

1. **Scope that spans more than one PR.** Slice is one PR. If the scope can't be delivered as one reviewable + rollback-able PR, the slice isn't slice-shaped — re-triage as project / promote.
2. **Edge cases as a flat list without dispositions.** "Edge cases: X, Y, Z" with no disposition doesn't promise anything. The disposition (handle / explicitly out / defer) is the load-bearing part.
3. **Slice-DoD missing manual-QA.** If the slice touches user-observable surface, manual-QA isn't optional. Either author a script + run it (via `drive-qa-plan` + `drive-qa-run`), or mark it explicit N/A with a rationale — never just skip.
4. **In-project slice that doesn't fit parent project's purpose.** If the slice's scope sits outside the parent's purpose, it's a new project (or orphan slice), not an in-project slice. Re-triage.
5. **Orphan-mode slice that's actually project-sized.** Orphan slices are still ≤ 1 PR. If you're tempted to write a multi-PR plan inline in the PR description, it's a project, not an orphan slice.
6. **Edge cases that surface during execution and don't go through `drive-discussion`.** Per invariant I12, the slice spec is the contract; new edge cases discovered during execution that aren't pre-named amend the spec via design discussion rather than getting silently handled.

## Checklist

- [ ] Loaded `drive/spec/README.md` (if exists)
- [ ] Mode chosen (in-project vs orphan)
- [ ] Scope fits one PR (re-triaged if not)
- [ ] Researched codebase state the slice will touch
- [ ] Scope + Approach drafted
- [ ] 5-15 edge cases pre-named with dispositions
- [ ] Slice-DoD includes manual-QA (or explicit N/A with rationale)
- [ ] Slice DoR walked; gaps resolved or surfaced
- [ ] Spec written (in-project) or held for PR injection (orphan)

## Related skills

- `drive-start-workflow` — routes to this skill via orphan slice / in-project slice verdicts
- `drive-discussion` — fires when design questions surface during drafting; resolves then hands back
- `drive-plan-slice` — decomposes the slice spec into dispatches; runs after this skill
- `drive-build-workflow` — pilots the dispatch loop the slice plan defines
- `drive-pr-description` — for orphan-mode slices, injects the slice spec into the PR body
- `drive-specify-project` — project-level variant; different inputs / outputs / templates
- `drive-qa-plan` + `drive-qa-run` ([PR #93](https://github.com/prisma/ignite/pull/93)) — manual-QA discipline referenced in slice-DoD

## References

- [`docs/drive/model.md`](/docs/drive/model.md) § Slice (unit); § Layer 5 — invariants I1 + I12
- [`docs/drive/principles/definition-of-ready.md`](/docs/drive/principles/definition-of-ready.md) § Slice DoR
- [`docs/drive/principles/definition-of-done.md`](/docs/drive/principles/definition-of-done.md) § Slice DoD
- [`docs/drive/principles/brief-discipline.md`](/docs/drive/principles/brief-discipline.md) — Example-Mapping edge cases
- [`docs/drive/model.md`](/docs/drive/model.md) § Two skill tiers — the project-vs-slice split rationale
