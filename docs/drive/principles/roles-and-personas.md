# Principle: Three roles + one orchestrator hat

## Who does what

Drive needs three roles and one hat. Roles are *who owns what*; the hat is *the stance whoever is currently running the process wears*.

| Role | Owns |
|---|---|
| **Project owner** | Project purpose; scope decisions (adopt new work vs defer); project-DoD; sign-off at close. |
| **Implementer** | Slice spec + slice plan + dispatch execution + PR open. |
| **Reviewer** | Slice review (verdict + findings). Different actor from the implementer. |

The hat:

**Agile orchestrator** — the stance whoever is currently driving the process wears. Scope discipline (triage, deferral, in-or-out calls), sizing instinct (slice-INVEST at slice altitude, dispatch-INVEST at dispatch altitude — coherence-driven, never file-count-driven; see [`sizing.md`](sizing.md)), process facilitation (DoR / DoD / WIP inspection / brief / retro), and knowing when to escalate to a design discussion. Not pinned to a person; not pinned to a role.

Any of these — roles or hat — can be a human or an agent or a mix. Today the operator wears most of them; the orchestrator agent wears the agile-orchestrator hat during dispatch loops. The trajectory hands more and more to agents as the team's `drive/<category>/README.md` content matures.

## Who wears what, today vs eventually

| Phase | Project owner | Implementer | Reviewer | Agile orchestrator hat |
|---|---|---|---|---|
| **Today (typical)** | Operator | Operator (often delegated to implementer subagent) | Operator (often delegated to reviewer subagent) | Operator at the top; orchestrator agent inside `drive-build-workflow` |
| **Near-term** | Operator | Implementer subagent (default); operator on judgment-heavy slices | Reviewer subagent (default); operator on high-blast-radius PRs | Orchestrator agent across all dispatch-loop work; operator at triage + design discussions |
| **Eventual** | Operator at the project-spec layer; agent for stable-input projects | Implementer subagent | Reviewer subagent | Orchestrator agent everywhere (triage, dispatch loop, retro running, protocol maintenance) |

In the eventual state, the operator's job is **design-level only** — project spec authoring, design-discussion participation, falsified-assumption escalation, sign-off at project close. Everything else delegates.

Two rules govern how fast you can delegate:

1. **Delegate when your `drive/<category>/README.md` carries the lessons.** A role is safe to hand to an agent once your team's project-context overlays capture the failure modes that would otherwise need human judgment. If your overlays are sparse, keep the operator in the loop.
2. **Delegation is per-role and per-scope, not all-or-nothing.** You can delegate implementer + reviewer for low-risk slices while staying in the loop for high-risk ones.

## Walkable transitions

The trajectory above is a spectrum, not a step function — see [`gradual-ai-adoption.md`](gradual-ai-adoption.md) for the principle. Three concrete intermediate points an operator can occupy *today* without committing to "agent runs the loop":

| Point | What the operator does | Drive skills they invoke |
|---|---|---|
| **Manual** | Reads `principles/` + `drive/<category>/README.md` directly; runs the rituals by hand. No drive-* skills involved. | None — git, GitHub, Linear directly. |
| **Atomic invocation** | Invokes individual atomic skills as building blocks (`drive-specify-slice` to scaffold a spec; `drive-plan-slice` to lay out dispatches; `drive-pr-description` to draft a PR body). Operator stays in the loop between invocations. | Atomic skills only; no workflow skills. |
| **Workflow invocation** | Invokes a workflow skill (`drive-start-workflow`, `drive-build-workflow`, `drive-deliver-workflow`) and lets it pilot the loop top-to-bottom. Operator handles design discussions + assumption-falsification escalations that fire to them. | Workflow skills + (transparently) the atomic skills they call. |

Each point is a fully valid mode of operation. Moving from one to the next is a deliberate choice, not an inevitability — a team that stays at "atomic invocation" indefinitely is operating Drive correctly; they're just not delegating more.

The cost of staying low on the spectrum: more operator time per slice. The cost of moving high too fast: the agent loop runs without the lessons the overlays would have provided, and drift recurs in the ways the overlays would have caught. Both gates are observable; both regress if you move too fast and surface in retros.

## What makes a role real

A role is real when **the same person can't fluidly switch to another role in the same minute without a context shift.**

- **Project owner vs implementer is real.** Scope decisions need a zoom-out stance; coding needs zoom-in. The same actor playing both eventually loses scope discipline (symptom: scope creeps in silently because the project owner has stopped reading their own spec).
- **Implementer vs reviewer is real.** Reviewing is adversarial reading — looking for what went wrong. Incompatible with the "I made this work" stance the implementer just exited. Same actor reviewing their own slice is structurally compromised.
- **Spec author vs plan author is not real.** Same flow state; same actor; no context shift required. We don't recognise it.

