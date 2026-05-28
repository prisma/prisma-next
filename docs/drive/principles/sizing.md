# Principle: size work by logical coherence, not by logistical footprint

## The rule

A unit of work — dispatch, slice, or project — is well-sized when it has **one logical outcome** that a single human or executor can hold in their head, deliver, and verify. It is mis-sized when its boundary is drawn around a logistical metric (file count, line count, time-box, number of packages) instead of around that outcome.

The tool for checking well-sizedness is **INVEST**, applied at all three altitudes. The same six letters; different altitude-specific definitions.

## Why we size

Executors — humans or agents — have a finite working memory. Reviewers have a finite attention budget for a single review session. A unit of work is well-sized when it fits both. Drive sizes work to:

- Keep executors **on track**: the outcome is concrete, the boundary is sharp, the executor does not need to invent sub-purposes mid-flight.
- Keep executors **operating fast**: the context they need fits in one priming pass; they spend tokens producing, not re-orienting.
- Keep executors' **scope controlled**: the brief names what's in and what's out; adjacent-but-tempting work has nowhere to land except a halt.
- Get **predictable results**: a well-sized unit completes within its time-box, with its outcome verifiable by a small set of gates.
- Stay within the executor's **context window**: a unit too big for context forces the executor to evict priming material, at which point it veers off the named outcome and spirals into tangential tasks.

