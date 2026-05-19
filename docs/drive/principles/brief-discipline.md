# Principle: The brief is the dispatch's running spec

## A bad brief and the same brief done well

A brief that drifts:

> Migrate a legacy data shape (the kind that lives across multiple consumers) to its replacement.

That's it. No outcome statement beyond the topic. No scope split. No edge cases. No DoD. No size. No tier. No inputs.

A dispatch run from this brief will pick whichever consumers the implementer happens to notice, resolve every edge case privately (legacy fixtures? silently regenerate; intentionally-flat-shape consumers like rejection tests? silently migrate them too, breaking the tests), declare done when the implementer feels finished, and pass validation gates because the gates don't catch unscoped work.

The same brief, well-shaped:

```markdown
# Brief: Migrate legacy-shape consumers (round 2 of 3)

## Outcome

Migrate the 8 in-source test sites listed in the spike artefact to the
new shape. One commit per file. No other consumers touched.

## Scope

In scope:
- The 8 test sites named in the spike artefact
- Test fixture regeneration ONLY if a fixture is listed as touched

Out of scope:
- Authoring-layer consumers (round 1 of next slice)
- Introspector tightening (round 3)
- Any fixture or consumer NOT in the spike artefact

## Edge cases

| Edge case | Do what |
|---|---|
| Site has a legacy-shape literal intentionally (rejection test) | Skip; flag in dispatch summary |
| Fixture file has drifted since the spike | Defer to a follow-up dispatch; do not regenerate inline |
| Site mixes legacy + new shape (partial migration from earlier) | Refuse and surface — slice-spec ambiguity, escalate to design discussion |

## Done when

- [ ] `<typecheck command>` clean
- [ ] `<test command>` passing
- [ ] `<grep-for-legacy-shape command>` returns empty for migrated sites
- [ ] No new TODOs
- [ ] Per-site commit messages reference the spike artefact

## Size + time-box

M; ≤ 30 min wall-clock.

## Model tier

Cheap (Sonnet/composer). Mechanical migration with strong DoD;
the capability premium isn't paying for anything here.

## Inputs

- Slice spec: projects/<project>/slices/round-2/spec.md
- Spike artefact: projects/<project>/spikes/<date>-test-sites.md
- Calibration: drive/plan/README.md § "<the relevant failure-mode entry>"
  + grep patterns from drive/plan/README.md's grep library

## Implementer + Reviewer

- Implementer: implementer subagent (cheap-tier composer)
- Reviewer: reviewer subagent (orchestrator tier, for verification rigour)
```

The well-shaped brief is verbose but unsurprising. The dispatch produced from it has nothing to interpret — every edge case is pre-named, every gate is explicit, scope-out is enumerated, the tier matches the shape. WIP-inspection has something sharp to check ("what did the implementer touch that wasn't in scope?"); the reviewer subagent has a sharp checklist; the operator returns to a dispatch whose outcome is predictable.

## What every brief needs

Eight sections. None may be omitted; your team's `drive/plan/README.md` may add more.

| Section | What it says | Why it matters |
|---|---|---|
| **Outcome** | One paragraph: what this dispatch produces. | The implementer's compass. Without it, "correct" and "useful" come apart. |
| **Scope (in / out)** | What's in this dispatch + what's explicitly out (named follow-up or scope-deferred). | Pre-empts "while I was in there I also fixed X" — the dispatch-scope sibling of project scope creep. |
| **Edge cases + dispositions** | Edge cases the implementer will hit, each with a pre-decided disposition (do X / refuse and surface / defer). | The fix for silent accommodation. The implementer cannot interpret an edge case the brief already covers. |
| **Done when** | Specific commands + per-dispatch acceptance criteria. | The contract the implementer fulfils and the reviewer verifies. |
| **Size + time-box** | T-shirt (XS / S / M — never L or XL); wall-clock per size. Overrun means re-scope, not extension. | Refuses oversized work; alarms on runaway dispatches. |
| **Model tier** | Cheap / mid / orchestrator. | Forces an explicit tier decision; defaulting to the parent agent's tier (the Cursor SDK's `Task` default) is treated as a bug. |
| **Inputs** | Links to slice spec, project spec, spike artefacts, calibration entries, prior dispatch artefacts in this slice. | What the agent reads — links pull the dependencies into the dispatch's context. |
| **Implementer + Reviewer** | Named (operator / subagent / specific persona). | Removes ambiguity about who's accountable for what. |

A spike-flavoured brief swaps the "Done when" section for an artefact spec — see [`spikes.md`](spikes.md).

## Where edge cases come from

Two sources at brief-assembly time:

1. **From the slice plan.** The implementer who authored the slice plan walked through this dispatch's work and asked "what's the implementer likely to encounter that's not the happy path?" — those are the candidate edge cases.
2. **From your team's `drive/plan/README.md`.** The failure-mode catalogue and grep library entries that match this dispatch's shape get pulled into the edge-case table at brief-assembly time. Every failure the team has hit before that matches this shape goes in, with a disposition.

The *first* time an edge case happens, the brief was the wrong place to catch it — you didn't know to name it. That's a retro trigger. The lesson goes into `drive/plan/README.md`; the next brief that matches the shape pulls the entry and pre-names the edge case. Over time the catalogue grows; new dispatches inherit the team's accumulated lessons automatically.

