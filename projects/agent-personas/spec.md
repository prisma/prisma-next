# Summary

A shared persona library that lets agent skills declare which executor identity should run them, shifting execution-time defaults toward a deliberate bias-set instead of the model's unopinionated mean. v1 introduces seven personas (PM, principal engineer, architect, tech lead, developer-default, devrel, OSS specialist), refactors `/drive-pr-local-review` into a composite + atomic skills, and retrofits existing skills to declare their persona — plugging the vocabulary-and-typology leak that the M1-cleanup F0–F6 cycle made visible.

# Context

## At a glance

Today every skill executes against the agent's default behaviour: competent, generic, unopinionated. The two existing "stance" skills (`drive-design-discussion`, `drive-product-discussion`) inline their stance privately, so the principal-engineer and PM lenses are encoded but not reusable. There's no architect lens at all, no devrel lens, no orchestrator lens — the result is that whole categories of defect (vocabulary, typology, fresh-reader experience, contributor friction) only surface when the human catches them post-implementation.

We extract the stance from each skill into a shared **persona library**, declare the executor on every skill, and decompose multi-output skills like `/drive-pr-local-review` into atomic single-persona skills composed by an orchestrator. A persona file looks roughly like this:

```markdown
# Architect

## Stance
You are an architect. Your job is to keep the system's structure coherent: ...

## Priorities
1. Ubiquitous language: names accurately encode responsibility, ...
2. Bounded contexts: each subsystem owns one set of concerns, ...
3. Conceptual integrity: the system reads as a single coherent design, ...

## Responsibilities
- Surface naming, typology, and responsibility-distribution defects ...
- Review ADRs and architecture docs ...
- ...

## Vocabulary cues
- Prefer: bounded context, ubiquitous language, anti-corruption layer, ...
- Avoid: framing distinctions that don't exist structurally (e.g. ...).
```

A skill names its executor by **persona ID**, not by file path — the `drive-agent-personas` skill is the indirection layer that resolves IDs to persona docs. The `SKILL.md` explains what a persona is, lists the available IDs, and instructs: *"When asked to adopt persona `<id>`, load the file `personas/<id>.md` from this skill directory and follow it."* Individual skills stay decoupled from the storage layout:

```markdown
# Review System Design

Adopt the `architect` persona (see the `drive-agent-personas` skill).

...
```

The composite shape works the same way; the orchestrator skill names its own persona and delegates to atomic single-persona sub-skills:

```markdown
# Local PR Review (composite)

Adopt the `tech-lead` persona (see the `drive-agent-personas` skill). Orchestrate, in order:

1. /review-system-design   (executes as `architect`)
2. /review-implementation  (executes as `principal-engineer`)
3. /review-walkthrough     (executes as `tech-lead`)
```

A skill that omits the persona instruction executes as the **`developer`** persona — that's a deliberate default, not an absence. Undeclared = hole; `developer` is what fills it. The convention and the resolution mechanism are documented in the `drive-agent-personas` skill itself (`SKILL.md`); nothing parses or enforces the binding programmatically.

## Problem

