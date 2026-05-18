# Spec — Drive domain model + agile orchestration

**Status:** Living. Consolidates two predecessor projects (`drive-domain-model` and `agile-agent-orchestration`) into one effort. See [`design-decisions.md`](design-decisions.md) for the chronological record; [`model.md`](model.md) for the pinned units, workflows, and invariants; [`workflow.md`](workflow.md) for the operational lifecycle map.

## Summary

The canonical Drive skill family has two compounding failure modes:

1. **Fuzzy units.** "Project," "milestone," "task," "plan," and "spec" each get used at multiple scopes, and the canonical skill bodies do not say which scope they mean when. At least one consumer (`prisma-next`) rejected the canonical Linear-sync workflow because of this ambiguity — the Linear ceremony operates on units that aren't pinned, so what gets synced where is unanswerable except by reference to the original author's mental model.
2. **Unbounded dispatches.** Even where the unit is clear, agent dispatches inside a "task" routinely run feature-sized scopes for hours without orchestrator inspection, producing drift that passes validation gates while violating the spec. The cure is classical Agile — sizing discipline, Definition of Ready / Done, WIP-inspection cadence, retros — transposed for agent teams.

This project addresses both. It pins Drive's domain model (PR ← {Slice | Direct change} ← Project + Dispatch + cross-cutting Design discussion, with explicit invariants and a triage workflow as the entry point), threads dispatch-level discipline into the workflows where agent execution happens, restructures the canonical drive-* skill family against the pinned model, rewrites the Drive process documentation, and captures a worked-example calibration (`prisma-next`).

Consumer migration is per-consumer follow-up driven by `drive-reconcile-skills` and is not in scope here.

## Context

### Fuzzy units make canonical workflow rejection rational

Today's `drive-create-plan` produces "a plan" that may be project-scope (composes multiple PRs), task-scope (a single PR-sized unit, but with its own "milestone" sub-structure), or somewhere between. The canonical body doesn't say which; the operator picks a scope by reading the situation, and the next agent or operator picks differently. The Linear sync workflow piles on top, prescribing milestone-creation, status-updates, state-discipline, and per-milestone naming conventions — but operating on the floating "milestone" unit, which means the sync doesn't land predictably. The Prisma Next team responded by deleting the parts they couldn't make sense of: `<State> M<N>:` naming, `*Outcomes*` blocks, the pipeline-shape taxonomy, per-milestone `save_status_update` calls, the no-estimates rule. The result is a parallel canonical that survives in their `.agents/skills/` but doesn't flow back to ignite.

### Canonical's project-shape gravity coerces work into project-scope

The existing canonical's only documented start path is via `drive-create-project`, which produces a `projects/<name>/` directory with `spec.md`, `plan.md`, and supporting structure. Bug fixes and one-line changes don't need this overhead but get it anyway, because the tooling has no lightweight path. Operators rationalise their small work as a project to use the tooling, and the result is project bloat — directories that should have been a PR or even a single commit.

### Agent dispatches drift inside oversized scopes

Independent of the unit problem, agent dispatches run unsupervised at feature-sized scopes. The orchestrator monitors via file-system proxies (commit cadence, file modification rate) rather than reading committed diffs; validation gates pass throughout; drift is invisible until the orchestrator (or operator) reads a specific diff for an unrelated reason; recovery requires unwinding multiple commits' worth of accommodating code. We have observed this failure mode multiple times during the `target-extensible-ir` project (most recently 2026-05-17, captured in `wip/unattended-decisions.md`). Each instance has the same shape, and the cure is structurally identical to the one that drove human Agile teams to adopt small stories + frequent inspection + Definition of Ready / Done.

### The "milestone" word floats

`drive-create-plan` uses `milestone` for both "a slice of a multi-PR project" and "a sub-section inside a single-PR task." Both are used in the same template, sometimes within the same example. The word has no fixed denotation in the canonical; the operator picks one each time.

### Domain events vs workflows is the wrong frame

An earlier DDD pass on the sibling project enumerated 11 domain events (`ProjectStarted`, `SliceAdded`, `SliceSpecified`, etc.) as the primary vocabulary. The user pushed back: agile project management is workflow-shaped, not event-shaped. Operators don't think "now I'm emitting a `SliceSpecified` event"; they think "now I'm writing the spec for this slice." Workflows are the right primary vocabulary; events fall out as workflow consequences.

