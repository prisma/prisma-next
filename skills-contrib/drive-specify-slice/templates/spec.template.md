# Slice: <slice-name>

_(In-project slices: parent project `projects/<project>/`. Outcome this slice contributes to the project's purpose: one line.)_

## At a glance

_1–2 sentences. What this slice changes and what it unblocks. Concrete (name the surface), not abstract._

## Chosen design

_The shape this slice converges on — the **decided** shape, not a survey of alternatives. Express it concretely: name surfaces, sketch interfaces, show a before/after worked example. Mermaid welcome for state / flow; ASCII tables for data shapes; code snippets when they convey an interface clearly._

## Coherence rationale

_Why these changes hang together as one reviewable PR rather than splitting across two. Often one sentence — "this slice migrates all call sites of `X` to the new API." This is the slice-INVEST *Small* check expressed in prose: one reviewer holds the coherence in one sitting._

## Scope

**In:** _Named surfaces, files, behaviours that change in this slice._

**Out:** _Adjacent surfaces deliberately left for other slices or future work._

## Pre-investigated edge cases

_Only edge cases already known from **outside the codebase** — a user's prior bug, a known footgun, a calibration-catalogue entry that matches this slice's shape. **Often empty.** Discovery happens at dispatch time, by the implementer's grep pre-flight on the named surface; pre-naming what the implementer would discover anyway makes the spec longer without adding information._

| Edge case | Disposition | Notes |
|---|---|---|
| _..._ | _..._ | _..._ |

_or: **None pre-investigated.** The implementer's dispatch-time grep is the discovery mechanism; new edge cases that surface at dispatch time amend the spec via `drive-discussion` per invariant I12._

## Slice-specific done conditions

_Only items NOT implied by CI-green + reviewer-accept + project-DoD floor. Often a single line — those three sources already cover most of what "done" means._

- [ ] _Slice-specific condition (e.g. "snapshot fixtures regenerated and committed", "manual-QA run report attached", "the call-site grep returns zero results")._

## Open Questions

_Residual questions for slice execution. Each with a working position so the operator can confirm or override._

1. _Question._ Working position: _..._

## References

- Parent project: `projects/<project>/spec.md` (in-project mode only)
- Linear issue: _link_
- Relevant ADRs / standards: _..._
