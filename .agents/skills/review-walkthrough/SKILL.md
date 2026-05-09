---
name: review-walkthrough
description: Atomic sub-skill — produces a `walkthrough.md` for a PR/branch as a semantic narrative aimed at a human operator touring a multi-thousand-LOC change. Adopts the `tech-lead` persona for altitude / packaging. Delegates to the `drive-pr-walkthrough` skill's `/walkthrough` workflow for the file's mechanical structure. Use directly when the user wants only the walkthrough, or via the composite `drive-pr-local-review` when they want the full review set.
disable-model-invocation: true
---

# Review: Walkthrough

Produce a `walkthrough.md` for the established review scope (branch + base) — a semantic narrative that walks a human operator through the change set at the right altitude.

This skill is **atomic** per `drive-agent-personas/SKILL.md § Composite skills § Shape A`. It produces one artefact (`walkthrough.md`) under one persona (`tech-lead`). It is invoked directly when the user wants only the walkthrough, or via the composite `drive-pr-local-review` when they want the full review set side-by-side.

## Persona

> **Adopt the `tech-lead` persona** (see the `drive-agent-personas` skill). The tech-lead persona is the source of truth for the lens — orchestration, surface-conflicts-don't-merge-them, right-altitude-for-audience, keep-the-user-in-the-loop, make-orchestration-legible, plus the persona-conflict / altitude / human-in-the-loop probes.

The tech-lead lens is *load-bearing* for this skill because the walkthrough's audience is a *human operator touring a multi-thousand-LOC PR*. The right altitude balances: enough detail that the reader can follow the substantive moves, not so much detail that the change-set's narrative is lost in token-level diffs. Architect-class concerns (typology / naming) and principal-engineer-class concerns (failure modes / blast radius) surfaced by the sibling sub-skills (`review-system-design`, `review-implementation`) get *referenced* in the walkthrough at the altitude the human needs — not re-adjudicated.

## Inputs

The composite caller (`drive-pr-local-review`) hands this skill:

- **Review scope:** the resolved branch + base + commit range.
- **Review spec:** the in-repo canonical spec or the inferred review `spec.md`.
- **Artefact directory:** the absolute path where `walkthrough.md` should be written.
- **Sibling reviews (when available):** paths to `system-design-review.md` and `code-review.md` produced by `review-system-design` and `review-implementation` respectively. The walkthrough may *reference* their conclusions at the right altitude (e.g. "the architect pass surfaced a typology concern around `Authored*`; see `system-design-review.md`") — it does not re-derive them.

When invoked directly (not via the composite), establish scope and spec yourself per the rules in `drive-pr-local-review/SKILL.md § 1)` and `§ 2)`. Sibling reviews may not exist on direct invocation; that is fine — the walkthrough stands alone.

## Output

Write `walkthrough.md` into the artefact directory.

### Mechanic — delegate to `drive-pr-walkthrough`

The mechanical structure of the walkthrough (output template, intent-extraction, behaviour-changes-as-evidence, linking conventions, quality checklist) is owned by the `drive-pr-walkthrough` skill at `.agents/skills/drive-pr-walkthrough/SKILL.md`. Use that skill's `/walkthrough` workflow to produce the file.

When invoking that workflow, **override its output path** so the file lands at `<artefact-directory>/walkthrough.md` rather than the default location.

The tech-lead lens is layered on top of that workflow: as you produce the walkthrough, apply the persona's altitude probe (*"what does THIS reader need to decide, and what altitude of detail enables that decision?"*) at every section to calibrate detail.

### Audience — load-bearing

The walkthrough's audience is a **human operator touring a multi-thousand-LOC PR**. They are reviewing the change set, possibly preparing to merge, possibly preparing to give substantive feedback, possibly preparing to land a follow-up. They are *not* re-doing the architect's typology audit or the principal engineer's failure-mode pressure-test — those are evidence files (`system-design-review.md`, `code-review.md`) the walkthrough may reference but does not duplicate.

Concrete altitude guidance:

- **Behaviour changes get plain-English explanations**, with *what changed* and *why it changed* surfaced at the conceptual level. The reader should be able to articulate the change to a third party after reading.
- **Implementation touchpoints get linked, not narrated.** Link to the file + line range; let the reader open the file when they want the line-level view.
- **Tests are evidence**, not narrative. Link the tests that prove the behaviour; do not write a parallel test-narrative.
- **Cross-pollination from sibling reviews** (architect / principal-engineer) is *referenced* at the right altitude. The walkthrough may say "the architect-pass surfaces a typology concern with `Authored*` (see `system-design-review.md` for the full reasoning)" — it does not re-adjudicate.
- **Substantive conflicts surfaced by the sibling reviews** stay surfaced (the persona's *surface-conflicts-don't-merge-them* rule applies). If the architect-pass and the principal-engineer-pass land on different verdicts about a single area of the change, the walkthrough names that disagreement and points the human at both files for the substantive evaluation.

## Quality bar

A walkthrough.md that passes the bar:

- Reads as a *narrative*, not a file-by-file changelog or a process recap.
- Uses the right altitude throughout: enough substance for the reader to evaluate, no more.
- References sibling reviews where their conclusions are load-bearing for the human's evaluation; does not duplicate their content.
- Surfaces any cross-lens conflicts (architect vs principal-engineer) as decisions for the human, not as resolved positions.
- Stands as the *primary review surface* for a single round — a reader who reads only this file (and clicks through links) gets a coherent view of what changed and why.

## Out of scope (route elsewhere)

- **Substantive system-design review.** Architect lens — composite delegates to `review-system-design`. The walkthrough references; does not derive.
- **Substantive code review and AC verification.** Principal-engineer lens — composite delegates to `review-implementation`. Same: reference, don't derive.
- **Adopter learnability, scope, public-surface stewardship.** Devrel / PM / oss-specialist lenses — typically not in the walkthrough's frame at all; route to those personas if the user wants them.

## Workflow

1. Adopt the tech-lead persona (see § Persona).
2. Read inputs (review scope, spec, artefact directory, sibling reviews when available) — establish scope + spec yourself if invoked directly.
3. Apply the `drive-pr-walkthrough` skill's `/walkthrough` workflow with the artefact directory's path overriding the default output location.
4. As you produce the walkthrough, apply the tech-lead altitude probe at every section: what does the human reader need to decide, and what altitude of detail enables that decision?
5. Reference (don't duplicate) sibling-review conclusions where they help the human evaluate. Surface cross-lens conflicts as decisions, not as resolved positions.
6. Write the walkthrough to `<artefact-directory>/walkthrough.md`.
