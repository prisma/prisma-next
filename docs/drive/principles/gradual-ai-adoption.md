# Principle: Gradual AI adoption

## The spectrum

A team's use of Drive sits on a spectrum, not at a destination:

```
       Zero AI                                                  Full delegation
  ───────────────────────────────────────────────────────────────────────────────
  Human reads, writes,    Human invokes atomic        Human invokes workflow   Agent runs the
  decides everything;     skills as building          skills end-to-end;       whole loop;
  agents only execute     blocks; agent runs each     agent runs each step;    human only at
  narrow tasks            step on request             human reviews verdicts   project-spec layer
                                                      between steps
```

Every team is at some point on this spectrum, today. Every team's point moves over time as the team's `drive/<category>/README.md` matures, as the canonical bodies harden, and as confidence in the orchestrator agent accrues. The methodology is designed so that **you can participate at any point on the spectrum** — not just the endpoints.

## What this principle commits us to

Three concrete commitments:

1. **Both skill tiers are first-class.** [Workflow skills](../model.md#two-skill-tiers-workflow-and-atomic) (`drive-<verb>-workflow`) and atomic skills are both directly invokable by humans. A human at the "zero AI" end calls atomic skills as building blocks (`drive-specify-slice`, then `drive-plan-slice`, then handles the dispatch loop themselves). A human at the "full delegation" end calls a workflow skill (`drive-build-workflow`) and lets it run the loop. The atomic-tier skills aren't internal plumbing; the workflow-tier skills aren't a replacement for humans. Both are intentional interfaces.

2. **The protocol is human-readable and human-runnable.** Every skill body documents the steps it runs. The Definition-of-Ready / Definition-of-Done / brief / WIP-inspection / retro templates work whether a human or an agent runs them. A human who hasn't touched any Drive skill should be able to read `principles/definition-of-ready.md` and run the gate manually; a human who runs only `drive-plan-slice` directly should get the same shape of slice plan as a human who runs `drive-build-workflow` and lets it call `drive-plan-slice` internally.

3. **Project-context memory (`drive/`) serves both humans and agents.** The category READMEs and the team's calibration aren't just agent context loaders — they're the team's documented protocol, readable by anyone on the team. When a human runs a slice manually, they consult the same project context an agent would load. When the team adopts more agent delegation, the agent inherits the human's accumulated lessons via the same surface.

## Why this matters

Without the principle named, the surfaces drift toward one end or the other:

- **Toward "agent only."** Workflow skills become opaque orchestrators only an agent can drive; atomic skills become internal plumbing; humans lose the ability to participate except at the most-delegated layer. New team members can't onboard incrementally — they either trust the agent loop or they don't.
- **Toward "human only."** Workflow skills become unmaintained or never built; atomic skills proliferate but never compose into something an agent can drive end-to-end; the trajectory to full delegation stalls because nobody ever crosses the threshold of trusting the loop.

The principle keeps the surfaces honest in the middle: every step usable by either, every layer documented for both, every protocol artefact readable by humans and loadable by agents.

## How to participate at each point on the spectrum

### Zero AI (humans only, no Drive skills involved)

- Read the principle docs (`principles/`) and the project-context READMEs (`drive/<category>/README.md`) directly. They describe the rituals in plain prose.
- Run the rituals manually: assemble a brief the way `principles/brief-discipline.md` describes; run the DoR gate the way `principles/definition-of-ready.md` describes; close the slice with the DoD checklist from `principles/definition-of-done.md`.
- Use Linear, git, GitHub directly. No drive-* skill invocations.

This is a fully valid mode of operating. The principle docs are the methodology; the skills are tools that automate parts of it.

### Atomic-skill use (humans invoking individual skills)

- Invoke atomic skills as building blocks when they save time: `drive-specify-slice` to scaffold a slice spec; `drive-plan-slice` to lay out the dispatches; `drive-pr-description` to draft a PR body.
- Run the loop between invocations yourself — you decide when to move from spec to plan to implementation to PR.
- Use the skills à la carte; skip the ones whose work you'd rather do by hand.

This is the right mode when you trust the individual skills but want to keep control of the loop. Common for design-heavy slices where the operator's judgment between steps is the value-add.

### Workflow-skill use (humans invoking the loops)

- Invoke a workflow skill (`drive-start-workflow`, `drive-build-workflow`, `drive-deliver-workflow`) and let it pilot the loop top-to-bottom.
- Stay in the human-in-the-loop role for the design discussions and the assumption-falsification escalations — those still fire to you. The workflow skill handles the rest.
- Watch the WIP-inspection cadence; intervene if drift surfaces.

This is the right mode when you trust the loop and want to delegate the orchestration work. Most slices most days.

### Full delegation (agent runs everything; human at project-spec layer)

- Write a project spec. Hand off to `drive-deliver-workflow`. Come back when a design discussion fires or the project closes.
- Read the project's health rollups when they fire (interactively or via session-end notification).
- Approve promotions / demotions on prompt; authorise spec amendments when stop-conditions surface them.

This is the eventual state for projects with stable inputs and well-overlaid team contexts. Not every project gets there; some always need human judgment in the loop.

## What gates moving up the spectrum

Two concrete gates:

1. **Your `drive/<category>/README.md` overlays carry the lessons.** Delegating more of the loop is safe when the project-context overlays capture the failure modes the human would otherwise need to spot. Sparse overlays → keep the human higher in the loop. (Per [`roles-and-personas.md`](roles-and-personas.md) § "Two rules govern how fast you can delegate.")
2. **The agent's verdicts have proven reliable for the kind of slice in question.** Trust accrues from observed performance. A new repo + a fresh agent team starts at the cautious end; moves up as retros stop firing on agent-side mistakes for slices of that kind.

Both gates are observable and reversible. Move back down the spectrum when the gates regress — overlays getting stale, agent verdicts surfacing avoidable failures.

## Anti-patterns

1. **Treating the workflow tier as "the future" and the atomic tier as "the legacy."** Both are first-class. A team perpetually at the atomic-skill point is operating Drive correctly; they're just not delegating more.
2. **Skipping the principle docs because "the skills know what to do."** The skills' shapes come from the principles. Humans who can't read the principles can't intervene meaningfully when the agent loop deviates.
3. **Demanding everyone on the team operate at the same point on the spectrum.** Different team members can be at different points on different days. A senior reviewer might run a workflow skill for routine slices and drop to atomic-skill use for high-stakes ones.
4. **Letting the orchestrator agent skip rituals "because they slow it down."** The rituals are why the loop is delegatable — they're what makes the agent's verdicts trustable. An agent running the loop with rituals skipped is faster but no longer safe to delegate to.
5. **Forcing delegation faster than the overlays can support.** Symptom: dispatches drift in the ways the overlays would have caught, but didn't get written because nobody was using the manual path. Move slower or run the path manually for a stretch to populate the overlays.

## Related principles

- **[`roles-and-personas.md`](roles-and-personas.md)** — the trajectory of *who* wears each role across the spectrum (today vs eventual); the two rules governing delegation pace.
- **[`protocol-as-memory.md`](protocol-as-memory.md)** — the memory surfaces (`drive/<category>/README.md`, skill bodies) are designed to serve both humans and agents; this is what makes the spectrum walkable.
- **[`brief-discipline.md`](brief-discipline.md)** — the brief template is human-readable; assembled identically whether a human or `drive-build-workflow` puts it together.
- **[`definition-of-ready.md`](definition-of-ready.md)** + **[`definition-of-done.md`](definition-of-done.md)** — the gates are runnable manually or by the workflow skill; the shape is the same.