The M1-cleanup project (PR #434) closed seven design-quality findings (F0–F6) over four implementer rounds and four reviewer rounds. The findings share a shape: **vocabulary, typology, and conceptual-integrity defects** — `APP_SPACE_ID` duplicated in five places (F3); types prefixed `Extension*` despite being target-agnostic (F4); types prefixed `Authored*` despite no structural distinction (F6); migration-dir detection by name regex instead of by manifest content (F0); test fixtures shaped as workspace packages (F1); transitional schema migrations carried at zero-range (F2). None of these surfaced during implementer rounds. None surfaced during reviewer rounds. All surfaced when the human read the resulting surface in interactive review *after* the work was nominally complete.

The reviewer at R4 closed with an explicit observation: design-quality vocabulary findings have systematically surfaced post-implementation across this milestone, and a pre-implementation surface-vocabulary pass would catch this class earlier.

The root cause: the implementer subagent and the reviewer subagent both run against the agent's default behaviour, which is competent generic engineering. Neither is framed to ask "does this typology imply distinctions that don't exist?" or "would a fresh reader find this name self-explanatory?" Those questions live in distinct stances — architect and devrel respectively — that aren't currently encoded anywhere accessible to the skills that need them. The existing stance skills (`drive-design-discussion`, `drive-product-discussion`) inline their stance, so it's neither composable nor available outside Q&A loops. There's no shared way for a reviewer subagent to say "execute this review *as an architect*" because there's no architect persona to point at.

A second-order problem: a single human plays many roles on prisma-next (PM, architect, principal engineer, implementer, tech lead). Without explicit personas, the agent has no vocabulary for which stance the human is currently delegating; everything collapses to "do this engineering task," and the lens-specific defects fall through.

## Approach

Treat **personas** and **skills** as orthogonal: persona is *who*, skill is *what*. A persona is the named representative of a coherent set of priorities and responsibilities at execution time — vocabulary, what's treated as obvious vs. worth stating, what's "good enough," default trade-offs, what failure modes to worry about first. A skill is an action; it declares the persona best suited to execute it. The same skill executed by two different personas would produce materially different output.

The library is itself a skill: `drive-agent-personas`, living at `.agents/skills/drive-agent-personas/`. The skill's `SKILL.md` does three things: (1) explains what a persona is and how it shifts execution-time defaults, (2) lists the available persona IDs and what each is for, and (3) instructs the agent on the resolution mechanism — *"When asked to adopt persona `<id>`, load `personas/<id>.md` from this skill directory and follow it for the rest of the current task."* The persona docs themselves live alongside it under `.agents/skills/drive-agent-personas/personas/<id>.md`, one file per persona. Each persona doc encodes its stance, priorities, responsibilities, and vocabulary cues — enough to shift the executor's biases when loaded into context.

Individual skills stay decoupled from the storage layout: they reference personas by ID only (e.g. *"Adopt the `architect` persona (see the `drive-agent-personas` skill)."*). If the persona library moves, only the `drive-agent-personas` skill changes — every other skill that names a persona keeps working unmodified. Nothing parses front-matter; nothing enforces the binding programmatically. Skills that omit the persona instruction fall back to the **`developer`** persona — that's the explicit default, documented in the `drive-agent-personas` skill alongside the convention itself.

The skill convention is: **atomic skill = exactly one persona** (SRP analogue). Multi-persona work composes — a *composite* skill loads its orchestrator persona (typically tech lead) and delegates to atomic single-persona sub-skills. Each sub-skill loads its own persona via its own instruction line; persona is *not* propagated by the orchestrator. That keeps the persona-skill binding clean (each skill is independent), pushes "who runs what when" into composition where disagreement-handling and result-merging will eventually live, and makes every skill self-describing on read. The convention is skill-author discipline, not a runtime contract — it's a convention like SRP.

A persona that has no current invocation point is not in v1. We anchor the seven personas where prisma-next has *current production surface* that needs the bias-shift: PM (already in `drive-product-discussion`), principal engineer (already in `drive-design-discussion`), architect (catches F3/F4/F6-class defects at production time), tech lead (orchestrates `/drive-pr-local-review` and `/drive-orchestrate-plan`), developer (the explicit default), devrel (catches F0/F1/F6-class reader-experience defects on doc-heavy surfaces), OSS specialist (extension contracts, public surface, contributor friction). Security, release manager, QA, EM are pull-driven — admitted when a skill explicitly needs them. EM specifically is absorbed by tech lead in v1.

The riskiest assumption is whether a markdown persona fragment loaded into a skill's context actually shifts behaviour measurably. We test this cheaply against the F0–F6 case directly: take an artefact from PR #434 that the reviewer subagent had already accepted before F4 / F6 surfaced (e.g. `projects/extension-contract-spaces/reviews/system-design-review.md` at the R2 commit, when `AuthoredContractSpace<TContract>` was committed), run the architect persona on it, see whether the architect surfaces the typology-prefix concerns the original reviewer missed. If it does, the construction works *and* it provably plugs the leak this project exists to plug. If it doesn't, the construction is theatre and the project loops back before populating the rest of the library.

# Requirements

## Functional Requirements

- **FR1.** The persona library is the `drive-agent-personas` skill, living at `.agents/skills/drive-agent-personas/`. Persona docs live alongside its `SKILL.md` under `.agents/skills/drive-agent-personas/personas/<id>.md`, one markdown file per persona. The skill's `SKILL.md` does three things: (1) explains what a persona is, (2) lists the available persona IDs and what each is for, (3) defines the resolution mechanism — *"When asked to adopt persona `<id>`, load `personas/<id>.md` from this skill directory and follow it."* — and the `developer`-as-default fallback rule and heuristic for admitting v2+ personas. Skills reference personas by ID only; the file path lives only inside `drive-agent-personas`.
- **FR2.** Each persona doc encodes at minimum: stance directive, priorities, responsibilities, vocabulary cues. The exact field shape and section names are an implementer-facing decision (see Open Questions); the spec pins the *minimum content*, not the section names.
- **FR3.** v1 ships seven personas:
  - **PM** — user/business/scope concerns; refined from the stance encoded in `drive-product-discussion`.
  - **Principal engineer** — buildability/operability/blast-radius concerns; refined from the stance encoded in `drive-design-discussion`.
  - **Architect** — system shape, vocabulary, typology, ubiquitous language, DDD/Clean/SOLID/bounded contexts, conceptual integrity. New.
  - **Tech lead** — orchestration; selects reviewers/implementers, surfaces conflicts, doesn't adjudicate. New.
  - **Developer** — implementation; the persona every skill falls back to when no other is declared. New.
  - **Devrel** — adopter learnability; docs, glossary, editing style, fresh-reader experience. New.
  - **OSS specialist** — contributor experience, license, governance, public-surface stewardship. New.
- **FR4.** Skills name their executor persona **by ID only** via an explicit instruction line in the skill body (e.g. *"Adopt the `architect` persona (see the `drive-agent-personas` skill)."*). Skills do not reference persona file paths — that coupling lives inside `drive-agent-personas`. Nothing parses skill front-matter; nothing enforces the binding programmatically — the convention is skill-author discipline. Skills that omit the persona instruction execute as the `developer` persona. The convention and the resolution mechanism are documented in the `drive-agent-personas` skill's `SKILL.md`.
- **FR5.** Composite skills are first-class. A composite skill loads its own (orchestrator) persona via the same mechanism and delegates to atomic single-persona sub-skills. Each sub-skill loads its own persona via its own instruction line; persona is *not* propagated by the orchestrator — every skill is independent on read. The composition mechanism is documented.
- **FR6.** `/drive-pr-local-review` is decomposed into a composite skill (`tech-lead` orchestrator) plus atomic single-persona sub-skills:
  - `/review-system-design` (architect)
  - `/review-implementation` (principal engineer)
  - `/review-walkthrough` (tech lead)
- **FR7.** Existing stance skills are retrofitted with explicit persona declarations:
  - `drive-design-discussion` → principal engineer
  - `drive-product-discussion` → PM
  - `drive-orchestrate-plan` → tech lead
- **FR8.** A reproducible A/B test artefact exists that demonstrates measurable behaviour difference between a skill executed unframed (developer-default) and the same skill executed under a declared non-default persona. The test target is implementer-chosen.

## Non-Functional Requirements

- **NFR1.** No runtime enforcement. Persona/skill binding is convention, not a contract; humans review skill changes anyway.
- **NFR2.** Persona docs are written in **advisory voice** (priorities, defaults, lenses) — not as rigid contracts. Tone matches `drive-design-discussion` / `drive-product-discussion` stance directives.
- **NFR3.** Persona library is **pull-driven** for v2+ additions: a new persona is only authored when a concrete skill needs it. Speculative personas (security, release manager, QA, EM if it returns) are not authored until invoked.
- **NFR4.** Each persona doc fits on roughly one screen of prose (target: a few hundred words). Personas are bias-frames, not encyclopedia entries.
- **NFR5.** The seven v1 personas pass the heuristic uniformly: (a) coherent priorities and responsibilities distinct from other personas in v1, and (b) materially different execution output than another persona on the same skill. The v1 set does not include junior-dev, QA, or EM (each fails the heuristic in current scope).

## Non-goals

- **Runtime enforcement** of persona/skill binding. Convention only.
- **Speculative personas in v1.** Security, release manager, QA, EM (admit when a skill needs them, not before).
- **Persona-disagreement adjudication mechanics** beyond "the orchestrator persona surfaces conflict to the human." Defer the adjudication design until two reviewer personas actually produce conflicting verdicts in practice.
- **Multi-persona atomic skills.** Composition is the only multi-persona surface.
- **Cross-project skill libraries.** This work is scoped to the agent skills used in this repo; personas may eventually be lifted to `prisma/ignite` or `~/.agents/`, but that lift is out of scope for v1.
- **Refactoring every existing skill.** Only the four named in FR6/FR7 are in v1; the rest pick up persona declarations as they're touched.

# Acceptance Criteria

- [ ] **AC1.** (covers FR1, FR2, FR3) The persona library exists at the chosen path and contains seven persona docs (PM, principal engineer, architect, tech lead, developer, devrel, OSS specialist), each with stance, priorities, responsibilities, and vocabulary cues. A reader unfamiliar with the project can identify each persona's distinct lens from its doc alone.
- [ ] **AC2.** (covers FR4) The skill-author convention is documented in the `drive-agent-personas` skill's `SKILL.md`: skills name a persona by ID only (e.g. *"Adopt the `architect` persona (see the `drive-agent-personas` skill)."*); the resolution mechanism (`drive-agent-personas` loads `personas/<id>.md`) lives inside that skill; the `developer`-as-default fallback rule and the heuristic for admitting v2+ personas are stated explicitly. A skill author reading the `SKILL.md` can correctly add a persona instruction to a new skill without further guidance and without referencing any file path.
- [ ] **AC3.** (covers FR7) `drive-design-discussion`, `drive-product-discussion`, and `drive-orchestrate-plan` declare their personas (principal engineer, PM, tech lead). Each skill's behaviour after the retrofit is observably the same as before in interactive use — the persona declaration replaces inline stance, it doesn't rewrite the workflow.
- [ ] **AC4.** (covers FR5, FR6) `/drive-pr-local-review` is decomposed: the original skill becomes a composite (`tech-lead` orchestrator) that delegates to `/review-system-design` (architect), `/review-implementation` (principal engineer), and `/review-walkthrough` (tech lead). Run end-to-end on a real branch (e.g. PR #434), the composite produces the same three artefacts (`system-design-review.md`, `code-review.md`, `walkthrough.md`) under the new shape.
- [ ] **AC5.** (covers FR8 — riskiest assumption) Run the architect persona against a PR #434 / extension-contract-spaces artefact that the original reviewer subagent had **already accepted** before F4 / F6 surfaced (e.g. `projects/extension-contract-spaces/reviews/system-design-review.md` at the R2 commit, when `AuthoredContractSpace<TContract>` was committed and the reviewer signed off). Compare two runs: framed (architect persona loaded) vs. unframed (developer default). The framed run **must** surface at least one of the typology-prefix concerns the original reviewer missed — the `Authored*` framing implying a structural distinction that doesn't exist, the `Extension*` framing coupling target-agnostic types to a consumer, or equivalent. If the framed run doesn't surface those concerns, the construction provably *fails to plug the leak this project exists for* — loop back to redesign before populating the rest of the library. Record both outputs and the diff as a project artefact under `projects/agent-personas/assets/`.
- [ ] **AC6.** (covers NFR3, NFR5) The v1 persona set is exactly seven; speculative personas are not authored. The heuristic is documented (priorities-and-responsibilities distinct + materially different execution output) so future maintainers can apply it consistently when admitting v2+ personas.

# Other Considerations

## Security

No security surface — this is local agent tooling and markdown content. No secrets, no network, no auth.

## Cost

No infrastructure cost. The marginal cost is human authoring time (estimated: a few hours per persona doc, ~half a day for the wiring refactor of `/drive-pr-local-review`).

## Observability

The A/B test in AC5 is the project's observability mechanism for whether personas actually shift behaviour. Beyond that, no runtime observability needed (no runtime).

## Data Protection

No personal data; no regulated data. N/A.

## Analytics

N/A.

# References

- **PR #434 (M1 cleanup, extension-contract-spaces)** — the F0–F6 cycle that motivates this work. Reviewer R4 closing observation in `projects/extension-contract-spaces/reviews/code-review.md § M1-cleanup — Round 4`.
- **`.claude/skills/drive-product-discussion/SKILL.md`** — current PM stance, inline.
- **`.claude/skills/drive-design-discussion/SKILL.md`** — current principal-engineer stance, inline.
- **`.claude/skills/drive-pr-local-review/SKILL.md`** — current multi-output skill that needs decomposition.
- **`.claude/skills/drive-orchestrate-plan/SKILL.md`** — current orchestration skill that needs persona declaration.
- **`AGENTS.md` § Golden Rules** — repo conventions referenced by personas.

# Open Questions

The following are implementer-facing degrees of freedom. None of these would change `Context` or the chosen approach; they're design choices the implementer makes during execution.

1. **Persona doc shape (field set / section names).** The spec pins minimum content (stance, priorities, responsibilities, vocabulary cues) but not the exact section names or field set. Candidates to consider in addition: "what this persona treats as obvious vs. worth stating," "what counts as good enough," "out-of-scope for this lens," "interactions with other personas." Default: keep it minimal in v1 (the four named); add fields when a persona-author finds the minimum insufficient. The implementer picks.

2. **Order of execution within v1.** The spec lists requirements but not sequencing. Recommended order — prove the assumption before populating the library, per the AC5 / "validate first" decision:
   1. Author the architect persona doc (the new persona with the most material).
   2. Run the AC5 A/B test against the F4/F6 case (kill the project here if the assumption fails).
   3. Author the remaining six persona docs.
   4. Document the convention (the `drive-agent-personas` skill's `SKILL.md`).
   5. Retrofit existing skills (FR7).
   6. Decompose `/drive-pr-local-review` (FR6).
   The plan (`drive-create-plan` next) settles this.

3. **Tech-lead-as-orchestrator default.** The spec says "typically tech lead" for composite-skill orchestrators. If a future composite skill genuinely needs a different orchestrator persona (e.g. a PM-orchestrated discovery skill), the convention allows it. No default-policing; skill authors choose.