## Approach

### Pin the model first

The full pinned model lives in [`model.md`](model.md). Shape:

- **Ubiquitous language** with three sized units (Project, Slice, Direct change), a delegation unit (Dispatch), and an artefact (Brief). Step retires to the implementer-internal Execution context.
- **Three roles** (project owner, implementer, reviewer) + **one persona** (agile orchestrator).
- **Eight workflows**: seven lifecycle-stage (triage, project initiation, slice initiation, slice execution, slice review, slice closure, project closure) + one cross-cutting (design discussion).
- **Three aggregate roots**: project, slice, direct change.
- **Twelve invariants** (I1–I12 in `model.md`). The load-bearing ones: one slice / direct change → one PR (I1); project scope bounded by project spec (I2); purpose statement immutable after first dispatch starts (I7); every dispatch / slice / project has a Definition of Done (I8 / I9 / I10); sizing caps apply at two scopes (I11); no silent agent-side amendments after the first dispatch starts (I12).
- **Per-context persistence**: direct changes have no on-disk artefact (intent in the PR body); orphan slices may live inline in the PR description; in-project slices live under `projects/<project>/slices/<slice>/`; projects keep today's directory shape.
- **Two-cap sizing discipline**: triage enforces the PR-cap at slice / direct-change scope; slice planning enforces the M-cap at dispatch scope; slice execution refuses L/XL in defense in depth.
- **One-tier Linear sync** via an anti-corruption layer, with explicit promotion (case-b: ticket → project) and demotion (project → slice / direct change) patterns.

### Thread dispatch-level discipline into the workflows

The methodology layer (Definition of Ready, Definition of Done, brief discipline, WIP-inspection cadence, retro discipline, spike pattern, sizing rules) lives inside the dispatch loop of slice execution, plus the spike-first variant of triage. Skills that own the dispatch loop (`drive-orchestrate-plan`) are augmented to enforce per-dispatch DoR / DoD; planning skills (`drive-project-plan`, `drive-slice-plan`) are responsible for sizing and brief shape.

The methodology decomposes into two layers per [`principles/protocol-as-memory.md`](principles/protocol-as-memory.md):

