# Agent Personas Plan

## Summary

Build a shared agent-persona library — the `drive-agent-personas` skill at `.agents/skills/drive-agent-personas/` — and rewire the existing skill set to declare which persona executes each one. The work plugs the F0–F6-class vocabulary-and-typology leak that surfaced in M1-cleanup of `extension-contract-spaces`. v1 ships seven personas and refactors `/drive-pr-local-review` into a composite + atomic single-persona sub-skills.

**Spec:** `projects/agent-personas/spec.md`

## Collaborators

| Role         | Person/Team   | Context                                                                                                          |
| ------------ | ------------- | ---------------------------------------------------------------------------------------------------------------- |
| Maker        | wmadden       | Drives execution; this is single-human work today                                                                |
| Reviewer     | wmadden       | Same person, post-implementation interactive review (until a second human is involved, the feedback loop is internal) |
| Affected     | Future agents | All current and future skills land in the convention's blast radius once it's documented                          |

## Shipping Strategy

Each milestone is independently safe to land. The implicit gate that keeps existing skills working through the entire rollout is **the developer-as-default rule**: a skill without an explicit "Adopt the `<id>` persona" instruction executes as `developer`, which is the agent's current default behaviour. Nothing in v1 forces existing skills to opt in; retrofits in M3 are additive (replace inline stance with a persona reference; preserve observable behaviour).

- **M1** lands the architect persona + minimal `drive-agent-personas` scaffold (just enough to resolve one persona ID). No existing skill is touched. If the M1 A/B test fails, the project halts here with no externalised behaviour to roll back.
- **M2** populates the library and completes the convention doc. Still nothing wired in — the library exists but is opt-in.
- **M3** retrofits three existing skills and decomposes `/drive-pr-local-review`. Each retrofit preserves observable behaviour (the persona doc *is* the inline stance, factored out and pointed at by ID). The decomposition replaces a multi-output skill with a composite that produces the same three artefacts.

There are no feature flags. The implicit gate is the load instruction in the skill body — present means "use this persona," absent means "use developer default" (which is what every skill does today).

## Test Design

Verification is manual / qualitative — this work produces markdown skill content, not code. There is no typecheck/test/lint command set; the gates are A/B comparisons, cold-read smoke checks, and E2E runs of the affected skills.

