# Principle: a dispatch brief has six sections — and nothing else

A dispatch brief is the document the orchestrator hands to an executor subagent to delegate one unit of work. It contains exactly these six sections, in this order:

| Section | What it contains |
|---|---|
| **Task** | One paragraph naming what this dispatch does. Unambiguous. Names the surface and the change. |
| **Scope** | Two lists: what's in this dispatch and what's explicitly out. The "out" list pre-empts "while I was in there I also fixed X." |
| **Completed when** | One to three binary, dispatch-specific conditions. Not slice-wide gates. Not anything CI / reviewer / project-DoD already implies. |
| **Standing instruction** | The same paragraph in every brief, every time: *"Stay focused on the goal; control scope. Trivial, obviously-related fixes that serve the goal go in the same dispatch with a one-line note in the wrap-up. Anything that pulls you off the goal — even if it looks useful — halts and surfaces."* |
| **References** | Links to: the slice spec; this dispatch's slice-plan entry; any spike artifact this dispatch consumes; prior dispatch artifacts in this slice. Plus team-context entries that match this dispatch's shape (failure modes the team has hit before, grep patterns from the team's catalogue). |
| **Operational metadata** | Three things: model tier (with a one-line rationale), time-box (overrun means halt and surface), halt conditions (the specific situations under which the executor stops and asks). |

A spike dispatch swaps "Completed when" for an artifact specification — see [`spikes.md`](spikes.md).

That's the whole rule. Everything below explains why each section is what it is and how to keep briefs from drifting back into bigger shapes.

## A concrete example

```markdown
# Brief: Migrate legacy-shape test sites (dispatch 2 of 3)

## Task

Migrate the 8 in-source test sites listed in the spike artifact to the new shape.
One commit per file. No other consumers touched.

## Scope

**In:** The 8 test sites named in the spike artifact (linked below).

**Out:** Authoring-layer consumers (next dispatch); introspector tightening (dispatch 3);
any fixture or consumer NOT in the spike artifact.

## Completed when

- [ ] All 8 sites updated; per-site commits reference the spike artifact.
- [ ] `rg "old-shape-literal"` returns empty in the migrated files.
- [ ] Package typecheck clean for the affected packages.

## Standing instruction

Stay focused on the goal; control scope. Trivial, obviously-related fixes that serve the
goal go in the same dispatch with a one-line note in the wrap-up. Anything that pulls you
off the goal — even if it looks useful — halts and surfaces.

## References

- Slice spec: `projects/<project>/slices/<slice>/spec.md`
- Slice-plan entry: `projects/<project>/slices/<slice>/plan.md` § Dispatch 2
- Spike artifact: `projects/<project>/spikes/<date>-test-sites.md`
- Team context: `drive/calibration/sizing.md` § Migration-shaped dispatches

## Operational metadata

- **Model tier:** cheap. Mechanical migration with strong gates.
- **Time-box:** ≤ 30 min.
- **Halt conditions:** site has a legacy-shape literal intentionally (rejection test) → skip and flag in wrap-up; site mixes legacy + new shape (partial migration) → halt and surface as slice-spec ambiguity.
```

There's nothing to interpret. The task is named. The scope is bounded. The completed-when is binary. The halt conditions cover the foreseen edge cases. The reviewer has a sharp focus (was the goal achieved, was scope honoured); the operator gets back a predictable dispatch.

## Briefs get shorter as a slice progresses

The same executor subagent runs every dispatch in a slice — it's resumed across dispatches rather than spawned fresh each time. Because the subagent is resumed, it retains the priming context from earlier dispatches even as its transcript grows. (Different agent harnesses keep that context in different ways — context-window expansion, selective compaction, summarisation — but the rule "same executor, resumed across dispatches" is what makes the briefs thin out, not the specific mechanism.)

What this means in practice:

| Dispatch | Brief shape |
|---|---|
| **Dispatch 1** of the slice | Full template at full precision. This brief primes the slice's chosen design, the team's catalogue entries the slice will need, and the slice-DoD context. |
| **Dispatch 2 onwards** | The References section gets shorter (the subagent already knows where the slice spec lives); team-context entries are only restated if they're new to this dispatch. Task / Scope / Completed-when / halt conditions stay at full precision. |

The default is to keep the same executor across all dispatches of a slice. Switching mid-slice means the new executor has to re-establish what the prior one already knew, which forfeits the priming. Spawn a fresh executor only when there's a deliberate reason — e.g. operator asks for a fresh-eyes pass.

## Where edge cases come from

Two sources, both at brief-assembly time:

1. **The team's catalogue.** Failure modes the team has hit before, grep patterns that anchor common rewrites. The brief-assembler picks the entries that match this dispatch's shape and links them in `References`. The ones that warrant halting become entries in `Halt conditions`.

2. **The slice spec's pre-investigated edge cases**, if any. This list is almost always empty. The slice spec only pre-investigates an edge case when the orchestrator already knew about it from outside the codebase (a user's prior bug, a known footgun). If there's an entry, the brief-assembler pulls it into `Halt conditions`.

Most edge cases are discovered at dispatch time by the executor's grep pre-flight on the named surface. The standing instruction tells the executor what to do with each one it finds (in scope and obvious → handle and note; in scope and ambiguous → halt; out of scope → don't touch).

