# Drive domain model

**Status:** Draft. Captures the working domain model for Drive — the units we care about, how they relate, what each workflow does, and the constraints that keep the model legible. Not a spec; the input to one.

**Voice:** project-manager lens, hardened with DDD ubiquitous-language discipline and agile-specialist invariants. Implementation surface (skill names, file paths, templates) is downstream and intentionally out of scope here.

**Companion documents:** `spec.md` (project scope), `HANDOVER.md` (full conversational backdrop).

## Why this exists

The audit of canonical Drive skills (see `projects/drive-context-convention/audit/SYNTHESIS.md`) surfaced one consumer team's rejection of the Drive workflow's coupling between plan-on-disk shape and Linear's data model. Digging in, the root cause is broader: **Drive's "project" model is too fuzzy.** "Project," "milestone," "task," "plan," "spec" each get used at multiple scopes; the canonical skill bodies don't say which scope they mean when. When Linear sync layers on top, the question *what gets synced where* becomes unanswerable except by reference to the original author's mental model — which doesn't survive the move to a new team.

A second failure mode reinforces the first: the canonical's only documented entry path produces a `projects/<name>/` directory with full project shape, regardless of work size. Bug fixes and one-line changes are coerced into project-scope because that's the only path the tooling exposes.

This document defines the units precisely so the workflow can land somewhere obvious, and adds a lightweight path for the small case.

## The forcing unit: the pull request

**A pull request (PR) is the unit Drive serves.**

A PR has a natural size cap. Above the cap, PRs become hard to review, debug, deploy, and roll back. Below the cap (down to one-line fixes), they remain useful. The cap varies by codebase but is real and bounded.

Every artefact Drive produces eventually composes into PRs. Drive is in the business of helping people produce well-shaped PRs — neither too large nor too vague nor missing context.

## Ubiquitous language

| Term | Definition |
| --- | --- |
| **PR (pull request)** | The forcing unit Drive serves. Has a natural size cap. Drive does not produce PRs directly; it produces specs and plans that lead to PRs. |
| **Slice** | One PR-sized unit of work. Has a slice spec and a slice plan; delivers exactly one PR. The agent's internal step decomposition of a slice is below the Drive-care line. |
| **Project** | Composition of slices under a single overarching purpose. Has a project spec, a project plan, and a definition of done. |
| **Project spec** | Artefact stating a project's overarching purpose, scope boundary, and definition of done. |
| **Slice spec** | Artefact stating a slice's purpose, scope (within the parent project's purpose, if any), and definition of done. |
| **Project plan** | Sketch of the slices composing a project — known and anticipated. Sequences slices, identifies stacking and parallelism. Does not enumerate the steps inside any one slice. |
| **Slice plan** | Sequence of steps that will deliver one PR. Identifies validation gates, decisions, risk surfaces. Does not enumerate file-level changes. |
| **Step (planning sense)** | An item inside a slice plan. Drive surfaces, names, and gates these. |
| **Step (execution sense)** | An action the implementer takes while executing a slice. Below the Drive-care line. Reserved for the Execution bounded context; the Planning context uses "slice-plan step" or rephrases. |
| **Purpose statement** | The "why" of a project. Declared in the project spec. Immutable after the first slice starts (I7). |
| **Scope boundary** | The "what's in" of a project. Declared in the project spec. May sharpen; never expands outside the purpose (C2 / I2). |
| **Definition of done (DoD)** | Criteria for "done" at a given scope. Explicit at both project and slice level (I8, I9). |
| **Stack** | A sequence of slices where each PR depends on the previous; lands in order. |
| **Parallel** | Slices whose PRs are independent and may land in any order. |

The word **"milestone"** retires from Drive vocabulary. (It may appear in the Tracker context's vocabulary — Linear has milestones — but Drive's own units never use it.) The word **"task"** also retires; it was the precursor of "slice."

## Bounded contexts

