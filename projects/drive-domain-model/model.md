# Drive domain model

## At a glance

Drive's domain model has three sized **units of work** (Direct change, Slice, Project), one **delegation unit** (Dispatch), eight **workflows** (seven lifecycle-stage + one cross-cutting), three **aggregate roots** that the workflows mutate, and twelve **invariants** that hold across everything. Two forcing constraints — the PR cap (units of work) and the M-cap (dispatches) — keep work appropriately sized; an anti-corruption layer maps Drive's units to Linear's.

```
Sized units (smallest → largest):
  Direct change  →  Slice  →  Project
      (no spec)     (one PR)   (composes slices)

Delegation unit:
  Dispatch  =  one agent session inside Slice execution

Workflows (eight):
  Triage → {Project init | Slice init | Direct change | Spike | Defer | Promote | Demote}
  Project init → Slice init → Slice exec → Slice review → Slice closure → Project closure
  Design discussion (cross-cutting; fires on triggers across the lifecycle)

Forcing constraints:
  Units of work bounded by PR cap (triage enforces).
  Dispatches bounded by M cap (slice planning enforces; slice execution refuses L/XL).

Linear sync:
  Anti-corruption layer maps Drive units → Linear units; promotion + demotion are
  the symmetric mid-flight reshape ceremonies.
```

This document is the source of truth. The spec ([`spec.md`](spec.md)) sets the project's scope and acceptance criteria; the workflow map ([`workflow.md`](workflow.md)) is the operational layer that names every skill plug-point.

## Two forcing constraints

The model's two structural constraints. Everything downstream — sizing, triage outcomes, dispatch discipline — falls out of these.

### The PR cap (the unit-of-work constraint)

A pull request has a natural size cap. Above the cap, PRs become hard to review, debug, deploy, and roll back. Below the cap (down to one-line fixes), they remain useful. The cap varies by codebase but is real and bounded.

Drive does not produce PRs directly. It produces specs and plans that *compose into* PRs. The PR cap therefore shows up as the **slice / direct-change cap** — the unit of work that delivers exactly one PR cannot exceed what one PR can absorb. Triage enforces this on admission: any candidate unit that wouldn't fit in one PR is admitted as a Project (which composes multiple PRs) instead.

### The M cap (the dispatch constraint)

A dispatch is one agent session. Long-running dispatches are hard for the orchestrator to inspect, hard to recover from when drift emerges, and pressure the implementer model into capability that should be reserved for genuine judgment.

Drive does not run dispatches directly either. The slice plan *decomposes into* dispatches. The dispatch cap therefore shows up as **complexity ≤ M** (t-shirt sized) plus a per-size wall-clock time-box. Slice planning enforces the cap; slice execution refuses L/XL even if a plan slipped one through (defense in depth).

### The two caps act independently

The PR cap is about review-ability, rollback-ability, debug-ability. The M cap is about agent-session inspect-ability, orchestrator recover-ability. **Neither subsumes the other** — a slice can fit one PR but require multiple dispatches; a single dispatch can never span multiple PRs. Codified as invariant **I11**.

## Layer 1: ubiquitous language

The terms below are pinned. Every drive-* skill body uses these and only these for the units they mean.

