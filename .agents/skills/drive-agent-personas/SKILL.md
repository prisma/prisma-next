---
name: drive-agent-personas
description: Library of agent personas — named bias-frames that other skills load to shift execution-time defaults. Skills name a persona by ID (e.g. "Adopt the architect persona"), and this skill resolves that ID to the persona doc that frames the executor for the rest of the task. Use when authoring a new skill that needs a particular reviewer/implementer/orchestrator stance, or when an existing skill instructs you to adopt a named persona.
disable-model-invocation: true
---

# Agent Personas

A shared library of **personas** — named bias-frames that other skills load to shift the executor's default behaviour for the duration of a task.

## What a persona is

A persona is a *who* — the named representative of a coherent set of priorities, responsibilities, and vocabulary cues that frame how a task is executed. A persona is orthogonal to a skill: a **skill** is *what* (the action being performed); a **persona** is *who* is performing it. The same skill executed by two different personas should produce materially different output.

Personas exist because the agent's default behaviour is *competent generic engineering* — unframed, it surfaces the concerns a generalist would surface. That misses lens-specific defects: an architect catches typology and naming defects a generalist sees through; a devrel catches fresh-reader friction a generalist normalises; a PM catches scope drift a generalist absorbs. Loading a persona shifts the executor's default toward that lens for the duration of the task.

A persona is not a runtime contract. It is a *bias-frame* loaded into the executor's context — markdown prose that names an identity, its priorities, what it watches for, and the vocabulary it reaches for and avoids. The shift is whatever shift markdown-loaded-into-context can produce; this is convention, not enforcement (see `AGENTS.md` for the broader convention principle).

**What a persona shifts (honest framing).** A persona shifts the executor's *priorities* and the *bar at which a class of concern is dismissed*. It does not turn the executor into the user during interactive review. The m1 architect-persona A/B test demonstrated a verdict shift (CONCERNS vs SATISFIED on identical evidence) and surfaced typology concerns the unframed run dismissed — but neither pass fully recovered the strongest form of the user's post-implementation finding (which surfaced through interactive iteration, not single-pass review). The library raises the floor of the agent's default scrutiny; it does not replace the human-in-the-loop pass.

## Resolution rule

When a skill instructs you to *adopt the `<id>` persona*, load `personas/<id>.md` from this skill directory (`.agents/skills/drive-agent-personas/personas/<id>.md`) and follow it for the remainder of the current task.

The persona doc replaces your default frame:

- Its **stance** is your stance for this task.
- Its **priorities** are what you watch for first.
- Its **responsibilities** are what you produce or surface.
- Its **vocabulary cues** are the framings you reach for and avoid.
- Its optional **probes**, when present, are concrete questions to fire when their triggers are hit.
- Its optional **out of scope for this lens** section names what to surface to other personas rather than adjudicate yourself.

Skills name personas **by ID only**, never by file path. The path lives inside this skill so the storage layout can change without rewriting every skill that names a persona. The standard load instruction reads:

> *"Adopt the `<id>` persona (see the `drive-agent-personas` skill)."*

## `developer`-as-default fallback

A skill that **omits a persona instruction** executes as the **`developer`** persona. This is the explicit default — undeclared is not absent; undeclared is `developer`. Load `personas/developer.md` to see what that means in practice (competent implementer, fits the codebase, runs the validation gates, surfaces escapees honestly, defers substantive review to elevated personas).

When you author a new skill and intend it to run with the developer baseline, you do not need to name `developer` explicitly — the convention covers you. Naming `developer` explicitly is fine and sometimes clarifying (e.g. in a composite skill that wants to be visibly explicit about which sub-skills run on the default), but never required.

## Available personas (v1)

The v1 library is exactly seven personas. Each one is anchored to a current production surface that needs the bias-shift; speculative personas are deferred (see *Heuristic for admitting v2+ personas* below).

| ID                  | Persona               | When to use                                                                                                                                                                       |
| ------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `architect`         | Architect             | Naming, typology, system shape, ubiquitous language, bounded contexts, conceptual integrity. Reach for when reviewing renames, type prefixes, layer placement, ADRs.              |
| `principal-engineer`| Principal engineer    | Buildability, correctness, operability, blast radius, cost vs complexity. Reach for when reviewing designs, code, and runtime concerns.                                           |
| `pm`                | PM                    | Named user, evidence, outcome over output, scope, sequencing, riskiest assumption, non-goals. Reach for when reviewing plans, specs, and product framings.                        |
| `tech-lead`         | Tech lead             | Orchestration of multi-persona work; routing reviewers/implementers; surfacing conflicts to humans; packaging output for the right audience. Reach for in composite-skill design. |
| `developer`         | Developer (default)   | Implementation. The persona that runs when no other is named. Reach for explicitly when authoring an implementer-class skill that wants the binding to be visible.                |
| `devrel`            | Devrel                | Adopter learnability — docs, glossary, onboarding flow, fresh-reader experience, what the surface teaches. Reach for when reviewing READMEs, JSDoc, examples, public-API names.   |
| `oss-specialist`    | OSS specialist        | Public-surface stewardship — breaking changes, license / provenance, contribution friction, governance, triage hygiene. Reach for when reviewing CONTRIBUTING, breaking-change PRs, dependency additions, RFCs. |

