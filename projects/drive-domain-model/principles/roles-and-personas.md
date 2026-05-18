# Principle: Three Roles + One Persona, Wearable By Humans Or Agents

## At a glance

**Drive recognises three roles and one persona.**

| Role | Owns | Why it's a real role |
|---|---|---|
| **Project owner** | Purpose statement + scope decisions + project-DoD + sign-off | Zoom-out stance — incompatible with in-the-weeds coding in the same minute. |
| **Implementer** | Slice spec + slice plan + dispatch execution + PR open | Continuous flow state across spec / plan / execute. |
| **Reviewer** | Slice review (verdict + findings) | Adversarial reading — incompatible with the "I made this work" stance the implementer just exited. |

| Persona | Stance |
|---|---|
| **Agile orchestrator** | Scope discipline, sizing instinct, process facilitation (DoR / DoD / WIP-inspection / brief / design-discussion escalation / retro running). Worn by whichever actor is currently running scope discipline or driving the dispatch loop. Independent of role. |

**All four can be played by humans, by agents, or in mixed configurations.** Today the human wears most; the orchestrator agent wears the agile-orchestrator persona during dispatch loops. The trajectory hands the persona to the orchestrator agent at all scopes (triage, dispatch loop, retro-running, protocol maintenance) as the team's calibration matures; the human's residual role becomes design-level (project spec authoring, design-discussion participation, falsified-assumption escalation).

The role/persona split is the team-shape companion to [`protocol-as-memory.md`](protocol-as-memory.md): the rituals are the memory; the roles and persona are the actors who execute them.

## The three roles

| Role | Owns | What makes it a real role |
|---|---|---|
| **Project owner** | Purpose statement; scope decisions (adopt new work vs defer); project-DoD; sign-off at close. | A scope decision requires a zoom-out stance — "does this serve the purpose?" — that's incompatible with the in-the-weeds stance of writing code. The same actor cannot fluidly switch in the same minute without a context shift. |
| **Implementer** | Slice spec; slice plan; dispatch execution; PR open. | Writing the slice plan, assembling briefs, executing edits, and resolving design-internal calls all happen in the same flow state. One actor; one continuous stance. |
| **Reviewer** | Slice review (verdict; findings). | Reviewing is adversarial reading — you're looking for what went wrong, what the implementer didn't see, what slipped past the gates. That stance is incompatible with the "I made this work" stance the implementer just exited. The same actor cannot review their own slice in the same minute without compromising the review. |

The test for whether a role is real: *can the same person fluidly play this role and another in the same minute, or does role-switching require a context shift?* Project-owner-vs-implementer is real (zoom-out vs zoom-in). Implementer-vs-reviewer is real (constructive vs adversarial). Spec-author-vs-plan-author is not real — the same brain does both in continuous sequence; that's why we don't recognise it.

### Roles that didn't make the cut

Earlier DDD passes proposed more granular roles. The ones that didn't survive:

- **Tech lead** as separate from project owner. Collapses into project owner — the zoom-out stance is the same; tech-lead specifics belong in calibration.
- **Spec author** as separate from implementer. Same flow state; same actor.
- **Plan author** as separate from implementer. Same flow state; same actor.
- **Standup runner** as separate from implementer or reviewer. The WIP-inspection cadence is run by whoever holds the agile orchestrator persona at that moment — it's a persona-driven action, not a separate role.
- **Coach** / **scrum master** as separate from agile orchestrator. Same orientation; collapses into the persona.

This collapse is intentional. Drive's role surface is small because agent teams cannot rely on organic role-distinction the way human teams can (a human standup-runner is recognisable by who's holding the marker; an agent team has no such cue). Pinning a small set of distinct roles is the way to keep the protocol legible.

## The one persona

| Persona | Stance |
|---|---|
| **Agile orchestrator** | Scope discipline (triage, deferral, in-or-out calls). Sizing instinct (PR-cap at slice; M-cap at dispatch). Process facilitation (WIP-inspection cadence, DoR / DoD gates, brief shape, design-discussion recognition, retro running). Independent of role — worn by whichever actor is currently running scope discipline or driving the dispatch loop. |

