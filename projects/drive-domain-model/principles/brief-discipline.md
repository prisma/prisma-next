# Principle: The Brief Is The Dispatch's Running Specification

## At a glance

**Every dispatch carries a brief with eight required sections** — Outcome, Scope (in / out), Edge cases + dispositions, Validation gates / DoD, Size + time-box, Model tier, Inputs, Implementer + Reviewer. No section may be omitted; calibration may overlay additional ones. Per-section detail (what each section captures, why it's load-bearing) is below in § What a brief contains.

The brief is the dispatch's running specification + the contract Definition of Done verifies. **Pre-naming edge cases with dispositions is the structural fix** for the silent-accommodation failure mode — the implementer cannot interpret an edge case the brief already covers. Pre-naming is the dispatch-scope analogue of Specification by Example / Example Mapping.

Briefs are assembled by the agile orchestrator at delegation time (fresh per dispatch, drawing from the slice spec + slice plan + spike artefacts + the team's `drive/plan/README.md`); they're transient — the slice plan, spike artefacts, and calibration are the durable inputs. Implementer-side amendments to the brief are forbidden by invariant I12.

## What a brief contains

Every brief carries the following sections. Sections may be terse or long depending on dispatch shape; none may be omitted.

| Section | What it captures | Why it's load-bearing |
|---|---|---|
| **Outcome** | The one-paragraph statement of what the dispatch produces (or, for spike-flavoured briefs, what the artefact answers). | The implementer's compass. Without it, the implementer can be "correct" without being useful. |
| **Scope (in / out)** | What's in this dispatch + what's explicitly excluded (lives in another dispatch, the next slice, or scope-deferred). | Pre-empts the silent expansion failure mode — "while I was in there I also fixed X" — which is the dispatch-scope sibling of project-scope creep. |
| **Edge cases + dispositions** | Pre-named edge cases the implementer will encounter, each with a pre-decided disposition (do X / refuse and surface / defer to follow-up). Example Mapping output. | The structural fix for silent accommodation. The implementer cannot interpret an edge case freely if the brief already says how to handle it. |
| **Validation gates / DoD** | The specific commands / checks the implementer must run to declare done (typecheck, test invocations, fixture validations, greps, etc.) plus the per-dispatch acceptance criteria. | The contract the implementer fulfils. Reviewer subagent verifies the same gates. |
| **Size + time-box** | T-shirt size (XS / S / M, never L/XL); wall-clock time-box per size; overrun triggers re-scope, not extension. | Refusal mechanism for unsized work + an alarm for runaway dispatches. |
| **Model tier** | Cheaper / mid / orchestrator tier. Per the dispatch-routing rules in [`decomposition-and-cost.md`](decomposition-and-cost.md). | Forces an explicit tier decision; defaults-to-parent is treated as a bug. |
| **Inputs** | Links to slice spec, project spec (if any), spike artefacts the brief depends on, relevant calibration entries, prior dispatch artefacts in the slice. | The brief is what the agent reads — links pull the artefacts the brief depends on into the dispatch's context. |
| **Implementer + Reviewer** | Named (operator / subagent / specific persona / etc.). | Removes ambiguity about who's accountable for what. |

Some shapes carry additional sections. A spike-flavoured brief replaces "Validation gates / DoD" with "Artefact spec + acceptance for actionable." A brief authoring a long-running migration carries an explicit "Checkpoint cadence" beyond the WIP-inspection default. Calibration may add team-specific sections (e.g. "Customer impact" for production-touching dispatches).

## Why Example Mapping in every brief

Example Mapping (from Specification by Example) is a lightweight pattern: for each story, name the rules + the examples that illustrate them + the questions that surface during the conversation. Drive adopts the rule + example halves; the questions become design-discussion triggers rather than brief content (they're for the operator + agile orchestrator to resolve before the dispatch starts).

The structural value of Example Mapping in a brief: **every edge case the implementer would otherwise resolve silently is now in the brief with its disposition.** Examples:

- "If the migration encounters a column with no current consumers, drop it." (Implementer wouldn't have known the disposition; now they do.)
- "If the regex matches more than 50 sites, stop and surface — that's too many for one dispatch." (Implementer would have silently migrated all of them; now they stop.)
- "If the test fixture format has changed since the brief was written, defer to a follow-up dispatch." (Implementer would have updated the fixture inline; now they don't.)

The implementer's silent accommodation failure mode is the proximate cause; the missing pre-naming is the structural cause. Brief discipline fixes the structure.

## The brief is per-dispatch; the slice spec is per-slice

A common confusion is treating the brief as a re-statement of the slice spec. They're different artefacts at different scopes:

| Artefact | Scope | Stability | Owner |
|---|---|---|---|
| **Slice spec** | One PR | Stable for the duration of the slice | Implementer (authored once) |
| **Slice plan** | One PR | Stable; the dispatch sequence inside the slice | Implementer (authored once) |
| **Brief** | One dispatch | Re-assembled per dispatch from slice spec + slice plan + spike artefacts + calibration | Agile orchestrator (assembled at delegation time) |

The brief draws from the slice spec and the slice plan but adds what the dispatch needs at this moment: which sub-scope of the slice, which edge cases apply here (vs the next dispatch), which validation gates are pickup-vs-final, which model tier is right for this work. The slice spec does not change as dispatches proceed; the brief is fresh per dispatch.

When a brief looks identical to the slice spec, the slice plan is probably one big dispatch (= the slice). That's a sign the slice plan needs decomposition.

## Brief template

Below is the starter template. Calibration overlays team-specific sections; the protocol carries the shape.

```markdown
# Brief: <one-line-name>

## Outcome

<One paragraph: what this dispatch produces. For a spike: what the
 artefact answers, where it lives, what shape it has.>

## Scope

**In scope:**
- <bullets>

**Out of scope:**
- <bullets — name follow-up dispatches / slices / scope-deferred>

## Edge cases (Example Mapping)

| Edge case | Disposition |
|---|---|
| <named edge case 1> | <do X / refuse and surface / defer to follow-up> |
| <named edge case 2> | <…> |

(Add a row per edge case the implementer might silently accommodate.)

## Validation gates / DoD

- [ ] <command 1> (e.g. `pnpm typecheck` clean)
- [ ] <command 2> (e.g. `pnpm test path/to/relevant` passing)
- [ ] <grep gate>: `rg <pattern> -- '!:foo'` returns empty
- [ ] <intent-level criterion>: <e.g. "no remaining call sites of legacy
       symbol X"; "fixtures regenerated without drift"; "no TODO left
       behind by this dispatch">

## Size + time-box

- T-shirt: <XS | S | M>
- Wall-clock: <≤ 5 min | ≤ 15 min | ≤ 30 min>

## Model tier

<cheaper | mid | orchestrator> — <one-line rationale referencing
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

For a spike-flavoured brief, replace the "Validation gates / DoD" section with:

```markdown
## Artefact spec + DoD

**Artefact path:** <where it lives — typically `projects/<x>/spikes/<date>-<q>.md`>

**Artefact shape:** <table | list | per-section structure — be specific>

**Done when:**
- [ ] Artefact exists at the named path with the named shape
- [ ] Artefact answers the question (not "I started investigating")
- [ ] Downstream dispatch's brief can be assembled using the artefact
```

## Anti-patterns this principle calls out

1. **"Do what's needed" briefs.** No outcome, no scope, no edge cases. The implementer is asked to interpret. The dispatch silently expands. Symptom: the orchestrator's WIP-inspection finds work that wasn't in any spec.

2. **Brief without explicit DoD.** Implementer declares done by feel. Reviewer subagent has nothing to verify against. Drift passes the gates.

3. **Brief without explicit scope-out.** Only "in scope" listed. The implementer who notices an adjacent fix is tempted to include it. Including the adjacent fix is the silent-expansion failure mode at dispatch scope.

4. **Brief without edge cases.** Implementer encounters the first edge case, makes a private decision, drifts. The edge case was knowable at brief-assembly time; not pre-naming it is the structural failure.

5. **Brief with a wishlist DoD.** Acceptance criteria like "code is clean" or "tests are good." Not checkable; the reviewer subagent can't verify; drift slips through. DoD items must be commands or grep gates or specific facts.

6. **Brief without a model tier.** Defaults to the orchestrator's tier (per Cursor SDK's `Task` default). Pays the capability premium on dispatches that don't need it. Per [`decomposition-and-cost.md`](decomposition-and-cost.md), the tier is a per-dispatch decision; making it explicit forces the decision.

7. **Brief that's a re-statement of the slice spec.** Means the slice is one dispatch's worth of work, which means the slice plan didn't decompose. Either the slice is too small (no plan needed) or the plan is wrong.

8. **Brief that the implementer rewrites silently.** The agile orchestrator who assembled the brief is the responsible authoring actor; implementer-side amendments to the brief are forbidden by I12 (every spec/plan amendment requires design discussion or operator authorisation). Symptom: the brief in the dispatch transcript doesn't match the brief the orchestrator wrote.

## Worked example: a bad brief vs the same brief, well-shaped

**Bad brief (the kind that drifts):**

> Migrate the legacy `StorageTable` shape to the new flat shape across consumers.

That's it. No outcome statement beyond the topic. No scope split. No edge cases. No DoD. No size. No tier. No inputs.

A dispatch run from this brief will: pick whichever consumers the implementer notices; resolve every edge case privately (legacy fixtures? — silently regenerate; intentionally-flat-shape consumers like tests of rejection? — silently migrate them too, breaking the tests); declare done when the implementer feels finished; pass validation gates because the gates don't catch unscoped work.

**Same brief, well-shaped:**

```markdown
# Brief: Migrate `StorageTable` consumers to flat shape (round 2 of 3)

## Outcome

Migrate the 8 in-source test sites listed under "Inputs > spike artefact"
to the new flat shape. Each site's old shape is replaced with the new
shape in one commit per file. No other consumers touched in this dispatch.

## Scope

**In scope:**
- The 8 test sites named in the spike artefact
- Test fixture regeneration ONLY if a fixture file is listed as touched in
  the spike artefact

**Out of scope:**
- The PSL-interpreter consumers (round 1 of the next slice)
- The Postgres-introspector tightening (round 3 of next slice)
- Any fixture file NOT in the spike artefact's "touched" list
- Any consumer NOT in the spike artefact (defer to a follow-up spike)

## Edge cases (Example Mapping)

| Edge case | Disposition |
|---|---|
| A test site has 'columns' literal that's intentionally legacy-shape (testing rejection) | Skip the site; flag in the dispatch summary |
| A fixture file has drifted since the spike was authored | Defer to a follow-up dispatch; do not regenerate inline |
| A site mixes legacy + flat shape (partial migration in-progress from earlier) | Refuse and surface — that's a slice-spec ambiguity, escalate to design discussion |
| A grep gate from calibration catches an anti-pattern | Refuse and surface — the calibration carries the lesson |

## Validation gates / DoD

- [ ] `pnpm typecheck` clean
- [ ] `pnpm test:packages` passing
- [ ] `rg "tables: \{" -- 'packages/*/src/test/**'` returns empty for the
       migrated sites
- [ ] No new TODOs left behind
- [ ] Per-site commit messages reference the source spike artefact

## Size + time-box

- T-shirt: M
- Wall-clock: ≤ 30 min

## Model tier

cheaper (Sonnet / composer). Mechanical migration with strong DoD;
capability premium unnecessary per decomposition-and-cost.md.

## Inputs

- Slice spec: `projects/storage-shape-flatten/slices/round-2/spec.md`
- Slice plan: `projects/storage-shape-flatten/slices/round-2/plan.md`
- Spike artefact: `projects/storage-shape-flatten/spikes/2026-05-17-test-sites.md`
- Calibration: `calibration/prisma-next.md` § "Dual-shape support relocated"
  and grep library entries `'columns' in` + `looksLike`

## Implementer + Reviewer

- Implementer: implementer subagent (cheap-tier composer)
- Reviewer: reviewer subagent (orchestrator tier, for verification rigour)
```

The well-shaped brief is verbose but unsurprising. The dispatch produced from it has nothing to interpret — every edge case is pre-named, every gate is explicit, scope-out is enumerated, the tier matches the shape. The WIP-inspection cadence has a sharp template ("what did the implementer touch that wasn't in scope?"); the reviewer subagent has a sharp checklist; the operator returns to a dispatch whose outcome is predictable.

## Practical implications

1. **Brief assembly is part of the agile orchestrator's job.** The persona's responsibility includes pulling the inputs together, threading the team-context entries that apply (from `drive/plan/README.md` per [PR #93](https://github.com/prisma/ignite/pull/93)'s project-context convention — the canonical home for the failure-mode catalogue + grep library + reference tasks + model-tier routing), naming the edge cases, picking the tier. This work happens at delegation time, not at planning time — the brief is fresh per dispatch.
2. **Slice plans carry brief skeletons.** Each dispatch in the slice plan carries enough metadata that brief assembly can pick it up without re-deriving from the slice spec. Slice planning is where the size + tier + edge-case-set is declared; brief assembly is where it's instantiated.
3. **Briefs are transient.** They live in dispatch transcripts; they don't persist as separate artefacts. The slice plan + spike artefacts + calibration are the durable inputs.
4. **`drive/plan/README.md`'s failure-mode catalogue feeds brief assembly.** Each catalogue entry that applies to the current dispatch's shape gets named in the "Inputs" section + threaded into the edge-case table. This is how the team's accumulated memory gets into the brief — `drive-orchestrate-plan` reads `drive/plan/README.md` as workflow step 1 (per PR #93's project-context convention), and the brief assembly threads the relevant entries.
5. **WIP-inspection's diff-reading uses the brief as the comparison.** "Is what just got committed in the brief's scope?" "Does it touch files the brief named?" "Did the implementer hit an edge case we pre-named?" Without a brief with explicit scope + edge cases, WIP-inspection has nothing sharp to ask.

## Failure mode this principle directly prevents

The silent-accommodation failure mode: implementer encounters an edge case, makes a private decision, the dispatch drifts in a way that passes validation gates while violating the spec. Brief discipline pre-names the edge cases with dispositions so the implementer has no edge case to silently accommodate — every plausible call is already declared.

Worth naming: the *first* time an edge case happens, the brief was the wrong place to catch it (we didn't know to name it). That's a retro trigger — the lesson goes into the team's `drive/plan/README.md` failure-mode catalogue, and subsequent briefs that match the dispatch shape pull the entry and pre-name the edge case. The brief discipline + the project-context accretion compound.

## Related principles

- **[`protocol-as-memory.md`](protocol-as-memory.md)** — the brief is the per-dispatch slice of the team's memory; calibration entries it draws from are the strong-memory surface.
- **[`decomposition-and-cost.md`](decomposition-and-cost.md)** — brief's model-tier section is the per-dispatch routing decision.
- **[`spikes.md`](spikes.md)** — spike-flavoured brief is a variant with an artefact-spec section in place of validation gates.
- **[`roles-and-personas.md`](roles-and-personas.md)** — brief is assembled by the agile orchestrator persona; implementer + reviewer assignments live in the brief.
- [`definition-of-ready.md`](definition-of-ready.md) — DoR gates whether the brief is ready to start (every brief section present, inputs loadable, gates runnable).
- [`definition-of-done.md`](definition-of-done.md) — DoD is the brief's validation-gates section operationalised at handoff, plus intent-validation and (for slices touching user-observable surface) manual QA.