Notice what is **not** in that list: blast-radius minimisation, file-count minimisation, line-count minimisation, change-surface minimisation. Those are logistical metrics. They sometimes correlate with the things we actually care about — but only sometimes — and treating them as the sizing axis produces the failure modes called out in [§ Anti-patterns](#anti-patterns).

## Logical units vs logistical units

A **logical unit** is defined by its outcome — "what is true about the system after this lands." A logical unit can touch one file or two hundred files; the unit-ness comes from the coherence of the outcome, not the size of the diff.

A **logistical unit** is defined by an implementation metric — "this touches N files," "this is M lines of diff," "this fits in T hours." Logistical metrics can be useful as *signals* (a 200-file diff probably warrants a closer look) but they are not the unit boundary.

Two worked examples make the distinction concrete:

- **Mechanical rename across 300 files** — one logical unit. The outcome is "every reference to `oldName` now reads `newName`." The reviewer reads three files and infers the other 297. The executor's context need is small. Sizing this as "L because it touches 300 files" misreads the unit's shape.

- **Three-file change that adds a new validator, a new error type, and updates a fixture** — possibly three logical units. The outcome is plural: a new validation rule, a new error vocabulary, a fixture update. The reviewer has to context-switch three times in one PR. The executor has to hold three sub-purposes. Sizing this as "S because it's three files" misses the coherence problem.

This is the central move: **outcome coherence is the boundary, not output footprint.**

## INVEST, applied at three altitudes

INVEST is the agile-canonical checklist for well-sized work (Bill Wake, 2003). The six letters apply at each Drive altitude with altitude-specific definitions.

### Dispatch INVEST

| Letter | At dispatch altitude |
|---|---|
| **I**ndependent | This dispatch produces a usable hand-off without depending on a sibling dispatch landing concurrently. (Sequential dependencies on prior dispatches are fine; concurrent dependencies are not.) |
| **N**egotiable | The outcome is specified; the implementation path is not. The executor has room to discover the right approach inside the named outcome. |
| **V**aluable | This dispatch advances the slice's outcome materially — not a step that exists only to set up another step. |
| **E**stimable | A `Completed when` checklist can be written that is binary and verifiable. If you can't write the checklist, the dispatch isn't shaped well enough yet. |
| **S**mall | The brief plus its references fit in the executor's context. The executor can hold the named outcome and its halt conditions without evicting one to make room for the other. |
| **T**estable | A small set of gates (commands, greps, tests) verifies the outcome. If verification requires reading the full diff, the dispatch is too big for its own outcome. |

### Slice INVEST

| Letter | At slice altitude |
|---|---|
| **I**ndependent | This slice can ship as one PR without depending on a sibling slice being merged first. (Sequential dependencies on prior slices in the project plan are fine; concurrent dependencies signal the two slices are actually one.) |
| **N**egotiable | The slice spec pins the chosen design; the dispatch sequence is negotiable. The orchestrator can re-decompose the slice plan without changing the slice's outcome. |
| **V**aluable | The slice closes a real gap in the project's purpose. A slice whose value is only "preparation for the next slice" is a sequencing artifact, not a slice. |
| **E**stimable | The slice's done conditions are binary and verifiable at PR-merge time. |
| **S**mall | **Manageable in a single code review.** One reviewer can hold the slice's coherence in one sitting without losing the thread. A 200-LoC PR spanning seven concerns fails this test; a 2000-LoC mechanical rename passes it. |
| **T**estable | The slice-DoD plus the project-DoD floor compose into a passable bar at PR-open time. |

### Project INVEST

| Letter | At project altitude |
|---|---|
| **I**ndependent | The project's purpose stands on its own — it's not "phase 1 of a larger thing that needs phase 2 to make sense." |
| **N**egotiable | The project spec pins the purpose; the slice composition is negotiable. The orchestrator can re-decompose the project plan without changing the project's purpose. |
| **V**aluable | The project's purpose closes a real gap. A project whose value is only "groundwork" is groundwork — file it that way, not as a project. |
| **E**stimable | Each slice in the project plan can be sized at slice-INVEST without further decomposition. |
| **S**mall | The branch stack survives normal rebasing cadence. A project that runs long enough for `main` to drift past its base on every slice is too big. |
| **T**estable | The project-DoD lists conditions that are checkable at close-out. |

## Anti-patterns

These are the recurring failure modes that the file-count framing produces. They are explicit because they recur even when the principle is stated.

### 1. Sizing on file count

> "This dispatch is L because it touches 30 files."

Sometimes 30 files is one logical unit (mechanical rename, codemod, search-and-replace on a uniform pattern). Sometimes 3 files is three logical units. File count is a *signal* (large diffs warrant a sniff test) but not the *axis*. The axis is outcome coherence.

The corrective question: *"Is there one outcome here that fits one sentence, or are there several?"* If one sentence covers all the changes, the file count is incidental. If you need three sentences, you have three units no matter how few files each one touches.

### 2. Sizing on time-box alone

> "This dispatch is M because it'll take ~30 min."

Time-box is a *constraint check* (does this fit in one executor session?), not a unit boundary. A 30-minute task with two distinct outcomes is still two units; bundling them under a single time-box hides the second outcome from the reviewer and the gates.

### 3. Pre-walking every detail before dispatch

> "Let me list every file the executor will touch and every grep they'll need to run."

This is waterfall planning dressed in agile vocabulary. The brief should name the outcome and the boundary, not the implementation path. Pre-walking burns orchestrator time, anchors the executor to one path when others may be better, and produces briefs the executor either ignores or follows mechanically without engaging.

The corrective: the brief gives the executor the **outcome** and the **halt conditions**. The executor's grep pre-flight is where implementation discovery belongs.

### 4. Defensive scope expansion ("while I was in there")

> "I noticed the fixture format was inconsistent so I wrote a helper to normalise old shapes to new shapes alongside the main change."

This is the failure mode that produced one of this codebase's most expensive dispatches: defensive helpers that defeat a hard-cut migration because the executor invented a sub-purpose ("be helpful to stale fixtures") the brief never authorized.

Defensive expansion is never OK. The standing instruction is *stay focused on the goal; control scope* — trivial-and-related fixes ride along with a wrap-up note; anything that invents a new sub-purpose halts and surfaces.

The corrective: when an executor produces work outside the named outcome, the reviewer rejects it on coherence grounds even if every individual line is well-written. The unit boundary is the outcome, not "things that seemed related at the time."

### 5. Conflating logical and logistical sizing in the same matrix

> "S = 1 file, M = 4-6 files, L = 10+ files."

A matrix shaped like this trains everyone reading it — orchestrators, executors, reviewers — to think in logistical terms. The matrix itself is the anti-pattern, even when the prose around it mentions coherence. The fix is not a footnote saying "remember it's about coherence"; it's a matrix shaped around coherence questions ("is this one outcome?", "does verification fit a small gate?") with logistical metrics demoted to signals.

### 6. Sizing by importance

> "This work is important, so it's a project."

Importance is not a sizing signal. A single-line copy fix to a critical user-visible string is a direct change. A six-PR refactor of a non-critical helper is a project. The sizing question is *what shape of unit holds this work coherently?*, not *how much does this matter?*

## Sizing happens at three moments

The principle applies at three points in the workflow:

1. **At triage** (`drive-triage-work`): pick the delivery shape (direct change / slice / project). The choice is INVEST-driven — is this one logical unit shippable as a direct change? a slice? does it compose 2+ slices into a project?

2. **At decomposition** (`drive-plan-project`, `drive-plan-slice`): break the parent into children. The children are INVEST-checked at their altitude. A slice plan that lists 12 dispatches signals one of: (a) the slice is mis-sized at the parent altitude, (b) the dispatches are too fine-grained, (c) some "dispatches" are actually setup steps that aren't valuable on their own.

3. **At pre-flight DoR** (`drive-build-workflow`): the orchestrator runs the dispatch INVEST checklist before delegating. Failing a letter means the dispatch isn't ready to dispatch — refine the brief, re-decompose, or surface a stop-condition.

## Operational caps (soft guides, not validity criteria)

INVEST is the validity test. The caps below are *operational guides* for spotting probable mis-sizing — they trigger a recheck, not an automatic refusal.

| Altitude | Soft cap | What hitting the cap means |
|---|---|---|
| Dispatch | Fits in one executor session (typical: minutes to an hour or two) | Above this, re-check Small + Estimable. |
| Slice | ≤ 10 M-sized dispatches | Above this, re-check the slice's Independent + Valuable at the project altitude (it may be two slices). |
| Project | 1–4 slices | Above 4, re-check the project's Independent (it may be two projects with one shared purpose statement). |

These caps emerged empirically from running Drive in this repo. They are heuristics, not rules. A 12-dispatch slice can be legitimate if those 12 dispatches all serve one outcome and the reviewer can hold the coherence — but the cap fires a recheck so the orchestrator confirms rather than drifts.

## The dispatch-shape failure modes are coherence failures

When a dispatch goes sideways, the failure is almost always a coherence failure, not a size failure. The two patterns this repo has hit most often:

- **Underspecified outcome lets the executor invent purposes.** The brief named a goal in vague terms; the executor filled the gap by inventing what "related" means; the dispatch grew defensive helpers, normalisers, or "while I was in there" fixes that defeat the named outcome. (Sizing fix: write a sharper outcome and a sharper boundary, not a smaller dispatch.)

- **Coherent-on-paper outcomes hide a hidden second outcome.** "Migrate the validator and update the fixtures" sounds like one outcome but the executor's mid-dispatch report shows two parallel investigations — the validator migration and a separate fixture-format discovery. (Sizing fix: split into two dispatches with explicit hand-off, not stretch the original.)

Both patterns are invisible to a file-count or LoC matrix. They are visible to INVEST.

## Related principles

- [`brief-discipline.md`](brief-discipline.md) — the brief's `Completed when` is where dispatch-INVEST's *Estimable* and *Testable* land in writing.
- [`decomposition-and-cost.md`](decomposition-and-cost.md) — why model tier follows dispatch shape, and why decomposition (sizing) is what makes cheap-tier dispatches safe.
- [`definition-of-ready.md`](definition-of-ready.md) — dispatch DoR is where the INVEST checklist is actually run.
- [`spikes.md`](spikes.md) — spike-dispatch sizing is special: the unit's outcome is an artifact, not a code change.

## See also

- [`drive/calibration/sizing.md`](../../../drive/calibration/sizing.md) — this repo's calibration of the principle: per-altitude INVEST rubric specialised to this codebase, parallelisation heuristics, recurring reference patterns.