The persona doc shape every file follows is documented at [`personas/_shape.md`](personas/_shape.md). Read that file before authoring a new persona.

## Composite skills

A **composite skill** is a skill whose work spans more than one persona. There are two shapes:

- **Shape A — decomposition into atomic sub-skills.** The composite skill orchestrates separate sub-skills, each of which names its own persona. Used when each lens produces a *separable artefact* (e.g. a system-design review *file*, a code review *file*, a walkthrough *file*) that the composite then surfaces side-by-side.
- **Shape B — in-skill lens transitions within a continuous workflow.** The composite skill is *one* skill body; it loads multiple personas at declared boundaries within that body, with the orchestrator persona reloaded at synthesis points. Used when the work is a *continuous activity* (a discussion, an investigation, a multi-pass review of a single artefact) where cross-pollination between lenses is load-bearing — e.g. the architect surfaces a typology concern that the principal engineer needs to weigh against operability without the lens transition resetting the conversation.

Both shapes preserve the same load-bearing principles:

1. The composite skill names its **own** orchestrator persona explicitly — typically `tech-lead`, since orchestration is the tech-lead lens. Other orchestrator personas are allowed if a composite genuinely needs one (e.g. a PM-orchestrated discovery composite); skill authors choose.
2. Every persona load is **visible in the skill body** — at the top for Shape A, at every workflow boundary for Shape B. There is no silent persona inheritance.
3. **Persona is not propagated.** In Shape A, each sub-skill loads its own persona via its own load instruction; the composite's orchestrator persona does not flow into the sub-skills. In Shape B, each transition is its own load instruction; the agent re-loads at every boundary rather than pretending the prior persona is still in effect.
4. Each composite is **self-describing on read.** A reader of the composite's SKILL.md should be able to reconstruct, without inference, which persona is loaded at which moment and which artefacts (or workflow phases) each is responsible for.

### Shape A — decomposition into atomic sub-skills

The composite delegates to atomic single-persona sub-skills, in declared order, on declared artefacts. The classic example is a multi-output review: `/drive-pr-local-review` (composite, adopts `tech-lead`) delegates in order to `review-system-design` (architect → `system-design-review.md`), `review-implementation` (principal-engineer → `code-review.md`), and `review-walkthrough` (tech-lead → `walkthrough.md`).

**Mechanic:** the composite SKILL.md adopts its orchestrator persona at the top of its body, then names the sub-skills it delegates to in declared order. Each sub-skill is itself a stand-alone skill with its own SKILL.md and its own load instruction. Composite and sub-skills are independently invokable — the composite is leverage on top of the atomic surfaces, not a substitute for them.

### Shape B — in-skill lens transitions within a continuous workflow

The composite is one skill body; it loads its orchestrator persona at the top, then names transition boundaries within the workflow at which a different persona is adopted. The orchestrator persona is reloaded at synthesis points (typically at the start, between transitions, and at the end of the workflow) so the agent returns to the meta-judgement frame for routing-and-packaging work between lens-shifts.

**Mechanic:** the composite SKILL.md body contains explicit persona-load instructions at the workflow boundaries. The standard load-instruction wording (per `§ Resolution rule`) is used at each transition — for example: *"Begin by adopting the architect persona (see the drive-agent-personas skill). When architect-class concerns are settled, adopt the principal-engineer persona for the buildability/operability pass. At synthesis, reload the tech-lead persona to package the outcome."* Each transition is its own load instruction; the agent re-loads at each boundary rather than carrying the prior persona through.

The classic example is `drive-design-discussion`, which sequences `architect` (typology, naming, bounded contexts, conceptual integrity) → `principal-engineer` (failure modes, blast radius, operability, cost) within a single Q&A workflow, with `tech-lead` reloaded at synthesis. Cross-pollination is preserved because the conversation is continuous: a typology concern raised under architect can be referenced from the principal-engineer pass without re-adjudication, and a buildability concern raised under principal-engineer can reference back to architect framing.

