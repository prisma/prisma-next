# Principle: Retros are trigger-based and must produce an update

## A retro that actually happened

Continuing the migration example from [`definition-of-done.md`](definition-of-done.md): intent-validation caught a programmatic-grep-route-around at dispatch DoD. The orchestrator ran a retro the same evening.

```markdown
# Retro: Dispatch DoD missed a programmatic-grep-route-around

**Trigger:** dispatch failure
**Trigger artefact:** <link to dispatch transcript>
**Date:** <YYYY-MM-DD>
**Orchestrator (wearer):** operator

## What happened

The migration dispatch passed all six "Done when" gates (typecheck,
tests, grep for the legacy shape literal, etc.) and the reviewer
subagent accepted. Intent-validation caught two sites where the
implementer routed around the grep gate using a programmatic
constructor (e.g. `Object.fromEntries(...)`) — equivalent to the
legacy shape but escapes a literal-shape grep.

## Why it happened

Proximate cause: the implementer found a way to satisfy the gate
without delivering the intent. Structural cause: the grep gate
was the only spec-shape check in the brief's DoD; intent-validation
was the brief's only defence against routing around the grep, and
the brief's tier was "cheap" — the cheap-tier reviewer subagent
accepted because the grep passed, not because intent matched.

## What should have caught it

The brief's edge-case table should have included "grep gate satisfied
by programmatic equivalent" with the disposition "refuse and surface."
It didn't because we'd never seen this pattern before; it wasn't in
drive/plan/README.md's failure-mode catalogue.

## Output

- [x] **Team-context update:** add to drive/plan/README.md §
       failure-mode catalogue: "Grep gate satisfied by programmatic
       equivalent (e.g. constructing the structure dynamically rather
       than as a literal)." Disposition: brief's edge-case table
       includes "if the gated shape would be programmatically
       constructed, refuse and surface." Grep library: add the
       relevant dynamic-construction pattern for follow-up dispatches.
- [ ] Canonical update: not applicable — this specific shape is
       team-local; routing around grep gates in general is already
       covered by canonical brief-discipline.
- [ ] ADR: not applicable.

## Update landed (post-retro)

<commit-hash> — drive/plan/README.md § failure-mode catalogue +
§ grep library.
```

7 minutes. Output: one team-context entry + one grep library pattern in `drive/plan/README.md`. The next time `drive-plan-slice` or `drive-build-workflow` runs on a slice that touches the affected surface, the README loads at workflow step 1 and the failure mode gets threaded into the brief's edge-case table; the failure mode doesn't recur.

That's what a retro looks like when it works. Trigger → write down what happened, why, what should have caught it → land an update somewhere an agent will read it next time → done.

## What kicks a retro off

Triggers, in order of cost-of-missing:

| Trigger | Required? |
|---|---|
| Dispatch failure | Yes |
| Drift event caught by WIP-inspection (overlay-worthy) | Yes |
| Escapee bug caught downstream | Yes |
| Calibration miss (a failure mode the overlay could have prevented but didn't) | Yes |
| Explicit operator request | Yes |
| Project close | Yes — mandatory per project DoD |
| Slice close where a learning surfaced | Asked, not required |

The required rows are non-skippable; the skill closing the unit refuses to close without retro completion (project DoD enforces this for project close). The non-required row is a question asked at slice close — if "no learning surfaced," skip; if yes, run.

**No calendar retros.** "Every Friday we retro the week" generates noise (most days have nothing to retro) and misses the moment (lessons are freshest immediately after the trigger). Trigger-based retros fire when the lesson is most accessible.

## What "done" looks like

A retro is complete when it produces at least one of three landed outputs:

| Output | Lands where | Effective when |
|---|---|---|
| **Canonical protocol update** — a general lesson that applies across teams | Upstream PR to [`prisma/ignite`](https://github.com/prisma/ignite) | Next `drive-update-skills` run |
| **Team-context update** — a team-specific lesson that's durable | Commit to `drive/<category>/README.md` in your repo | Immediately — next drive-* run |
| **ADR** — an architectural call surfaced by the trigger | `docs/architecture docs/adrs/` | On merge |

If a retro produces none of these, **the retro failed.** The lesson exists only in the head of whoever was in the loop that day; that's not the team's memory.

The orchestrator's job is to name the output explicitly: "this retro produced [canonical / team-context / ADR / none — and here's why], landing at [path]." "None — but here's why" must explain *why the lesson doesn't generalise* (one-off, environmental, non-recurring). The default suspicion is that any lesson worth running a retro for is worth landing somewhere; "none — but here's why" is the exception.

Transient retros — drafts during a project's lifetime — may land first in `projects/<x>/retros/<date>.md` while the operator decides whether they're team-context-worthy or canonical-worthy. The transient surface is not memory (per [`protocol-as-memory.md`](protocol-as-memory.md)'s tier table); the retro is not done until the final home is committed.

## Which output to pick

Use the test from [`protocol-as-memory.md`](protocol-as-memory.md): would another team using these same skills want this rule?

| The lesson is about... | Output |
|---|---|
| A ritual's *shape* (what DoR is, what a brief contains, what a retro produces, how WIP-inspection works) | Canonical |
| A *content* entry in an existing ritual (new failure mode, new grep pattern, new DoR/DoD overlay item, new reference task) | Team-context — the matching `drive/<category>/README.md` |
| An invariant every team should honour | Canonical |
| The same pattern showing up in multiple teams' `drive/<category>/README.md` files (visible via `drive-reconcile-skills`'s upstream-worthy classifications) | Canonical (graduate the pattern) |
| An architectural choice with consequences past this project | ADR |

When in doubt, start with team-context. Promoting later (when you notice multiple teams writing the same thing) is cheap; demoting a half-baked canonical change is not.

## Retro template

Run by the orchestrator (operator or orchestrator agent). Short — a retro that runs longer than 15 minutes for one trigger usually means the trigger contained multiple lessons; split into multiple retros.

```markdown
# Retro: <one-line-name>

**Trigger:** <dispatch failure | drift event | escapee | slice close
              | project close | calibration miss | explicit request>
**Trigger artefact:** <link to dispatch transcript / PR / commit /
                       failing test / customer report / operator request>
**Date:** <YYYY-MM-DD>
**Orchestrator (wearer):** <operator | orchestrator agent>

## What happened

<2-4 sentences: the trigger as observed. Concrete, not interpretive.>

## Why it happened

<2-4 sentences: the proximate cause, then the structural cause.
 The structural cause is the one that informs the update — if the
 proximate cause was "the implementer drifted," the structural
 cause is "the brief didn't pre-name the edge case the implementer
 silently accommodated.">

## What should have caught it

<1-3 sentences: which gate / ritual / artefact should have prevented
 this, and what was missing from it.

 - "Brief discipline should have pre-named the edge case; it didn't
    because we hadn't hit this shape before."
 - "Dispatch DoD should have caught the intent-mismatch; it didn't
    because intent-validation wasn't run."
 - "Slice DoR should have surfaced the missing calibration entry;
    it didn't because the entry didn't exist yet."

 Be specific about *which* gate failed and *why*. Vague answers
 produce vague updates.>

## Output

(Pick at least one. Multiple is fine. If "None — but here's why,"
 write the rationale below; default suspicion is that's wrong.)

- [ ] **Canonical update:** <which canonical skill body / rule;
       what changes — upstream PR to prisma/ignite>
- [ ] **Team-context update:** <which drive/<category>/README.md;
       what new entry — commit in your repo>
- [ ] **ADR:** <ADR-### title; one-paragraph framing>
- [ ] **None — but here's why:** <rationale must explain why this
       lesson doesn't generalise; default suspicion is it does>

## Update landed (post-retro)

<Link the commit / PR / file where the update is now persisted. The
 retro is not complete until the update is in a surface the agent
 reads on a subsequent dispatch.>
```

## Anti-patterns

1. **Retro without an update.** The most common failure. Operator notices a thing went wrong, says "we should add a check for that," doesn't add the check, moves on. The lesson exists in the operator's head; the team doesn't have it. The retro is not complete until the update has landed; the orchestrator runs the retro AND is responsible for the landing.
2. **Calendar-based retro.** "Every Friday we retro the week." Generates noise; misses the moment (lessons two days old are less vivid, less accurate). Trigger-based retros run when the trigger fires.
3. **Retro by committee.** A retro that requires multiple participants and a scheduled meeting is human-team shape; agent teams don't have that overhead, but they also don't have the conversational refinement human-team retros benefit from. The orchestrator runs the retro alone (with operator participation if a design-discussion-flavoured call is involved); speed is the protection against the lesson going stale.
4. **Retro that names the proximate cause and stops.** "The implementer drifted." OK — but *why* did the dispatch loop allow the drift? The structural cause is what generates the update. Stopping at proximate cause produces no canonical or team-context delta; the gap recurs.
5. **Vague update.** "We should be more careful about briefs." Doesn't update any surface; agents on the next dispatch won't know what changed. Updates must be concrete: "add 'grep gate routed around with programmatic equivalent' to `drive/plan/README.md` § failure-mode catalogue, with two example dispositions."
6. **Update lands in a weak-memory surface.** Per [`protocol-as-memory.md`](protocol-as-memory.md), the strong surfaces are always-loaded (`.cursor/rules/`, `AGENTS.md`) and `drive/<category>/README.md` (loaded by their matching skill at workflow step 1). Operator scratch (untracked working notes) is no-memory; `projects/<x>/` is transient. An update that lands only in operator scratch or in transient project notes is the same as no update — the lesson won't survive project close-out.
7. **Project DoD skipped because "the team knows the retro outcome."** The retro is the team's only memory. A project that ships without its retro has lost its lessons regardless of what's in the operator's head.
8. **Retro held but the "Update landed" line never gets filled in.** The template's post-retro link is the proof-of-landing. Without it, the protocol has a retro that intended to update but didn't.

## When you need a new `drive/<category>/` directory

If a retro produces a team-context update that doesn't fit any existing category, the answer is usually one of:

1. **The lesson actually belongs to an existing category** — re-read [`protocol-as-memory.md`](protocol-as-memory.md) § "Where memory lives in a repo" and pick the closest fit.
2. **The lesson is canonical, not team-context** (a new ritual is needed, not a new team-specific entry).
3. **A new category is genuinely warranted** — but adding one is a canonical change (the corresponding drive-* skill needs to know to read it). Land that as its own retro output: canonical update, "add `drive-<new-skill>` and its `drive/<new-category>/README.md` to the conventions table."

Don't create category READMEs unilaterally for skills that don't exist yet — they won't be read by anything.

## How this fits the larger picture

- The orchestrator (per [`roles-and-personas.md`](roles-and-personas.md)) runs the retro — process facilitation is part of the hat.
- Triggers are pre-declared. The dispatch failure that just fired a retro fired one because the protocol said it would, not because someone decided to.
- Retro time-box is ≤ 15 min per trigger; longer means the trigger contained multiple lessons. Split into multiple retros.
- The landed update is the deliverable. "Update landed" is the retro's own DoD.
- Project close-out is the gate that catches missed retros. A project that hits its mandatory close retro and discovers no canonical / team-context updates over its lifetime is suspicious — projects that don't surface learnings either had no failures (rare) or had failures whose retros didn't run.
- Unattended-mode retros are drafted by the orchestrator agent (filling in "What happened / Why / What should have caught"); the operator runs the "Output" + "Update landed" steps on return.
- When in-repo skill copies have been edited as quick fixes, run `drive-reconcile-skills` (from [PR #93](https://github.com/prisma/ignite/pull/93)) before any project-close retro — accumulated drift settles into the right home rather than rotting in stale local copies.

## Related principles

- **[`protocol-as-memory.md`](protocol-as-memory.md)** — why retros are mandatory at all; defines the surfaces the retro updates and the heuristic for which surface to pick.
- **[`roles-and-personas.md`](roles-and-personas.md)** — the orchestrator hat owns retro running.
- **[`definition-of-ready.md`](definition-of-ready.md)** — DoR overlays in `drive/<category>/README.md` grow by retro accretion.
- **[`definition-of-done.md`](definition-of-done.md)** — DoD overlays grow by retro accretion; project DoD makes the close retro mandatory.
- **[`brief-discipline.md`](brief-discipline.md)** — many retro outputs land in `drive/plan/README.md`'s failure-mode catalogue and grep library, then thread into subsequent briefs' edge-case tables.
- **[`decomposition-and-cost.md`](decomposition-and-cost.md)** — `drive/plan/README.md`'s model-tier routing table grows by retro accretion (which dispatch shapes turned out to be safe at which tier).
- **`drive-reconcile-skills`** ([PR #93](https://github.com/prisma/ignite/pull/93)) — pairs with retro discipline: routes in-repo skill drift to the right home.
