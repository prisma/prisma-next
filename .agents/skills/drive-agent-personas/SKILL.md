---
name: drive-agent-personas
description: Library of agent personas — named bias-frames that other skills load to shift execution-time defaults. Skills name a persona by ID (e.g. "Adopt the architect persona"), and this skill resolves that ID to the persona doc that frames the executor for the rest of the task. Use when authoring a new skill that needs a particular reviewer/implementer/orchestrator stance, or when an existing skill instructs you to adopt a named persona.
disable-model-invocation: true
---

# Agent Personas

A shared library of **personas** — named bias-frames that other skills load to shift the executor's default behaviour for the duration of a task.

> **Status (v1, M1):** scaffold. Resolves the `architect` ID. The full persona library, the `developer`-as-default rule, and the heuristic for admitting v2+ personas land in M2 (see `projects/agent-personas/plan.md § Milestone 2`).

## What a persona is

A persona is a *who* — the named representative of a coherent set of priorities, responsibilities, and vocabulary cues that frame how a task is executed. A persona is orthogonal to a skill: a **skill** is *what* (the action being performed); a **persona** is *who* is performing it. The same skill executed by two different personas should produce materially different output.

Personas exist because the agent's default behaviour is *competent generic engineering* — unframed, it surfaces the concerns a generalist would surface. That misses lens-specific defects: an architect catches typology and naming defects a generalist sees through; a devrel catches fresh-reader friction a generalist normalises; a PM catches scope drift a generalist absorbs. Loading a persona shifts the default toward that lens for the duration of the task.

A persona is not a runtime contract. It is a *bias-frame* loaded into the executor's context — markdown prose that names an identity, its priorities, what it watches for, and the vocabulary it reaches for and avoids. The shift is whatever shift markdown-loaded-into-context can produce; this is convention, not enforcement (see `AGENTS.md` for the broader convention principle).

## Resolution rule

When a skill instructs you to *adopt the `<id>` persona*, load `personas/<id>.md` from this skill directory (`.agents/skills/drive-agent-personas/personas/<id>.md`) and follow it for the remainder of the current task.

The persona doc replaces your default frame:

- Its **stance** is your stance for this task.
- Its **priorities** are what you watch for first.
- Its **responsibilities** are what you produce or surface.
- Its **vocabulary cues** are the framings you reach for and avoid.
- Its **out of scope for this lens** section names what to surface to other personas rather than adjudicate yourself.

Skills name personas **by ID only**, never by file path. The path lives inside this skill so the storage layout can change without rewriting every skill that names a persona.

## Available personas (v1, M1 scaffold)

| ID          | Persona     | Status                                 |
| ----------- | ----------- | -------------------------------------- |
| `architect` | Architect   | Available (`personas/architect.md`).   |

The remaining six v1 personas (`pm`, `principal-engineer`, `tech-lead`, `developer`, `devrel`, `oss-specialist`) land in M2. Until then, a skill that names one of those IDs will fail to resolve — that is intentional; M1 is the kill-the-project gate that proves the persona-load mechanism shifts behaviour at all before the rest of the library is populated.

## Persona doc shape

Every persona doc under `personas/<id>.md` follows the shape contract documented at `personas/_shape.md`. Read that file before authoring or reviewing a persona.

## What lands in M2 (not yet here)

The M2 work completes this scaffold:

- The remaining six persona docs (`pm`, `principal-engineer`, `tech-lead`, `developer`, `devrel`, `oss-specialist`).
- The `developer`-as-default rule for skills that omit a persona instruction.
- The full convention: how a skill author writes the load instruction, how composite skills declare an orchestrator persona without propagating it to sub-skills, the heuristic for admitting v2+ personas, and which roles are deferred (security, release-manager, QA, EM-absorbed-by-tech-lead).

Until M2 lands, treat this skill as load-bearing for one purpose only: resolving the `architect` ID for the M1 A/B test that gates the rest of the project.