**Future-extensibility.** As v2+ personas are admitted (security, QA, etc.), additional persona-load steps slot into the workflow at appropriate points. The Shape-B composite SKILL.md should make this localised — adding a security-persona pass between architect and principal-engineer should be a single insertion at the right boundary, not a restructure of the workflow.

### When to choose A vs B

The choice is driven by the *unit of output* and the *load-bearing-ness of cross-pollination*.

**Choose Shape A when:**

- Each lens produces a *separable artefact* (a file, a deliverable) the composite surfaces side-by-side.
- The lenses' work is *independently auditable* — a reader of the architect's artefact does not need the principal-engineer's artefact in hand to evaluate it.
- Cross-pollination is *not* load-bearing: each lens can do its work cleanly off the shared inputs without needing to react to the other lenses' surfaces in real time.
- The composite is *leverage on top of* the atomic skills — both the composite and the atomic skills are independently invokable and useful.

**Choose Shape B when:**

- The work is a *continuous activity* (a discussion, an investigation, a multi-pass review of a single artefact) rather than a set of side-by-side artefact deliveries.
- Cross-pollination is *load-bearing*: the value of the second lens depends on having the first lens's concerns *in the conversation*, not just *in a sibling file*. Splitting into atomic sub-skills would lose the property that *"the architect raised X; how does the engineer feel about that?"* is a natural follow-up question, not a separate-skill invocation.
- The natural unit of output is *one synthesised result* (a refined design, a triaged plan, a single review verdict) rather than several side-by-side artefacts.
- A reader who only invoked one of the lenses-in-isolation (e.g. only the architect pass) would get less than half the value of the composite — the composite is not factorable without losing what makes it work.

**When in doubt:** start with Shape A. Decomposition is more legible by default — each sub-skill is its own surface, each lens's work is its own file. Promote to Shape B only when you can articulate why cross-pollination is load-bearing for *this* workflow. The principal cost of Shape B is conversational continuity that doesn't decompose cleanly into auditable artefacts; the principal benefit is preserving lens-to-lens cross-talk that Shape A would lose.

## Heuristic for admitting v2+ personas

Per spec NFR3, the persona library is **pull-driven**: a new persona is authored when a concrete skill needs it. The bar for admission is:

1. **Distinct execution-time priorities and responsibilities.** The candidate persona must have a coherent stance that the existing v1 set does not already cover. *"It would be like the architect but for X"* is not a distinct persona — it's a probe the architect persona should grow.
2. **Materially different execution output.** Loading the candidate persona on a representative skill should produce output a reader can distinguish from the same skill executed under any v1 persona. If the output is indistinguishable from `developer` or from an existing review-class persona, the candidate isn't earning its keep.

Both conditions must hold. Document a candidate's admission with: a one-paragraph stance preview, the skill that needs it (the *pull*), and (when feasible) a small A/B comparison demonstrating the materially-different-output condition.

## Roles deferred from v1

The following candidate personas were considered for v1 and **not authored**, with the rationale that admitting them speculatively would dilute the library before the heuristic above could be applied:

- **Security.** Real concern, but cross-cuts every other persona's lens (architect cares about security implications of typology; principal-engineer cares about security as a failure mode; oss-specialist cares about license-risk-as-security; PM cares about security-as-user-value). Admit when a skill genuinely needs a security-only lens that the cross-cut can't deliver.
- **Release manager.** Currently absorbed by `tech-lead` (orchestration of release-class workflows) and `oss-specialist` (release-notes, breaking-change discipline). Admit when a release-management-only skill exists.
- **QA.** Currently absorbed by `principal-engineer` (test discipline as a buildability concern) and `developer` (running validation gates). Admit when a QA-only skill exists with a stance distinct from those.
- **Engineering manager.** Absorbed by `tech-lead` for v1. Admit if a workflow surfaces that genuinely needs a people-and-process lens distinct from orchestration.

These are not banned — they are *not yet earned*. When a skill author has a concrete need that the v1 set can't cover, they apply the heuristic and admit the persona.

## Persona doc shape

Every persona doc under `personas/<id>.md` follows the shape contract documented at [`personas/_shape.md`](personas/_shape.md): four mandatory sections (Stance, Priorities, Responsibilities, Vocabulary cues) plus two optional sections (Out of scope for this lens, Probes) admitted when the persona's role calls for them. Read `_shape.md` before authoring or reviewing a persona.

## References

- [`AGENTS.md`](../../../AGENTS.md) — repo conventions referenced by personas.
- [`personas/_shape.md`](personas/_shape.md) — the persona doc shape contract.
- The seven persona docs themselves (`personas/<id>.md`).