The persona is real because the orientation it captures isn't a role's exclusive property. The project owner wears agile orchestrator when triaging surfaced scope. The implementer wears agile orchestrator when sizing their own dispatches in the slice plan. The orchestrator agent wears agile orchestrator full-time during a dispatch loop. The persona is the answer to "who's running the process?" not "who owns the work?"

The key responsibility that lives only in the persona: **recognising when to escalate to design discussion.** The agile orchestrator notices when an assumption is being silently accommodated, when an obstacle is bigger than the dispatch's brief can handle, when scope is shifting under the project's spec. The persona's job is to pause and bring the operator in, per invariant I12.

## The today → eventual trajectory

The point of pinning roles + persona is not just legibility — it's to support **incremental delegation** as confidence in the protocol accrues. The trajectory:

| Phase | Project owner | Implementer | Reviewer | Agile orchestrator (persona) |
|---|---|---|---|---|
| **Today (typical)** | Operator | Operator (often delegated to implementer subagent) | Operator (often delegated to reviewer subagent) | Operator at top; orchestrator agent inside `drive-orchestrate-plan` |
| **Near-term** | Operator | Implementer subagent (default); operator on judgment-heavy slices | Reviewer subagent (default); operator on high-blast-radius PRs | Orchestrator agent at all dispatch-loop work; operator at triage + design discussions |
| **Eventual** | Operator at the project-spec layer; agent for stable-input projects | Implementer subagent | Reviewer subagent | Orchestrator agent at all scopes (triage, dispatch loop, retro running, protocol maintenance) |

The operator's residual role at the eventual phase is **design-level** — project spec authoring, design-discussion participation, falsified-assumption escalation, sign-off at project close. Everything else delegates.

Two principles govern the delegation pace:

1. **Delegate when the calibration carries the lesson.** A role is safe to delegate to an agent when the project's calibration captures the failure modes that would otherwise require human judgment. If the calibration is sparse, keep the operator in the loop.
2. **Delegation is per-role and per-scope.** Not all-or-nothing. The operator can delegate implementer + reviewer for low-risk slices while staying in the loop for high-risk ones. The trajectory is per-role-per-scope, not a global cutover.

## Role + persona configurations (worked examples)

### Configuration A: operator-driven small project

```
Project owner:       operator
Agile orchestrator:  operator (at triage); orchestrator agent (in dispatch loops)
Implementer:         operator (for design-heavy slices); implementer subagent (for mechanical slices)
Reviewer:            reviewer subagent (for all slices); operator (for high-blast-radius)
```

Typical for a project with a stable spec but novel implementation. Operator wears project owner + agile orchestrator at the top level; agents do the inside-the-loop work.

### Configuration B: unattended-mode execution

```
Project owner:       operator (set up before going away)
Agile orchestrator:  orchestrator agent (full-time)
Implementer:         implementer subagent
Reviewer:            reviewer subagent
```

Operator returns to find: PRs opened or in review; design-discussion stop-conditions logged for pending design calls; retros run on any drift / failure events. Operator picks up the design-discussion thread and re-authorises.

### Configuration C: direct change (orphan)

```
Project owner:       (none — orphan unit)
Agile orchestrator:  operator (at triage; "this is a direct change")
Implementer:         operator (one edit)
Reviewer:            peer operator OR self-review (for truly trivial)
```

The lightest possible configuration. Triage is the only ceremony; everything else is just the edit + the PR + the merge.

### Configuration D: project owner is an agent (eventual)

```
Project owner:       agent (a "PO subagent" reading the project's stable input — e.g. a customer ticket, a roadmap line, an OKR)
Agile orchestrator:  orchestrator agent
Implementer:         implementer subagent
Reviewer:            reviewer subagent
```