| AC   | TC    | Test Case                                                                                                                                                                                                                                  | Type   | Milestone | Expected Outcome                                                                                                                                                          |
| ---- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-5 | TC-1  | A/B test: invoke the existing (pre-decomposition) `/drive-pr-local-review` skill on PR #434 / extension-contract-spaces *at the R2 commit* (`68ebbeb25`, when `AuthoredContractSpace<TContract>` was committed and the original reviewer signed off). Constrain the invocation to produce *only* `system-design-review.md` (skip code-review and walkthrough). Run twice with identical inputs — once instructed to adopt the `architect` persona for the system-design-review portion, once unframed (developer default). Compare the two `system-design-review.md` outputs. Same skill, same input, same target artefact, only the persona framing differs. | Manual | M1        | The framed run surfaces at least one of the typology-prefix concerns the original reviewer missed (the `Authored*` framing implying a non-existent structural distinction, the `Extension*` framing coupling target-agnostic types, or equivalent). The unframed run does not. |
| AC-1 | TC-2  | Inventory: all seven persona files exist under `.agents/skills/drive-agent-personas/personas/` with the agreed IDs (`architect`, `pm`, `principal-engineer`, `tech-lead`, `developer`, `devrel`, `oss-specialist`).                          | Manual | M2        | Seven files present; no extra; IDs match.                                                                                                                                  |
| AC-1 | TC-3  | Each persona doc encodes the minimum content: stance directive, priorities, responsibilities, vocabulary cues. Read each cold and check.                                                                                                    | Manual | M2        | Every doc has all four; the section structure is uniform across the seven (per the doc-shape decision in Task 2.1).                                                        |
| AC-1 | TC-4  | Cold-read distinctness: hand each persona doc to a fresh reader (or self with a clean buffer), ask them to identify the lens. Each doc must read as a *distinct* identity from the others.                                                  | Manual | M2        | Reader can summarise each persona's lens in one sentence and articulate what differentiates it from the other six.                                                        |
| AC-2 | TC-5  | `drive-agent-personas` SKILL.md content review: explains what a persona is, lists the seven IDs, defines the resolution mechanism (`load personas/<id>.md`), states the developer-as-default rule, documents the heuristic for admitting v2+ personas. | Manual | M2        | All five elements present; reader can apply the heuristic to a new candidate persona without further guidance.                                                            |
| AC-2 | TC-6  | Convention legibility: a skill author reading the SKILL.md cold can correctly add a persona instruction to a new skill, by ID, without seeing any path.                                                                                     | Manual | M2        | The author writes the correct one-line instruction (e.g. `Adopt the architect persona (see the drive-agent-personas skill).`) on the first try.                            |
| AC-3 | TC-7  | `drive-design-discussion/SKILL.md` adopts `principal-engineer` and removes the inline stance directive (delegates to the persona doc).                                                                                                       | Manual | M3        | Grep finds the load instruction; the inline stance paragraph is replaced with the reference.                                                                              |
| AC-3 | TC-8  | `drive-product-discussion/SKILL.md` adopts `pm` and removes the inline stance directive.                                                                                                                                                     | Manual | M3        | As above for PM.                                                                                                                                                          |
| AC-3 | TC-9  | `drive-orchestrate-plan/SKILL.md` adopts `tech-lead` (orchestrator persona).                                                                                                                                                                | Manual | M3        | Grep finds the load instruction at the top of the skill body.                                                                                                              |
| AC-3 | TC-10 | Behaviour smoke: re-run `drive-design-discussion` on a small design topic post-retrofit. The interactive loop, response shape, and probing style match pre-retrofit behaviour (the persona reference is a re-routing, not a rewrite).         | Manual | M3        | Output is observably the same shape as before retrofit; no regression in stance.                                                                                          |
| AC-4 | TC-11 | `drive-pr-local-review/SKILL.md` is now a composite: adopts `tech-lead`, delegates in order to `/review-system-design`, `/review-implementation`, `/review-walkthrough`.                                                                      | Manual | M3        | Skill body lists the three sub-skills with their personas; no review logic is duplicated in the composite.                                                                |
| AC-4 | TC-12 | Each atomic sub-skill (`review-system-design`, `review-implementation`, `review-walkthrough`) loads its own persona (`architect`, `principal-engineer`, `tech-lead` respectively).                                                            | Manual | M3        | Each SKILL.md has the load instruction at the top; each is single-purpose.                                                                                                |
| AC-4 | TC-13 | E2E: run the new composite `/drive-pr-local-review` on a real branch (PR #434 is the obvious target). It produces `system-design-review.md`, `code-review.md`, `walkthrough.md` next to each other in the artefact directory.                | E2E    | M3        | All three artefacts exist; format unchanged; quality at parity or better than the pre-decomposition shape.                                                                |
| AC-6 | TC-14 | Inventory check: only the seven anchored personas exist in v1; no security/release/QA/EM persona files. The heuristic doc names these as deferred and the rule for admitting them.                                                            | Manual | M2        | `ls personas/` returns exactly the seven; SKILL.md heuristic section is unambiguous.                                                                                       |

## Milestones

### Milestone 1: Validate the assumption (kill-the-project gate)

Author the `architect` persona, build a minimal `drive-agent-personas` scaffold sufficient to resolve one persona ID, and run the A/B test that proves (or disproves) that a markdown persona fragment shifts execution behaviour measurably.

This milestone exists to fail fast. If TC-1 fails, the entire project halts here — no second persona is authored, no skills are retrofitted, no `/drive-pr-local-review` is decomposed. The library shape and the convention are deferred until the construction is proven to work on the case it exists to solve.

**Tasks:**

- [ ] **Task 1.1.** Decide the persona doc shape (sections / fields) — at minimum: stance directive, priorities, responsibilities, vocabulary cues. Write the decision as a short memo at the top of the architect persona doc, or as a `personas/_shape.md` reference. The shape applies uniformly to all seven personas in M2. (Resolves spec Open Question #1.)
- [ ] **Task 1.2.** Author `.agents/skills/drive-agent-personas/personas/architect.md`. Encode the stance described in the spec (DDD / Clean / SOLID / ubiquitous language / bounded contexts / typology coherence) plus priorities, responsibilities, and vocabulary cues. (Sets up TC-1.)
- [ ] **Task 1.3.** Author a minimal `.agents/skills/drive-agent-personas/SKILL.md` scaffold — just enough to resolve a single persona ID by `id → personas/<id>.md` and document what a persona is. The full convention (heuristic, full ID list, developer-default rule) lands in M2 / Task 2.3. (Sets up TC-1.)
- [ ] **Task 1.4.** Run the A/B test (satisfies TC-1). Use the **existing pre-decomposition** `/drive-pr-local-review` skill as the test harness (do not pre-build atomic sub-skills — that's M3 work). Invoke it twice against PR #434 / extension-contract-spaces at commit `68ebbeb25`, constraining each run to produce *only* `system-design-review.md` (skip code-review and walkthrough). Run A: instruct the skill to adopt the `architect` persona (load `personas/architect.md` from `drive-agent-personas`) for the system-design-review portion. Run B: same invocation, no persona instruction (developer default). Same skill, same input, same target artefact — only persona framing differs, so the comparison is clean. Capture both `system-design-review.md` outputs verbatim and record the diff + verdict in `projects/agent-personas/assets/m1-architect-ab-test.md` against the AC-5 expected outcome. **Decision task** — proceeds to M2 only on PASS; on FAIL, halt and revisit the spec's Approach.

**Validation gate (manual):**

- TC-1 captured in `projects/agent-personas/assets/m1-architect-ab-test.md` with verdict PASS (the framed run surfaces at least one typology-prefix concern the original reviewer missed; the unframed run does not).
- Architect persona doc and the minimal SKILL.md scaffold exist at the pinned paths.
- No existing skill is modified at this milestone.

### Milestone 2: Populate the library + document the convention

Author the remaining six persona docs and complete the `drive-agent-personas` SKILL.md so the convention is fully documented and the library is ready for skill authors to adopt. Library is opt-in — no existing skill is wired in until M3.

**Tasks:**

- [ ] **Task 2.1.** Author `personas/pm.md`. Refine and decouple the PM stance currently inlined in `drive-product-discussion`. (Satisfies TC-2, TC-3, TC-4.)
- [ ] **Task 2.2.** Author `personas/principal-engineer.md`. Refine and decouple the principal-engineer stance currently inlined in `drive-design-discussion`. (Satisfies TC-2, TC-3, TC-4.)
- [ ] **Task 2.3.** Author `personas/tech-lead.md`. Stance: orchestration (selecting reviewers/implementers, surfacing conflicts, not adjudicating). (Satisfies TC-2, TC-3, TC-4.)
- [ ] **Task 2.4.** Author `personas/developer.md`. Explicit default. The persona that runs when no other is named. Frame: implementer who synthesises the other personas' concerns into the artefact; absorbs unstated baseline. (Satisfies TC-2, TC-3, TC-4.)
- [ ] **Task 2.5.** Author `personas/devrel.md`. Stance: adopter learnability; docs, glossary, editing style, fresh-reader experience. (Satisfies TC-2, TC-3, TC-4.)
- [ ] **Task 2.6.** Author `personas/oss-specialist.md`. Stance: contributor experience, license, governance, public-surface stewardship. (Satisfies TC-2, TC-3, TC-4.)
- [ ] **Task 2.7.** Complete `drive-agent-personas/SKILL.md`: (1) explain what a persona is and how it shifts execution-time defaults, (2) list the seven persona IDs and what each is for, (3) define the resolution mechanism (load `personas/<id>.md` when asked to adopt `<id>`), (4) state the `developer`-as-default fallback rule, (5) document the heuristic for admitting v2+ personas (priorities-and-responsibilities distinct + materially different execution output) and which roles are deferred (security, release manager, QA, EM-absorbed-by-tech-lead). (Satisfies TC-5, TC-6, TC-14.)

**Validation gate (manual):**

- TC-2: `ls .agents/skills/drive-agent-personas/personas/` returns exactly seven `.md` files matching the agreed IDs.
- TC-3, TC-4: Cold-read of each persona doc by the maker confirms the four required content blocks are present and the lens is identifiable.
- TC-5, TC-6, TC-14: The SKILL.md is complete; reading it cold, a skill author can write a correct persona instruction on the first try; the heuristic and deferral list are explicit.

### Milestone 3: Retrofit existing skills + decompose `/drive-pr-local-review`

Wire existing skills to the library and prove multi-persona composition by decomposing the multi-output `/drive-pr-local-review` into atomic single-persona sub-skills behind a tech-lead-orchestrated composite.

**Tasks:**

- [ ] **Task 3.1.** Retrofit `drive-design-discussion/SKILL.md` to adopt `principal-engineer`. Replace the inline "Core directive" stance paragraph with the load instruction (`Adopt the principal-engineer persona (see the drive-agent-personas skill).`). Confirm the persona doc carries the same stance content; if not, reconcile in `personas/principal-engineer.md` rather than leaving the duplicate inline. (Satisfies TC-7, partial TC-10.)
- [ ] **Task 3.2.** Retrofit `drive-product-discussion/SKILL.md` to adopt `pm`. Same pattern as Task 3.1 — drop the inline stance, point at the persona doc. (Satisfies TC-8, partial TC-10.)
- [ ] **Task 3.3.** Retrofit `drive-orchestrate-plan/SKILL.md` to adopt `tech-lead`. (Satisfies TC-9, partial TC-10.)
- [ ] **Task 3.4.** Decompose `drive-pr-local-review` into:
  - A composite `drive-pr-local-review/SKILL.md` that adopts `tech-lead` and delegates in order to the three atomic sub-skills.
  - `review-system-design/SKILL.md` (atomic, adopts `architect`) — produces `system-design-review.md`.
  - `review-implementation/SKILL.md` (atomic, adopts `principal-engineer`) — produces `code-review.md`.
  - `review-walkthrough/SKILL.md` (atomic, adopts `tech-lead`) — produces `walkthrough.md` (audience: human-operator touring a multi-thousand-LOC PR; balance detail vs. high-level concerns from architect/engineer/etc.).
  Each atomic sub-skill is single-purpose; no review logic is duplicated in the composite. (Satisfies TC-11, TC-12.)
- [ ] **Task 3.5.** E2E smoke: run the new composite `/drive-pr-local-review` against PR #434 (the same branch that produced the F0–F6 cycle — natural test bed). Confirm the three artefacts exist next to each other and quality is at parity with the pre-decomposition shape. (Satisfies TC-13.)
- [ ] **Task 3.6.** Behaviour smoke: re-run one of the retrofitted interactive skills (e.g. `drive-design-discussion`) on a small design topic. Confirm the loop, response shape, and probing style are observably the same as pre-retrofit. (Satisfies TC-10 in full.)
- [ ] **Task 3.7 (close-out).** Verify all six ACs against the artefacts and the M1 / M3 captured outputs. **No `docs/` migration needed** — the durable artefacts are the personas + SKILL.md, which already live at `.agents/skills/drive-agent-personas/` and outlive `projects/`. Strip any repo-wide references to `projects/agent-personas/**` (likely none — this project doesn't add cross-repo links). Delete `projects/agent-personas/`. No Linear ticket linkage in v1 (Linear skipped per Open Item #6).

**Validation gate (manual):**

- TC-7, TC-8, TC-9: grep confirms each retrofitted skill has the persona load instruction at the top of its body and the inline stance paragraph is removed (not duplicated).
- TC-10: behaviour smoke run shows no regression in interactive stance.
- TC-11, TC-12: composite + three atomic sub-skills exist; each atomic skill is single-persona; composite contains no review logic.
- TC-13: E2E run on PR #434 produces all three artefacts at parity.
- AC-3 (composite): the new shape produces the same three artefacts as the pre-decomposition `/drive-pr-local-review` did.

## Open Items

Carried forward from the spec's Open Questions, plus items surfaced during planning.

1. **Persona doc shape (carry-over).** Spec OQ #1 — exact field set / section names beyond the four mandatory blocks (stance, priorities, responsibilities, vocabulary cues). Decided in Task 1.1 and applied uniformly from Task 1.2 onward. Candidate additional fields the implementer may consider: "what this persona treats as obvious vs. worth stating," "what counts as good enough," "out-of-scope for this lens," "interactions with other personas."

2. **Tech-lead-as-default-orchestrator policy (carry-over).** Spec OQ #3 — the convention says "typically tech lead" for composite orchestrators; future composite skills may pick a different orchestrator persona if they need to. No default-policing in v1.

3. **What happens if M1 TC-1 fails.** The plan halts at M1 with no rollback needed (nothing is wired in). Spec Approach is revisited; the project may be cancelled or restructured. Worth being explicit so the maker isn't tempted to push through.

4. **A/B test reproducibility.** TC-1 captures both runs verbatim, but the underlying agent run isn't deterministic. If the result is borderline (framed surfaces *one* concern; unframed surfaces *zero* but only barely), re-run to confirm. Document the runs and the verdict criteria so a future reader can re-evaluate.

5. **Possible scope creep in Task 3.4.** Decomposing `drive-pr-local-review` into a composite + three atomic skills is the largest single surface change in v1. If the existing `drive-pr-local-review` workflow has internal ordering or shared state across the three outputs (e.g. spec-establishment that all three reviewers depend on), the decomposition may surface a small refactor that goes beyond pure single-persona splits. Surface and re-scope if so; don't silently expand.

6. **No Linear project for v1.** This is single-human local-tooling work; surfaces no external collaborator to coordinate with. Skip Linear creation in `drive-create-plan`'s Linear integration step. If a second collaborator joins or the work expands, file a Linear project then.

**Walkthrough persona — settled:** `tech-lead`. Audience is a human operator touring a multi-thousand-LOC PR; the right lens balances architect/engineer/etc. concerns at the right altitude. The binding is convention, not enforced; future reconsideration is allowed but not anticipated.

**Close-out target — settled:** none. Long-lived material is the skills themselves (`.agents/skills/drive-agent-personas/` and the retrofitted skills), which are not under `projects/`. Close-out is just verify-ACs + delete `projects/agent-personas/`.