Roles we considered and dropped:

- **Tech lead** as separate from project owner. Same zoom-out stance; collapses.
- **Standup runner** as separate from implementer or reviewer. The WIP-inspection cadence is run by whoever wears the orchestrator hat at the moment.
- **Coach / scrum master** as separate from agile orchestrator. Same orientation; collapses into the hat.

The collapse is on purpose. Agent teams can't rely on the organic role-distinction human teams have (a standup runner is recognisable by who's holding the marker; an agent team has no such cue). A small pinned set of roles keeps the protocol legible.

## Four concrete configurations

### A: operator-driven small project

```
Project owner:       operator
Agile orchestrator:  operator (at triage); orchestrator agent (in dispatch loops)
Implementer:         operator (for design-heavy slices); implementer subagent (for mechanical slices)
Reviewer:            reviewer subagent (for all slices); operator (for high-blast-radius)
```

Typical for a project with a stable spec but novel implementation. Operator wears project owner + orchestrator hat at the top level; agents do the inside-the-loop work.

### B: unattended-mode execution

```
Project owner:       operator (set up before going away)
Agile orchestrator:  orchestrator agent (full-time)
Implementer:         implementer subagent
Reviewer:            reviewer subagent
```

Operator returns to find: PRs opened or in review; design-discussion stop-conditions logged for pending design calls; retros run on any drift or failure events. Operator picks up the design-discussion thread and re-authorises.

### C: direct change (orphan)

```
Project owner:       (none — orphan unit)
Agile orchestrator:  operator (at triage; "this is a direct change")
Implementer:         operator (one edit)
Reviewer:            peer operator OR self-review (for truly trivial)
```

The lightest possible configuration. Triage is the only ceremony; everything else is the edit + the PR + the merge.

### D: project owner is an agent (eventual)

```
Project owner:       agent (a "PO subagent" reading the project's stable input —
                     a customer ticket, a roadmap line, an OKR)
Agile orchestrator:  orchestrator agent
Implementer:         implementer subagent
Reviewer:            reviewer subagent
```

For projects whose purpose is captured by a stable input artefact that doesn't need human design judgment to interpret. Most projects today do need that judgment; this configuration is the trajectory's eventual state, not today's.

## Anti-patterns

1. **Same actor as implementer and reviewer on the same slice.** Compromises the review stance. The *same actor at a different time* is also compromised — adversarial reading doesn't form cleanly when you just finished implementing.
2. **Project owner playing implementer continuously.** Zoom-out stance erodes when the actor is always in the weeds. The operator who is project owner *and* writes every line of code eventually loses scope discipline. Symptom: scope creeps in silently because the project owner has stopped reading their own spec.
3. **Treating the orchestrator hat as "the senior agent."** The hat is about orientation, not seniority or model tier. A cheap-tier agent can wear it during a single triage call. An expensive-tier agent can fail at it if it doesn't actually run the rituals.
4. **No actor wears the orchestrator hat during a dispatch loop.** Worst case: the loop runs without any actor holding the WIP-inspection cadence + DoR / DoD discipline. The dispatch silently drifts. The orchestrator agent inside `drive-build-workflow` is the canonical wearer; a configuration where the loop runs without one is broken.
5. **Delegating before your `drive/<category>/README.md` carries the lessons.** Delegating implementer to a subagent in a repo whose overlays are sparse means the agent re-discovers failures the overlays would have warned about. Symptom: dispatches drift the same way they did before any of this work existed. The overlays gate delegation pace.
6. **Wearing the orchestrator hat in name only — skipping its escalation responsibility.** The hat's job to recognise when design discussion is needed only works if the actor wearing it is actually checking for assumption-falsification and obstacle-emergence. An orchestrator agent that just executes its dispatch loop without those watchpoints isn't actually wearing the hat.

## Related principles

- **[`gradual-ai-adoption.md`](gradual-ai-adoption.md)** — the trajectory across the human / agent spectrum is walkable; every point is a valid place to operate; the protocol supports participation at any level.
- **[`protocol-as-memory.md`](protocol-as-memory.md)** — the rituals the hat facilitates ARE the team's memory; without the hat, the rituals don't fire and the memory doesn't accumulate.
- **[`brief-discipline.md`](brief-discipline.md)** — every brief carries an implementer assignment + an expected reviewer; the hat assembles the brief.
- **[`definition-of-ready.md`](definition-of-ready.md)** — the gate the hat runs before delegating.
- **[`definition-of-done.md`](definition-of-done.md)** — the gate the hat runs before accepting handoff.
- **[`retro.md`](retro.md)** — the hat owns running the retro and landing the resulting update.
