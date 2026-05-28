# Artefact redesign: per-level templates, lean briefs, orphan-slice default

**Date:** 2026-05-28
**Status:** Accepted; pilot rollout starting immediately
**Touches:** `drive-specify-project`, `drive-plan-project`, `drive-specify-slice`, `drive-plan-slice`, `drive-build-workflow`, `drive-discussion`, `drive-triage-work`, `drive-start-workflow`, `docs/drive/principles/brief-discipline.md`, `drive/calibration/dod.md`, `drive/calibration/sizing.md`

## Decision

The Drive methodology is restructured around eight rules. Each rule is self-contained; together they replace the previous artifact templates.

### Rule 1 — Project, slice, and dispatch each get their own template

A project, a slice, and a dispatch are three different shapes of work. A single template stretched across all three either over-prescribes the small case or under-prescribes the large one. Each level now has its own template, tuned to the constraint that limits it:

- A **dispatch** must fit in the executor's context window.
- A **slice** must fit within one code review.
- A **project** suffers as its branch stack grows and coordination overhead increases.

### Rule 2 — Content lives at the lowest level where it doesn't lose information

If a section can move from a higher-level artifact to a lower-level one without losing meaning, it belongs at the lower level. Project specs become short by construction: they only carry what's true at the system level and nowhere else.

This rule resolves what to put where. It is also why the per-artifact templates below look the way they do.

### Rule 3 — Triage produces one of three delivery shapes

The triage skill picks between three shapes:

- **Direct change** — one commit, no spec.
- **Slice** — one PR, one spec.
- **Project** — multiple slices, project spec.

Promote / demote / spike-first / defer are not triage verdicts. They are transitions that move in-flight work between shapes. The previous eight-verdict triage tree conflated entry-point decisions with in-flight transitions; the simpler structure is easier to hold in head.

**The triage default is orphan slice first.** A one-slice project is acceptable when discussion-mode reveals the work needs design thinking before dispatching, but the baseline assumption is "this is a slice." A new project is created only when the work composes 2+ slices.

### Rule 4 — Discussion is signal-triggered, not mandatory

`drive-triage-work` runs a signal check before producing a verdict. Signals include:

- Design ambiguity in the ticket.
- Scope spanning surfaces the orchestrator hasn't grepped.
- The orchestrator's first grep returns more files than expected.
- A parent-project assumption could be falsified by this work.

If any fire, the workflow routes to `drive-discussion` before triage. If none fire, the orchestrator drafts directly. The operator doesn't have to flag the signal; the orchestrator detects it.

### Rule 5 — The executor's standing instruction is "stay focused on the goal; control scope"

Not "minimise changes." Minimisation trains executors to refuse obvious, goal-serving fixes — they leave the codebase in a worse state than necessary because their instructions told them not to touch anything.

The instruction is: stay focused on the goal; control scope. Trivial, obviously-related fixes ride along with a one-line note in the wrap-up. Anything that pulls the executor off the goal halts.

This instruction appears verbatim in every dispatch brief.

### Rule 6 — The reviewer does not re-run validation commands during routine review

The implementer ran `pnpm typecheck`, `pnpm test`, and the rest of the validation gates as part of the dispatch's Definition of Done. The reviewer trusts that run and focuses on design judgment. Re-running the same commands added ~5 minutes per review for near-zero new signal.

The one exception is the verify-on-main protocol: when an implementer claims a failure is pre-existing on `main`, the reviewer verifies that claim with a focused force-build plus typecheck — not the full suite.

### Rule 7 — The team-level Definition of Done lives in project context, not in the skill

Different teams and repos have different DoD floors. The skill body shouldn't pin one. In this repo, the team-DoD floor lives at `drive/calibration/dod.md` — an existing file accreted by retro discipline. Every project spec inherits these items and adds project-specific conditions on top; project specs do not restate the floor.

### Rule 8 — Internal project labels stay out of operator-facing communication

Linear tickets, PR titles and bodies, public commit messages, ADRs, release notes, and chat messages to the operator must be readable by someone without project context. Refer to slices and dispatches by what they do, not by their internal ID. Internal shorthand (slice IDs, dispatch numbers, finding labels) is fine inside intra-project artifacts — dispatch briefs, reviewer reports, retro entries — but not outside them.

## Per-artifact templates

