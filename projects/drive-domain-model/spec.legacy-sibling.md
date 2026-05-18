# Summary

The canonical Drive skill family is built on a fuzzy domain model: "project," "milestone," "task," "plan," and "spec" each get used at multiple scopes, and the canonical skill bodies do not say which scope they mean when. At least one consumer (`prisma-next`) rejected the canonical Linear-sync workflow because of this ambiguity — the Linear ceremony operates on units that aren't pinned, so what gets synced where is unanswerable except by reference to the original author's mental model. This project clarifies Drive's domain model (pulls request → slice → project as a three-level hierarchy with explicit invariants and a triage workflow as the entry point), rewrites the canonical drive-* skill family against the pinned model, and updates the Drive process documentation. Consumer migration is a per-consumer follow-up driven by `drive-reconcile-skills`, not in scope here.

# Context

## At a glance

The drive-context-convention work (PR [#93](https://github.com/prisma/ignite/pull/93), branch `add-drive-qa-skills`) introduced the per-skill-family `drive/<category>/README.md` convention and shipped supporting skills for bootstrap, reconcile, and update. Its audit (`projects/drive-context-convention/audit/`) walked every curated canonical drive-* skill plus two consumer projects (`prisma-next`, `pdp-control-plane`) to identify project-specific content that should be extracted. The synthesis recommended several push-down and extraction moves, plus a "two-tier Linear ceremony" refinement to address Prisma Next's rejection of the canonical Linear workflow.

> **On-disk state at handover:** since the audit ran, `origin/main` advanced to `a8dd1ba` (skills README rewrite). Three changes affect references below:
>
> - `drive-code-review` was renamed to `drive-review-code` (new `<scope>-<verb>-<noun>` naming taxonomy in `skills/README.md`).
> - A new `.system/` skill bucket exists; `drive-list` was upstreamed there (the pdp consumer audit had flagged it as upstream-worthy).
> - `drive-orchestrate-plan` was promoted from `.experimental/` to `.curated/`.
>
> Audit files predate these changes and were not updated; the spec, model, and handover use current names.

The user then pushed back: the rejection wasn't "ceremony too heavy" but "units too fuzzy." `drive-create-plan` operates simultaneously on plans for "this small fix," "this stacked-PR sequence," and "this multi-week feature" — and the canonical's "milestone"/"task"/"plan"/"spec" vocabulary floats across those scopes without anchor. The fix isn't to make Linear ceremony opt-in. The fix is to define the units precisely so the ceremony lands somewhere obvious.

The model the user proposed:

- **The pull request is the forcing unit.** It has a natural size cap (debuggable, deployable, rollback-able).
- **A slice is one PR-sized unit of work** (terminology chosen over `task` for ubiquitous-language reasons). Has its own spec and plan. The agent's internal step decomposition is below the Drive-care line.
- **A project is a composition of slices under a single overarching purpose.** May contain one slice or many; slices may stack or run in parallel.
- **A triage workflow** is run at every entry point and decides slice-vs-project. Driven by the **agile orchestrator** persona. Currently absent from canonical Drive.

The pinned domain model lives at `projects/drive-domain-model/model.md` and incorporates a DDD + agile-specialist pass: bounded contexts, three-role collapse, workflows-not-events, explicit definition of done, the triage / orphan-slice persistence concession, and a one-tier Linear sync via an anti-corruption layer. The handover at `projects/drive-domain-model/HANDOVER.md` is the full conversational backdrop.

```text
┌─────────────────────────────────────────────────────────────┐
│  Triage (agile orchestrator)                                 │
│    "slice in existing project" / "orphan slice" / "project"  │
└─────────────────────────────────────────────────────────────┘
       │                  │                    │
       ▼                  ▼                    ▼
  Slice initiation   Slice initiation   Project initiation
  (in-project)       (orphan)           (project owner)
       │                  │                    │
       │                  │                    ▼
       │                  │                Project plan
       │                  │                (slices it into…)
       │                  │                    │
       ▼                  ▼                    ▼
  Slice execution → Slice review → Slice closure → next slice
                                                  or project closure
```

## Problem

### Fuzzy units make canonical workflow rejection rational

Today's `drive-create-plan` produces "a plan" that may be project-scope (composes multiple PRs), task-scope (a single PR-sized unit, but with its own "milestone" sub-structure), or somewhere between. The canonical body doesn't say which; the operator picks a scope by reading the situation, and the next agent or operator picks differently. The Linear sync workflow piles on top, prescribing milestone-creation, status-updates, state-discipline, and per-milestone naming conventions — but operating on the floating "milestone" unit, which means the sync doesn't land predictably. The Prisma Next team responded by deleting the parts they couldn't make sense of: `<State> M<N>:` naming, `*Outcomes*` blocks, the pipeline-shape taxonomy, per-milestone `save_status_update` calls, the no-estimates rule. The result is a parallel canonical that survives in their `.agents/skills/` but doesn't flow back to ignite.

### Canonical's project-shape gravity coerces work into project-scope

The existing canonical's only documented start path is via `drive-create-project`, which produces a `projects/<name>/` directory with `spec.md`, `plan.md`, and supporting structure. Bug fixes and one-line changes don't need this overhead but get it anyway, because the tooling has no lightweight path. Operators rationalise their small work as a project to use the tooling, and the result is project bloat — directories that should have been a PR description.

### The "milestone" word floats

`drive-create-plan` uses `milestone` for both "a slice of a multi-PR project" and "a sub-section inside a single-PR task." Both are used in the same template, sometimes within the same example. The word has no fixed denotation in the canonical; the operator picks one each time. Under the new model, `milestone` either retires (becoming synonymous with `slice`) or pins to one scope, but the floating status must end.

### Domain events vs workflows is the wrong frame for an agile process

An earlier DDD pass enumerated 11 domain events (`ProjectStarted`, `SliceAdded`, `SliceSpecified`, etc.) as the primary vocabulary. The user pushed back: agile project management is workflow-shaped, not event-shaped. Operators don't think "now I'm emitting a `SliceSpecified` event"; they think "now I'm writing the spec for this slice." Workflows are the right primary vocabulary; events fall out as workflow consequences.

## Approach

### Pin the model first

The full pinned model lives in `projects/drive-domain-model/model.md`. Key shape:

- **Ubiquitous language**: PR, slice, project, project spec, slice spec, project plan, slice plan, purpose statement, scope boundary, definition of done, stack, parallel.
- **Three roles**: project owner (purpose + scope; non-fungible; human only), implementer (writes slice spec + plan + executes + opens PR; human or agent), reviewer (reviews PR; distinct from implementer).
- **One persona**: agile orchestrator (drives triage and project closure; worn by whichever human or agent is currently running scope discipline).
- **Seven workflows**: triage, project initiation, slice initiation, slice execution, slice review, slice closure, project closure. Triage runs both at entry (new ticket) and mid-flight (surfaced work).
- **Two aggregate roots**: project (owns project spec, project plan, slice references), slice (owns slice spec, slice plan, PR reference, state).
- **Nine invariants** (I1–I9 in the model). The load-bearing ones: one slice → one PR (I1); project scope bounded by project spec (I2); purpose statement immutable after first slice starts (I7); every slice and every project has an explicit definition of done (I8, I9).
- **Per-context persistence**: orphan slices may live inline in the PR description with no on-disk artefact; in-project slices live under a lighter shape than today's project directory; projects keep today's directory shape.

### Restructure the canonical drive-* skill family

Once the model is pinned, the canonical skill family is rewritten to use the model consistently:

- **Triage skill (new)**: runs the triage workflow at any entry point. Driven by the agile orchestrator persona. Decides slice-vs-project; routes to the right next workflow. Working name: `drive-triage-work` (aspirationally compliant with the `<scope>-<verb>-<noun>` taxonomy in `skills/README.md`). See OQ7.
- **`drive-create-spec`** and **`drive-create-plan`**: become scope-typed. Either split into project-scope and slice-scope variants, or take a scope flag at invocation time (working lean: take a scope flag; fewer skills to maintain).
- **`drive-create-project`**: stays. Operates only at project scope.
- **`drive-close-project`**: stays. Operates only at project scope.
- **`drive-orchestrate-plan`** (now in `.curated/` since `a8dd1ba`): becomes slice-scope only. One slice, one orchestrated loop, one PR. Multi-slice projects run the orchestrator once per slice.
- **`drive-pr-description`, `drive-pr-walkthrough`, `drive-review-code`**: stay; already slice-scope.
- **`drive-create-deployment-plan`**: stays; project-scope.
- **`drive-post-update`**: stays; project-scope.
- **`drive-list`** (in `.system/` since `a8dd1ba`): cross-cutting; no scope binding. Stays.

The detailed restructuring plan is produced as part of this project's deliverables (see Acceptance Criteria AC4).

### Rewrite the Drive process documentation

`docs/engineering/drive-process.md` is rewritten to teach the model:

- Ubiquitous language section.
- Roles + personas.
- Workflows (with the triage workflow front-and-centre).
- Invariants.
- Definition-of-done treatment at both scopes.
- Per-context persistence shape (orphan slice → inline; in-project slice → light directory; project → full directory).
- Linear sync via the anti-corruption layer (one-tier, falls out of the slice/project unit).

The existing Drive process content (Skill Map, the convention section landed in PR #93) is preserved; the model content is layered on rather than replacing.

### Hand off to consumers

Each consumer adopts on its own schedule via `drive-reconcile-skills` (already shipped in PR #93). Their drift either lifts to consumer READMEs (per the drive-context-convention) or is dropped as stale. Per-consumer migration is *not* in scope for this project; the deliverable is canonical-side only.

### Audit follow-up

The drive-context-convention audit (`projects/drive-context-convention/audit/`) produced 11 audit files + a synthesis. Most of the synthesis's findings carry forward under the new model with re-framing:

- The Linear-vocabulary push-down candidate (slice ↔ Linear-issue translation) becomes part of the anti-corruption layer design.
- The "research before asking" canonical operating rule push-down stays as a separate small canonical edit.
- The subagent-permissions rule, dynamic-remote resolution in `drive-pr-description`, additive-phrasing guidance in `drive-pr-walkthrough`, and similar pure-improvement candidates stay as separate small canonical edits.
- The "two-tier Linear ceremony" recommendation is *replaced* by the model's one-tier slice/project unit.
- The "role-naming for sibling-skill references" and "frontmatter `requires:` field" recommendations from the synthesis are withdrawn (user clarified: we don't support skill renaming; the persona-installation dependency was version drift).

The re-framed audit is folded into the canonical skill rewrite, not maintained as a separate document.

# Requirements

## Functional Requirements

- **FR1.** A pinned domain model exists at `projects/drive-domain-model/model.md` covering ubiquitous language, roles, personas, workflows (including triage), aggregates, invariants, scope discipline, and per-context persistence shape. The model is the source of truth referenced by every canonical drive-* skill.
- **FR2.** The canonical drive-* skill family is rewritten to use the model's vocabulary and to declare each skill's scope (project, slice, or scope-flag-parameterised). No canonical skill body uses "milestone" or "task" in their pre-model senses; both are either retired or re-pinned to a single meaning.
- **FR3.** A new canonical skill (`drive-triage` or equivalent) runs the triage workflow at any entry point. Driven by the agile orchestrator persona. Outputs a slice-vs-project decision and routes to the next workflow.
- **FR4.** Orphan slices (slices without a parent project) have a lightweight invocation path that does not require a `projects/<name>/` artefact. The slice spec may live in the PR description; the slice plan may live in the implementer's working memory or in the PR description's checklist.
- **FR5.** The Drive process documentation (`docs/engineering/drive-process.md`) is rewritten to teach the pinned model: ubiquitous language, roles + personas, workflows, invariants, definition-of-done, persistence shape, Linear sync.
- **FR6.** The synthesis findings from the drive-context-convention audit are re-framed against the pinned model. Findings that survive (push-down candidates, pure improvements) land as canonical edits during the skill rewrite. Findings that don't survive (two-tier Linear ceremony, role-naming refactor, frontmatter `requires:`) are documented as deprecated in `projects/drive-context-convention/audit/SYNTHESIS.md`.

## Non-Functional Requirements

- **NFR1.** The model is pinned through user-collaborative iteration. The next agent does not unilaterally adopt or refine the model — it surfaces drafts and converges with the user.
- **NFR2.** The canonical skill rewrite ships in per-skill PRs, not as an omnibus. Each PR carries one or a few related skills and references this spec.
- **NFR3.** No consumer's currently-installed drive-* skill copy is broken silently. Consumers adopt the new canonical on their own schedule via `drive-reconcile-skills`. The reconcile-skills auto-classification is calibrated to surface any model-incompatible drift as upstream-worthy with `(?)` confidence rather than silently extracting.
- **NFR4.** The Drive process documentation rewrite preserves existing content (skill map, convention section landed in PR #93) and layers the model on top. The PR #93 work is not relitigated.
- **NFR5.** Ubiquitous-language discipline holds in the canonical bodies. No floating use of "milestone," "task," "plan," "spec" without scope. A scope-typed term is used everywhere ("slice," "project plan," "slice spec," etc.). A grep across canonical bodies for the deprecated vocabulary should return empty after the rewrite.

## Non-goals

- **Consumer migration.** Each consumer adopts on its own schedule via `drive-reconcile-skills`. The deliverable here is canonical-side only.
- **Linear sync mechanism design.** This project pins the unit (slice ↔ Linear issue, with TBD whether milestone is in play); the actual MCP-tool-call shape is downstream and may be its own follow-up project.
- **The "where does scope-deferred work go?" question.** Acknowledged-but-tabled in the model. The model captures the principle (out-of-scope work doesn't expand the project); the landing pad is a follow-up.
- **Rewriting the convention's audit reports.** They stay as historical artefacts; only the synthesis is updated with re-framing notes.
- **Adopting the new model for the convention work itself.** PR #93's machinery is fine under either model and ships as-is.

# Acceptance Criteria

- [x] **AC1 (drafted).** `projects/drive-domain-model/model.md` has been rewritten to incorporate ubiquitous language (slice everywhere; no `task`), three roles + agile-orchestrator persona, seven workflows (with triage as the load-bearing first), two aggregate roots, nine invariants, scope-discipline rule, per-context persistence shape, one-tier Linear sync, and updated open questions. **User sign-off is still pending** — flip the box closed once the user has reviewed and approved. Covers FR1.
- [ ] **AC2.** A skill restructuring plan exists at `projects/drive-domain-model/skill-restructure.md` (or as a section of this spec). It enumerates every existing canonical drive-* skill across all three buckets (`.curated/`, `.experimental/`, `.system/`) and proposes one of: stays-as-is / split-by-scope / takes-scope-flag / renamed / new / retired. The plan references the model's vocabulary throughout. Covers FR2 (planning).
- [ ] **AC3.** The new triage skill exists at `skills/.experimental/drive-triage-work/SKILL.md` (or final location and name TBD per OQ7). Implements the triage workflow per the model. Has Workflow, Pitfalls, Checklist sections per the existing skill template. Wired to the convention's `drive/<category>/README.md` if applicable. Covers FR3.
- [ ] **AC4.** Each canonical drive-* skill that needs rewriting (per AC2) has been rewritten in a separate PR. Each PR's body references this spec and the relevant model.md section. PRs are independently reviewable. Covers FR2 (execution), NFR2.
- [ ] **AC5.** A grep across canonical drive-* skill bodies for floating-scope vocabulary (`\bmilestone\b`, `\btask\b` in its pre-model sense) returns only matches inside explicit deprecation notices or model-teaching examples. Covers NFR5.
- [ ] **AC6.** The orphan-slice path is exercised end-to-end: a bug-fix-scale entry point runs through `drive-triage` → orphan slice initiation → execution → review → closure, producing exactly one PR with the slice spec inline in the PR description and no `projects/<name>/` artefact. Covers FR4.
- [ ] **AC7.** `docs/engineering/drive-process.md` is rewritten to teach the model. The PR #93 content (Skill Map, "Project context for drive skills" section) is preserved and integrated into the new shape rather than replaced. Covers FR5, NFR4.
- [ ] **AC8.** `projects/drive-context-convention/audit/SYNTHESIS.md` carries a header / footer / annotation explaining that several of its Tier 1 recommendations were superseded by the model-clarification work, with pointers to this project and its successor canonical edits. Audit reports themselves stay unmodified. Covers FR6.

# Other Considerations

## Security

N/A — developer-tooling and documentation change. No new credentials, secrets, or user-data surfaces. The new `drive-triage` skill is read-only with respect to the codebase (it reads tickets, specs, project state; it does not modify code).

## Cost

N/A — no production infrastructure. Operating cost is operator + agent time invested in adopting the new model. Per-PR canonical rewrites are reviewed individually; the project as a whole is sized in the high tens of agent-hours plus several rounds of user review.

## Observability

The new `drive-triage` skill, like other drive-* skills, prints per-run summaries (the slice-vs-project decision, the routed-to workflow, any scope-deferred candidates). No metrics, logs, or alerts. If adoption stalls, the convention's `drive-reconcile-skills` output already surfaces drift signal that can be tracked at the consumer level.

## Data Protection

N/A — no personal or regulated data flows through any surface introduced here.

## Analytics

N/A — see Observability.

## Migration risk

The canonical skill rewrite is breaking: consumers who haven't yet adopted the drive-context-convention will see their next `npx skills update` produce significant churn. Mitigation: the rewrite ships per-skill, each with its own PR; consumers can opt to delay adoption skill-by-skill. Each canonical PR's description lists the model concepts it depends on so consumers can decide whether to adopt now or wait.

# References

- `projects/drive-domain-model/HANDOVER.md` — exhaustive handover document; read first.
- `projects/drive-domain-model/model.md` — pinned domain model (source of truth for AC1).
- `projects/drive-context-convention/spec.md` — predecessor convention's spec, including the "Design refinements surfaced by the audit" section that points at this work.
- `projects/drive-context-convention/audit/SYNTHESIS.md` — audit synthesis that surfaced the model question. Several Tier 1 recommendations are superseded here (see AC8). Note that audit files reference `drive-code-review`; its current name on `main` is `drive-review-code`.
- `projects/drive-context-convention/audit/consumer-prisma-next.md` — the consumer drift report that most directly motivated this work (Prisma Next's rejection of canonical's Linear-coupled plan-on-disk shape).
- `projects/drive-context-convention/audit/consumer-pdp-control-plane.md` — the lighter-drift consumer; useful for negative-result calibration.
- `projects/drive-context-convention/audit/drive-create-plan.md` — the per-skill audit most relevant to the model question (heaviest plan-on-disk-to-Linear findings).
- `docs/engineering/drive-process.md` — the canonical Drive process doc; rewritten as AC7.
- `skills/README.md` — naming taxonomy (`<scope>-<verb>-<noun>`) and lifecycle stages (Plan / Execute / Review / Ship) the model layers on top of.
- `skills/.curated/drive-*/SKILL.md`, `skills/.experimental/drive-*/SKILL.md`, `skills/.system/drive-*/SKILL.md` — the canonical skill family across three buckets, rewritten per AC4.
- [Ignite PR #93](https://github.com/prisma/ignite/pull/93) — the drive-context-convention machinery this project builds on top of.

# Open Questions

1. **Linear unit for a slice — issue or milestone?** Both Linear units have similar shapes (description, status, links). The choice affects the anti-corruption layer between Drive Planning and the Tracker context. **Working position:** Linear issue (more universal; less constrained semantics; matches how both audited consumers currently use Linear). Pin in the canonical rewrite of `drive-create-plan` / `drive-triage`.
2. **What enforces I1 (one slice → one PR)?** Candidates: operator discipline; a watchpoint in the orchestrator that surfaces "should we split?" mid-execution when a slice approaches size cap; a hard gate in slice-closure. **Working position:** orchestrator watchpoint + operator discipline; no hard gate (operator has final say).
3. **What enforces I2 (project scope doesn't expand)?** **Working position:** the triage workflow itself enforces this — every time new work surfaces, triage re-reads the project spec to make the in-or-out call. `drive-triage` is the enforcement point.
4. **Where does scope-deferred work go?** Acknowledged-but-tabled in the model. Candidates: `projects/<project>/deferred.md` during a project; routed at project closure (each item triaged individually); some become candidate-projects in a separate register; some are intentionally dropped. **Working position:** route at project closure; no silent loss; landing pad is per-consumer (declared in `drive/project/README.md` if needed).
5. **Exact persistence shape for in-project slices.** **Working position:** `projects/<project>/slices/<slice>/spec.md` + `plan.md`. Mirrors the project's structure at smaller scale; supports more than one artefact per slice.
6. **Should `drive-create-spec` and `drive-create-plan` split or take a scope flag?** **Working position:** scope flag (fewer skills to maintain; the body is largely the same with a few scope-conditional sections). Pin during the restructuring plan (AC2).
7. **Name for the triage skill.** Candidates: `drive-triage`, `drive-triage-work`, `drive-triage-entry`, `drive-intake-work`, `drive-route-work`. The `skills/README.md` naming taxonomy prescribes `<scope>-<verb>-<noun>` for curated skills (aspirational, not enforced). **Working position:** `drive-triage-work` — aspirationally compliant; `work` is the natural noun for the thing being triaged. Bare `drive-triage` is acceptable but reads incomplete against the taxonomy.
8. **Migration path for existing in-flight Drive projects.** Today's `prisma/ignite` itself has the drive-context-convention work mid-flight under the old model. **Working position:** retroactively reshape only if there's a clear payoff; let existing in-flight artefacts age out under the old model; new projects use the new model.
9. **How is the project spec written when full scope isn't knowable yet?** **Working position:** the project spec is written in two passes — purpose statement fixed in the first pass (immutable per I7); scope boundary sharpened in later passes as slices deliver. Document this explicitly in the rewritten `drive-create-project` workflow.
10. **What happens to "milestone" as a word?** **Working position:** retire it from Drive vocabulary entirely. The Linear-side word `milestone` may still appear as part of the Tracker context's vocabulary, but Drive never uses it for its own units. Add to the deprecation grep in AC5.