```text
┌─ Drive Planning context ──────────────────────────────────────┐
│  Project, Slice, Spec(:scope), Plan(:scope), Purpose,         │
│  Scope boundary, Definition of done, Stack, Parallel.         │
│  Drive's own bounded context. Owns the ubiquitous language.   │
└───────────────────────────────────────────────────────────────┘

┌─ Drive Execution context ─────────────────────────────────────┐
│  Step (execution sense), edit, file, commit,                  │
│  validation-gate outcome, decision outcome.                   │
│  Below the Drive-care line — the implementer's domain.        │
│  Planning surfaces gates and decisions into this context but  │
│  does not prescribe its internals.                            │
└───────────────────────────────────────────────────────────────┘

┌─ Drive Review context ────────────────────────────────────────┐
│  Review, finding, walkthrough, before/after, persona pass.    │
│  Drive serves this context (via drive-review-code,            │
│  drive-pr-walkthrough); the team owns its rhythm.             │
└───────────────────────────────────────────────────────────────┘

┌─ Drive Deployment context ────────────────────────────────────┐
│  Deployment plan, deploy, rollback, stage, release.           │
│  Project-scope; not slice-scope.                              │
└───────────────────────────────────────────────────────────────┘

╔═ Tracker context (Linear) — external ═════════════════════════╗
║  Linear project, Linear milestone, Linear issue,              ║
║  status update, workflow state.                               ║
║  Anti-corruption layer between Planning and Tracker: a Drive  ║
║  Slice translates outward to a Linear unit (issue or          ║
║  milestone — see OQ1). Drive's domain does not depend on      ║
║  Tracker concepts.                                            ║
╚═══════════════════════════════════════════════════════════════╝
```

The Planning context is what Drive owns. The Execution context is below-the-line; Drive doesn't prescribe its internals. Review and Deployment are adjacent — Drive serves them but doesn't own their rhythm. The Tracker context (Linear) is external; the anti-corruption layer keeps Drive's domain uncorrupted by Linear's data model.

## Roles and personas

Three roles:

| Role | Owns | Person constraint |
| --- | --- | --- |
| **Project owner** | Purpose statement; scope decisions (adopt vs defer); project-level definition of done. | Human only; non-fungible across a project's life. |
| **Implementer** | Slice spec + slice plan + slice execution + PR open. | Human or agent. |
| **Reviewer** | Slice review. | Different actor from the slice's implementer (peer review). Human or agent. |

One persona:

| Persona | Stance |
| --- | --- |
| **Agile orchestrator** | Scope discipline, sizing instinct, deferral decisions, process facilitation. A mental lens worn by whichever human or agent is currently running triage or project closure. Independent of role: a project owner running triage wears the agile-orchestrator hat; an implementer running mid-slice triage on surfaced work also wears it. |

The test for whether a role is real: *can the same person fluidly play this role and another in the same minute, or does role-switching require a context shift?* Project owner is real because scope decisions require a zoom-out stance. Implementer-vs-reviewer is real because reviewing is adversarial reading. Spec-author-vs-plan-author is not real; the same brain does both in continuous sequence.

## Workflows

Drive runs in seven workflows. Each has a trigger, a driver (role or persona), and an output. Workflows compose; one workflow's completion often triggers another.

