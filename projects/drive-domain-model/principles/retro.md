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

- **Protocol update.** A general lesson (applies across projects / teams). Lands in `principles/` (a new doc or an amended one), the shared methodology skill set, or as a new always-applied rule.
- **Calibration update.** A project-specific lesson. Lands in the project's calibration doc (e.g. `calibration/prisma-next.md`) — new failure-mode entry, new grep library pattern, new reference task, new DoR / DoD overlay item.
- **ADR (Architecture Decision Record).** A durable architectural call surfaced by the trigger. Lands in `docs/architecture docs/adrs/`.

If a retro produces none of those, **the retro failed**. The lesson exists only in the head of whoever was in the loop that day; that's not the team's memory.

The agile orchestrator's responsibility includes naming the output explicitly: "this retro produced [protocol update | calibration update | ADR | none — and here's why]." If "none — but here's why," the rationale must say *why the lesson doesn't generalise* (one-off, environmental, non-recurring). The default suspicion is that any lesson worth running a retro for is worth landing somewhere; "none — but here's why" is the exception, not the rule.

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

- [ ] **Protocol update:** <which doc / rule / skill; what changes>
- [ ] **Calibration update:** <which calibration doc; what new entry>
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

6. **Update lands in a weak-memory surface.** Per [`protocol-as-memory.md`](protocol-as-memory.md), the strongest surfaces are always-loaded (`.cursor/rules/`, `AGENTS.md`); calibration docs are conditional-loaded (in-project context); `wip/` is no-memory. An update that lands in `wip/` is the same as no update.

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

- [x] **Calibration update:** add entry to `calibration/prisma-next.md`
       § failure-mode catalogue: "Grep gate satisfied by programmatic
       equivalent (e.g. `Object.fromEntries` re-creating a flat literal
       structure)." Disposition: brief edge-case table includes
       "if a flat-shape literal would be programmatically constructed,
       refuse and surface." Grep library: add pattern
       `\bObject\.fromEntries\(` for the dispatches that follow.
- [ ] Protocol update: not applicable — this is a project-specific
       anti-pattern that calibration catches.
- [ ] ADR: not applicable.

## Update landed (post-retro)

<commit-hash> — `calibration/prisma-next.md` § failure-mode catalogue
+ § grep library.
```

The retro ran in 7 minutes. Output: one calibration entry + one grep library pattern. Next migration dispatch's brief assembly threads the calibration entry into the edge-case table; the failure mode doesn't recur.

## How calibration overlays the protocol

Retro outputs naturally split:

- **Update lands in protocol layer** when the lesson would apply to any team running Drive. Examples:
  - A failure mode in dispatch DoD that any team's projects could hit (e.g. "DoD that depends on private environment").
  - A missing structural protection (e.g. "intent-validation should be non-optional at dispatch + slice DoD" — that's how invariant I12 got named).
  - A persona-responsibility gap (e.g. "the agile orchestrator's responsibility includes recognising when to escalate to design discussion" — that's the I12 enforcement mechanism articulated).

- **Update lands in calibration layer** when the lesson is project- or team-specific. Examples:
  - A new failure-mode catalogue entry (the `StorageTable` example above).
  - A new grep library pattern.
  - A new reference task for t-shirt sizing.
  - A new DoR / DoD overlay item.

The agile orchestrator decides which layer; the heuristic from [`protocol-as-memory.md`](protocol-as-memory.md): *if the same pattern surfaces across multiple teams' calibrations, it graduates to the protocol; otherwise it stays in calibration.* Don't pre-emptively graduate; let pattern-recognition drive it.

## Practical implications

1. **The agile orchestrator runs the retro.** Per [`roles-and-personas.md`](roles-and-personas.md), the persona owns process facilitation, which includes retros.
2. **Triggers are pre-declared.** The team knows which events fire a retro; no surprise — the dispatch failure that just happened fires a retro because the protocol said it would, not because someone decided to.
3. **Retro time-box is ≤ 15 min for a single trigger.** Longer means the trigger had multiple lessons; split into multiple retros.
4. **The update is the deliverable.** "Update landed" is the retro's DoD. No update, no retro.
5. **Project close-out is the gate that catches missed retros.** A project that hits its mandatory close retro and discovers no calibration / protocol updates over its lifetime is suspicious — projects that don't surface learnings either had no failures (rare) or had failures whose retros didn't run (the failure mode).
6. **Unattended-mode retros are recorded for operator return.** Per `drive-orchestrate-plan`'s unattended-mode rules: dispatch failure or drift event triggers a stop-condition; the orchestrator agent drafts the retro (filling in the template's "What happened / Why / What should have caught" sections); operator runs the "Output" + "Update landed" steps on return.

## Failure mode this principle directly prevents

The recurring failure where the team's lessons live only in the heads of whoever was around at the time, and re-discovery happens because subsequent agents have no surface to read the lesson from. The fix is structural: every learning event produces a landed update in a memory-strong surface; the agent on the next dispatch reads the update; the lesson informs the work.

## Related principles

- **[`protocol-as-memory.md`](protocol-as-memory.md)** — the structural reason retros are mandatory and must produce updates that land in memory-strong surfaces.
- **[`roles-and-personas.md`](roles-and-personas.md)** — the agile orchestrator persona owns retro running.
- **[`definition-of-ready.md`](definition-of-ready.md)** — DoR calibration overlays grow by retro accretion.
- **[`definition-of-done.md`](definition-of-done.md)** — DoD calibration overlays grow by retro accretion; project DoD makes the close retro mandatory.
- **[`brief-discipline.md`](brief-discipline.md)** — many retro outputs land as new failure-mode catalogue entries that get threaded into subsequent briefs' edge-case tables.
- **[`decomposition-and-cost.md`](decomposition-and-cost.md)** — calibration's model-tier routing table grows by retro accretion (which dispatch shapes turned out to be safe at which tier).