| Term | Definition |
|---|---|
| **PR (pull request)** | The forcing unit Drive ultimately serves. Has a natural size cap. Drive does not produce PRs directly; it produces specs and plans that lead to PRs. |
| **Direct change** | The smallest unit. One PR with intent in the PR body; no spec, no plan, no dispatch ceremony. The lightweight path for trivial work (copy changes, config flips, one-line fixes). Sibling of Slice — both can exist orphan, both can compose under a project. |
| **Slice** | One PR-sized unit of work. Has a slice spec and a slice plan; delivers exactly one PR. The slice's dispatch plan decomposes the work for agent execution. |
| **Project** | Composition of slices and/or direct changes under one overarching purpose. Has a project spec, a project plan, and a project-DoD. |
| **Dispatch** | The agent-session delegation unit. One delegation to an implementer subagent — may contain multiple logical steps but presents as one orchestrator-to-implementer interaction. Drive surfaces, sizes, gates, and inspects dispatches; the steps inside are below the Drive-care line. |
| **Step** | Logical-increment unit inside a dispatch. The implementer composes them while executing. Below the Drive-care line; Drive does not surface or gate steps individually. |
| **Project spec** | Artefact stating a project's purpose, scope boundary, and project-DoD. |
| **Slice spec** | Artefact stating a slice's purpose, scope (within the parent project's purpose, if any), and slice-DoD. For orphan slices, may live inline in the PR description. |
| **Project plan** | Sketch of the slices and direct changes composing a project — known and anticipated. Sequences them, identifies stacking and parallelism. Does not enumerate the dispatches inside any one slice. |
| **Slice plan** | Sequence of dispatches that will deliver one PR. Each dispatch sized ≤ M, with declared DoR and DoD. Does not enumerate the steps inside any one dispatch. |
| **Brief** | The artefact passed to a dispatch at delegation time. Carries DoR satisfaction, scope, edge cases pre-named with dispositions (Example Mapping), validation gates, time-box, model tier. The dispatch-level analogue of a slice spec. |
| **Purpose statement** | The "why" of a project. Declared in the project spec. Immutable after the first slice or direct change starts (I7). |
| **Scope boundary** | The "what's in" of a project. Declared in the project spec. May sharpen; never expands outside the purpose (I2). |
| **Definition of Ready (DoR)** | Criteria the unit must satisfy before work on it begins. Declared per scope (dispatch DoR, slice DoR, spike DoR; project DoR is light by comparison). |
| **Definition of Done (DoD)** | Criteria for "done" at a given scope. Explicit at three scopes: dispatch (I8), slice (I9), project (I10). |
| **Stack** | A sequence of slices where each PR depends on the previous; lands in order. |
| **Parallel** | Slices whose PRs are independent and may land in any order. |
| **Spike** | A brief-type (not a separate unit). May manifest at slice scope (a research slice that ships a doc PR) or dispatch scope (an investigation dispatch whose output is a written artefact consumed by the next dispatch). Spike DoD is "an actionable artefact exists," not "code is committed." |
| **Design discussion** | A collaborative shape between operator and agile orchestrator that fires at trigger points (pre-spec, mid-spec, mid-flight on falsified assumption, mid-flight on obstacle, explicit request). Cross-cutting workflow, not a lifecycle stage. Output: spec/plan edits + a `design-decisions.md` entry. Backed by the `drive-discussion` mode skill. |

**Retired terms.** The words **milestone** and **task** retire from Drive's vocabulary. (Linear has milestones; that's the Tracker context's vocabulary. Drive's own units never use the word.) Predecessor uses get re-pinned: "milestone" → "slice"; "task" → "slice" or "dispatch" depending on the predecessor's intended scope.

## Layer 1.5: bounded contexts (where each word applies)

```text
┌─ Drive Planning context ──────────────────────────────────────┐
│  Project, Slice, Direct change, Spec(:scope), Plan(:scope),   │
│  Dispatch, Brief, Purpose, Scope boundary, DoR, DoD,          │
│  Stack, Parallel.                                              │
│  Drive's own bounded context. Owns the ubiquitous language.   │
└───────────────────────────────────────────────────────────────┘

┌─ Drive Execution context ─────────────────────────────────────┐
│  Step (logical increment), edit, file, commit,                │
│  validation-gate outcome, decision outcome.                   │
│  Below the Drive-care line — the implementer's domain.        │
│  Planning surfaces gates and dispatch boundaries into this    │
│  context but does not prescribe its internals.                │
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
║  Anti-corruption layer between Planning and Tracker:          ║
║  Drive units translate outward to Linear units via fixed      ║
║  mapping (§ Linear sync). Drive's domain does not depend on   ║
║  Tracker concepts.                                            ║
╚═══════════════════════════════════════════════════════════════╝
```