These workflows sit on top of (and refine) the four-stage lifecycle described in [the skills README's Drive project lifecycle diagram](../../skills/README.md#workflow-drive-project-lifecycle): **Plan** (triage + initiation), **Execute** (slice execution), **Review** (slice review), **Ship** (slice + project closure).

### 1. Triage

The load-bearing workflow. Runs at every entry point. Currently absent from canonical Drive.

```text
Triggered by:  (a) a fresh entry point — Linear ticket, bug report,
                   customer ask, "I should do X" thought, a
                   scope-deferred candidate from a prior project; OR
               (b) new work surfacing mid-flight inside another
                   workflow (the "scope emergence" case).
Driven by:     agile orchestrator.

Decision tree:
  1. Does an existing open project's purpose cover this?
     – Yes → propose adding as a slice to that project.
     – No  → continue.
  2. Does this plausibly fit in one PR?
     – Consider: surface area, files touched, decisions involved,
       review effort, rollback complexity.
     – Lean small when unclear. Splitting a slice later is cheap;
       collapsing a project to a slice is expensive.
  3. Is there a single clear outcome with no significant unknowns?
     – Yes → this is a slice.
     – No  → this is a project.

Outputs:       exactly one of —
               A. New slice inside existing project → run Slice
                  initiation (in-project).
               B. New orphan slice → run Slice initiation
                  (lightweight mode).
               C. New project → run Project initiation.

Side outputs:  scope-deferred candidates if intake surfaces
               unrelated work (recorded; not actioned).
```

### 2. Project initiation

```text
Triggered by:  triage outputting "new project."
Driven by:     project owner.
Outputs:       project spec (purpose statement, scope boundary,
               definition of done)
               + project plan (initial slicing — known + anticipated).
```

### 3. Slice initiation

```text
Triggered by:  triage outputting "new slice" (orphan or in-project),
               OR project initiation adding a slice, OR mid-flight
               triage adopting surfaced scope.
Driven by:     implementer.
Outputs:       slice spec + slice plan. Persistence shape per
               context (see § Persistence shape below):
               – Orphan slice: inline in PR description.
               – In-project slice: on disk under a lighter shape
                 than the project directory.
```

### 4. Slice execution

```text
Triggered by:  slice initiation completing.
Driven by:     implementer.
Outputs:       PR opened; code on the branch; validation gates
               from the slice plan executed.
```

### 5. Slice review

```text
Triggered by:  slice execution opening a PR.
Driven by:     reviewer.
Outputs:       review verdict (accept / request changes); findings
               to address or accept.
```

### 6. Slice closure

```text
Triggered by:  slice review accepting.
Driven by:     implementer + project owner (if in-project).
Outputs:       PR merged; slice marked delivered; scope-deferred
               candidates recorded if any; next slice (if stacked)
               cued via slice initiation.
```

### 7. Project closure

```text
Triggered by:  all planned slices delivered, OR project abandoned.
Driven by:     project owner (wearing the agile-orchestrator hat).
Outputs:       project closed; deferred-work bundle handed off
               somewhere (see OQ4); learnings captured.
```

State of an aggregate is what falls out of workflows running, not what they are named after. A slice transitions to `delivered` because slice closure ran successfully; we don't model "delivered" as a separate event-emission step.

## Aggregates

Two aggregate roots, expressed in workflow terms rather than DDD-classroom terms:

- **Project** is mutated only by project initiation, mid-flight triage (when the agile orchestrator adopts new scope), and project closure. The project owns: project spec, project plan, slice references, project state (`open` | `closed`).
- **Slice** is mutated only by slice initiation, slice execution, slice review, and slice closure. The slice owns: slice spec, slice plan, slice state (`specified` | `planned` | `in-flight` | `delivered` | `abandoned`), PR reference.

Project references slices by ID. Slices may reference back to a project. Splitting a slice (when implementation reveals it's too big — I1) is a slice operation; the project notices and updates its plan to reflect the new composition.

The aggregate split matters because it tells us what skills can do what without re-running which other skills. A skill that re-plans a slice doesn't have to re-author its parent project. A skill that adds a slice to a project doesn't have to author the new slice's spec.

## Invariants

```text
I1  A slice delivers exactly one PR.
I2  A project's scope is bounded by its project spec at all times.
I3  Every spec and plan has exactly one scope-type (project or
    slice), declared at creation and immutable thereafter.
I4  A project has at least one slice. Otherwise it should be a
    slice, not a project.
I5  A slice may or may not have a parent project. Orphan slices —
    bug fixes, one-offs — are allowed.
I6  A slice's spec and plan exist before implementation begins.
I7  A project's purpose statement is immutable after the first
    slice starts. (Scope boundary may sharpen; purpose cannot
    be replaced — otherwise it's a new project.)
I8  Every slice has a definition of done — declared in its slice
    spec OR inherited from its parent project's DoD.
I9  Every project has a definition of done declared in its
    project spec.
```

I7 is the structural ratchet against mission drift: you can refine *how* the project gets done, but you can't change *what* the project is once you've committed work to it.

## Scope discipline

When new work surfaces inside a project — during a slice, a review, a deployment, an unrelated conversation — the agile orchestrator runs (mid-flight) triage and asks:

> Does this serve the project's purpose, as stated in the project spec?

- **Yes** → add it to the project plan as a new slice (or fold into an existing planned slice).
- **No** → record as a scope-deferred candidate; do not add to the project plan.

The scope-deferred-work landing pad is OQ4 (still open). The principle that scope-irrelevant work does not expand the project is the load-bearing part.

## Persistence shape

The on-disk shape of an artefact is **per-context**. The model deliberately allows a lightweight path for the small case so that triage can route to "slice" instead of always defaulting to "project."

| Artefact | Where it lives |
| --- | --- |
| Project spec | `projects/<project>/spec.md` (today's shape) |
| Project plan | `projects/<project>/plan.md` (today's shape) |
| In-project slice spec + plan | Lighter shape than the project directory. Working proposal: `projects/<project>/slices/<slice>/spec.md` and `plan.md`. Pin during the canonical skill restructuring. |
| Orphan slice spec + plan | Inline in the PR description (spec under the PR's "what" / "why"; plan under the PR's checklist or in the implementer's working memory). No on-disk artefact required. |
| Deployment plan | `projects/<project>/deployment-plan.md` (project-scope). |
| Review artefacts | Per the existing convention (under the consumer's declared scratch directory; see `drive/code-review/README.md` per the drive-context-convention). |
| Scope-deferred candidates (during project) | Working proposal: `projects/<project>/deferred.md`. Reviewed at project closure; each item triaged individually (most become candidate projects elsewhere). |

The forcing principle: **slice persistence is per-context, not uniform.** Without this concession, triage will keep routing-to-project just to use the tooling.

## Linear sync (one-tier via the anti-corruption layer)

Once units are pinned, the Linear mapping is obvious:

| Drive unit | Linear unit |
| --- | --- |
| Project | Linear project |
| Project spec | Linear project description / linked doc |
| Slice | Linear issue (working position; OQ1 may revise to Linear milestone) |
| Slice spec | Linear issue description / linked doc |
| Slice plan | Not synced — internal to the slice's execution |
| PR | Linked to the Linear issue via GitHub integration; auto-closes on merge |

The agent's step-by-step decomposition inside a slice does not sync anywhere. `save_status_update` is project-scope only.

The two-tier Linear ceremony framing (minimal core + opt-in layers) the audit synthesis previously proposed is replaced by this one-tier mapping. Ceremony falls out of the unit definitions rather than being toggleable per consumer.

## Implications for existing canonical Drive

Sketched, not specified. Skill-family restructuring lives in the project spec's AC2.

### Skills that currently muddle scope

| Canonical skill | Today | Under this model |
| --- | --- | --- |
| `drive-create-spec` | Produces "a spec" — scope implicit. | Produces either a project spec or a slice spec. Either two skills or one parameterised skill (working lean: scope flag; fewer skills to maintain). |
| `drive-create-plan` | Produces "a plan" with a milestone → task two-level decomposition that floats across scopes. | Produces either a project plan (slice composition) or a slice plan (PR delivery sequence). The "milestone" level either collapses (becomes synonymous with slice) or is renamed. |
| `drive-orchestrate-plan` | Orchestrates "a plan" — scope implicit. | Operates on a slice plan. One slice, one orchestrated loop, one PR. Multi-slice projects run the orchestrator once per slice. |

### Skills that are already scope-clear under this lens

| Canonical skill | Scope |
| --- | --- |
| `drive-create-project` | Project. |
| `drive-close-project` | Project. |
| `drive-create-deployment-plan` | Project (deployment plans describe how composed PRs ship to users). |
| `drive-pr-description` | Slice. |
| `drive-pr-walkthrough` | Slice. |
| `drive-review-code` | Slice. |
| `drive-post-update` | Project (a status update is about the project's overall progress; per-PR status is the PR's own review and merge state). |
| `drive-list` | Cross-cutting (meta / navigation). Already lives in `.system/` since `a8dd1ba` (skills README rewrite); no scope binding. |

### Missing skill: triage

A new canonical skill is required to run the triage workflow. Naming candidates: `drive-triage`, `drive-triage-work`, `drive-triage-entry`, `drive-route-work`. Per the [naming taxonomy](../../skills/README.md#naming-taxonomy) of `<scope>-<verb>-<noun>`, `drive-triage-work` is aspirationally compliant; `drive-triage` is acceptable but incomplete. Pin during skill restructuring (see spec OQ7).

## Open questions

1. **Linear issue vs Linear milestone for a slice.** Both have similar shapes. Working position: Linear issue (more universal; less constrained semantics; matches how audited consumers currently use Linear).
2. **What enforces I1 (one slice → one PR)?** Candidates: operator discipline; a watchpoint in the orchestrator that surfaces "should we split?" mid-execution when a slice approaches size cap; a hard gate in slice-closure. Working position: orchestrator watchpoint + operator discipline; no hard gate.
3. **What enforces I2 (project scope doesn't expand)?** Working position: triage itself enforces this. Every time new work surfaces, triage re-reads the project spec to make the in-or-out call. The triage skill is the enforcement point.
4. **Where does scope-deferred work go?** Working position: `projects/<project>/deferred.md` during a project; reviewed at project closure; each item routed via triage (most become candidate projects in a separate register; some are intentionally dropped). No silent loss.
5. **Exact persistence shape for in-project slices.** Working position: `projects/<project>/slices/<slice>/spec.md` + `plan.md`. Pin during canonical skill restructuring.
6. **`drive-create-spec` / `drive-create-plan`: split by scope or take a scope flag?** Working position: scope flag (fewer skills; body largely the same with a few scope-conditional sections). Pin during restructuring.
7. **Name for the triage skill.** Working position: `drive-triage-work`. Aspirationally compliant with the naming taxonomy; alternative `drive-triage` is acceptable but incomplete.
8. **How is the project spec written when full scope isn't knowable yet?** Working position: two passes — purpose statement fixed in the first pass (immutable per I7); scope boundary sharpened in later passes as slices deliver.
9. **Stacked PRs in Linear.** Linear has no first-class stacking metadata. Working position: each PR is its own Linear issue; the stack order is recorded in the project plan and in the PR descriptions; Linear sees a sequence of issues without explicit stacking metadata.

## What this document does *not* decide

- The names of any skills (other than aspirational positions for new ones).
- The file paths for any artefact (other than aspirational positions in § Persistence shape).
- The shape of any template.
- The migration plan from canonical to the new model.

All of those are downstream. This document is the input; the spec drives the implementation.

## Pointers

- `projects/drive-domain-model/spec.md` — companion project spec (scope, acceptance criteria, requirements).
- `projects/drive-domain-model/HANDOVER.md` — conversational backdrop and decision rationale.
- `projects/drive-context-convention/audit/SYNTHESIS.md` — the audit that surfaced the model question. Several Tier 1 recommendations are superseded here (see this project's spec AC8).
- `docs/engineering/drive-process.md` — canonical Drive process doc; rewritten under this project per spec AC7.
- `skills/README.md` — naming taxonomy and lifecycle stages this model layers on top of.
- `skills/.curated/drive-*/SKILL.md`, `skills/.experimental/drive-*/SKILL.md`, `skills/.system/drive-*/SKILL.md` — canonical skill family, restructured per spec AC4.
