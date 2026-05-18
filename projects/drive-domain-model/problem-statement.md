# A proposal for `drive-*`: explicit units + dispatch discipline

We've been using the canonical `drive-*` skills heavily in `prisma-next` for the past few months. Two things kept biting us. We think they share a common cause and we think the fix is a small consolidation of the unit model + some Agile-style dispatch discipline grafted into the existing skill loop. This doc lays out what we ran into, what we'd like to change, and what the PR series would look like.

It stacks on top of [PR #93](https://github.com/prisma/ignite/pull/93) — your `drive-bootstrap-context` / `drive-reconcile-skills` / `drive-update-skills` + project-context convention makes most of this much easier to land.

## What kept going wrong

### 1. We never knew what unit of work we were in

`drive-create-plan` produces "a plan." Sometimes that plan composes multiple PRs (project-scope). Sometimes it's one PR with sub-milestones (task-scope). Sometimes it's somewhere in between. The skill body doesn't say which; the operator picks each time; the next operator picks differently.

The Linear-sync workflow sits on top of this — it tells you to create milestones, name them `<State> M<N>:`, post `*Outcomes*` blocks, do per-milestone `save_status_update` calls. But it operates on the floating "milestone" unit, so what gets synced where becomes unanswerable except by knowing what the original author had in mind.

What `prisma-next` did about it: deleted the parts of the canonical Linear-sync we couldn't make sense of (the `<State> M<N>:` naming, the `*Outcomes*` blocks, the pipeline-shape taxonomy, the per-milestone status updates, the no-estimates rule). The result is a parallel canonical that lives in our `.agents/skills/` and never flowed back to Ignite. A second team adopting Drive would hit the same gaps and either fork too or just ignore Linear-sync entirely.

### 2. Agent dispatches inside a "task" kept running unsupervised for hours

Most recent example, captured in `wip/unattended-decisions.md` from 2026-05-17 on the `target-extensible-ir` project: a single dispatch got a feature-sized brief; the orchestrator monitored via file-system proxies (commit cadence, file modification rate) rather than reading committed diffs; the dispatch satisfied its grep gate using a programmatically-equivalent shape that escaped the literal-shape check; CI passed throughout; the failure surfaced three slices later. Recovery cost was the slices to unwind + a corrective round.

The shape is the same every time this has happened (and it's happened multiple times). Once a dispatch's scope is bigger than the orchestrator can re-read at the cadence it inspects at, drift becomes invisible.

### These two compound

The unit confusion produces oversized work units — the only documented start path is `drive-create-project` (which coerces everything into project-scope), and the only documented planning unit is "milestone / task" (which encourages composing many concerns into one bucket). Once the unit is oversized, the dispatch loop inherits it and runs unsupervised. Fixing the units without the discipline still produces drift; fixing the discipline without the units leaves the operator picking scopes manually each time.

## What we're proposing

Three things that fit together.

### 1. Pin three units of work

| Unit | What it is | Where it persists |
|---|---|---|
| **Direct change** | One PR; no spec, no plan, no dispatch ceremony. For trivial stuff — copy changes, config flips, one-line fixes. | Intent in the PR body. No on-disk artefact. |
| **Slice** | One PR-sized unit. Has a slice spec + slice plan; delivers exactly one PR. The slice plan decomposes into agent dispatches. | In-project: `projects/<project>/slices/<slice>/`. Orphan: inline in the PR description. |
| **Project** | A composition of slices and/or direct changes under one purpose. Has a project spec + plan + project-DoD. | `projects/<project>/spec.md` + `plan.md`. |

Plus one delegation unit: **Dispatch** — one agent session. A slice plan is a sequence of dispatches. Each dispatch carries its own DoR + DoD + sizing cap (≤ M).

The point: an operator picking up a Linear ticket has a clear answer to "what unit is this?" before any skill runs.

### 2. A triage workflow as the universal entry point

A new `drive-triage-work` skill that every entry into Drive runs first — Linear ticket, bug report, customer ask, "I should do X" thought, all of them. Outputs one of eight verdicts:

1. **Direct change** — straight to `gh pr create`.
2. **Orphan slice** — slice spec inline in PR description.
3. **In-project slice** — slice spec under `projects/<project>/slices/<slice>/`.
4. **New project** — full project ceremony.
5. **Promote** (mid-flight) — an in-flight slice has grown beyond one PR; create a Linear Project and migrate.
6. **Demote** (mid-flight) — an in-flight project has shrunk to fit one PR; close down the project ceremony.
7. **Spike first** — investigation dispatch whose DoD is "an actionable artefact exists"; re-triage on the artefact.
8. **Defer** — record in `projects/<x>/deferred.md` or operator scratch; do not act.

Triage runs at every fresh entry AND mid-flight when scope shifts. Today there's no triage skill — the operator picks a workflow from intuition, and `drive-create-project`'s gravity wins by default.

### 3. Agile-style dispatch discipline grafted onto `drive-orchestrate-plan`

The standard Scrum / XP / Kanban response to the same failure shape in human teams, transposed for agent execution:

- **Definition of Ready** (pre-flight, per dispatch) — brief is assembled, sized ≤ M, inputs loadable, "Done when" commands runnable, edge cases pre-named with dispositions.
- **WIP inspection cadence** (≤ 5 min) — orchestrator reads the diff of what just landed and promotes drift to a finding immediately. Not file-system proxies.
- **Definition of Done** (post-flight, per dispatch) — gates pass, every pre-named edge case was handled per its disposition, reviewer subagent verdict is accept, intent-validation confirms the dispatch delivered what the brief described rather than a literal-correct-but-spec-wrong implementation.
- **L/XL refusal** — any dispatch whose brief is sized above M is refused; the slice plan re-decomposes.
- **Design-discussion stop-condition** — when a baked-in assumption is falsified mid-dispatch, the orchestrator halts and surfaces to the operator rather than silently amending the spec.

None of these are new ideas — they're the standard responses to the same failure shape in human teams. The work here is the transposition, not the invention.

## What it looks like as Ignite-side PRs

Stacks on top of [PR #93](https://github.com/prisma/ignite/pull/93).

**Two splits** (per-scope variants of existing skills):

- `drive-create-spec` → `drive-project-specify` + `drive-slice-specify`.
- `drive-create-plan` → `drive-project-plan` + `drive-slice-plan`.

**Three new skills:**

- `drive-triage-work` (entry-point + mid-flight scope re-evaluator).
- `drive-health-check` (project rollup; session-bookended or trigger-fired).
- `drive-retro-run` (trigger-based retro template).

**Five augmentations** to existing skills:

- `drive-orchestrate-plan` — per-dispatch DoR + WIP inspection + per-dispatch DoD + brief template + L/XL refusal + design-discussion stop-condition.
- `drive-close-project` — mandatory final retro.
- `drive-create-project` — project DoR check + `drive/<category>/README.md` bootstrap.
- `drive-discussion` — promoted from mode skill to first-class cross-cutting workflow.
- `drive-pr-description` — extended to handle the direct-change case.

**Vocabulary refresh** across all unchanged skills — "milestone" and "task" retire; "step" demotes to implementer-internal.

[`skill-restructure.md`](skill-restructure.md) has the per-PR sequencing.

## How it leans on PR #93

PR #93 already established the split between portable methodology (canonical drive-* skill bodies) and team-specific protocol (`drive/<category>/README.md` in each consumer repo, loaded by each drive-* skill as workflow step 1). This proposal uses that split directly:

- Methodology — DoR / DoD shapes, brief template, retro template, triage decision tree — lives in canonical skill bodies (this restructure).
- Team-specific content — failure-mode catalogues, grep libraries, reference tasks, DoR / DoD overlay items — lives in `drive/<category>/README.md` per the PR #93 convention.
- `drive-reconcile-skills` is the existing operational loop that moves project-specific drift out of in-repo skill copies into the right category README.

So the restructure isn't a sweeping rewrite that breaks consumers. Each consumer's `drive/<category>/README.md` keeps their team-specific overlays; the canonical body update lands via `drive-update-skills`; reconciliation handles the rest.

## What we'd like from you

1. A read of [`spec.md`](spec.md) — does the proposed model fit where canonical is heading? Are there constraints we missed (frontmatter conventions, naming patterns, in-flight work we'd collide with)?
2. A read of [`skill-restructure.md`](skill-restructure.md) § "Implementation sequencing" — is the per-PR ordering reviewable? Is the dependency chain on PR #93 OK?
3. Pushback on anything that conflicts with where Drive is heading on your side, especially:
   - The new skill names (we tried to follow the dominant `drive-<verb>-<noun>` and `drive-<sub-namespace>-<verb>` shapes).
   - The new `drive/<category>/README.md` categories the new skills introduce (`triage`, `retro`, `health`).
   - Promoting `drive-discussion` from mode skill to first-class.

Not asking for an omnibus PR. The restructure ships per-skill (one or two related skills per PR); happy to land them in whichever order works for the canonical roadmap.

## Where the rest of the material is

- [`spec.md`](spec.md) — full project spec (design, requirements, acceptance criteria, alternatives considered)
- [`model.md`](model.md) — the pinned domain model in detail (vocabulary, workflows, invariants, Linear sync)
- [`workflow.md`](workflow.md) — the operational lifecycle map (every skill plugs into a named phase)
- [`skill-restructure.md`](skill-restructure.md) — workflow → skill map + per-skill verdicts + implementation sequencing
- [`principles/`](principles/) — the principles the restructure is built on (protocol-as-memory, brief-discipline, DoR, DoD, retro, etc.)
- [`calibration/prisma-next.md`](calibration/prisma-next.md) — worked-example calibration showing what `drive/<category>/README.md` overlays look like in practice
- [`design-decisions.md`](design-decisions.md) — chronological decisions log (alternatives + rationale)
- [PR #93](https://github.com/prisma/ignite/pull/93) — the assumed-landed base; all proposed PRs stack on top