- **General protocol** (lives in this project; eventually in canonical Drive skills + rules): the universal rules (DoR / DoD shape, WIP-inspection cadence, sizing taxonomy, spike pattern, brief shape). Same across projects.
- **Project calibration** (lives in each adopting repo's docs): reference tasks for t-shirt sizing, project-specific DoD verification gates, failure-mode catalogue, grep library. Varies per project. [`calibration/prisma-next.md`](calibration/prisma-next.md) is the worked example for this repo.

### Restructure the canonical drive-* skill family

Once the model is pinned and the methodology is layered, the canonical skill family is rewritten:

- **Split** `drive-create-spec` into `drive-project-specify` + `drive-slice-specify`. Project-scope and slice-scope inputs / outputs / templates differ meaningfully.
- **Split** `drive-create-plan` into `drive-project-plan` + `drive-slice-plan`. Project-plan composes slices and direct changes; slice-plan composes dispatches with sizing and DoR discipline.
- **Augment** `drive-orchestrate-plan` (slice-scope only): per-dispatch DoR pre-flight; WIP-inspection cadence as a named loop step; per-dispatch DoD post-flight; brief template; L/XL refusal at dispatch time; mandatory design-discussion stop-condition on assumption-falsification.
- **Augment** `drive-close-project`: mandatory final retro step (calls `drive-retro-run`).
- **Promote to first-class** `drive-discussion` (the mode skill): explicit cross-cutting workflow per the model.
- **New** `drive-triage-work`: runs the triage workflow at any entry point AND mid-flight; outputs one of eight triage verdicts; routes to the right downstream workflow.
- **New** `drive-health-check`: project rollup, session-bookended (interactive) or trigger-fired (unattended).
- **New** `drive-retro-run`: runs the retro template; lands the learning in the strong-memory surface (protocol / calibration / ADR).
- **Stay** (with light or no augmentation): `drive-create-project`, `drive-pr-description`, `drive-pr-walkthrough`, `drive-review-code`, `drive-post-update`, `drive-create-deployment-plan`, `drive-list`.

The detailed restructuring plan is produced as part of this project (AC5) and lives in [`skill-restructure.md`](skill-restructure.md) (upcoming).

### Rewrite the Drive process documentation

`docs/engineering/drive-process.md` is rewritten to teach the consolidated model + methodology:

- Ubiquitous language section (including Dispatch + Direct change + Design discussion).
- Roles + personas.
- Workflows (with triage front-and-centre; design discussion as cross-cutting; promotion / demotion patterns).
- Invariants (all twelve).
- Definition-of-Ready / Definition-of-Done treatment at three scopes (dispatch / slice / project).
- Sizing taxonomy + the two caps.
- WIP-inspection cadence.
- Spike pattern + brief discipline.
- Retro pattern.
- Per-context persistence shape.
- Linear sync via the anti-corruption layer (one-tier + promotion + demotion).

The existing Drive process content (Skill Map, the convention section landed in PR #93) is preserved; the consolidated model + methodology is layered on rather than replacing.

### Hand off to consumers

Each consumer adopts on its own schedule via `drive-reconcile-skills` (already shipped in PR #93). Their drift either lifts to consumer READMEs (per the drive-context-convention) or is dropped as stale. Per-consumer migration is *not* in scope for this project; the deliverable is canonical-side only. `prisma-next` is the first adopter and contributes its calibration document back as the worked example.

### Audit follow-up

The drive-context-convention audit (`projects/drive-context-convention/audit/` in the `prisma/ignite` repo, snapshot present locally at `reference/ignite/projects/drive-context-convention/audit/`) produced 11 audit files + a synthesis. Most of the synthesis's findings carry forward under the new model with re-framing:

- The Linear-vocabulary push-down candidate (slice ↔ Linear-issue translation) becomes part of the anti-corruption layer design.
- The "research before asking" canonical operating rule push-down stays as a separate small canonical edit.
- The subagent-permissions rule, dynamic-remote resolution in `drive-pr-description`, additive-phrasing guidance in `drive-pr-walkthrough`, and similar pure-improvement candidates stay as separate small canonical edits.
- The "two-tier Linear ceremony" recommendation is *replaced* by the model's one-tier slice / project / direct-change unit.
- The "role-naming for sibling-skill references" and "frontmatter `requires:` field" recommendations from the synthesis are withdrawn (user clarified: we don't support skill renaming; the persona-installation dependency was version drift).

The re-framed audit is folded into the canonical skill rewrite, not maintained as a separate document.

## Functional Requirements

- **FR1.** A pinned domain model exists at [`model.md`](model.md) covering ubiquitous language (including Dispatch + Direct change + Design discussion), roles, personas, workflows (eight; one cross-cutting), aggregates, invariants (twelve), scope discipline (both directions), per-context persistence shape, two-cap sizing discipline, and one-tier Linear sync (with promotion + demotion patterns). The model is the source of truth referenced by every canonical drive-* skill.
- **FR2.** The canonical drive-* skill family is rewritten to use the model's vocabulary and to declare each skill's scope. No canonical skill body uses "milestone" or "task" in their pre-model senses; both are either retired or re-pinned to a single meaning.
- **FR3.** A new canonical skill (`drive-triage-work`) runs the triage workflow at any entry point AND mid-flight. Driven by the agile orchestrator persona. Outputs one of eight verdicts (direct change / orphan slice / in-project slice / new project / promote / demote / spike first / defer) and routes to the next workflow.
- **FR4.** Direct changes and orphan slices have lightweight invocation paths that do not require a `projects/<name>/` artefact. Direct change: intent in the PR body; no spec / no plan / no dispatch ceremony. Orphan slice: slice spec inline in the PR description; slice plan in the implementer's working memory or the PR's checklist.
- **FR5.** The dispatch-level discipline is operationalised: every dispatch has a Definition of Ready (pre-flight) and a Definition of Done (post-flight) declared in its brief; the WIP-inspection cadence runs during every dispatch; L/XL dispatches are refused by the dispatch loop. Lives inside `drive-orchestrate-plan` augmentation + `drive-slice-plan`.
- **FR6.** A cross-cutting design-discussion workflow is supported via the `drive-discussion` mode skill, promoted to first-class. Trigger points (pre-spec, mid-spec, mid-flight on falsified assumption, mid-flight on obstacle, explicit request) are documented in [`model.md`](model.md) and the rewritten `drive-process.md`. The agile orchestrator is responsible for recognising when to escalate.
- **FR7.** Project promotion (case-b: ticket → new Linear Project) and project demotion (project → slice / direct change) workflows are defined and implementable. Linear ceremony for both is specified in [`model.md`](model.md) § "Linear sync."
- **FR8.** The Drive process documentation (`docs/engineering/drive-process.md`) is rewritten to teach the consolidated model + methodology. The PR #93 work (Skill Map, "Project context for drive skills" section) is preserved and integrated rather than replaced.
- **FR9.** The synthesis findings from the drive-context-convention audit are re-framed against the consolidated model. Findings that survive (push-down candidates, pure improvements) land as canonical edits during the skill rewrite. Findings that don't survive are documented as deprecated in `projects/drive-context-convention/audit/SYNTHESIS.md` (in the `prisma/ignite` repo).
- **FR10.** A worked-example calibration exists at [`calibration/prisma-next.md`](calibration/prisma-next.md), covering reference tasks for t-shirt sizing, DoD verification gates specific to `prisma-next`, failure-mode catalogue, and grep library.

## Non-Functional Requirements

- **NFR1.** The model is pinned through user-collaborative iteration. The agent does not unilaterally adopt or refine the model — drafts are surfaced and converged with the operator.
- **NFR2.** The canonical skill rewrite ships in per-skill PRs (canonical-side, in the `prisma/ignite` repo), not as an omnibus. Each PR carries one or a few related skills and references this spec.
- **NFR3.** No consumer's currently-installed drive-* skill copy is broken silently. Consumers adopt the new canonical on their own schedule via `drive-reconcile-skills`. The reconcile-skills auto-classification is calibrated to surface model-incompatible drift as upstream-worthy with `(?)` confidence rather than silently extracting.
- **NFR4.** The Drive process documentation rewrite preserves existing content (skill map, convention section landed in PR #93) and layers the consolidated model + methodology on top.
- **NFR5.** Ubiquitous-language discipline holds in the canonical bodies. No floating use of "milestone," "task," "plan," "spec," "step" without scope. A grep across canonical bodies for the deprecated vocabulary should return empty after the rewrite.
- **NFR6.** The methodology and the model are extensible by trigger-based recalibration, not periodic. Each significant retrospective (calibration miss, escapee, drift event) prompts a check: protocol update (general lesson) or calibration update (project-specific lesson)? Per [`principles/protocol-as-memory.md`](principles/protocol-as-memory.md).

## Non-goals

- **Consumer migration.** Each consumer adopts on its own schedule via `drive-reconcile-skills`. The deliverable is canonical-side only.
- **Linear sync mechanism design beyond unit mapping.** This project pins the units and the promotion / demotion patterns; the full MCP-tool-call shape (for every transition) may be its own follow-up.
- **Automating the WIP-inspection cadence.** The 5-minute check is an orchestrator-agent ritual, not an automated CI gate. (Automation of specific checks — grep gates, fixture validation — is welcome but separate.)
- **Multi-agent parallel execution semantics.** Addressed when we use it in anger; out of scope for the initial methodology.
- **Eliminating orchestrator judgment.** The protocol provides structural protection; the orchestrator still makes interpretation calls within the structure.
- **Rewriting the convention's audit reports.** They stay as historical artefacts; only the synthesis is updated with re-framing notes.
- **Adopting the new model for the convention work itself.** PR #93's machinery is fine under either model and ships as-is.
- **Scope-deferred work landing pad design beyond the working position.** Per-project `deferred.md` is the working position; refinement is downstream.

## Acceptance Criteria

- [x] **AC1 (drafted).** [`model.md`](model.md) has been rewritten to incorporate the consolidated vocabulary (Slice / Direct change / Dispatch / Brief; Step retired to Execution context; Design discussion as cross-cutting workflow), three roles + agile-orchestrator persona, eight workflows (with triage as the load-bearing first; design discussion as the cross-cutting), three aggregate roots, twelve invariants (incl. two-cap sizing I11 and no-silent-amendments I12), scope discipline in both directions, per-context persistence shape (incl. direct-change row), one-tier Linear sync (incl. promotion + demotion patterns), and updated open questions. **Operator sign-off pending** — flip once reviewed. Covers FR1.
- [ ] **AC2.** [`workflow.md`](workflow.md) is rewritten using the consolidated vocabulary. The lifecycle map shows the seven lifecycle stages + the design-discussion cross-cutting workflow + the cadences + the artefacts at each step. Covers FR1 (operational layer).
- [ ] **AC3.** The principle docs exist under [`principles/`](principles/): `protocol-as-memory.md`, `decomposition-and-cost.md`, `spikes.md` (refreshed for vocabulary); `roles-and-personas.md`, `brief-discipline.md`, `definition-of-ready.md`, `definition-of-done.md`, `retro.md` (new). Each captures the principle plus a template where applicable. Covers FR5, FR6, NFR6.
- [ ] **AC4.** [`calibration/prisma-next.md`](calibration/prisma-next.md) is refreshed with the new vocabulary and adds the missing sections: project-specific DoR additions, failure-mode catalogue's new entries, grep library for `prisma-next` specifically. Covers FR10.
- [ ] **AC5.** A skill restructuring plan exists at [`skill-restructure.md`](skill-restructure.md). It enumerates every existing canonical drive-* skill across all three buckets and proposes one of: stays / augmented / split-by-scope / renamed / new / retired. Specifies the new skills (`drive-triage-work`, `drive-health-check`, `drive-retro-run`, `drive-project-specify`, `drive-project-plan`, `drive-slice-specify`, `drive-slice-plan`) with templates referenced. Covers FR2 (planning), FR3, FR5.
- [ ] **AC6.** The new triage skill exists at `skills/.experimental/drive-triage-work/SKILL.md` (in `prisma/ignite`). Implements the triage workflow per the model — eight verdicts, mid-flight variant for promotion / demotion. Wired to the convention's `drive/<category>/README.md`. Covers FR3.
- [ ] **AC7.** `drive-orchestrate-plan` is augmented with per-dispatch DoR pre-flight, WIP-inspection cadence as a named loop step, per-dispatch DoD post-flight, brief template, L/XL refusal, and design-discussion stop-condition on assumption-falsification. Covers FR5, FR6.
- [ ] **AC8.** Each remaining canonical drive-* skill that needs rewriting (per AC5) has been rewritten in a separate PR (canonical-side). Each PR's body references this spec and the relevant [`model.md`](model.md) section. PRs are independently reviewable. Covers FR2 (execution), NFR2.
- [ ] **AC9.** A grep across canonical drive-* skill bodies for floating-scope vocabulary (`\bmilestone\b`, `\btask\b` in its pre-model sense, `\bstep\b` in its planning-sense pre-model use) returns only matches inside explicit deprecation notices or model-teaching examples. Covers NFR5.
- [ ] **AC10.** The direct-change path is exercised end-to-end: a trivial entry point (copy change, config flip, or one-line fix) runs through `drive-triage-work` → "direct change" verdict → `gh pr create` with intent in the PR body, no on-disk artefact. Covers FR4 (direct change).
- [ ] **AC11.** The orphan-slice path is exercised end-to-end: a bug-fix-scale entry point runs through `drive-triage-work` → orphan slice initiation → execution → review → closure, producing exactly one PR with the slice spec inline in the PR description and no `projects/<name>/` artefact. Covers FR4 (orphan slice).
- [ ] **AC12.** A promotion is exercised end-to-end: a ticket triaged at `drive-triage-work` time as "needs project ceremony" routes through the promotion workflow, producing a new Linear Project with the original ticket moved inside and marked Done. Covers FR7 (promotion).
- [ ] **AC13.** A demotion is exercised end-to-end: a mid-flight project where the remaining scope is one PR routes through the demotion workflow, producing a surviving Linear issue outside the project and the project Cancelled / Completed. Covers FR7 (demotion).
- [ ] **AC14.** `docs/engineering/drive-process.md` (in `prisma/ignite`) is rewritten to teach the consolidated model + methodology. The PR #93 content is preserved and integrated. Covers FR8, NFR4.
- [ ] **AC15.** `projects/drive-context-convention/audit/SYNTHESIS.md` (in `prisma/ignite`) carries a header / footer / annotation explaining that several of its Tier 1 recommendations were superseded by the consolidated work, with pointers to this project. Audit reports themselves stay unmodified. Covers FR9.

## Open Questions

Surviving from the predecessors after consolidation; new ones added below. Resolved questions and their rationale are recorded in [`model.md`](model.md) § "Open questions."

1. **What enforces I1 (one slice / direct change → one PR)?** Working position: agile-orchestrator WIP-inspection during slice execution surfaces "should we split?" mid-flight; no hard gate.
2. **What enforces I2 (project scope doesn't expand)?** Working position: triage itself enforces — every time new work surfaces, mid-flight triage re-reads the project spec to make the in-or-out call.
3. **Scope-deferred work landing pad.** Working position: `projects/<project>/deferred.md` during a project; reviewed at project closure; each item triaged individually. Per-orphan-work: operator scratch.
4. **What enforces I12 (no silent agent-side amendments)?** Working position: orchestrator stop-condition fires on detected drift (per `drive-orchestrate-plan` unattended-mode rules); design discussion produces the amendment with operator participation.
5. **Name for the triage skill.** Working position: `drive-triage-work` — aspirationally compliant with the `<scope>-<verb>-<noun>` taxonomy in `skills/README.md`.
6. **How is the project spec written when full scope isn't knowable yet?** Working position: two passes — purpose statement fixed in the first pass (immutable per I7); scope boundary sharpened in later passes as slices deliver. Design discussion is the mechanism for the second pass.
7. **Stacked PRs in Linear.** Linear has no first-class stacking metadata. Working position: each PR is its own Linear issue; the stack order is recorded in the project plan and in the PR descriptions; Linear sees a sequence of issues without explicit stacking metadata.
8. **N for the unattended-mode "consecutive dispatches without milestone progress" drift alarm in `drive-health-check`.** Working position: calibrate per-project; default to 3.
9. **Demotion authorisation.** Working position: agile orchestrator surfaces a demotion candidate as a structured decision; operator authorises before any Linear cleanup runs.
10. **How does the protocol become machine-readable for an agent orchestrator?** Likely answer: the principles + rituals as a `drive/agile` skill the orchestrator loads automatically; the always-applied invariants (no L/XL dispatch, WIP-inspection cadence, DoR/DoD gates) as a rule that fires when any `drive-*` skill is in play. Pin during skill restructuring.
11. **Migration path for existing in-flight Drive projects.** Today's `prisma/ignite` itself has the drive-context-convention work mid-flight under the old model. Working position: retroactively reshape only if there's a clear payoff; let existing in-flight artefacts age out under the old model; new projects use the new model.

## References

- [`model.md`](model.md) — pinned domain model
- [`workflow.md`](workflow.md) — operational lifecycle map (Drive ↔ Agile)
- [`design-decisions.md`](design-decisions.md) — chronological decisions log
- [`principles/`](principles/) — per-principle deep-dives
- [`calibration/prisma-next.md`](calibration/prisma-next.md) — worked-example calibration
- [`skill-restructure.md`](skill-restructure.md) — proposed skill set with augmentations (upcoming)
- [`plan.md`](plan.md) — execution plan (upcoming)
- `docs/engineering/drive-process.md` (in `prisma/ignite`) — canonical Drive process doc; rewritten as AC14
- `skills/README.md` (in `prisma/ignite`) — naming taxonomy this model layers on top of
- `reference/ignite/skills/` (local) — cloned canonical skill bodies for reading; not committed
- `wip/unattended-decisions.md` — the 2026-05-17 dispatch-drift capture that motivated the methodology half
- [Ignite PR #93](https://github.com/prisma/ignite/pull/93) — the drive-context-convention machinery this project builds on top of
