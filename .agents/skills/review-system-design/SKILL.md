---
name: review-system-design
description: Atomic sub-skill — produces a `system-design-review.md` for a PR/branch by reading changes through the architect lens (typology, naming, bounded contexts, conceptual integrity, ubiquitous language). Adopts the `architect` persona. Use directly when the user wants only the system-design review, or via the composite `drive-pr-local-review` when they want the full review set.
disable-model-invocation: true
---

# Review: System Design

Produce a `system-design-review.md` for the established review scope (branch + base), grounded in the canonical or inferred review spec.

This skill is **atomic** per `drive-agent-personas/SKILL.md § Composite skills § Shape A`. It produces one artefact (`system-design-review.md`) under one persona (`architect`). It is invoked directly when the user wants only the system-design pass, or via the composite `drive-pr-local-review` when they want the full review set side-by-side.

## Persona

> **Adopt the `architect` persona** (see the `drive-agent-personas` skill). The architect persona is the source of truth for the lens — system shape, ubiquitous language, bounded contexts, dependency direction, typology integrity, conceptual integrity, conceptual minimality, plus the discriminator-completeness / consumer-vs-essence / concept-vs-mechanism / symmetry / reads-cold probes.

The architect lens is *load-bearing* for this skill. A system-design review that does not apply the architect's typology probes to introduced names, prefixes, namespaces, or layer placements is missing what makes this skill different from a generic review. When you encounter a qualifier-style prefix (`Authored*`, `Extension*`, `Internal*`, `Base*`, etc.) in the diff, fire the discriminator-completeness probe before signing off — see the persona's `## Probes` section for the full set.

## Inputs

The composite caller (`drive-pr-local-review`) hands this skill:

- **Review scope:** the resolved branch + base + commit range (e.g. `origin/main...HEAD`).
- **Review spec:** the in-repo canonical spec (file path) when one exists on the branch, or the inferred review `spec.md` written by the composite into the artefact directory.
- **Artefact directory:** the absolute path where `system-design-review.md` should be written.

When invoked directly (not via the composite), establish the same inputs yourself per the scope-and-spec rules in `drive-pr-local-review/SKILL.md § 1) Establish the review scope` and `§ 2) Establish expectations`.

## Output

Write `system-design-review.md` into the artefact directory.

### Minimum coverage

The architect-lens review must cover:

- **What problem is being solved; what new guarantees / invariants are introduced.** Frame in the system-shape sense: what concept is being added, removed, or reshaped at the type / module / namespace level.
- **Subsystem fit** (contracts, plans, runtime, adapters/plugins, capability gating). Whether the new shape lives in the right bounded context with the right dependency direction. Layer purity. Whether existing concepts already cover the new concern under different names.
- **Boundary correctness.** Domain / layer / plane imports. Whether a type that lives in the framework layer actually belongs there or is target-specific. Whether the *meaning* of an import direction is right, not just whether it compiles.
- **Naming and typology integrity.** Apply the architect persona's probes (discriminator-completeness / consumer-vs-essence / concept-vs-mechanism / symmetry / reads-cold) to every introduced name, prefix, namespace, or grouping. Surface typology holes; propose the prefix-free alternative; check whether the same type already exists under another name.
- **ADRs.** If the branch adds or changes ADRs under `docs/architecture docs/adrs/`, treat them as design-intent sources and explicitly review their reasoning and trade-offs through the architect lens (vocabulary fit; conceptual integrity; speculative-extensibility tax).
- **Test strategy adequacy at the architectural level.** What architectural property must be proven, and where. Test naming and structure as evidence of the system's conceptual partitioning.

### Quality bar

A system-design-review.md that passes the bar:

- Names the load-bearing typology / naming / boundary decisions the diff introduces, in plain language a reader can re-evaluate.
- Surfaces every qualifier-prefix, consumer-encoding name, and mechanism-named-as-concept the architect persona's probes catch.
- Explicitly distinguishes architect-class concerns (in scope) from buildability / scope / learnability concerns (out of scope; routed to other personas via the composite).
- Reads cleanly as a stand-alone artefact: a reviewer with no other context can re-evaluate the architect-pass conclusions from this file alone.

## Out of scope (route elsewhere)

- **Implementation correctness, failure modes, blast radius, operability, cost.** These are the principal-engineer's lens — the composite delegates them to the `review-implementation` sub-skill (or invoke it directly).
- **Adopter learnability of the surface, fresh-reader friction, glossary stability.** These are the devrel persona's lens; route to a devrel-pass review skill when one exists, or surface as out-of-scope.
- **Scope, user value, evidence for the problem.** These are the PM persona's lens; out of scope for system-design review.
- **Public-surface stewardship, license / provenance, contribution friction.** These are the oss-specialist persona's lens; out of scope for system-design review.
- **Composing reviewer outputs, packaging the synthesis for the human.** That is the `review-walkthrough` sub-skill's lens (tech-lead).

## Workflow

1. Adopt the architect persona (see § Persona).
2. Read inputs (review scope, spec, artefact directory) — establish them yourself if invoked directly.
3. Read the diff with the architect lens loaded; fire probes on qualifier prefixes, consumer-encoded names, mechanism-named-as-concept, sibling-asymmetry, and cold-reads.
4. Read changed files in full when the diff alone is insufficient to apply the typology / boundary / naming probes meaningfully.
5. Write `system-design-review.md` per the minimum-coverage list above; structure as the reviewer judges best.
6. Surface any concern that crosses into another lens's scope as a referral, not as content (e.g. *"this name surfaces an ambiguity the architect lens cannot fully resolve without weighing operability — surface to principal-engineer for the buildability pass"*).