## The brief is fresh per dispatch; the slice spec is stable

| Artefact | Scope | Lifespan | Authored by |
|---|---|---|---|
| **Slice spec** | One PR | Stable for the slice | Implementer (once) |
| **Slice plan** | One PR | Stable; the dispatch sequence | Implementer (once) |
| **Brief** | One dispatch | Re-assembled per dispatch | Agile orchestrator (at delegation time) |

The brief draws from the slice spec and slice plan but adds what the dispatch needs *right now*: which sub-scope of the slice, which edge cases apply here vs the next dispatch, which gates are checkpoint-vs-final, which tier is right for this work.

If a brief looks identical to the slice spec, the slice plan probably has one big dispatch (= the slice). That's a sign the plan needs decomposing.

## Brief template

```markdown
# Brief: <one-line-name>

## Outcome

<One paragraph: what this dispatch produces. For a spike: what
the artefact answers, where it lives, what shape it has.>

## Scope

**In scope:**
- <bullets>

**Out of scope:**
- <bullets — name the follow-up dispatch / slice / "scope-deferred"
  each item lives in>

## Edge cases

| Edge case | Do what |
|---|---|
| <named edge case 1> | <do X / refuse and surface / defer to follow-up> |
| <named edge case 2> | <…> |

## Done when

- [ ] <command 1> (e.g. `pnpm typecheck` clean)
- [ ] <command 2> (e.g. `pnpm test path/to/relevant` passing)
- [ ] <grep gate>: `rg <pattern> -- '!:foo'` returns empty
- [ ] <intent-level criterion>: <e.g. "no remaining call sites of
       legacy symbol X"; "fixtures regenerated without drift";
       "no TODOs left behind by this dispatch">

## Size + time-box

- T-shirt: <XS | S | M>
- Wall-clock: <≤ 5 min | ≤ 15 min | ≤ 30 min>

## Model tier

<cheap | mid | orchestrator> — <one-line rationale referencing
decomposition-and-cost.md>

## Inputs

- Slice spec: <path>
- Slice plan: <path>
- Project spec (if any): <path>
- Spike artefacts (if any): <path>
- Calibration entries: <links to failure-mode entries / grep library
  patterns that apply>
- Prior dispatch artefacts in this slice: <links>

## Implementer + Reviewer

- Implementer: <subagent | operator | named persona>
- Reviewer: <subagent | operator | named persona>
```

For a spike, swap "Done when" for:

```markdown
## Artefact + Done when

**Artefact path:** <typically `projects/<x>/spikes/<date>-<q>.md`>

**Artefact shape:** <table | list | per-section structure — be specific>

**Done when:**
- [ ] Artefact exists at the named path with the named shape
- [ ] Artefact answers the question (not "I started investigating")
- [ ] Downstream dispatch's brief can be assembled using the artefact
```

## Anti-patterns

1. **"Do what's needed" briefs.** No outcome, no scope, no edge cases. The implementer interprets. The dispatch silently expands. WIP-inspection finds work that wasn't in any spec.
2. **Brief without an explicit "Done when."** Implementer declares done by feel. Reviewer has nothing to verify against. Drift passes the gates.
3. **Brief without explicit "out of scope."** Only "in scope" listed. The implementer who notices an adjacent fix is tempted to include it. Including it is silent scope expansion.
4. **Brief without edge cases.** Implementer hits the first edge case, makes a private call, drifts. The edge case was knowable at brief-assembly time; not naming it is the structural failure.
5. **Wishlist "Done when."** Items like "code is clean" or "tests are good" — not checkable; reviewer can't verify; drift slips through. Items must be commands, grep gates, or specific facts.
6. **Brief without a model tier.** Defaults to the orchestrator's tier (Cursor SDK's `Task` default). Pays the capability premium on dispatches that don't need it. Make the tier explicit.
7. **Brief that's a re-statement of the slice spec.** The slice is one dispatch's worth of work. Either the slice is too small (no plan needed) or the plan needs decomposing.
8. **Implementer silently rewrites the brief.** The agile orchestrator owns the brief; implementer-side amendments are forbidden by invariant I12 (every spec/plan amendment requires design discussion or operator authorisation). Symptom: the brief in the dispatch transcript doesn't match the brief the orchestrator wrote.

## Related principles

- **[`protocol-as-memory.md`](protocol-as-memory.md)** — `drive/plan/README.md`'s failure-mode catalogue + grep library are what the brief draws from when assembling the edge-case table.
- **[`decomposition-and-cost.md`](decomposition-and-cost.md)** — the brief's model-tier section is the per-dispatch routing decision.
- **[`spikes.md`](spikes.md)** — a spike's brief swaps "Done when" for an artefact spec.
- **[`roles-and-personas.md`](roles-and-personas.md)** — the agile orchestrator assembles the brief; implementer + reviewer assignments live in the brief.
- **[`definition-of-ready.md`](definition-of-ready.md)** — dispatch DoR is "is the brief assembled per brief discipline?"
- **[`definition-of-done.md`](definition-of-done.md)** — dispatch DoD is the brief's "Done when" operationalised at handoff, plus intent-validation and (where the slice touches user-observable surface) manual QA.