The Planning context is what Drive owns. The Execution context is below-the-line; Drive doesn't prescribe its internals. Review and Deployment are adjacent — Drive serves them but doesn't own their rhythm. The Tracker context (Linear) is external; the anti-corruption layer keeps Drive's domain uncorrupted by Linear's data model.

## Layer 2: roles and personas

Three roles:

| Role | Owns | Person constraint |
|---|---|---|
| **Project owner** | Purpose statement; scope decisions (adopt vs defer); project-DoD. | Today: human only; non-fungible across a project's life. Eventual: agent-eligible for projects whose purpose is well-specified by stable input artefacts. |
| **Implementer** | Slice spec + slice plan + dispatch execution + PR open. | Human or agent. |
| **Reviewer** | Slice review. | Different actor from the slice's implementer (peer review). Human or agent. |

One persona:

| Persona | Stance |
|---|---|
| **Agile orchestrator** | Scope discipline, sizing instinct, deferral decisions, process facilitation. Owns triage. Owns dispatch-level discipline during slice execution (DoR / DoD / WIP inspection / brief shape). Knows when to escalate to design discussion. Worn by whichever human or agent is currently running scope discipline or driving the dispatch loop. Independent of role. |

The test for whether a role is real: *can the same person fluidly play this role and another in the same minute, or does role-switching require a context shift?* Project owner is real because scope decisions require a zoom-out stance. Implementer-vs-reviewer is real because reviewing is adversarial reading. Spec-author-vs-plan-author is not real; the same brain does both in continuous sequence.

**Role-wearing trajectory.** Today the human wears project owner + agile orchestrator + implementer (sometimes). The orchestrator agent wears agile orchestrator during dispatch loops (per `drive-orchestrate-plan`); the implementer subagent wears implementer; the reviewer subagent wears reviewer. As confidence in the methodology accrues, the orchestrator agent eventually wears agile orchestrator at all levels (triage, dispatch loop, retro-running, protocol maintenance) and the human's residual role becomes design-level (project spec authoring, design discussion participation, falsified-assumption escalation). See [`principles/roles-and-personas.md`](principles/roles-and-personas.md) for the full mapping.

## Layer 3: workflows

Eight workflows. Seven are lifecycle-stage; one (design discussion) is cross-cutting and fires at trigger points across the lifecycle.

