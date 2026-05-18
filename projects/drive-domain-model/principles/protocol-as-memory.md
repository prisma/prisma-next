# Principle: The Protocol Is the Team's Memory

## Thesis

Agent teams have no organic memory transmission between dispatches. Rituals (Definition of Ready, Definition of Done, WIP-inspection cadence, brief discipline, written failure-mode catalogues, design discussions, retros) are not supplements to memory the way they are for human teams — they ARE the memory. Every failure mode we don't write into the protocol re-happens.

## The asymmetry with human teams

Human teams learn from mistakes through several mechanisms, most of them organic:

- **Continuity of personnel.** The same developer who got burned by a pattern last sprint will hesitate when they see it again. The lesson lives in the person.
- **Shared experience as context.** "Remember when we tried that? It didn't work because…" — water-cooler context transmission, retro discussions, casual hallway corrections.
- **Apprenticeship.** Junior developers absorb patterns from senior developers without either party explicitly naming the lesson.
- **Repeated exposure to the codebase.** Just being around the code teaches you what tends to break.

Human-team rituals (standup, retro, planning, DoR, DoD) supplement these organic mechanisms. They formalise the lessons that would otherwise drift, but the bulk of the team's memory lives outside the rituals — in the heads of the people.

Agent teams have **none** of those organic mechanisms:

- **No continuity.** Each dispatch is a fresh agent that has read only what's in front of it. The agent that got burned by a pattern in dispatch N is not the agent that picks up dispatch N+1.
- **No shared experience.** Agents don't have hallway conversations. They don't talk to each other. They don't reminisce.
- **No apprenticeship.** A senior agent cannot tacitly transmit patterns to a junior agent. The transmission must be explicit and written.
- **No codebase familiarity that accumulates.** Each dispatch sees only the files it reads. It does not retain a model of the codebase across dispatches.

Every dispatch is a fresh team member onboarded from cold. The only context an agent has is what's written down where it will read it.

## Consequence: rituals carry all the memory

For agent teams, the rituals are not supplements — they are the entire memory store. Specifically:

- **Definition of Ready** is the team's accumulated wisdom about what makes a dispatch (or slice, or project) pickable. Without it, every dispatch re-discovers the same scoping mistakes.
- **Definition of Done** is the team's accumulated wisdom about what makes a dispatch (or slice, or project) verified. Without it, every dispatch re-discovers the same verification gaps.
- **Brief discipline** (pre-naming edge cases with dispositions) is the team's accumulated wisdom about which traps lurk in this domain. Without it, every implementer re-falls into them.
- **Failure-mode catalogue** is the team's accumulated wisdom about what's gone wrong before. Without it, every recurrence feels novel.
- **Grep library** is the team's accumulated wisdom about which anti-patterns to search for. Without it, every drift detection starts from zero.
- **Design-decisions log** is the team's accumulated wisdom about which paths were considered and rejected. Without it, every design discussion re-litigates settled calls.

When a failure mode happens for the first time, the cost is unavoidable. When it happens for the second time, the cost is structural — it means the lesson from the first time didn't land in the protocol.

## The retro is the team's only learning mechanism

For human teams, retros are one of several mechanisms for learning. For agent teams, retros are **the** mechanism. If a retro doesn't produce a written protocol or calibration update, the team has not learned. The lesson exists only in the head of the human who happened to be in the loop that day, and that human is not the team — they are an external observer.

Every retro must answer: **does this require a protocol update (general), a calibration update (project-specific), or both?** If neither, the retro produced no learning.

Examples from today's reversal that produce updates:

- **General protocol update**: brief discipline must pre-name edge cases the implementer will be tempted to accommodate, with explicit dispositions.
- **Project calibration update (prisma-next)**: add "dual-shape support relocated under a new name" to the failure-mode catalogue; add `'columns' in` and `looksLike` to the grep library; add the corrected reversal as a worked example.

If we leave today's retro without those updates, the next implementer will hit the same trap and we will not have learned.

## Team-specific ritual additions live in project artefacts

The methodology is centralized and shared across repos. A single `drive/agile` skill (or equivalent) carries the general protocol — the ritual patterns, the gate structure, the sizing rubric framework. Multiple teams adopt it; each team has its own conventions, constraints, and recurring failure modes.

This creates a structural rule: **team-specific additions to any ritual MUST land in project-specific artefacts**, never in the shared methodology. Concretely:

- A team that requires every PR to link a Linear ticket adds that to its **Definition of Ready** in its own project calibration doc — not into the shared DoR template.
- A team that requires a screenshot in every UI-changing PR adds that to its **Definition of Done** in its calibration — not into the shared DoD checklist.
- A team that has discovered a recurring anti-pattern (e.g. "dual-shape support relocated under new names") adds it to its **failure-mode catalogue** and **grep library** — not into the shared protocol.
- A team that wants the WIP-inspection cadence to ask an extra question ("are we still on the right model tier?") records that in its **brief discipline** layer — not into the shared WIP-inspection pattern.

The shared methodology defines:

- The **shape** of each ritual (what DoR is, what DoD is, what brief discipline means, what the WIP-inspection cadence asks, what a design discussion produces, what a retro produces)
- The **invariants** every team must honour (no L/XL dispatch, WIP-inspection cadence ≤ 5 min, intent-validated reviewer verdicts, no silent agent-side amendments, etc.)
- The **gate patterns** that compose into project-specific gates

Project calibration defines:

- The **content** of the rituals for this team's work (the reference tasks, the verification commands, the grep patterns, the failure-mode entries)
- The **additions** unique to this team's conventions or constraints

This split has two consequences worth naming:

1. **The shared methodology stays small.** It contains patterns, not specifics. A bloated central skill carrying every team's idiosyncrasies would re-create the failure mode it exists to prevent (cognitive overload, drift, lessons lost in noise).
2. **The calibration layer is load-bearing.** A team that adopts the methodology without writing its own calibration has half a protocol — the patterns without the project-specific anti-patterns the team has learned to avoid. The team will re-fall into traps the calibration would have caught.

Implementation rule: **if you find yourself wanting to add a check / pattern / gate to the centralized methodology that is specific to one team's work, stop. That belongs in the calibration layer.** The exception is when the same pattern surfaces across multiple teams' calibrations — then it's general and can graduate to the methodology.

## Documents that are not memory

Documents agents do not read on dispatch are not memory. They are archaeology.

Concretely:

- Documents buried in places the orchestrator agent does not load on every dispatch (e.g. a buried `wip/` file, an old PR description, a Slack thread) are not memory.
- Documents that are too long for the orchestrator agent to absorb in its context window are partially-not-memory — only the portions actually loaded function as memory.
- Documents that contradict each other are anti-memory: the agent's "memory" becomes inconsistent.

For agent teams, **the home of a document determines whether it functions as memory**:

- `.cursor/rules/` (always loaded) → strongest memory
- Project / workspace `AGENTS.md` (always loaded) → strong memory
- `.agents/skills/*/SKILL.md` (loaded on relevance) → conditional memory
- `docs/` (loaded on reference) → weak memory (must be linked from a stronger surface)
- `projects/<x>/` (loaded only during that project's lifetime) → transient memory
- `wip/` (not generally loaded) → no memory

The strongest place to land a lesson is the surface the agent reads first, every time. The weakest is a document the agent will only see if someone explicitly links to it from a place the agent already reads.

## Practical implications

1. **Every post-mortem produces an update.** Either the protocol (this project) or the calibration (the project where the failure occurred). If neither updates, the post-mortem failed.
2. **Updates land in surfaces agents actually read.** Generalisable lessons eventually graduate to `.cursor/rules/` or `.agents/skills/`. Project-specific lessons land in surfaces the project's own briefs link to.
3. **The protocol stays small enough to be memorable.** A 10,000-word protocol is not memory because the orchestrator agent cannot hold it. The protocol must be designed for working-memory consumption: short principles + linked detail.
4. **The catalogue grows by accretion.** Failure modes are added as they happen. The catalogue is a write-once-per-occurrence, read-on-every-dispatch artefact.
5. **The orchestrator's job includes catalogue maintenance.** Not just dispatching and inspecting — also recording. A retro without a written update is not a complete retro.

## Failure mode this principle directly prevents

The recurring failure where a team-of-amnesiacs re-falls into the same trap each time because no agent remembers the trap and no document on the agent's path describes it. The fix is structural: write the lesson into a surface the agent reads, every dispatch, in time to apply it.

## Related principles

- **[`decomposition-and-cost.md`](decomposition-and-cost.md)** — why the protocol's "small dispatches" rule also enables cheaper agents.
- **[`spikes.md`](spikes.md)** — the only ritual that produces an output artefact instead of working code; the artefact IS memory for the dispatches that depend on it.
- (Upcoming) **`brief-discipline.md`** — Example Mapping in every dispatch brief; the brief itself is the running specification.
- (Upcoming) **`retro.md`** — the trigger-based learning ritual; without it, the team has no learning mechanism.
