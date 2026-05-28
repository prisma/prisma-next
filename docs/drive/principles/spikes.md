# Principle: Spikes are time-boxed investigations whose output is a written artefact

## A good spike, a bad spike

**Good spike:**

> **Question:** How many in-source test literals construct the old data shape we're migrating away from?
>
> **Time-box:** 20 min.
>
> **Output** (write to `projects/<x>/spikes/<date>-old-shape-test-sites.md`): a per-package table with file paths + occurrence counts + the total. Flag separately any sites that are *intentionally* using the old shape (e.g. testing rejection).

That output table goes directly into the brief for the migration dispatch. The next agent reads it; sizes the migration; lists the sites in the migration brief's scope-in; pre-names the rejection-test sites as edge cases. The spike paid for itself.

**Bad spike:**

> Explore the migration system and tell me what you find.

No specific question. No artefact structure. Time-box implicit. Output will be free-form prose. Cannot be slotted into a downstream brief. The next agent gets a paragraph and still has to ask the original question.

The difference is whether **the spike's output is a fact the next dispatch can use, not an opinion or a write-up.**

## What a spike is (and isn't)

A spike is a dispatch with three differences from a regular dispatch — same brief discipline, same DoR/DoD shape, same orchestration loop. Only the deliverable changes:

| | Regular dispatch | Spike dispatch |
|---|---|---|
| Deliverable | Committed code | A written artefact at a named path with a named shape |
| "Done when" | "Gates pass; intent validated" | "Artefact exists at the named path; answers the question; downstream dispatch's brief can be assembled from it" |
| Question shape | "Make X true" | "What's true about Y in this codebase right now?" |

`drive-build-workflow` runs spikes the same way it runs any other dispatch. There's no separate skill. Triage may also emit "spike first" as a verdict when the entry point can't be sized without a probe; re-triage runs on the artefact.

## When a spike is the right move

A spike is warranted when **the orchestrator cannot decompose, size, or triage the work without first answering a question the codebase can answer.**

Spike-worthy questions:

- "How many call sites does this refactor touch?"
- "Which test fixtures currently use the legacy shape?"
- "What's the actual API surface the public types expose? (What would we be breaking?)"
- "Is there an existing helper for this, or do we need to write one?"
- "What's the shape of the existing consumers we'd need to maintain compatibility with?"
- "Does this concept already have a home in the codebase, or are we adding new vocabulary?"

Not spike-worthy:

- *"What should the new API look like?"* — design judgment; belongs in a design discussion or ADR, not a spike.
- *"Will this approach work?"* — too vague; reformulate as a specific question about the codebase a small probe can answer.
- *"How long will this take?"* — answer comes from sizing, not a spike. A spike can answer the prerequisite *"how big is the surface?"* but not the time estimate directly.

The test: **the output must be a fact about the codebase or system, not an opinion or a recommendation.** If the answer is "we should do X," the question was actually a design question; do that work in a design discussion or ADR.

## Spike DoR

A spike is ready to dispatch when:

1. **The question is specific.** "How many test sites need migration?" — specific. "Investigate the migration system" — not.
2. **The question is answerable from the codebase.** Reading code, running greps, inspecting types, executing small queries. Not "what should we do?" — that requires design judgment outside the spike.
3. **The output artefact is named.** "A list of the test sites, grouped by package, with a one-line note per site." "A table of consumers + their dispatch sizes." Not "a write-up."
4. **The time-box is set.** Spikes are bounded. Most common time-box is 15-30 min; longer means the question was bigger than expected.

If the question is unclear or unanswerable from the codebase, the spike isn't ready — it's still an open design question.

## Spike DoD

A spike is done when:

1. **The artefact exists at the named path** (typically `projects/<x>/spikes/<date>-<question>.md`).
2. **The artefact answers the question.** Not "I started investigating and ran out of time." If the time-box hit before the question was answered, that's itself an answer — the artefact should record *"Q is bigger than expected; here's what I learned in the time-box, here's what's still unknown, recommend re-spiking with a narrower question."*
3. **The downstream dispatch can use the artefact.** The orchestrator can read it and decompose / size / brief the next dispatch from it. If the artefact is too vague to do that, the spike's output is incomplete.

A spike's output IS the spike. No artefact = not done, regardless of what was learned in the process.