Each template below applies Rule 2 (content lives at the lowest level where it doesn't lose information) to the level it covers.

### Project spec

**Contains:**

- **Purpose** — the north star, immutable across plan rewrites.
- **Non-goals** — explicit scope-protection.
- **Place in the larger world** — external dependencies, interfaces, "must integrate with X."
- **Cross-cutting requirements no single slice carries** — non-functional or functional requirements that only emerge when slices come together.
- **Transitional-shape constraints, stated as constraints** — e.g. "each slice must leave the system deployable"; "no breaking change without a deprecation window."

**Does not contain:**

- Per-slice detail (lives in the slice spec).
- Sequencing detail (lives in the project plan).
- Separate FR / NFR / Constraints+Assumptions ceremony sections — fold the items that matter into the sections above; drop the rest.

### Project plan

**Contains:**

An ordered list of slices, with parallel branches called out explicitly. Each entry:

- **Outcome** — one line, what this slice makes true.
- **Builds on** — state from prior slices this slice depends on.
- **Hands to** — state this slice leaves for downstream slices.
- **Focus** — what's in scope here; what adjacent surfaces are handled by other slices.

Plus a transitional-shape rationale where the sequencing isn't obvious from the dependency graph.

**Parallelisation must be surfaced explicitly.** The dependency graph implies which slices can run in parallel (B can run with A if B's "Builds on" doesn't reference A), but planning bias is sequential by default. A project plan that doesn't surface parallelisation opportunities misses real schedule wins.

**Does not contain:**

- Per-slice DoD coverage maps (the project-DoD is checked at close-out directly).
- Per-slice "Files in play" or "Predicted size" (those are slice-pickup work).

### Slice spec

**Contains:**

- **Chosen design** — the shape this slice converges on (e.g. "object-pair encoding for cross-references").
- **Coherence rationale** — why these dispatches together make one reviewable PR.
- **Slice-specific done conditions** — only what's not implied by CI-green + reviewer-accept + the project-DoD floor.
- **Pre-investigated edge cases** — only the ones the orchestrator already knows about from outside the codebase (a user's prior bug, a known footgun, a calibration entry matching this slice's shape). Almost always empty.

**Does not contain:**

- Pre-walked edge-case enumeration. Edge-case discovery happens at dispatch time, by the implementer's grep pre-flight on the named surface. Pre-naming what the implementer would discover anyway just makes the spec longer.

### Slice plan

**Contains:**

An ordered list of M-sized dispatches (target ≤ 10). Each entry uses the same shape as project-plan slice entries: outcome + builds-on + hands-to + focus.

The order encodes the migration shape — incremental delivery, keep-tests-green, transitional advantages. The brief-assembler reads each entry to know what context the executor needs for that dispatch.

**Explicit `Builds on` per dispatch catches non-linear dependencies.** Dispatch N may depend on N-2's output rather than N-1's; order alone hides that, an explicit `Builds on` surfaces it.

**Does not contain:**

- Per-dispatch DoR / DoD checklists (brief-assembler work).
- Per-dispatch "Files in play" (executor's discovery work).
- Per-dispatch sizing rationale (the slice-plan's M-cap means dispatches are M-sized by construction; L or XL refuses, re-decomposes).

### Dispatch brief

The full template lives at [`docs/drive/principles/brief-discipline.md`](../principles/brief-discipline.md). In summary: six sections — Task, Scope, Completed when, Standing instruction (verbatim across all briefs), References, Operational metadata. Briefs get shorter as the slice progresses because the same executor subagent runs every dispatch in the slice and retains the priming context from earlier dispatches when it's resumed.

## Sizing anchors

| Level | Lower | Upper | Why the floor matters |
|---|---|---|---|
| Direct change | 1 dispatch | 1 dispatch | If the spec needs writing down, it's a slice. |
| Slice | 1 dispatch | 5–10 M-dispatches | PR review has real human cost; tiny unrelated PRs are dominated by review overhead. Batch into an adjacent slice. |
| Project | 1 slice | 1–4 slices | Above 5 slices, stacked-PR and coordination overhead exceeds the project's value; that's probably two projects. |

Single-slice projects exist when discussion-first reveals one slice that needs design thinking before dispatching.

## Why we made this change

After roughly a week running the previous Drive model end-to-end on the target-extensible IR project (5 slices, ~30 dispatches, two reset-and-replan moments), five concrete complaints surfaced. The redesign answers each.

- **Process slowness.** Brief assembly was a 15-minute orchestrator task; per-dispatch ceremony added up. → Lean six-section briefs; reviewer skips re-running validation commands; same executor across the slice so briefs thin out.
- **Wordy artifacts.** Specs and plans grew structural sections that restated information visible elsewhere. → Rule 2 (content lives at the lowest level where it doesn't lose information) plus per-level templates pruned accordingly.
- **Unintelligible operator-facing communication.** Internal shorthand ("Path B," "S1.C D2-R6") leaked into Linear tickets and PR bodies. → Rule 8 (internal labels stay inside intra-project artifacts).
- **Auto-promotion of orphan slices to projects.** Project bias dominated triage. → Three-shape triage with orphan-slice default and a 1–4-slices-per-project anchor.
- **`drive-start-workflow` chattiness.** Confirmed every verdict even when no authorisation was needed. → Confirm only for promote, demote, or operator-flagged project creation; otherwise decide and execute.

## What this resolves

Once these amendments land, these retro entries are encoded into canonical skill bodies and can be deleted:

- "Over-detailed dispatch briefs" — resolved by the new six-section brief plus the slice-plan handoff principle (most content that was in the old brief moves to the slice-plan entry).
- "Reviewer dispatched with redundant gate-run scope" — resolved by Rule 6.
- "Reviewer prompt self-contradiction (Section C: Gate verification)" — resolved by the same change (the contradiction goes away when gate-running scope does).
- "Over-strict grep gate (slice spec paraphrased project-DoD)" — resolved by the slice spec inheriting project-DoD items verbatim rather than re-typing the patterns.
- "Per-call-site edits without audit-completeness" — partially resolved by Rule 5 (the standing instruction + the audit-grep addition in the brief).

These remain unresolved:

- "Stale-dist false-fail" — environmental, not artifact-shape.
- "Orchestrator over-asking permission" — behavioural, ongoing self-discipline.
- "Implementer discipline failure (refusal-trigger non-fire, defensive adapters, confabulation)" — executor-side discipline.
- "CI-fix dispatch shipped a layering-violation workaround" — executor judgment.

## Pilot plan

The next project IS the pilot. Rather than running the new model against one project before rolling it out, all eight skills change at once. Review in ~1 week.

**Success criterion (operator-set):** *"I can do detailed design work with my agent, then hand off execution to the orchestrator, which will plan the project and slices and iterate through delegating the dispatches until the project is complete, without my involvement, and the result meets my project success criteria."*

Measurements at pilot retro: operator interventions per dispatch; cycle time from project-start to project-done; retro-finding count generated during the pilot; artifact line counts (project spec, slice spec, slice plan, dispatch brief); reviewer wallclock per dispatch.

## Held thread

The dispatch sizing matrix at `drive/calibration/sizing.md` is too conservative for cheap-tier mechanical-fanout dispatches relative to what subagents have actually delivered across recent slices. Re-calibration is deferred until the pilot accumulates fresh data points. After the pilot, revisit using shipped dispatches as the ground-truth dataset and rewrite the matrix.

## Consequences

**Positive:**

- Specs and plans fit on one screen.
- Dispatch briefs drop from 200+ lines to ~30 lines.
- Triage decisions are simpler (3 entry-point shapes).
- Operator confirmation prompts drop significantly.
- Multiple retro entries get resolved without separate retro-keeping work.

**Risk:**

- The redesign is untested at scale. The pilot may surface gaps the design discussion didn't anticipate.
- Per-level template differentiation means four distinct templates to maintain (project spec, project plan, slice spec, slice plan) plus the brief. A single-template alternative was simpler to maintain but symmetric for its own sake.
- "Stay focused on the goal" depends on executor judgment about what counts as related vs drift. Edge cases will need calibration.
- Signal-triggered discussion depends on the orchestrator's signal detection. False negatives (skipping discussion when one was needed) will show up as design-question discovery mid-slice.

## References

- Discussion-mode session transcript: 2026-05-28 in the active worktree chat.
- Retro file at the time of decision: [`drive/retro/findings.md`](../../../drive/retro/findings.md).
- Brief discipline doc: [`docs/drive/principles/brief-discipline.md`](../principles/brief-discipline.md).
- Team-DoD floor inherited by project specs: [`drive/calibration/dod.md`](../../../drive/calibration/dod.md).
- Sizing matrix slated for revisit: [`drive/calibration/sizing.md`](../../../drive/calibration/sizing.md).
