# Principle: The brief is the dispatch's running spec — and it stays lean

A dispatch brief tells an executor what to do, the scope they're working in, the conditions under which they're done, and the minimum operational metadata they need to act. Nothing else.

The brief is **not** a re-statement of the slice spec, **not** a comprehensive work plan, and **not** a pre-decomposed file list. The slice spec is stable across the slice's dispatches; the executor (the same subagent across the slice) retains its prior dispatch transcripts via selective context compaction. The brief restates only what's dispatch-specific.

## A bad brief and the same brief done well

A brief that drifts:

> Migrate a legacy data shape (the kind that lives across multiple consumers) to its replacement.

That's it. No outcome statement beyond the topic. No scope split. No completed-when. No tier. No inputs.

A dispatch run from this brief will pick whichever consumers the implementer happens to notice, resolve every edge case privately (legacy fixtures? silently regenerate; intentionally-flat-shape consumers like rejection tests? silently migrate them too, breaking the tests), declare done when the implementer feels finished, and pass validation gates because the gates don't catch unscoped work.

The same brief, leaner-but-precise:

```markdown
# Brief: Migrate legacy-shape consumers (dispatch 2 of 3)

## Task

Migrate the 8 in-source test sites listed in the spike artefact to the new shape.
One commit per file. No other consumers touched.

## Scope

**In:** The 8 test sites named in the spike artefact (linked below).

**Out:** Authoring-layer consumers (next dispatch); introspector tightening (dispatch 3);
any fixture or consumer NOT in the spike artefact.

## Completed when

- [ ] All 8 sites updated to the new shape; per-site commit messages reference the spike artefact.
- [ ] Grep gate: `<grep-for-legacy-shape command>` returns empty for migrated sites.
- [ ] Package typecheck clean for the affected packages.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve
the goal go in the same dispatch with a one-line note in your wrap-up. Anything that pulls
you off the goal — even if it looks useful — halts and surfaces.

## References

- Slice spec: `projects/<project>/slices/<slice>/spec.md`
- Slice plan entry: `projects/<project>/slices/<slice>/plan.md` § Dispatch 2
- Spike artefact: `projects/<project>/spikes/<date>-test-sites.md`
- Calibration entry: `drive/plan/README.md` § "Migration test-site rejection cases"

## Operational metadata

- **Model tier:** cheap. Mechanical migration with a strong completed-when.
- **Time-box:** ≤ 30 min.
- **Refusal triggers:** site has a legacy-shape literal intentionally (rejection test) → skip and flag in wrap-up; site mixes legacy + new shape (partial migration) → halt and surface as slice-spec ambiguity.
```

This brief has nothing to interpret — task is named, scope is bounded, completed-when is binary, refusal triggers cover the foreseen edge cases, calibration tells the executor what footguns the team has hit before. WIP-inspection has a sharp check ("touched anything outside the 8 named sites?"); the reviewer has a sharp focus (was the goal achieved, was scope honoured); the operator gets back a predictable dispatch.

## What every brief needs

Six sections. None may be omitted; your team's project context may add more.

| Section | What it says |
|---|---|
| **Task** | One unambiguous paragraph: what this dispatch does. Names the surface and the change. |
| **Scope (in / out)** | What's in this dispatch + what's explicitly out. The `out` list pre-empts "while I was in there I also fixed X." |
| **Completed when** | Binary, dispatch-specific conditions. NOT slice-wide gates; NOT what CI / reviewer / project-DoD already implies. Often just 1–3 items. |
| **Standing instruction** | The "stay focused on the goal; control scope" framing. Carried verbatim in every brief; the executor sees the same words every time. |
| **References** | Links to slice spec, slice plan entry, spike artefacts (if any), calibration entries that match THIS dispatch's shape (not a generic catalogue dump), prior dispatch artefacts in this slice. |
| **Operational metadata** | Model tier (with a one-line rationale), time-box (overrun → halt), refusal triggers (the specific conditions under which the executor halts and surfaces). |

A spike-flavoured brief swaps the "Completed when" section for an artefact spec — see [`spikes.md`](spikes.md).

## Briefs thin out across a slice

The implementer subagent is resumed across dispatches in a slice (see `drive-build-workflow` § Subagent continuity). Selective context compaction preserves the priming context from earlier dispatches even as the transcript accumulates.

| Dispatch | Brief shape |
|---|---|
| **D1** (first in the slice) | Full template. The brief primes the slice's entire chosen design, calibration footguns, slice-DoD context. |
| **D2+** | References section thins (subagent knows where the slice spec lives); calibration entries trim to ones not already pulled in D1; task / scope / completed-when / refusal triggers stay full-precision. |

Switching the executor mid-slice forfeits the priming. The default is the same implementer across all dispatches of a slice; spawn fresh only on a deliberate role-intent pivot (e.g. operator-requested fresh-eyes pass).

## Where edge cases go (and why most don't go in the brief anymore)

Two sources at brief-assembly time:

1. **From outside-codebase knowledge.** Calibration entries from the team's project context that match THIS dispatch's shape — failure modes the team has hit before, grep patterns that anchor common rewrites. Goes in `References` and surfaces as `Refusal triggers` for the ones that warrant halting.
2. **From the slice spec's pre-investigated edge cases** (if any). Almost always empty in the new model — pre-naming what the implementer would discover anyway is brief gigantism. If the slice spec did pre-investigate something (operator's prior bug, known footgun), pull that into `Refusal triggers`.