These sit on top of (and refine) the four-stage lifecycle described in [the skills README's Drive project lifecycle diagram](../../skills/README.md): **Plan** (triage + initiation), **Execute** (slice execution), **Review** (slice review), **Ship** (slice + project closure).

### 1. Triage (the load-bearing one)

Runs at every entry point AND mid-flight when scope shifts. Currently absent from canonical Drive. Without it, the canonical's project-shape gravity (only `drive-create-project` exposes an entry path) wins by default and small work gets coerced into project-scope.

```text
Triggered by:  (a) a fresh entry point — Linear ticket, bug report,
                   customer ask, "I should do X" thought, a
                   scope-deferred candidate from a prior project; OR
               (b) new work surfacing mid-flight inside another
                   workflow (scope emergence); OR
               (c) explicit re-triage request (mid-flight scope
                   re-evaluation — promotion or demotion candidate).
Driven by:     agile orchestrator.

Decision tree:
  1. Is this trivial enough to skip slice ceremony entirely?
     (Copy change, config flip, one-line fix; reviewer can verify
      by reading the diff in ~30 seconds.)
     – Yes → direct change.
     – No  → continue.
  2. Does an existing open project's purpose cover this?
     – Yes → in-project slice (or in-project direct change).
     – No  → continue.
  3. Can we size this without further investigation?
     – No  → spike first (queue a single spike dispatch;
              re-triage on artefact).
     – Yes → continue.
  4. Does this plausibly fit in one PR?
     – Consider: surface area, files touched, decisions involved,
       review effort, rollback complexity.
     – Lean small when unclear. Splitting a slice later is cheap;
       collapsing a project to a slice is expensive.
     – Yes → orphan slice.
     – No  → new project.

Mid-flight variants:
  - PROMOTE: an in-flight slice has grown beyond one PR. Route to
    promotion workflow (§ Linear sync — Promotion pattern).
  - DEMOTE: an in-flight project has shrunk to fit one PR. Route to
    demotion workflow (§ Linear sync — Demotion pattern).
  - DEFER: surfaced work is out of scope for the current project's
    purpose. Record in projects/<project>/deferred.md (or operator
    scratch for orphan work); do not act on it.

Outputs:       exactly one of —
               A. Direct change → straight to gh pr create.
               B. New orphan slice → run slice initiation (lightweight
                  mode; PR-description-inline persistence).
               C. New in-project slice → run slice initiation
                  (in-project mode).
               D. New project → run project initiation.
               E. Promote → run promotion workflow.
               F. Demote → run demotion workflow.
               G. Spike first → run a single spike dispatch; re-triage.
               H. Defer → record; no further action.
```

### 2. Project initiation

```text
Triggered by:  triage outputting "new project."
Driven by:     project owner (often with agile orchestrator + design
               discussion to shape the purpose).
Outputs:       project spec (purpose statement, scope boundary,
               project-DoD)
               + project plan (initial slicing — known + anticipated;
                 may include direct changes if known).
```

### 3. Slice initiation

```text
Triggered by:  triage outputting "new slice" (orphan or in-project),
               OR project initiation adding a slice, OR mid-flight
               triage adopting surfaced scope.
Driven by:     implementer.
Outputs:       slice spec + slice plan (dispatch sequence; sized
               ≤ M-cap per dispatch; DoR + DoD declared per dispatch).
               Persistence per context (§ Persistence shape):
               – Orphan slice: inline in PR description.
               – In-project slice: under projects/<project>/slices/<slice>/.
```

### 4. Slice execution

```text
Triggered by:  slice initiation completing.
Driven by:     agile orchestrator (running the dispatch loop) +
               implementer (executing each dispatch).
Per-dispatch shape:
  Pre-flight:  DoR check; brief assembled from the slice plan +
               any spike artefacts; model tier chosen.
  Delegate:    one dispatch to the implementer subagent.
  Inspect:     WIP-inspection cadence (≤ 5 min) — orchestrator reads
               diff of what just landed; promotes drift to a finding.
  Close:       DoD post-flight check; reviewer subagent verdict;
               refresh per-slice review artefacts.
  Next:        loop to next dispatch in the slice plan.
Outputs:       PR opened; code on the branch; validation gates from
               the slice plan executed.
```

### 5. Slice review

```text
Triggered by:  slice execution opening a PR.
Driven by:     reviewer.
Outputs:       review verdict (accept / request changes); findings
               to address or accept; manual-QA script + run report
               (per `drive-qa-plan` + `drive-qa-run`).
```

### 6. Slice closure

```text
Triggered by:  slice review accepting.
Driven by:     implementer + project owner (if in-project) +
               agile orchestrator.
Outputs:       PR merged; slice marked delivered; scope-deferred
               candidates recorded if any; project-health rollup
               fires (per-slice trigger); retro fires if a learning
               surfaced; next slice (if stacked) cued via slice
               initiation.
```

### 7. Project closure

```text
Triggered by:  all planned slices delivered, OR project abandoned.
Driven by:     project owner (wearing the agile-orchestrator hat).
Outputs:       project closed; deferred-work bundle handed off;
               mandatory final retro (protocol / project-context /
               ADR update — if none, retro failed); long-lived docs
               migrated; projects/<project>/ deleted.
```

### 8. Design discussion (cross-cutting)

Not a lifecycle stage. Fires at multiple trigger points across the lifecycle. Operator + agile orchestrator collaborate to resolve a design question; the output updates the spec / plan / `design-decisions.md`.

```text
Triggered by:
  - Pre-spec: shaping the initial design before any spec exists.
  - Mid-spec: refinement during project-specify or slice-specify
    when a question surfaces the agent cannot resolve alone.
  - Mid-flight on falsified assumption: an assumption baked into the
    spec or plan turns out to be wrong; orchestrator pauses, raises
    to operator.
  - Mid-flight on obstacle emergence: a new technical or scope
    obstacle the spec did not anticipate.
  - Explicit request: operator says "let's think through X."

Driven by:     operator + agile orchestrator (collaboratively).
               Personas may be loaded (architect, principal-engineer,
               PO) per the drive-agent-personas skill.

Output:        spec edit + plan edit (project or slice scope; may
               also trigger a re-triage if scope shifted enough to
               change verdict); design-decisions.md entry recording
               the call + rationale.
```

The agile orchestrator's responsibility includes **recognising when design discussion is needed** and pulling the operator in. In interactive mode that means surfacing a structured decision; in unattended mode it means firing a stop-condition and logging the trigger for the operator's return (per `drive-orchestrate-plan` § Unattended mode).

State of an aggregate is what falls out of workflows running, not what they are named after. A slice transitions to `delivered` because slice closure ran successfully; we don't model "delivered" as a separate event-emission step.

## Layer 4: aggregates

Three aggregate roots, expressed in workflow terms rather than DDD-classroom terms:

- **Project** is mutated only by project initiation, mid-flight triage (when the agile orchestrator adopts new scope or demotes), and project closure. The project owns: project spec, project plan, slice and direct-change references, project state (`open` | `closed`).
- **Slice** is mutated only by slice initiation, slice execution, slice review, and slice closure. The slice owns: slice spec, slice plan, slice state (`specified` | `planned` | `in-flight` | `delivered` | `abandoned`), PR reference.
- **Direct change** is mutated only by triage (creation), and the bare commit + PR + review + merge sequence. The direct change owns: PR reference, optional Linear-issue link. State (`open` | `merged` | `abandoned`) tracks PR lifecycle.

Project references slices and direct changes by ID. Slices may reference back to a project. Splitting a slice (when implementation reveals it's too big — I1) is a slice operation; the project notices and updates its plan to reflect the new composition.

The aggregate split matters because it tells us what skills can do what without re-running which other skills. A skill that re-plans a slice doesn't have to re-author its parent project. A skill that adds a slice to a project doesn't have to author the new slice's spec.

## Layer 5: invariants

```text
I1  A slice OR a direct change delivers exactly one PR.
I2  A project's scope is bounded by its project spec at all times.
I3  Every spec and plan has exactly one scope-type (project or
    slice), declared at creation and immutable thereafter.
I4  A project has at least one slice OR direct change. Otherwise
    it should be a slice or direct change, not a project.
I5  A slice or direct change may or may not have a parent project.
    Orphan units — bug fixes, one-offs — are allowed.
I6  A slice's spec and plan exist before implementation begins.
    A direct change has no spec/plan; intent is captured in the
    PR body before the PR opens.
I7  A project's purpose statement is immutable after the first
    slice or direct change starts. (Scope boundary may sharpen;
    purpose cannot be replaced — otherwise it's a new project.)
I8  Every dispatch has a Definition of Done declared in its brief
    AND a Definition of Ready satisfied before it starts.
I9  Every slice has a Definition of Done declared in its slice
    spec OR inherited from its parent project's DoD.
I10 Every project has a Definition of Done declared in its
    project spec.
I11 Sizing caps apply at two scopes:
      - Slice/direct-change: bounded by PR-cap (the unit must fit
        in one PR). Triage enforces.
      - Dispatch: bounded by M-cap (complexity ≤ M; wall-clock
        time-box per t-shirt size). Slice planning enforces;
        slice execution refuses L/XL even if a plan slipped one
        through.
I12 Spec or plan amendments after the first dispatch of a slice
    starts are either (a) the output of a design discussion with
    operator participation, or (b) an explicit operator-authorised
    edit. Silent agent-side amendments are forbidden — they break
    the artefact contract.
```

I7 is the structural ratchet against mission drift: you can refine *how* the project gets done, but you can't change *what* the project is once you've committed work to it.

I11 is the structural ratchet against runaway agent dispatches and unreviewable PRs. The two caps are independent and complementary.

I12 is the structural ratchet against assumption-falsification being silently accommodated: when an assumption breaks, the orchestrator must surface to the operator (or, in unattended mode, halt) rather than amend the spec/plan privately.

## Scope discipline (both directions)

Scope discipline operates in both directions.

**Scope expansion (the classic case).** When new work surfaces inside a project — during a slice, a review, a deployment, an unrelated conversation — the agile orchestrator runs mid-flight triage and asks:

> Does this serve the project's purpose, as stated in the project spec?

- **Yes** → add it to the project plan as a new slice or direct change (or fold into an existing planned slice).
- **No** → record as a scope-deferred candidate; do not add to the project plan.

**Scope contraction (the symmetric case).** When in-flight work reveals it's smaller than initially thought, the agile orchestrator runs mid-flight triage and asks:

> Does the remaining work still warrant project-scope ceremony?

- **Yes** → continue as planned.
- **No** → demote (project → slice or direct change). Run the demotion workflow (§ Linear sync — Demotion pattern).

The scope-deferred-work landing pad is `projects/<project>/deferred.md` (or operator scratch for orphan work). Reviewed at project closure; each item triaged individually.

## Persistence shape

The on-disk shape of an artefact is **per-context**. The model deliberately allows a lightweight path for the small case so that triage can route to "slice" or "direct change" instead of always defaulting to "project."

| Artefact | Where it lives |
|---|---|
| Project spec | `projects/<project>/spec.md` |
| Project plan | `projects/<project>/plan.md` |
| In-project slice spec + plan | `projects/<project>/slices/<slice>/spec.md` + `plan.md` |
| Orphan slice spec + plan | Inline in the PR description (spec under "what" / "why"; plan under the PR's checklist or in the implementer's working memory). No on-disk artefact required. |
| Direct change | No spec, no plan, no on-disk artefact. Intent lives in the PR description; the commit + PR is everything. |
| Spike artefact (dispatch-scope) | `projects/<project>/spikes/<date>-<q>.md` for in-project spikes; transient scratch for orphan-context spikes |
| Spike artefact (slice-scope) | A doc PR (an ADR, an analysis); shipped under the project's normal docs path |
| Deployment plan | `projects/<project>/deployment-plan.md` (project-scope) |
| Review artefacts | `projects/<project>/reviews/{code-review,system-design-review,walkthrough}.md` (per `drive-orchestrate-plan`); for orphan slices, lighter shape attached to the PR review surface |
| Manual-QA script | `projects/<project>/manual-qa.md` (in-project); inline QA section in PR description (orphan). Per [`prisma/ignite#93`](https://github.com/prisma/ignite/pull/93) `drive-qa-plan`. |
| Manual-QA run report | `projects/<project>/manual-qa-reports/<YYYY-MM-DD>-<runner>.md` (in-project); inline QA findings in PR review thread (orphan). Per `drive-qa-run`. One per run; reports accumulate (never overwritten) so the QA history is auditable. |
| Scope-deferred candidates (during project) | `projects/<project>/deferred.md`. Reviewed at project closure; each item triaged individually |
| Dispatch brief | Transient — assembled at dispatch time from the slice plan + spike artefacts; not separately persisted |
| `design-decisions.md` entry (per project) | `projects/<project>/design-decisions.md`; orphan work uses operator scratch or in-PR captures |
| Project-context conventions (per consumer repo) | `drive/<category>/README.md` (categories: `spec`, `project`, `plan`, `qa`, `code-review`, `pr`, `deployment`, `post-update`). Read by drive-* skills as workflow step 1. Per [`prisma/ignite#93`](https://github.com/prisma/ignite/pull/93). |

The forcing principle: **persistence is per-context, not uniform.** Without this concession, triage will keep routing-to-project just to use the tooling.

## Linear sync

One-tier mapping via the anti-corruption layer. Pinned units → fixed Linear translation:

| Drive unit | Linear unit |
|---|---|
| Project | Linear project |
| Project spec | Linear project description (or linked doc) |
| Slice | Linear issue |
| Slice spec | Linear issue description (or linked doc) |
| Direct change | Linear issue (if one exists for the original ask) OR no Linear unit if developer-initiated |
| Slice plan | Not synced — internal to the slice's execution |
| Dispatch | Not synced — below the Linear-care line |
| PR | Linked to its Linear issue via GitHub integration; auto-closes on merge |

`save_status_update` is project-scope only. The agent's dispatch-level decomposition does not sync anywhere.

### Promotion pattern (ticket → project)

Triggered when triage decides a ticket represents work too big for a single slice — needs project ceremony.

```text
1. Create Linear Project (save_project) with name + description from
   the ticket's framing.
2. Move the originating ticket into the new Linear Project
   (update_issue with project = <new project id>).
3. Mark the ticket Done; either:
     a. Rename to "Plan: <project name>" — clear forward-pointer.
     b. Add a comment "Converted to project: <project url>" —
        preserves original title.
4. Continue with drive-create-project → drive-project-specify →
   drive-project-plan. Slices subsequently created as new Linear
   issues under the project.
```

The original ticket survives as a marker of "the original ask"; the project becomes the durable handle going forward.

### Demotion pattern (project → slice or direct change)

Triggered when triage decides an in-flight project has shrunk to fit one PR (or even one direct change).

```text
1. Identify the surviving scope (usually: one slice's worth of
   remaining work, sometimes a single direct change).
2. Pick or create the Linear issue that will carry the surviving
   scope forward.
3. Close other open Linear issues under the project with a
   "merged into <surviving-ticket>" comment.
4. Move the surviving ticket OUT of the Linear Project
   (update_issue with project = null) so it stands alone.
5. Mark the Linear Project as Cancelled (with rationale in the
   final status update) OR Completed (if part of the original
   scope did ship).
6. Migrate or retire on-disk artefacts: useful content from
   projects/<project>/ moves into the surviving ticket's PR
   description if relevant; the rest is dropped; projects/<project>/
   is deleted.
7. Surviving work continues as orphan slice (or direct change).
```

The demotion path is heavier — more Linear state to clean up. The agile orchestrator runs it cautiously: surfaces the cleanup steps explicitly, asks the operator for sign-off before mass-closing issues.

## Implications for existing canonical Drive

Sketched here; the full skill-restructure plan with sequencing lives in [`skill-restructure.md`](skill-restructure.md).

### Skills that split or augment

| Canonical skill | Today | Under this model |
|---|---|---|
| `drive-create-spec` | Produces "a spec" — scope implicit. | **Splits** into `drive-project-specify` and `drive-slice-specify`. Body differs meaningfully (project: purpose + scope boundary + project-DoD; slice: scope-within-project + slice-DoD + Example-Mapping edge cases). |
| `drive-create-plan` | Produces "a plan" with a milestone → task two-level decomposition that floats across scopes. | **Splits** into `drive-project-plan` (slice composition; stack/parallel) and `drive-slice-plan` (dispatch sequence; sizing discipline; DoR-per-dispatch). |
| `drive-orchestrate-plan` | Orchestrates "a plan" — scope implicit. | Becomes slice-scope only. Augmented with: explicit DoR pre-flight per dispatch; WIP-inspection cadence as a named loop step; DoD post-flight per dispatch; brief template; L/XL refusal at dispatch time (defense in depth). |

### Skills that stay (some lightly augmented)

| Canonical skill | Scope | Augmentation |
|---|---|---|
| `drive-create-project` | Project | Seed placeholders for slice template + calibration links |
| `drive-close-project` | Project | Mandatory final retro step (calls `drive-retro-run`) |
| `drive-create-deployment-plan` | Project | None |
| `drive-pr-description` | Slice | None |
| `drive-pr-walkthrough` | Slice | None |
| `drive-review-code` | Slice | None |
| `drive-post-update` | Project | None |
| `drive-list` (in `.system/`) | Cross-cutting | None |
| `drive-discussion` (mode) | Cross-cutting | None; promoted to first-class workflow in this model |

### New skills

| Skill | Scope | Workflow |
|---|---|---|
| **`drive-triage-work`** | Cross-cutting (entry) | Runs the triage workflow at any entry point AND mid-flight; outputs one of the eight triage verdicts; routes to the right downstream workflow. |
| **`drive-health-check`** | Project (rollup) | Produces session-bookended (interactive) or trigger-fired (unattended) project rollups: slice progress, drifted slices, dispatch throughput so far, calibration signals, recommended next pick. |
| **`drive-retro-run`** | Trigger-based | Runs the retro template: surface the failure or learning, decide canonical vs project-context vs ADR home, name the update, land it in the matching memory home. Mandatory at project closure; trigger-fired on dispatch failure / drift / escapee. |

### Direct change has no dedicated skill

Triage's "direct change" verdict routes the developer straight to `gh pr create`. No Drive skill is involved in execution; the implementer reads the intent, makes the edit, opens the PR. (Drive could observe — e.g., a future skill might check that a direct-change PR is small enough to merit the verdict — but the path is deliberately ceremonial-light.)

## Open questions

Resolved during consolidation, recorded here as closed for the historical trail:

- ~~OQ1. Linear unit for a slice — issue or milestone?~~ **Closed.** Linear issue. (More universal; matches consumer practice; reserves "milestone" for the Linear-side vocabulary that doesn't map to Drive.)
- ~~OQ5. Exact persistence shape for in-project slices.~~ **Closed.** `projects/<project>/slices/<slice>/spec.md` + `plan.md`.
- ~~OQ6. Split `drive-create-spec` / `drive-create-plan` or take a scope flag?~~ **Closed.** Split. The two pairs (`drive-project-specify` / `drive-slice-specify`; `drive-project-plan` / `drive-slice-plan`) have genuinely different inputs, outputs, audiences, and shape. A scope flag papers over the difference.
- ~~OQ10. What happens to "milestone" as a word?~~ **Closed.** Retired from Drive vocabulary entirely.

Still open (working positions): see [`spec.md`](spec.md) § Open questions for the full list with working positions.

## What this document does *not* decide

- The bodies of any skills (skill restructuring lives in [`skill-restructure.md`](skill-restructure.md)).
- The exact templates for slice spec / slice plan / brief / DoR / DoD / retro (these live in the principle docs under [`principles/`](principles/)).
- The migration plan from canonical to the new model (per-consumer adoption is downstream).
- The reference-task anchors for any specific repo's t-shirt sizing (lives in each repo's calibration; [`calibration/prisma-next.md`](calibration/prisma-next.md) is the worked example).

All of those are downstream. This document is the input.

## Pointers

- [`workflow.md`](workflow.md) — operational layer (the lifecycle map with skills + agile parallels + cadences)
- [`spec.md`](spec.md) — project scope and acceptance criteria
- [`problem-statement.md`](problem-statement.md) — self-contained problem framing for canonical-side maintainers
- [`design-decisions.md`](design-decisions.md) — chronological decisions log (the full alternatives ledger)
- [`principles/`](principles/) — per-principle deep-dives
- [`calibration/prisma-next.md`](calibration/prisma-next.md) — worked-example calibration
- [`skill-restructure.md`](skill-restructure.md) — proposed skill set with augmentations + implementation sequencing
- [`plan.md`](plan.md) — execution plan (upcoming)
