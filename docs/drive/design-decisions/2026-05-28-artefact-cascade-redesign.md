# Artefact cascade redesign

**Date:** 2026-05-28
**Status:** Accepted; pilot rollout starting immediately
**Touches:** `drive-specify-project`, `drive-plan-project`, `drive-specify-slice`, `drive-plan-slice`, `drive-build-workflow`, `drive-discussion`, `drive-triage-work`, `drive-start-workflow`, `docs/drive/principles/brief-discipline.md`, `drive/done/README.md` (new)

## Context

After ~1 week running the Drive methodology in earnest across the `contract-ir-planes` project, the operator surfaced five complaints that compound into a single picture: **the methodology's artefacts are exhaustive, waterfall-shaped, and duplicate each other across levels.** Concretely:

- Project plans list slices with purpose + scope + dependencies; each slice spec then restates the slice's purpose and dispatches; each slice plan re-lists the dispatches in detail.
- Dispatch briefs run hundreds of lines — pre-enumerating files to touch, exhaustive completion-criteria checklists, multi-paragraph design-decision rationales.
- Specs over-prescribe: 5–15 pre-named edge cases with dispositions, 10-section project-spec template, 7-item project-done checklist.
- The triage skill biases toward "new project" even for one-PR-sized work, partly because the spec/plan ceremony is heavy enough to make orphan-slice feel comparable in cost.
- The `drive-start-workflow` confirmation prompts at every decision point are noisy.

Validation gates run far too often (implementer + reviewer + post-CodeRabbit-fix), with parallel agents on the operator's machine compounding CPU load.

The retros captured each of these as friction, but the retros are scattered observations — not a coherent redesign. This decision record captures the redesign produced by an extended discussion-mode session on 2026-05-28.

## Decision

The Drive cascade is redesigned around two principles:

1. **Each level carries durable intent + constraints (a "spec") and sequenced units with handoff contracts (a "plan").** The principle is fractal in *concept*. The templates are NOT identical across levels — each level's template is dictated by its real-world constraint:
   - **Dispatch** must fit in agent context window.
   - **Slice** must fit within code review.
   - **Project** suffers as branches stack and coordination overhead grows.
2. **If a section could move down a level without losing information, it belongs down the level.** This is the rule that resolves the trim question in a principled way rather than arbitrarily. Project specs become short by construction.

### Per-artefact decisions

#### Project spec

**Carries:**
- Purpose (durable north star, immutable across plan rewrites).
- Non-goals (explicit scope-protection).
- Place in the larger world (external dependencies, interfaces, "must integrate with X").
- Cross-cutting requirements no single slice carries (NFRs / FRs that emerge when slices come together).
- Transitional-shape constraints stated as constraints, not plans ("each slice must leave the system deployable", "no breaking change without a deprecation window").

**Does not carry:**
- Per-slice detail (lives in the slice spec).
- Sequencing detail (lives in the project plan).
- FRs / NFRs / Constraints + Assumptions as separate ceremony sections — fold the load-bearing ones into the sections above; drop the ones that fill with prose nobody re-reads.

**Why:** Test of "only true at the system level" cuts most of the existing template's mass. Purpose and non-goals are the exceptions — they're durable system-level even though they're not strictly "emergent from slices coming together," because they're what makes the slices coherent in the first place.

**Rejected alternative:** Trim everything by 50% uniformly. Rejected because arbitrary; the trim has no theory of what to keep, so bloat returns next iteration.

#### Project plan

**Carries:**
- Ordered (and **where independent, parallel**) list of slices. Each entry:
  - Outcome (one line — what this slice makes true).
  - Builds on (state from prior slices this slice relies on).
  - Hands to (state this slice leaves for downstream slices).
  - Focus (in scope here; adjacent surfaces handled by other slices).
- Transitional-shape rationale where the sequencing isn't obvious from the dependency graph.

**Parallelisation is load-bearing and must be explicit.** The dependency graph technically encodes parallelisation (slice B can run with slice A iff B's "builds on" doesn't reference A), but the planning bias is sequential by default. A project plan that doesn't surface its parallelisation opportunities is incomplete.

**Does not carry:**
- Per-slice DoD coverage maps (the project-DoD is checked at close-out directly).
- Per-slice "Files in play" or "Predicted size" (slice-author work, done at slice-pickup time).

#### Slice spec

**Carries:**
- The chosen design (the shape this slice converges on, e.g., "object-pair encoding for cross-references").
- Coherence rationale (why these dispatches together = one reviewable PR).
- Slice-specific done conditions — only what's not implied by CI-green + reviewer-accept + the project-DoD floor.
- Pre-investigated edge cases — *only* the ones the orchestrator already knows about from outside-codebase sources (a user's prior bug, a known footgun, a calibration entry matching the slice's shape). **Often empty.**

