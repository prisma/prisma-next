# Principle: Retros Are Trigger-Based And Must Produce an Update

## Thesis

A **retro** is the team's only learning mechanism. It runs **trigger-based** — when something happened that's worth learning from — not on a calendar cadence. Every retro must produce a **protocol update, calibration update, or ADR**. If it produces none of those, the retro failed; the lesson didn't land in a surface that subsequent dispatches will read.

For human teams, retros are one of several learning mechanisms (continuity of personnel, shared experience, apprenticeship, repeated codebase exposure). For agent teams, retros are *the* mechanism — per [`protocol-as-memory.md`](protocol-as-memory.md), nothing else accumulates between dispatches. A retro that doesn't update the protocol or calibration is a retro the team didn't have.

## Triggers

Retros fire on the following triggers, in order of cost-of-missing:

| Trigger | Cadence | Required? |
|---|---|---|
| **Dispatch failure** | One per failure event | Yes |
| **Drift event caught by WIP-inspection** | One per drift event that surfaced a calibration-worthy lesson | Yes |
| **Escapee bug caught downstream** | One per escapee | Yes |
| **Slice close where a learning surfaced** | At slice close, if checked | No (asked, not required) |
| **Project close** | At project close | Yes (mandatory; per project DoD) |
| **Calibration miss** | Whenever a failure mode hits that calibration could have prevented but didn't | Yes |
| **Explicit operator request** | Whenever the operator says "let's retro this" | Yes |

The mandatory retros (rows marked Yes) are non-skippable; the skill that closes the unit refuses to close without retro completion (per project DoD). The non-mandatory ones are a question asked at the appropriate scope — if the answer is "no learning surfaced," skip; if "yes," run.

What's deliberately absent: calendar-based retros ("every Friday"). Calendar retros generate noise (most days have nothing to learn from) and miss the right moment (the lesson is freshest immediately after the trigger). Trigger-based retros run when the lesson is most accessible and most needed.

## The mandatory output

A retro is complete when it produces at least one of:

- **Canonical protocol update.** A general lesson that applies across projects and teams. Lands as an upstream PR to [`prisma/ignite`](https://github.com/prisma/ignite) — either to a canonical drive-* skill body, to the shared methodology skill set, or as a new always-applied rule. Goes through canonical-side review (the cross-team applicability check). Picks up for every team on next `drive-update-skills` run.
- **Project-context update.** A team-specific lesson that's durable (this team will hit it again). Lands as a commit in the consumer repo's `drive/<category>/README.md` for the matching skill family — the surface the relevant drive-* skill reads as workflow step 1. Per the eight-category table in [`protocol-as-memory.md`](protocol-as-memory.md): failure-mode catalogues and grep library go in `drive/plan/README.md`; QA-flavoured lessons in `drive/qa/README.md`; review-flavoured ones in `drive/code-review/README.md`; etc. Effective immediately for this team.
- **ADR (Architecture Decision Record).** A durable architectural call surfaced by the trigger. Lands in `docs/architecture docs/adrs/`.

If a retro produces none of those, **the retro failed**. The lesson exists only in the head of whoever was in the loop that day; that's not the team's memory.

The agile orchestrator's responsibility includes naming the output explicitly: "this retro produced [canonical update | project-context update | ADR | none — and here's why], landing at [path]." If "none — but here's why," the rationale must say *why the lesson doesn't generalise* (one-off, environmental, non-recurring). The default suspicion is that any lesson worth running a retro for is worth landing somewhere; "none — but here's why" is the exception, not the rule.

### Home selection: which one?

Use the heuristic from [`protocol-as-memory.md`](protocol-as-memory.md):

- The lesson is about a ritual's **shape** (what DoR is, what brief discipline means, what a retro produces, what the WIP-inspection cadence asks) → canonical update.
- The lesson is about a **content** entry inside an existing ritual (a new failure-mode catalogue entry, a new grep pattern, a new DoR / DoD overlay item, a new reference task) → project-context update (the matching `drive/<category>/README.md`).
- The lesson is about an **invariant** every team should honour, or a structural protection none of the canonical skills enforce yet → canonical update.
- The same pattern surfacing across **multiple teams' project-context READMEs** (visible through canonical-side review of upstream-worthy candidates surfaced by `drive-reconcile-skills`) → canonical update (graduate the pattern).