**Discovery happens at dispatch time, by the implementer.** A grep pre-flight on the named surface finds the call sites; the implementer's standing instruction ("stay focused on the goal; control scope") gives them the disposition rule for what to do with each one (in scope and obvious → handle; in scope and ambiguous → halt; out of scope → don't touch).

The first time an edge case happens that the calibration didn't predict, the brief was the wrong place to catch it — the team didn't know to name it. That's a retro trigger. The lesson goes into the team's project context; the next brief that matches the shape pulls the entry and pre-names the refusal trigger. Over time the catalogue grows; new dispatches inherit the team's accumulated lessons automatically.

## Brief template

```markdown
# Brief: <one-line-name>

## Task

<One paragraph: what this dispatch does. Unambiguous. Names the surface and the change.>

## Scope

**In:** <bullets — the files / changes / behaviours in this dispatch>

**Out:** <bullets — what the implementer must NOT touch, even if adjacent and tempting>

## Completed when

- [ ] <specific condition — e.g. "the `oldX` function is removed; all call sites use `newX`">
- [ ] <operational gate — e.g. "package typecheck clean for `<pkg>`">

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve
the goal go in the same dispatch with a one-line note in your wrap-up message. Anything
that pulls you off the goal — even if it looks useful — halts and surfaces.

## References

- Slice spec: <path>
- Slice plan entry: <path> § Dispatch N
- Calibration entries from project context matching this dispatch's shape: <links — only the ones that apply>
- Prior dispatch artefacts in this slice (if any): <links>

## Operational metadata

- **Model tier:** <cheap | mid | orchestrator> — <one-line rationale>
- **Time-box:** <≤ 5 min | ≤ 15 min | ≤ 30 min>
- **Refusal triggers:** <conditions under which the implementer halts and surfaces>
```

For a spike, swap "Completed when" for:

```markdown
## Artefact + Completed when

**Artefact path:** <typically `projects/<x>/spikes/<date>-<q>.md`>

**Artefact shape:** <table | list | per-section structure — be specific>

**Completed when:**
- [ ] Artefact exists at the named path with the named shape.
- [ ] Artefact answers the question (not "I started investigating").
- [ ] Downstream dispatch's brief can be assembled using the artefact.
```

## Anti-patterns

1. **"Do what's needed" briefs.** No task, no scope, no completed-when. The implementer interprets. The dispatch silently expands. WIP-inspection finds work that wasn't in any spec.
2. **Brief without an explicit "Completed when."** Implementer declares done by feel. Reviewer has nothing to verify against. Drift passes the gates.
3. **Brief without explicit "out of scope."** Only "in scope" listed. The implementer who notices an adjacent fix is tempted to include it. Including it is silent scope expansion.
4. **Brief that pre-decomposes every file the implementer will touch.** Brief gigantism. The implementer's grep pre-flight finds the call sites; pre-naming them pretends the brief-assembler knows more than they do and creates a false sense of completeness.
5. **Brief that pre-walks every edge case "to be safe."** Same. Most edge cases get discovered at dispatch time. Pre-name only what calibration or outside-codebase sources already taught you — and lift those into `Refusal triggers`, not a generic catalogue.
6. **Wishlist "Completed when."** Items like "code is clean" or "tests are good" — not checkable; reviewer can't verify; drift slips through. Items must be commands, grep gates, or specific facts.
7. **Brief without a model tier.** Defaults to the orchestrator's tier (Cursor SDK's `Task` default). Pays the capability premium on dispatches that don't need it. Make the tier explicit.
8. **Brief that's a re-statement of the slice spec.** The slice is one dispatch's worth of work. Either the slice is too small (no plan needed) or the plan needs decomposing.
9. **Implementer silently rewrites the brief.** The agile orchestrator owns the brief; implementer-side amendments are forbidden by invariant I12 (every spec / plan amendment requires design discussion or operator authorisation). Symptom: the brief in the dispatch transcript doesn't match the brief the orchestrator wrote.
10. **Standing instruction rephrased as "minimize changes."** Minimization trains timidity — implementers refuse to fix obvious-and-related issues that would actually serve the goal. The instruction is "stay focused on the goal; control scope" — fix-and-note for trivial-and-related; halt for drift.
11. **Brief composed by a subagent.** If the orchestrator has the context to write the brief, they write the brief. Dispatching brief-assembly to a subagent inflates the brief (the subagent over-loads context to "do a thorough job") and inverts the cost model (you pay subagent tokens to produce a document you'd write yourself in 5 minutes).

## Related principles

- **[`protocol-as-memory.md`](protocol-as-memory.md)** — the team's failure-mode catalogue + grep library are what the brief draws from when picking refusal triggers and calibration references.
- **[`decomposition-and-cost.md`](decomposition-and-cost.md)** — the brief's model-tier section is the per-dispatch routing decision.
- **[`spikes.md`](spikes.md)** — a spike's brief swaps "Completed when" for an artefact spec.
- **[`roles-and-personas.md`](roles-and-personas.md)** — the agile orchestrator assembles the brief; implementer + reviewer assignments live in the brief.
- **[`definition-of-ready.md`](definition-of-ready.md)** — dispatch DoR is "is the brief assembled per this discipline?"
- **[`definition-of-done.md`](definition-of-done.md)** — dispatch DoD is the brief's "Completed when" operationalised at handoff, plus intent-validation.
- **[`docs/drive/design-decisions/2026-05-28-artefact-cascade-redesign.md`](../design-decisions/2026-05-28-artefact-cascade-redesign.md)** — the redesign that introduced lean briefs + executor continuity + the standing-instruction reframe.