## A few more worked examples

**Good spike:** *"Does the existing codebase have a utility for converting between two specific shapes we'd otherwise have to bridge? Look in `<package-area>/`. Time-box: 10 min. Output: yes/no + file path + signature if yes; recommendation if no."*

The yes/no directly shapes whether the next dispatch needs to write a helper or use an existing one.

**Bad spike:** *"What's the right way to design the new data shape?"*

Design question, not a spike. Belongs in an ADR discussion. A spike could support it ("survey existing shapes in the codebase") but can't answer it.

**Good spike:** *"What's the maximum nesting depth our parser produces today? Run the test suite with the depth tracker enabled and report the max. Time-box: 5 min. Output: integer + one-line breakdown by fixture."*

A fact about the system. Informs whether a depth-bounded migration approach is realistic.

**Bad spike:** *"Investigate parser performance."*

Same problems as "explore the migration system." Reformulate as a specific question with a specific output shape.

## Two anti-patterns

### 1. "Investigation + implementation" in one dispatch

A common temptation: combine the spike and the implementation. *"Investigate how many test sites need migration, then migrate them."*

Wrong for two reasons:

- **The implementation can't be sized until the investigation completes.** Combining means the orchestrator can't run dispatch-INVEST against the implementation in advance. The dispatch silently becomes whatever shape the investigation reveals — and that shape often fails INVEST's *Estimable* and *Small* once it lands.
- **The artefact gets lost.** When the same dispatch does both, the investigation output usually becomes *"I noticed N sites need migration, then I migrated them all"* — buried in commit messages. The next agent has no spike artefact to read from.

Always separate. Spike first → artefact → orchestrator reads → sizes the implementation → dispatches it as its own M-sized work (or several M-sized works if the spike revealed it should decompose further).

### 2. "Exploratory dispatch" with no question

A second temptation: dispatch with no clear question, expecting the implementer to "figure it out and report back."

Wrong because:

- **There's no DoR.** Nothing to check WIP-inspection against.
- **The implementer's interpretation latitude is unbounded.** Different implementers produce wildly different artefacts; the orchestrator can't predict what comes back.
- **The artefact won't be reusable.** Without a named output structure, what comes back is free-form prose that doesn't slot into a downstream brief.

If the orchestrator doesn't have a specific question to ask, spend time formulating one — don't outsource the formulation.

## Spike artefacts are memory (or aren't, depending where they live)

Per [`protocol-as-memory.md`](protocol-as-memory.md), spike outputs are part of the team's memory *iff* they live where downstream agents will read them. Spike outputs in operator scratch (untracked working notes, transient drafts) are not memory; spike outputs linked from the project plan or referenced in the next dispatch's brief are.

Useful default: **spike outputs that inform the next dispatch live in the project's spec/plan tree; spike outputs that are one-shot stay in operator scratch and are deleted after the consuming dispatch completes.** The criterion is "will another dispatch need to read this?"

Stale spikes are worse than no spikes — an output that no longer reflects the codebase but is still being referenced will mislead. Spike outputs under `projects/<x>/spikes/` are deleted at project close-out (per the transient-projects discipline) unless they've graduated to a long-lived doc in `docs/` or a `drive/<category>/README.md` entry.

## How this fits into the loop

- The orchestrator's planning includes *"what spikes do we need?"* as an explicit step. Before committing to a decomposition, surface the unknowns and queue spikes for the ones that can't be reasoned from the brief.
- Triage can emit *"spike first"* as a verdict; the result is a single-dispatch slice plan with a spike-flavoured brief; re-triage runs on the artefact.
- Spikes are typically high-surface, low-conceptual work (read code, count things, structure findings). Per [`decomposition-and-cost.md`](decomposition-and-cost.md), cheap-tier dispatch with sharp DoD is usually the right shape.

## Related principles

- **[`protocol-as-memory.md`](protocol-as-memory.md)** — why spike artefacts must live in surfaces downstream dispatches will load.
- **[`decomposition-and-cost.md`](decomposition-and-cost.md)** — why spikes are usually cheap-tier dispatches that enable cheap-tier implementation dispatches.
- **[`brief-discipline.md`](brief-discipline.md)** — spike briefs swap "Done when" for an artefact spec but keep the other seven sections.