The eventual state for projects whose purpose is captured by a stable input artefact (a ticket, an OKR, a customer requirement) that doesn't require human design judgment to interpret. Most projects today do require that judgment; this configuration becomes accessible as the protocol matures.

## Anti-patterns this principle calls out

1. **Same actor as implementer and reviewer in the same dispatch.** Compromises the review stance. The reviewer must be a different actor than the implementer for the slice (the *same actor at a different time* is also compromised — the review stance doesn't form cleanly when you just finished implementing).

2. **Project owner playing implementer continuously.** The zoom-out stance erodes when the actor is always in the weeds. The operator who is the project owner but is also writing every line of code will eventually lose scope discipline. Symptom: scope creeps in silently because the project owner has stopped reading their own spec.

3. **Agile orchestrator role conflated with "the senior agent."** The persona isn't about seniority or tier; it's about the orientation. A cheap-tier agent can wear the persona during a single triage call. An expensive-tier agent can fail at the persona if it doesn't actually run the rituals.

4. **No actor wears agile orchestrator during a dispatch loop.** Worst case: the dispatch loop runs without any actor holding the WIP-inspection cadence + DoR / DoD discipline. The dispatch silently drifts (the failure mode described in `spec.md`). The orchestrator agent inside `drive-orchestrate-plan` is the canonical wearer for this; a configuration where the loop runs without one is broken.

5. **Delegation without calibration.** Delegating implementer to a subagent in a project whose calibration is sparse means the agent re-discovers the failure modes the calibration would have warned about. Symptom: dispatches drift the same way they did before any of this work existed. The calibration is the gate on delegation pace.

6. **Skipping the persona's escalation responsibility.** The agile orchestrator's job to recognise when design discussion is needed only works if the actor wearing the persona is actually checking. An orchestrator agent that just executes its dispatch loop without watchpoints for assumption-falsification or obstacle-emergence is wearing the persona in name only. The watchpoint discipline is non-optional.

## Practical implications

1. **Every dispatch records who's wearing what.** Brief includes implementer (subagent vs operator); reviewer is named; the agile orchestrator's wearer is implicit at the dispatch-loop scope (orchestrator agent) but explicit at triage and retro scopes.
2. **The persona is portable.** No actor "is" the agile orchestrator permanently. The persona moves with whoever is running scope discipline at the moment. Pinning this avoids the "but I'm not the orchestrator" failure where rituals get skipped because nobody felt responsible.
3. **Role assignments live in calibration when they're project-specific.** "For this team's web-app slices, the reviewer is always a different operator than the implementer; for backend slices, reviewer-subagent is sufficient" is calibration content. The protocol carries the shape; the calibration carries the per-project assignments.
4. **Trajectory milestones land in retros.** "We delegated implementer for slice X; the dispatch drifted because calibration was missing entry Y; we added Y" is a retro outcome that updates calibration AND pulls the trajectory forward (next time we can delegate the same shape of slice safely).

## Failure mode this principle directly prevents

Two recurring failures:

- **Role merging that compromises adversarial reading.** When the same actor reviews their own slice, the review is structurally weaker; subtle drift slips through. The split makes the adversarial stance possible.
- **Process facilitation falling between the cracks.** When no actor explicitly wears the agile orchestrator persona, rituals get skipped — sometimes silently, until a retro discovers the omission. Naming the persona ensures someone is responsible at every moment.

## Related principles

- **[`protocol-as-memory.md`](protocol-as-memory.md)** — the rituals the persona facilitates ARE the team's memory; without the persona, the rituals don't fire and the memory doesn't accumulate.
- **[`brief-discipline.md`](brief-discipline.md)** — every brief carries an implementer assignment + an expected reviewer; the persona's job is to assemble the brief.
- **[`definition-of-ready.md`](definition-of-ready.md)** — the gate the persona runs before delegating to the implementer.
- **[`definition-of-done.md`](definition-of-done.md)** — the gate the persona runs before accepting the implementer's work.
- **[`retro.md`](retro.md)** — the persona owns running the retro and lands the resulting protocol / calibration / ADR update.
