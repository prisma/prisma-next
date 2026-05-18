# Principle: Spikes Are Time-Boxed Investigations With Artefact Output (Brief-Type, Not a Separate Skill)

## Thesis

A spike is a short, time-boxed investigation whose Definition of Done is "you have an actionable understanding of what to do," not working code. Spikes exist because some planning-time questions cannot be answered by reasoning from the brief — they need a small probe into the codebase / system / environment. The output of a spike is an artefact (a decomposition plan, an estimate range, an approach proposal, a list of consumers) that downstream dispatches consume.

Mechanically, a spike is a **brief-type variant of an ordinary dispatch**, not a separate skill or workflow. A spike-flavoured brief carries a different DoD ("the artefact is actionable") and a different output expectation (a written artefact, not committed code). Spike dispatches are runnable by `drive-orchestrate-plan` the same way any other dispatch is — just with a different brief shape. Triage may also emit "spike first" as a verdict when the entry-point can't be sized without a probe.

Spikes are the only dispatch type in the protocol that produces a written artefact rather than executed code. That makes them load-bearing for the team's memory in a way other dispatches are not.

## When to use a spike

A spike is warranted when **the agile orchestrator cannot decompose, size, or triage work without first answering a question that the codebase can answer**.

Examples of spike-worthy questions:

- "How many call sites does this refactor touch?"
- "Which test fixtures currently use the legacy shape?"
- "What's the actual API surface the public types expose? (i.e. what would we be breaking?)"
- "Is there an existing helper for this, or do we need to write one?"
- "What's the right shape of this abstraction given the existing consumers?"
- "Does this concept already have a home in the codebase, or are we adding new vocabulary?"

Examples of questions that are **not** spike-worthy:

- "What should the new API look like?" → that's design judgment, belongs in an ADR / spec discussion, not a spike.
- "Will this approach work?" → too vague; reformulate as a specific question about the codebase that can be answered with a small probe.
- "How long will this take?" → answer comes from sizing, not from a spike. (A spike can answer the prerequisite question "how big is the surface?" but not the time estimate directly.)

A useful test: **the spike's output must be a fact about the codebase or system, not an opinion or a recommendation.** If the answer is "we should do X," the question was actually a design question; do that work in a design discussion or ADR.

## Definition of Ready for a spike

A spike is ready to dispatch when:

1. **The question is specific.** "How many test sites need migration?" is specific. "Investigate the migration system" is not.
2. **The question is answerable from the codebase.** Reading code, running greps, inspecting types, executing small queries. Not "what should we do?" — that requires design judgment outside the spike.
3. **The output artefact is named.** "A list of the test sites, grouped by package, with a one-line note per site." "A table of consumers + their dispatch sizes for the decomposition plan." Not "a write-up."
4. **The time-box is set.** Spikes are bounded. The most common spike time-box is 15-30 min; longer means the question was actually bigger than expected.

If the question is unclear or unanswerable from the codebase, the spike is not ready — it's still an open design question.

## Definition of Done for a spike

A spike is done when:

1. **The output artefact exists on disk** at a known path (typically under the project's `wip/` or `spikes/` directory, depending on retention policy).
2. **The artefact answers the question.** Not "I started investigating and ran out of time." If the time-box hit before the question was answered, that's itself an answer — the artefact should record "Q is bigger than expected; here's what I learned in the time-box, here's what's still unknown, recommend re-spiking with a narrower question."
3. **The downstream dispatch can use the artefact.** The orchestrator can read the artefact and decompose / size / brief the next dispatch using it. If the artefact is too vague to do that with, the spike's output is incomplete.

A spike's output is the spike. If there's no artefact, the spike was not done — regardless of what was learned in the process.

## Why spikes are different from other dispatches

Most dispatches produce committed code that ships with the project. Spikes produce written artefacts that exist to inform later dispatches. This structural difference has consequences:

- **The artefact is the deliverable.** Not "what I learned" — what I wrote down for the next agent / orchestrator to read.
- **The artefact's home matters.** A spike output in `wip/` (not loaded on subsequent dispatches) is unsafe — the downstream dispatch may not know to read it. A spike output linked from the project's plan / spec is reliably loaded.
- **The artefact's structure matters.** Tables, lists, and explicit headings are more memory-friendly than prose. The next agent will be reading this to make a decision; structure helps.
- **Stale spikes are anti-memory.** A spike output that no longer reflects the codebase but is still being referenced will mislead. Spike outputs need an expiry / re-validation policy if the codebase moves underneath them.

## The "investigation + implementation" anti-pattern

A common temptation: combine the spike and the implementation in one dispatch. "Investigate how many test sites need migration, then migrate them."

This is wrong for two reasons:

1. **The implementation cannot be sized until the investigation completes.** Combining them means the orchestrator can't apply size caps to the implementation. The dispatch silently becomes whatever size the investigation reveals — which might be L/XL.

2. **The artefact gets lost.** When the same dispatch does both, the investigation output usually becomes "I noticed N sites need migration, then I migrated them all" — buried in commit messages. The next agent has no spike artefact to learn from.

Always separate. Spike first, produces artefact, orchestrator reads artefact, sizes the implementation, dispatches the implementation as its own M-sized work (or several M-sized works if the spike revealed it should be decomposed further).

## The "exploratory dispatch" anti-pattern

A second temptation: dispatch a task with no clear question, expecting the implementer to "figure it out and report back."

This is wrong because:

1. **There's no DoR.** The dispatch can't be checked at any standup because there's no specification to verify against.
2. **The implementer's interpretation latitude is unbounded.** Different implementers will produce wildly different artefacts; the orchestrator can't predict what comes back.
3. **The artefact is unlikely to be reusable.** Without a named output structure, what comes back will be free-form prose that doesn't slot into a downstream brief.

If the orchestrator doesn't have a specific question to ask, the right move is to spend time formulating the question — not to outsource the formulation to an implementer.

## Worked examples

**Good spike**: "How many in-source test literals construct the old flat-shape `tables: {<name>: ...}` contract?

Time-box: 20 min.

Output (write to `projects/<x>/spikes/2026-05-17-flat-shape-test-sites.md`): a per-package table with file paths + occurrence counts, plus the total. Identify any sites that are *intentionally* flat-shape (e.g. testing rejection); flag separately."

The output table goes directly into the brief for the migration dispatch.

**Bad spike**: "Explore the migration system and tell me what you find."

No specific question. No artefact structure. Time-box implicit. Output will be unstructured prose. Cannot be slotted into a downstream brief.

**Good spike**: "Does the existing codebase have a utility for converting a `Record<NamespaceId, ...>` to a flat per-table list? Look in `packages/2-sql/`. Time-box: 10 min. Output: yes/no + file path + signature if yes; recommendation if no."

The yes/no answer directly shapes whether the next dispatch needs to write a helper or use an existing one.

**Bad spike**: "What's the right way to design the new IR shape?"

That's a design question, not a spike. Belongs in an ADR discussion. A spike could support it ("survey existing IR shapes in the codebase") but cannot answer it.

## Spike outputs are memory

Per [`protocol-as-memory.md`](protocol-as-memory.md), spike outputs are part of the team's memory iff they live where downstream agents will read them. Spike outputs that go into `wip/` and are forgotten are not memory; spike outputs linked from the project plan or referenced in the next dispatch's brief are.

A useful default: **spike outputs that inform the next dispatch live in the project's spec/plan tree; spike outputs that are one-shot stay in `wip/` and are deleted after the consuming dispatch completes**. The criterion is "will another dispatch need to read this?"

## Practical implications

1. **The protocol explicitly supports spikes as a brief-type variant.** Briefs, DoR, DoD, time-boxing all apply, with the modification that the deliverable is an artefact rather than code. No separate skill required — `drive-orchestrate-plan` runs a spike dispatch the same way it runs any other dispatch, just with a spike-flavoured brief.
2. **The agile orchestrator's planning includes "what spikes do we need?" as an explicit step.** Before committing to a decomposition, the orchestrator surfaces the unknowns and queues spikes for the ones that can't be reasoned from the brief.
3. **"Spike first" is a triage verdict.** When triage can't size or decompose without a probe, it routes to a single-dispatch slice plan with a spike-flavoured brief; re-triage runs on the artefact.
4. **Spike artefacts have a retention policy.** Default: spike artefacts under `projects/<x>/spikes/` are deleted at project close-out (per the transient-projects discipline) unless they've graduated to a long-lived doc in `docs/` or a calibration entry.
5. **Spikes can be dispatched to cheaper agents.** Per [`decomposition-and-cost.md`](decomposition-and-cost.md), spikes are typically high-surface low-conceptual work (read code, count things, structure findings). Cheap-tier dispatch with strong DoD is the right shape.

## Failure mode this principle directly prevents

Two recurring failures:

- **Sizing by guess** — the orchestrator dispatches an L/XL because they didn't actually know how big the work was; a spike would have surfaced the size and forced decomposition.
- **Implementation drift from unknown unknowns** — the implementer hits a question the orchestrator didn't anticipate, makes a private decision, drifts from spec. A spike that surfaced the question pre-dispatch would have routed the decision to the orchestrator instead.

## Related principles

- **[`protocol-as-memory.md`](protocol-as-memory.md)** — why spike artefacts must live in surfaces downstream dispatches will load.
- **[`decomposition-and-cost.md`](decomposition-and-cost.md)** — why spikes are typically cheap-tier dispatches that enable cheap-tier implementation dispatches.