**Does not carry:**
- Pre-walked edge-case enumeration (the old "5–15 with dispositions" template). Discovery happens at dispatch-time by the implementer's grep pre-flight; pre-naming what the implementer would discover anyway is brief gigantism one level up.

#### Slice plan

**Carries:**
- Ordered list of M-sized dispatches (target ≤ 10). Each entry: outcome + builds-on + hands-to + focus — same shape as project-plan slice entries.

**Sequencing is the intent.** Incremental delivery; keep-tests-green; transitional-shape advantage. The order encodes the migration shape. The brief-assembler reads this entry to know what context the executor needs for each dispatch.

**Handoff contracts catch non-linear dependencies.** Dispatch N may depend on N-2's output, not N-1's. Explicit `builds on` per dispatch surfaces this; order alone hides it.

**Does not carry:**
- Per-dispatch DoR / DoD checklists (brief-assembler work).
- Per-dispatch "Files in play" (implementer's discovery work).
- Per-dispatch sizing rationale (the plan's M-cap means M-sized by construction).

#### Dispatch brief

**Carries:**
- Task at hand (unambiguous one-paragraph statement).
- Scope (in / out — what the executor must NOT touch).
- Completed-when (binary conditions specific to this dispatch, not the slice-wide gate suite).
- Operational metadata (model tier, time-box, refusal triggers, pointers up to slice spec + slice plan entry).
- Calibration references (specific footguns / failure patterns from the team's project context that match *this* dispatch's shape).
- Standing instruction: **"stay focused on the goal; control scope."** Trivial, obvious-and-related fixes that serve the goal go in the same dispatch with a one-line note in the wrap-up. Drift from the goal halts.

**Briefs thin out over the slice.** First-dispatch brief carries the priming context that shapes the whole slice's executor behavior; selective context compaction preserves early-set context as the executor's transcript accumulates, so subsequent briefs lean on the priming without re-paying. **Same executor across the slice is high-value** — switching at dispatch 6 forfeits the priming.

**Does not carry:**
- Comprehensive work plans.
- Pre-decomposed file lists.
- Multi-paragraph design-decision rationales.
- Exhaustive consumer call-site audits.
- Step-by-step execution scripts.

### Sizing anchors and floors

| Level | Lower | Upper | Floor rationale |
|---|---|---|---|
| Direct change | 1 dispatch | 1 dispatch | Spec must fit in working memory; if it needs writing down, it's a slice |
| Slice | 1 dispatch | 5–10 M-dispatches | Below ~50 LoC of unrelated work, batch into adjacent slice — PR review overhead is real |
| Project | 1 slice | 1–4 slices | Above 5 slices: stacked-PR + coordination overhead exceeds project value; probably 2 projects |

**Floors matter as much as ceilings.** PR overhead has real human cost; single-line PRs for "unrelated" work are dominated by review burden. Same logic at project level: a 1-slice project is fine when discussion-first reveals it really is one slice; spinning up a project for a slice that could fold into an adjacent project is overhead with no payoff.

**Triage default after sizing:** orphan slice first; one-slice project only if orphan won't fit (typically when you want to think the design through first); new project only when the work composes 2+ slices.

### Cross-cutting principles

1. **Drop arbitrary number ranges everywhere** ("5–15 edge cases", "1–3 paragraphs", "≤ 3 sentences"). They push the author to pad to the lower bound. Few-to-none may be the right answer for a particular artefact.
2. **Discussion is signal-triggered, not mandatory.** Fires when there's design ambiguity in the ticket, scope spanning unknown surfaces, the orchestrator's first-grep returns more files than expected, or a parent-project assumption could be falsified by this work. Otherwise, draft directly. The orchestrator detects the signal; the operator doesn't need to flag it.
3. **Triage simplifies to 3 entry-point verdicts.** Direct change / slice / project. Promote / demote / spike / defer are **state-machine transitions** on in-flight work, not entry-point verdicts. (The legacy 8-verdict tree conflated these; the simpler structure is easier to hold in head.)
4. **Executor continuity across the slice.** Selective context compaction preserves early-set design context; first-dispatch primes, subsequent briefs inherit. Switching executors mid-slice forfeits the priming.
5. **"Stay focused on the goal; control scope"** as the executor's standing instruction. Not "minimize changes" — minimization trains timidity. Goal-focused with scope discipline; trivial-and-related fixes in-line with a note; drift halts.
6. **Reviewer pnpm budget is zero.** Implementer's gate run is the gate; reviewer judges design, not mechanics. Exception: the verify-on-main protocol when investigating a "pre-existing on main" claim, which is a focused force-build + typecheck, not the full suite.
7. **Team-level Definition of Done lives in project context** (this repo: `drive/calibration/dod.md`; other repos may use `drive/done/README.md` or a comparable path). Different teams / repos have different DoD floors; the skill body shouldn't pin one. Each project spec inherits the team's floor and adds project-specific conditions on top.
8. **No project-internal labels in operator-facing communication.** Externally-discoverable artefacts (Linear tickets, PR titles + bodies, public commit messages, ADRs, release notes) must be readable by someone without project context. The same rule applies to chat messages: define internal terms on first use; refer to slices and dispatches by what they do, not by their ID. Internal shorthand (slice IDs, dispatch numbers, finding labels) is fine in intra-project artefacts (dispatch briefs, reviewer reports, retro entries) but not in conversation with the operator.

### What gets resolved

Once the skill amendments below land, these retro entries are encoded into canonical skill bodies and can be deleted:

- "Brief gigantism" — resolved by the new dispatch-brief shape + slice-plan handoff principle (most of what was in the old brief moves to the slice plan entry).
- "Reviewer dispatched with redundant gate-run scope" — resolved by the build-workflow amendment placing reviewer pnpm budget at zero.
- "Reviewer prompt self-contradiction (Section C: Gate verification)" — resolved by the same change (the contradiction goes away when gate-running scope does).
- "Over-strict grep gate (slice paraphrased project-DoD)" — resolved by simplified slice-spec done-conditions structure (verbatim from project-DoD where they exist; explicit carve-out, not re-typed pattern).
- "Per-call-site edits without audit-completeness" — partially resolved by the "stay focused on the goal; control scope" standing instruction + audit-grep brief addition.

These remain unresolved and continue to apply:

- "Stale-dist false-fail" (environmental, not artefact-shape).
- "Orchestrator over-asking permission" (behavioral, ongoing self-discipline).
- "Implementer discipline failure (refusal-trigger non-fire + F6 + confabulation)" (executor-side discipline).
- "CI-fix dispatch shipped a layering-violation workaround" (executor judgment).

### Held threads (for after this rollout)

- **Calibration matrix revisit.** `drive/calibration/sizing.md` is too conservative for dispatch sizing relative to what the implementer subagents have actually delivered across recent slices. Revisit using shipped dispatches as the ground-truth dataset; tighten the matrix; rewrite the dispatch sizing anchors against it. Pilot project will accumulate fresh data points.

### Pilot

**The next project IS the pilot.** Rather than running the new model against one project before rolling it out, the operator has opted to amend all eight skills at once and pilot the next project under them. Review in ~1 week.

**Success criterion (operator-set):** *"I can do detailed design work with my agent, then hand off execution to the orchestrator which will plan the project and slices and iterate through delegating the dispatches until the project is complete, without my involvement, and the result meets my project success criteria."*

Observable measurements at pilot retro: operator interventions per dispatch; cycle time from project-start to project-done; retro-finding count generated during pilot; artefact line counts (project spec, slice spec, slice plan, dispatch brief); reviewer wallclock per dispatch.

## Consequences

### Positive

- Specs and plans become readable on a single screen.
- Dispatch briefs collapse from 200+ lines to ~30 lines.
- Triage decisions are simpler (3 entry-point verdicts).
- Operator confirmation prompts drop significantly (only promote/demote/significant-rescope warrant interrupting).
- Multiple retro entries get resolved without separate retro-keeping work.

### Negative / risk

- The redesign is untested at scale. The pilot project might surface gaps the discussion didn't anticipate.
- Per-level template differentiation means more templates to maintain (4 distinct templates: project spec, project plan, slice spec, slice plan, plus brief). The fractal-uniform alternative was simpler to maintain but symmetric for its own sake.
- "Stay focused on the goal" depends on executor judgment about what's "related" vs "drift." Edge cases may need calibration.
- The signal-triggered discussion entry depends on the orchestrator's signal detection. False negatives (skipping discussion when one was needed) will show up as design-question discovery mid-slice.

### Neutral

- Cross-cutting principles (drop number ranges, jargon-free conversation, reviewer pnpm-zero) apply universally and don't change the cascade itself.

## References

- Discussion-mode session transcript: 2026-05-28 in the active worktree chat.
- Retro file at the time of decision: [`drive/retro/findings.md`](../../../drive/retro/findings.md).
- Brief discipline doc being rewritten: [`docs/drive/principles/brief-discipline.md`](../principles/brief-discipline.md).
- Team-DoD floor inherited by project specs: [`drive/calibration/dod.md`](../../../drive/calibration/dod.md).
- Calibration matrix being revisited: [`drive/calibration/sizing.md`](../../../drive/calibration/sizing.md).