When an edge case happens that the catalogue didn't predict, the brief was the wrong place to catch it — the team didn't know to name it. That's a retro trigger: the lesson goes into the team's context catalogue, and the next brief whose shape matches inherits it.

## Brief template

```markdown
# Brief: <one-line-name>

## Task

<One paragraph: what this dispatch does. Unambiguous. Names the surface and the change.>

## Scope

**In:** <bullets — the files / changes / behaviours in this dispatch>

**Out:** <bullets — what the executor must NOT touch, even if adjacent and tempting>

## Completed when

- [ ] <specific condition — e.g. "the `oldX` function is removed; all call sites use `newX`">
- [ ] <operational gate — e.g. "package typecheck clean for `<pkg>`">

## Standing instruction

Stay focused on the goal; control scope. Trivial, obviously-related fixes that serve the
goal go in the same dispatch with a one-line note in the wrap-up. Anything that pulls you
off the goal — even if it looks useful — halts and surfaces.

## References

- Slice spec: <path>
- Slice-plan entry: <path> § Dispatch N
- Team context entries that match this dispatch's shape: <links — only the ones that apply>
- Prior dispatch artifacts in this slice (if any): <links>

## Operational metadata

- **Model tier:** <cheap | mid | orchestrator> — <one-line rationale>
- **Time-box:** <≤ 5 min | ≤ 15 min | ≤ 30 min>
- **Halt conditions:** <conditions under which the executor stops and surfaces>
```

A spike brief swaps "Completed when" for:

```markdown
## Artifact + Completed when

**Artifact path:** <typically `projects/<x>/spikes/<date>-<q>.md`>

**Artifact shape:** <table | list | per-section structure — be specific>

**Completed when:**
- [ ] Artifact exists at the named path with the named shape.
- [ ] Artifact answers the question (not "I started investigating").
- [ ] The next dispatch's brief can be assembled using the artifact.
```

## Things to avoid

1. **"Do what's needed" briefs.** No task, no scope, no completed-when. The executor interprets. The dispatch silently grows. The orchestrator's mid-dispatch check finds work that wasn't in any spec.
2. **No "Completed when".** The executor declares done by feel; the reviewer has nothing concrete to verify against.
3. **No "Out of scope".** Only "In scope" listed. The executor who notices an adjacent fix is tempted to include it; including it is silent scope expansion.
4. **Pre-decomposing every file the executor will touch.** The executor's grep pre-flight finds the call sites at dispatch time. Pre-naming them in the brief pretends the orchestrator knows more than they do, inflates the brief, and creates a false sense of completeness.
5. **Pre-walking every edge case "to be safe".** Same. Pre-name only what the team's catalogue or outside-codebase knowledge already taught — and put those in `Halt conditions`, not a separate catalogue dump.
6. **Wishlist "Completed when" entries.** Items like "code is clean" or "tests are good" — not verifiable; the reviewer can't check; drift slips through. Each item must be a command, a grep gate, or a specific fact.
7. **No model tier.** Defaults to the orchestrator's tier and pays the capability premium on dispatches that don't need it. Make the tier explicit.
8. **A brief that restates the slice spec.** Either the slice is one dispatch's worth of work (no plan needed) or the plan needs decomposing.
9. **The executor silently rewriting the brief.** The orchestrator owns the brief; executor-side amendments require operator authorisation. If the brief in the dispatch transcript doesn't match the brief the orchestrator wrote, something went wrong.
10. **Standing instruction rephrased as "minimize changes".** Minimisation trains timidity — executors refuse obvious, goal-serving fixes. The standing instruction is "stay focused on the goal; control scope" — fix-and-note for the trivial-and-related; halt for drift.
11. **Brief composed by a subagent.** If the orchestrator has the context to write the brief, they write the brief. Dispatching brief-assembly to a subagent inflates the brief (the subagent loads context defensively to "do a thorough job") and inverts the cost model.

## Related principles

- [`sizing.md`](sizing.md) — the dispatch-INVEST checklist this brief embodies. `Task` answers *Valuable* + *Independent*; `Scope` + `Completed when` answer *Estimable* + *Testable*; `References` answer *Small* (does the priming fit?); `Halt conditions` close the loop on *Negotiable* by naming where the executor's discovery must stop.
- [`protocol-as-memory.md`](protocol-as-memory.md) — the team's failure-mode catalogue and grep library, which the brief draws from for `Halt conditions` and `References`.
- [`decomposition-and-cost.md`](decomposition-and-cost.md) — the model-tier choice in `Operational metadata`.
- [`spikes.md`](spikes.md) — how to write a spike brief.
- [`roles-and-personas.md`](roles-and-personas.md) — who composes the brief, who executes, who reviews.
- [`definition-of-ready.md`](definition-of-ready.md) — what the orchestrator checks before dispatching.
- [`definition-of-done.md`](definition-of-done.md) — what the orchestrator checks at handoff.
- [`../design-decisions/2026-05-28-artifact-cascade-redesign.md`](../design-decisions/2026-05-28-artifact-cascade-redesign.md) — the design discussion that produced the six-section template.
