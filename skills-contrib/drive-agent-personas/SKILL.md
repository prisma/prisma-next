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

## Role vs persona

Roles and personas are orthogonal: a **role** is a structural constraint on *what* an actor does; a **persona** is a bias-frame on *how* the actor reasons. Both coexist within a single sub-agent. Loading a persona does not change the actor's role, and binding a role does not specify which persona the actor wears within that role.

The structural roles defined in [`drive/roles/README.md`](../../drive/roles/README.md) — Orchestrator (runs `drive-*-workflow` skills) and Executor with three subtypes (Specialist runs an atomic skill end-to-end; Implementer edits product code within a slice; Reviewer reads code and writes review verdicts) — set the boundary of what tools and actions are appropriate. The persona library defined in this skill sets the lens through which the actor inside that boundary reasons.

Concrete combinations:

- An Executor running `drive-specify-project` can wear the `tech-lead` persona (orchestrating spec authoring), the `architect` persona (naming and typology focus), or any other persona the skill calls for. The role stays Specialist — the persona only shifts the scrutiny frame.
- A Reviewer in `drive-build-workflow` can wear the `principal-engineer` persona (buildability, blast radius, operability) for an escalation review without becoming an Orchestrator. The role stays Reviewer; the persona only sharpens the review priorities.
- An Orchestrator running `drive-deliver-workflow` defaults to the `tech-lead` persona (orchestration of multi-persona work). Loading `tech-lead` does not authorise the Orchestrator to call `Read`/`Grep`/`Write` directly — the role constraint still applies. A `tech-lead`-persona Orchestrator that drifts into execution is mis-applying the persona; the persona is the lens, not the license.

The practical consequence for skill authors: a skill that requires a specific persona should still respect the role binding established by the calling workflow. A dispatch brief carries both — the role declaration ("you are running as an Executor / Specialist") and the persona instruction ("adopt the `tech-lead` persona"). The two are independent and both load-bearing.

See [`drive/roles/README.md`](../../drive/roles/README.md) for the canonical definitions, the five binding layers, the DO-NOT enumeration, and the escape-hatch policy.

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

## Multi-persona skills

A skill whose work spans more than one persona adopts an **orchestrator persona** at the top of its body and names **persona transitions** at workflow boundaries within that body. The orchestrator is reloaded at synthesis points (typically at the start, between transitions, and at the end) so the agent returns to the meta-judgement frame for routing-and-packaging work between lens-shifts.

Load-bearing principles:

1. The skill names its **own** orchestrator persona explicitly — typically `tech-lead`, since orchestration is the tech-lead lens. Other orchestrators are allowed where the skill genuinely needs one (e.g. a PM-orchestrated discovery skill); skill authors choose.
2. Every persona load is **visible in the skill body** — at the top and at every workflow boundary. There is no silent persona inheritance.
3. **Persona is not propagated.** Each transition is its own load instruction; the agent re-loads at every boundary rather than carrying the prior persona through.
4. The skill is **self-describing on read.** A reader of its SKILL.md should be able to reconstruct, without inference, which persona is loaded at which moment.

**Mechanic.** The SKILL.md body contains explicit persona-load instructions at workflow boundaries. The standard load-instruction wording (per `§ Resolution rule`) is used at each transition — for example: *"Begin by adopting the architect persona (see the drive-agent-personas skill). When architect-class concerns are settled, adopt the principal-engineer persona for the buildability/operability pass. At synthesis, reload the tech-lead persona to package the outcome."*

**Example.** `drive-discussion` invoked with `architect` + `principal-engineer` sequences typology / naming / bounded-contexts concerns → failure-modes / blast-radius / operability concerns within a single Q&A workflow, with `tech-lead` reloaded at synthesis. Cross-pollination is preserved because the conversation is continuous: a concern raised under one persona can be referenced from the next pass without re-adjudication.

**Future-extensibility.** As v2+ personas are admitted (security, QA, etc.), additional persona-load steps slot into the workflow at appropriate points. Adding a security-persona pass between architect and principal-engineer should be a single insertion at the right boundary, not a restructure of the workflow.

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