When in doubt, start with project-context. Promoting later (via `drive-reconcile-skills`'s upstream-worthy classification) is cheap; demoting a half-baked canonical change is not.

Transient retros — drafts during a project's lifetime — may land first in `projects/<x>/retros/<date>.md` while the operator decides whether it's project-context-worthy or canonical-worthy. The transient surface is not memory (per [`protocol-as-memory.md`](protocol-as-memory.md)'s tier table); the retro is not done until the final home is committed.

## Retro template

Run by the agile orchestrator (operator or orchestrator agent). Short — a retro that runs longer than 15 minutes for a single trigger usually means the trigger contained multiple lessons; split into multiple retros.

```markdown
# Retro: <one-line-name>

**Trigger:** <dispatch failure | drift event | escapee | slice close |
              project close | calibration miss | explicit request>
**Trigger artefact:** <link to the dispatch transcript / PR / commit /
                       failing test / customer report / operator request>
**Date:** <YYYY-MM-DD>
**Agile orchestrator (wearer):** <operator | orchestrator agent>

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
- [ ] **Project-context update:** <which drive/<category>/README.md;
       what new entry — commit in the consumer repo>
- [ ] **ADR:** <ADR-### title; one-paragraph framing>
- [ ] **None — but here's why:** <rationale must explain why this
       lesson doesn't generalise; default suspicion is it does>

## Update landed (post-retro)

<Link the commit / PR / file where the update is now persisted. The
 retro is not complete until the update is in a surface the agent
 reads on a subsequent dispatch.>
```

## Anti-patterns this principle calls out

1. **Retro without output.** The most common failure. Operator notices a thing went wrong, says "we should add a check for that," doesn't add the check, moves on. The lesson exists in the operator's head; the team doesn't have it. The structural fix: the retro is not complete until the update has landed; the agile orchestrator runs the retro and is responsible for the landing.

2. **Calendar-based retro.** "Every Friday we retro the week." Generates noise (most days have nothing to retro); misses the moment (the lessons most worth capturing are 1-2 days old by Friday, less vivid, less accurate). Trigger-based retros run when the trigger fires.

3. **Retro by committee.** A retro that requires multiple participants and a scheduled meeting is human-team shape; agent teams don't have that overhead, but they also don't have the conversational refinement that human team retros benefit from. The agile orchestrator runs the retro alone (with operator participation if a design-discussion-flavoured call is involved); the speed is the protection against the lesson going stale.

4. **Retro that names the proximate cause and stops.** "The implementer drifted." OK — but *why* did the dispatch loop allow the drift? The structural cause is what generates the update. Stopping at proximate cause produces no protocol or calibration delta; the gap recurs.

5. **Vague update.** "We should be more careful about briefs." Doesn't update any surface; agents on the next dispatch won't know what changed. Updates must be concrete: "add 'grep-gate routed around with programmatic equivalent' to `prisma-next.md` § failure-mode catalogue, with two example dispositions."

6. **Update lands in a weak-memory surface.** Per [`protocol-as-memory.md`](protocol-as-memory.md)'s tier table, the strongest surfaces are always-loaded (`.cursor/rules/`, `AGENTS.md`) and the `drive/<category>/README.md` files (loaded by their matching skill as workflow step 1); `wip/` is no-memory and `projects/<x>/` is transient memory. An update that lands in `wip/` or that lives only in transient project notes is the same as no update — the lesson will not survive project close-out.

7. **Project DoD skipped because "the team knows the retro outcome."** The retro is the team's only memory. A project that ships without its retro has lost its lessons no matter what's "in the operator's head."

8. **Retro held but the "Update landed" line never gets filled in.** The retro template requires the post-retro link to the landed commit / PR. Without it, the protocol has a retro that intended to update but didn't.

## Worked example: a retro on the StorageTable intent-mismatch

(Continuing from the worked example in [`definition-of-done.md`](definition-of-done.md).)

```markdown
# Retro: Dispatch DoD missed a programmatic-grep-route-around

**Trigger:** dispatch failure
**Trigger artefact:** <link to dispatch transcript>
**Date:** 2026-05-17
**Agile orchestrator (wearer):** operator

## What happened

Migration dispatch for the `StorageTable` shape change passed all six
validation gates (typecheck, tests, grep for `tables: {`, etc.) and
the reviewer subagent accepted. Intent-validation caught two sites
where the implementer routed around the grep gate using
`Object.fromEntries(...)` — programmatically equivalent to the legacy
shape but escapes the literal-shape grep.

## Why it happened

Proximate cause: the implementer found a way to satisfy the gate
without delivering the intent. Structural cause: the grep gate
was the only spec-shape check in the brief's DoD; intent-validation
was the brief's only defense against routing around the grep, and
the brief's tier was "cheaper" — the cheaper-tier reviewer subagent
accepted because the grep passed, not because intent matched.

## What should have caught it

The brief's edge-case table should have included "grep-gate satisfied
by programmatic equivalent" with the disposition "refuse and surface."
It didn't because we'd never seen this pattern before; it's not in
the calibration's failure-mode catalogue.

## Output

- [x] **Project-context update:** add entry to
       `prisma-next/drive/plan/README.md` § failure-mode catalogue:
       "Grep gate satisfied by programmatic equivalent (e.g.
       `Object.fromEntries` re-creating a flat literal structure)."
       Disposition: brief edge-case table includes "if a flat-shape
       literal would be programmatically constructed, refuse and
       surface." Grep library: add pattern `\bObject\.fromEntries\(`
       for the dispatches that follow. Lands under `plan` because
       brief discipline (and the failure-mode / grep library it draws
       from) is part of slice-plan work.
- [ ] Canonical update: not applicable — this is a project-specific
       anti-pattern in prisma-next's IR shape; routing around grep
       gates in general is already covered by the canonical
       brief-discipline section.
- [ ] ADR: not applicable.

## Update landed (post-retro)

<commit-hash> — `prisma-next/drive/plan/README.md` § failure-mode
catalogue + § grep library.
```

The retro ran in 7 minutes. Output: one project-context entry + one grep library pattern in `drive/plan/README.md`. The next time `drive-slice-plan` or `drive-orchestrate-plan` runs on a slice that touches the affected surface, it reads the README at workflow step 1 and threads the failure mode into the brief's edge-case table; the failure mode doesn't recur.

(Note: during this project's lifetime the entry is mirrored in `projects/drive-domain-model/calibration/prisma-next.md` as the worked-example calibration. When the calibration migrates to `prisma-next/` per the close-out plan, the entry settles into `prisma-next/drive/plan/README.md` as its canonical home.)

## Output routing in operation

Retro outputs route to one of two durable homes (per [`protocol-as-memory.md`](protocol-as-memory.md) § "Two homes for memory"); ADR is the third for architecture decisions.

- **Canonical update** when the lesson would apply to any team running Drive. Examples:
  - A failure mode in dispatch DoD that any team's projects could hit (e.g. "DoD that depends on private environment").
  - A missing structural protection (e.g. "intent-validation should be non-optional at dispatch + slice DoD" — that's how invariant I12 got named).
  - A persona-responsibility gap (e.g. "the agile orchestrator's responsibility includes recognising when to escalate to design discussion").

  Landing surface: upstream PR to `prisma/ignite` — into the relevant skill body, the always-applied rules, or `principles/` in this project (which feeds canonical).

- **Project-context update** when the lesson is team-specific. Examples:
  - A new failure-mode catalogue entry (the `StorageTable` example above) → `drive/plan/README.md`.
  - A new grep library pattern → `drive/plan/README.md`.
  - A new reference task for t-shirt sizing → `drive/plan/README.md`.
  - A new DoR / DoD overlay item → `drive/<category>/README.md` for the matching skill family (e.g. a new slice-DoD item about QA goes in `drive/qa/README.md`; a new project-DoR item about Linear setup goes in `drive/project/README.md`).
  - A new manual-QA convention (e.g. "every slice that touches the demo must include a `pnpm demo` walkthrough") → `drive/qa/README.md`.
  - A new code-review checklist item → `drive/code-review/README.md`.

  Landing surface: commit in the consumer repo. Effective immediately for that team's next drive-* skill invocation.

The agile orchestrator decides the routing using the heuristic from [`protocol-as-memory.md`](protocol-as-memory.md) § "Home selection": *if the same pattern surfaces across multiple teams' `drive/<category>/README.md` files, it graduates to canonical; otherwise it stays project-context.* Don't pre-emptively graduate; let pattern-recognition (visible via `drive-reconcile-skills`'s upstream-worthy classifications across teams) drive it.

### When the team needs a new category

If a retro produces a project-context update that doesn't fit any of the existing eight categories (per PR #93) plus the three added by this project's restructure (`triage`, `retro`, `health`), the answer is usually one of:

1. The lesson actually belongs to an existing category — re-read the category table in `protocol-as-memory.md` § "Home 2" and pick the closest fit.
2. The lesson is canonical, not project-context (a new ritual is needed, not a new team-specific entry).
3. A new category is genuinely warranted — but adding one is a canonical change (the corresponding drive-* skill needs to know to read it). Land that as its own retro output (canonical update: "add `drive-<new-skill>` and its `drive/<new-category>/README.md` to the conventions table").

Don't create category READMEs unilaterally for skills that don't exist yet — they won't be read by anything.

## Practical implications

1. **The agile orchestrator runs the retro.** Per [`roles-and-personas.md`](roles-and-personas.md), the persona owns process facilitation, which includes retros.
2. **Triggers are pre-declared.** The team knows which events fire a retro; no surprise — the dispatch failure that just happened fires a retro because the protocol said it would, not because someone decided to.
3. **Retro time-box is ≤ 15 min for a single trigger.** Longer means the trigger had multiple lessons; split into multiple retros.
4. **The update is the deliverable.** "Update landed" is the retro's DoD. No update, no retro — and the update must land in a memory-strong surface (canonical body or `drive/<category>/README.md`), not in transient project notes.
5. **Project close-out is the gate that catches missed retros.** A project that hits its mandatory close retro and discovers no canonical / project-context updates over its lifetime is suspicious — projects that don't surface learnings either had no failures (rare) or had failures whose retros didn't run (the failure mode).
6. **Unattended-mode retros are recorded for operator return.** Per `drive-orchestrate-plan`'s unattended-mode rules: dispatch failure or drift event triggers a stop-condition; the orchestrator agent drafts the retro (filling in the template's "What happened / Why / What should have caught" sections) and proposes a routing (canonical vs project-context, with a candidate `drive/<category>/README.md`); operator runs the "Output" + "Update landed" steps on return.
7. **The reconciliation loop is part of the retro discipline.** When the team has been editing in-repo skill copies as quick fixes, `drive-reconcile-skills` (per [PR #93](https://github.com/prisma/ignite/pull/93)) auto-classifies each delta and routes it to the right home (`drive/<category>/README.md` for project-specific, `wip/drive-upstream-improvements.md` for operator triage). Operators should run reconciliation periodically — and especially before any project-close retro — so the team's accumulated drift settles into the right home rather than rotting in stale skill copies.

## Failure mode this principle directly prevents

The recurring failure where the team's lessons live only in the heads of whoever was around at the time, and re-discovery happens because subsequent agents have no surface to read the lesson from. The fix is structural: every learning event produces a landed update in a memory-strong surface; the agent on the next dispatch reads the update; the lesson informs the work.

## Related principles

- **[`protocol-as-memory.md`](protocol-as-memory.md)** — the structural reason retros are mandatory; defines the two homes (canonical body, `drive/<category>/README.md`) and the home-selection heuristic this principle operationalises.
- **[`roles-and-personas.md`](roles-and-personas.md)** — the agile orchestrator persona owns retro running.
- **[`definition-of-ready.md`](definition-of-ready.md)** — DoR's project-context overlays (in `drive/<category>/README.md`) grow by retro accretion.
- **[`definition-of-done.md`](definition-of-done.md)** — DoD's project-context overlays grow by retro accretion; project DoD makes the close retro mandatory.
- **[`brief-discipline.md`](brief-discipline.md)** — many retro outputs land in `drive/plan/README.md`'s failure-mode catalogue and grep library, then get threaded into subsequent briefs' edge-case tables.
- **[`decomposition-and-cost.md`](decomposition-and-cost.md)** — `drive/plan/README.md`'s model-tier routing table grows by retro accretion (which dispatch shapes turned out to be safe at which tier).
- **`drive-reconcile-skills`** ([PR #93](https://github.com/prisma/ignite/pull/93)) — the reconciliation skill that auto-classifies in-repo skill-drift deltas and routes them to the right home; pairs with the retro discipline.
