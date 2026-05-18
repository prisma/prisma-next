# Problem statement: the canonical drive-* skills and the proposed consolidated model

**Audience.** Maintainers and contributors to the canonical `drive-*` skill family in [`prisma/ignite`](https://github.com/prisma/ignite). You can read this without any other doc in this project; pointers to the proposal mechanics are at the end.

**TL;DR.** Two recurring failure modes in today's canonical Drive — *fuzzy units* and *unbounded agent dispatches* — share a structural fix: pin Drive's domain model explicitly, and thread Agile-style dispatch discipline (Definition of Ready / Done, WIP inspection, sizing caps, retros) into the workflows where agent execution happens. We're proposing the model and the discipline, plus the skill-restructure to land them, as a series of small canonical PRs that stack on top of [PR #93](https://github.com/prisma/ignite/pull/93).

## The two failure modes

### 1. Fuzzy units

In the current canonical, the words **project, milestone, task, plan, spec, step** each get used at multiple scopes, and the skill bodies do not say which scope they mean when. `drive-create-plan` produces "a plan" that may be project-scope (composes multiple PRs), task-scope (one PR with sub-milestones), or anywhere between — the operator picks each time, the next operator picks differently. The Linear-sync workflow piles on top, prescribing milestone-creation + status-updates + per-milestone naming — but operating on a floating "milestone" unit, so what gets synced where is unanswerable except by reference to the original author's mental model.

**Concrete evidence.** The `prisma-next` team responded to this by deleting the parts of the canonical Linear-sync they couldn't make sense of: the `<State> M<N>:` naming convention, the `*Outcomes*` blocks, the pipeline-shape taxonomy, the per-milestone `save_status_update` calls, the no-estimates rule. The result is a parallel canonical that lives in their `.agents/skills/` but does not flow back to ignite. A second team adopting Drive would re-discover the same gaps and either fork again or ignore the Linear-sync workflow entirely.

### 2. Unbounded agent dispatches

Independent of the unit problem, agent dispatches inside a "task" routinely run feature-sized scopes for hours without orchestrator inspection. The orchestrator monitors via file-system proxies (commit cadence, file modification rate) rather than reading committed diffs; validation gates pass throughout; drift is invisible until someone reads a specific diff for an unrelated reason; recovery requires unwinding multiple commits' worth of accommodating code.

**Concrete evidence.** The `prisma-next` `target-extensible-ir` project hit this multiple times (most recently 2026-05-17, captured in `wip/unattended-decisions.md`). The shape is identical each time: a single dispatch is given a feature-sized brief; the orchestrator infers progress from file-system signals; the dispatch routes around its grep gate using a programmatically-equivalent shape; CI passes; the failure surfaces three slices later as a downstream breakage. The cost is the slices to unwind plus the corrective round.

The cure for this is the classical Agile response to the same failure shape in human teams: **small stories, frequent inspection, explicit Definition of Ready and Done.** Translating that to agent teams gives us *small dispatches with size caps, ≤ 5-minute WIP inspection cadence, pre-flight DoR and post-flight DoD per dispatch.*

## Why these are one problem

The two failure modes compound. The fuzzy-units problem produces too-large work units, because the only documented start path (`drive-create-project`) coerces everything into project-scope and the only documented planning unit ("milestone / task") encourages composing many concerns into a single planning bucket. Once the unit is oversized, the dispatch loop has no chance — it inherits the oversized scope and runs unsupervised. Fixing the units without the discipline still produces drift; fixing the discipline without the units leaves the operator picking scopes manually each time.

Both failures yield to **structural** fixes — agreeing on the units once, encoding them in the canonical skill bodies, and gating each dispatch with explicit pre- and post-flight checks. The cure that worked for human teams (Kanban WIP limits, Definition of Ready, Definition of Done, retros) works for agent teams when transposed: the rituals carry all the team's memory because agents have none of the organic memory transmission human teams rely on.

## What we're proposing

A consolidated domain model + a methodology layer + a canonical-side skill restructure. Three layers, deliberately ordered smallest scope to largest:

### Three sized units of work

| Unit | What it is | Persistence |
|---|---|---|
| **Direct change** | The lightweight path — one PR, no spec, no plan, no dispatch ceremony. For trivial work (copy changes, config flips, one-line fixes). | Intent in the PR body. No on-disk artefact. |
| **Slice** | One PR-sized unit. Has a slice spec + slice plan; delivers exactly one PR. The slice plan decomposes into agent dispatches. | In-project: `projects/<project>/slices/<slice>/`. Orphan: inline in the PR description. |
| **Project** | Composition of slices and/or direct changes under one overarching purpose. Has a project spec + project plan + project-DoD. | `projects/<project>/spec.md` + `plan.md`. |

Plus one delegation unit: **Dispatch** — one agent session. A slice plan is a sequence of dispatches. Each dispatch carries its own DoR + DoD + sizing cap (≤ M complexity).

### A triage workflow as the universal entry point

Every entry into Drive — Linear ticket, bug report, customer ask, "I should do X" thought — runs `drive-triage-work` first. It outputs one of eight verdicts that route the work to the right downstream workflow:

1. **Direct change** — straight to `gh pr create`.
2. **Orphan slice** — slice spec inline in PR description.
3. **In-project slice** — slice spec under `projects/<project>/slices/<slice>/`.
4. **New project** — full project ceremony.
5. **Promote** (mid-flight) — an in-flight slice has grown beyond one PR; create a Linear Project and migrate.
6. **Demote** (mid-flight) — an in-flight project has shrunk to fit one PR; close down the project ceremony.
7. **Spike first** — investigation dispatch whose DoD is "an actionable artefact exists"; re-triage on artefact.
8. **Defer** — record in `projects/<x>/deferred.md` or operator scratch; do not act.

Triage runs at every fresh entry point AND mid-flight when scope shifts. Today's canonical has no triage skill — the operator picks a workflow from intuition; the project-shape gravity of `drive-create-project` wins by default.

### Dispatch discipline that fires on every agent session

Inside the slice execution loop:

- **Definition of Ready** (pre-flight, per dispatch) — the brief is assembled, sized ≤ M, inputs loadable, validation gates runnable, edge cases pre-named.
- **WIP inspection cadence** (≤ 5 min) — orchestrator reads the diff of what just landed, promotes drift to a finding immediately.
- **Definition of Done** (post-flight, per dispatch) — validation gates pass, every pre-named edge case was handled per its disposition, reviewer subagent verdict is accept, intent-validation confirms the dispatch delivered what the brief described (not a literal-correct-but-spec-wrong implementation).
- **L/XL refusal** — any dispatch whose brief is sized above M is refused; the slice plan re-decomposes.
- **Design-discussion stop-condition** — when a baked-in assumption is falsified mid-dispatch, the orchestrator halts and surfaces to the operator rather than silently amending the spec.

These are not new ideas — they are the standard Scrum / XP responses to the same failure shape in human teams. The work here is transposing them for agent execution, not inventing them.

### Twelve invariants the model commits to

Notable ones:
- I1: a slice OR direct change delivers exactly one PR.
- I2: a project's scope is bounded by its project spec at all times.
- I7: a project's purpose statement is immutable after the first slice or direct change starts.
- I11: sizing caps apply at **two scopes** — slice/direct-change bounded by PR-cap (review-ability); dispatch bounded by M-cap (agent-session inspect-ability). Independent and complementary.
- I12: spec or plan amendments after the first dispatch starts require either operator authorisation or a design-discussion output. Silent agent-side amendments are forbidden — they break the artefact contract.

The full set lives in [`model.md`](model.md) § Invariants.

## What changes for Ignite (canonical-side skill restructure)

Stacks on top of [PR #93](https://github.com/prisma/ignite/pull/93) (the project-context convention + the `drive-qa-plan` / `drive-qa-run` manual-QA pair + the `drive-bootstrap-context` / `drive-reconcile-skills` / `drive-update-skills` meta-skills). The restructure proposes:

**Two splits** (per-scope variants):
- `drive-create-spec` → `drive-project-specify` + `drive-slice-specify`.
- `drive-create-plan` → `drive-project-plan` + `drive-slice-plan`.

**Three new skills**:
- `drive-triage-work` (entry-point + mid-flight scope re-evaluator).
- `drive-health-check` (project rollup; session-bookended or trigger-fired).
- `drive-retro-run` (trigger-based retro template).

**Five augmentations** (existing skills, new structural behaviour):
- `drive-orchestrate-plan` — per-dispatch DoR + WIP inspection + per-dispatch DoD + brief template + L/XL refusal + design-discussion stop-condition.
- `drive-close-project` — mandatory final retro.
- `drive-create-project` — project DoR check + project-context directory bootstrap.
- `drive-discussion` — promoted from mode skill to first-class cross-cutting workflow.
- `drive-pr-description` — extended to handle the direct-change case.

**Vocabulary refresh** across all unchanged skills — "milestone" and "task" retire from Drive vocabulary; "step" demotes to implementer-internal.

The full restructure plan with sequencing and per-PR scoping is in [`skill-restructure.md`](skill-restructure.md). Per-skill PRs are independently reviewable and consumers adopt skill-by-skill via the `drive-reconcile-skills` machinery PR #93 already shipped.

## How this connects to PR #93

PR #93 established the *separation* between portable methodology (canonical drive-* skill bodies) and team-specific protocol (`drive/<category>/README.md` in each consumer repo, loaded by drive-* skills as workflow step 1). This proposal **uses that separation**:

- Methodology lives in canonical skill bodies (this restructure).
- Project-specific calibration (failure-mode catalogue, grep library, reference tasks, DoR / DoD overlays) lives in `drive/<category>/README.md` per the PR #93 convention.
- `drive-reconcile-skills` is the operational loop that moves project-specific drift out of in-repo skill copies into the right category README.

This means: the restructure is not a sweeping rewrite that breaks every consumer. Each consumer's `drive/<category>/README.md` keeps their team-specific overlays; the canonical body update lands via `drive-update-skills`; reconciliation handles the rest.

## What we're asking for

1. **A read of [`spec.md`](spec.md)** to confirm the proposed model and the canonical-side scope are sensible, and to surface canonical-side constraints we may have missed (frontmatter conventions, naming patterns, in-flight work we'd collide with).
2. **A read of [`skill-restructure.md`](skill-restructure.md) § "Implementation sequencing"** to confirm the per-PR ordering is reviewable and the dependency chain on PR #93 is OK.
3. **Pushback on anything that conflicts with where Drive is heading on your side** — especially around the new skill names (we tried to follow the dominant `drive-<verb>-<noun>` and `drive-<sub-namespace>-<verb>` shapes), the new `drive/<category>/README.md` categories the new skills introduce (`triage`, `retro`, `health`), or the mid-flight `drive-discussion` promotion to first-class.

We are not asking for a single omnibus PR — the restructure ships per-skill (one or two related skills per PR) and we're happy to land them in whichever order makes sense for the canonical roadmap.

## Pointers (the mechanics)

- [`spec.md`](spec.md) — full project spec (design, requirements, acceptance criteria, alternatives)
- [`model.md`](model.md) — the pinned domain model in detail (vocabulary, workflows, invariants, Linear sync)
- [`workflow.md`](workflow.md) — the operational lifecycle map (every skill plugs into a named phase)
- [`skill-restructure.md`](skill-restructure.md) — workflow → skill map + per-skill verdicts + implementation sequencing
- [`principles/`](principles/) — the protocol primitives (protocol-as-memory, brief-discipline, DoR, DoD, retro, etc.)
- [`calibration/prisma-next.md`](calibration/prisma-next.md) — worked-example calibration; demonstrates how project-context overlays look in practice
- [`design-decisions.md`](design-decisions.md) — chronological decisions log (23 decisions, alternatives + rationale)
- [PR #93](https://github.com/prisma/ignite/pull/93) — the assumed-landed base; all proposed PRs stack on top
