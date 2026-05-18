# Skill restructuring plan

Inventory + verdicts for every existing canonical `drive-*` skill under the consolidated domain model, plus charters for the new skills the model introduces. **Option A scope**: this doc carries the *what changes and why* — the actual skill bodies (frontmatter, Workflow, Pitfalls, Checklist) are drafted per-skill in their canonical-side PRs in the `prisma/ignite` repo (Option B, delivered piecemeal).

This is the planning artefact reviewers use to evaluate whether the restructuring is sensible. Each upstream PR's body will reference this plan and the relevant `model.md` section.

## Framing

Three pressures shape the restructure:

1. **Vocabulary alignment.** Every existing canonical skill body uses pre-model words ("milestone," "task," generic "plan") at scopes the new model now pins. Bodies need rewriting to use slice / dispatch / direct change / project at their declared scope.
2. **Scope declarations.** Every skill must declare a scope: project, slice, dispatch (rare; usually inside `drive-orchestrate-plan`), or cross-cutting. Today the scope is implicit; reviewers and operators each interpret.
3. **The three workflow gaps.** Triage, project health rollup, and retro running have no dedicated skill. They're load-bearing under the consolidated model; three new skills land.

The restructure ships per-skill in `prisma/ignite`, not as an omnibus PR (per `spec.md` § NFR2). Per-skill PRs are independently reviewable and consumers can adopt skill-by-skill via `drive-reconcile-skills`.

## Verdicts table

Eight verdict types. Each existing skill gets one; each new skill carries its rationale.

| Verdict | Meaning |
|---|---|
| **stays** | No body change beyond vocabulary refresh. |
| **augmented** | Body keeps its shape; gains specific new sections / checks / refusals. |
| **split** | One skill becomes two (project-scope + slice-scope variants). |
| **renamed** | Existing skill keeps its body; gets a new name + scope declaration. |
| **new** | No predecessor; fresh skill body. |
| **retired** | Predecessor removed; functionality absorbed elsewhere. |
| **promoted** | Moves between buckets (`.experimental/` → `.curated/`, etc.). |
| **promoted-to-first-class** | Existing skill (often mode) gains workflow-level standing in the model. |

## 1. Existing canonical drive-* skills

### 1.1 `.curated/`

#### `drive-agent-personas` — stays

**Scope:** Cross-cutting.

**Verdict + Why:** Stays. The persona installation surface (architect, principal-engineer, tech-lead, PM, etc.) is independent of the workflow model; the consolidation doesn't change what a persona is or how it loads. Body needs minor vocabulary updates (replace "Maker" with "agile orchestrator" where the persona-loader runs scope discipline; reference [`principles/roles-and-personas.md`](principles/roles-and-personas.md) for the three-role + one-persona mapping).

#### `drive-close-project` — augmented

**Scope:** Project.

**Verdict + Why:** Stays as the project-closure skill. Augmented with:
- Mandatory final retro step (calls `drive-retro-run` per [`principles/retro.md`](principles/retro.md) — project DoD requires the retro per `model.md` invariant I10).
- Refusal to delete `projects/<x>/` if project DoD's required items (per [`principles/definition-of-done.md`](principles/definition-of-done.md) § Project DoD) are unmet. Specifically: the mandatory retro must have produced a landed update; Linear cleanup must be done; long-lived docs must be migrated.
- Updated Linear ceremony for promotion-pattern completion (if the project was promoted from a ticket per `model.md` § Linear sync, the originating ticket already reflects completion; the Linear Project transitions to Completed via the close-out PR's merge).

#### `drive-code-review` (renamed `drive-review-code`) — stays

**Scope:** Slice.

**Verdict + Why:** Stays. The rename (per the `skills/README.md` `<scope>-<verb>-<noun>` taxonomy) already landed on `main`. Body needs vocabulary refresh only — references to "the task" become "the slice"; refers to slice DoD per [`principles/definition-of-done.md`](principles/definition-of-done.md) for the reviewer's contract.

#### `drive-create-deployment-plan` — stays

**Scope:** Project.

**Verdict + Why:** Stays. Deployment plans are project-scope; the model doesn't change what a deployment plan is. Vocabulary refresh only (deployment plan composes slice deliverables; per-slice deploy considerations live in slice spec).

#### `drive-create-plan` — split

**Scope before:** Implicit (project or task — author chooses).

**Verdict + Why:** Split into two skills: `drive-project-plan` (project-scope; composes slices + direct changes; stack/parallel sequencing) and `drive-slice-plan` (slice-scope; composes dispatches; sizing discipline + DoR-per-dispatch). The two have meaningfully different inputs / outputs / templates per decision 17. The body of `drive-create-plan` does not survive — its content is split, refactored, and re-authored against the new model.

See § 2.3 and § 2.4 for the new skills' charters.

#### `drive-create-project` — stays

**Scope:** Project.

**Verdict + Why:** Stays. Project scaffolding is unambiguous. Augmented with: project DoR check at entry (per [`principles/definition-of-ready.md`](principles/definition-of-ready.md) § Project DoR — triage verdict must be "project"; purpose statement gets the first-pass draft); seeds placeholders for slice template + calibration links.

#### `drive-create-spec` — split

**Scope before:** Implicit.

**Verdict + Why:** Split into two skills: `drive-project-specify` (project-scope; purpose + scope-boundary + project-DoD, often with design-discussion participation) and `drive-slice-specify` (slice-scope; scope-within-project + slice-DoD + Example-Mapping edge cases, authored by the implementer). Per decision 17 — same rationale as `drive-create-plan` split.

See § 2.5 and § 2.6.

#### `drive-discussion` — promoted-to-first-class

**Scope:** Cross-cutting.

**Verdict + Why:** Stays as a mode skill, but **promoted to first-class** in the model (workflow row in `model.md` § Workflows; row in `workflow.md` lifecycle table). Body documents the trigger points (pre-spec, mid-spec, mid-flight on falsified assumption, mid-flight on obstacle, explicit request) and the agile orchestrator's responsibility to recognise when to escalate. Documents the output contract (spec/plan edit + `design-decisions.md` entry). References [`model.md`](model.md) § Workflows (Design discussion) and [`principles/roles-and-personas.md`](principles/roles-and-personas.md) for the persona's escalation responsibility.

#### `drive-post-update` — stays

**Scope:** Project.

**Verdict + Why:** Stays. Status updates on Linear Projects are project-scope; the consolidation doesn't change what a status update is. Vocabulary refresh only.

#### `drive-pr-description` — stays

**Scope:** Slice (and direct change).

**Verdict + Why:** Stays. PR descriptions are PR-scope, which under the model maps to slice or direct change. Body extended to handle the direct-change case (PR description carries the intent — that's the only artefact for direct changes per `model.md` § Persistence shape). No vocabulary issues — "PR" is the unit.

#### `drive-pr-walkthrough` — stays

**Scope:** Slice (and direct change).

**Verdict + Why:** Stays. Same scope as `drive-pr-description`. Walkthrough's "intent-first narrative" shape works for both slices and direct changes (a direct change has shorter narratives; same shape).

### 1.2 `.experimental/`

#### `drive-orchestrate-plan` — augmented + promoted

**Scope:** Slice.

**Verdict + Why:** Promoted from `.experimental/` to `.curated/` (already happened on `main` per the legacy sibling spec). Augmented with five things per the consolidated model:

1. **Per-dispatch DoR pre-flight.** Before delegating each dispatch, run the dispatch DoR check (per [`principles/definition-of-ready.md`](principles/definition-of-ready.md) § Dispatch DoR). Refuse to dispatch if unmet.
2. **WIP-inspection cadence as a named loop step.** ≤ 5 min cadence during every dispatch; reads diff of what just landed; promotes drift to a finding (per [`principles/brief-discipline.md`](principles/brief-discipline.md) § Practical implications).
3. **Per-dispatch DoD post-flight.** After each dispatch, run the dispatch DoD check (per [`principles/definition-of-done.md`](principles/definition-of-done.md) § Dispatch DoD). Includes intent-validation as non-optional.
4. **Brief template integration.** Brief assembly is done by the orchestrator agent per [`principles/brief-discipline.md`](principles/brief-discipline.md). The skill body references the brief template directly; rejects briefs missing required sections.
5. **L/XL refusal at dispatch time + design-discussion stop-condition.** Defense in depth on top of slice-plan's sizing — refuse any dispatch whose brief is L/XL. On detected assumption-falsification (per `model.md` invariant I12), fire stop-condition: interactive mode surfaces "I need to think through X with you"; unattended mode halts, logs the trigger for operator return.

The skill stays slice-scope only (one slice, one orchestrate-plan loop, one PR). Multi-slice projects run the orchestrator once per slice.

#### `drive-reverse-spec` — stays

**Scope:** Slice (typically; can be project for archeology).

**Verdict + Why:** Stays. The "reverse-engineer the spec from an existing PR" pattern is independent of the model. Vocabulary refresh only.

### 1.3 `.system/`

#### `drive-list` — stays

**Scope:** Cross-cutting.

**Verdict + Why:** Stays. The skill listing is mechanical and doesn't depend on the model. No changes.

### 1.4 Retirements

No retirements at the skill level. Two **vocabulary retirements**:

- **"Milestone"** retires from Drive vocabulary. Where it appeared in skill bodies, it's replaced with "slice" (the Drive-side word for the PR-sized unit). Linear's "milestone" remains as a Linear-side word — that's the Tracker context's vocabulary per `model.md` § Bounded contexts.
- **"Task"** retires in its pre-model senses. Where it referred to a PR-sized unit, replace with "slice." Where it referred to an agent dispatch, replace with "dispatch."

## 2. New skills

### 2.1 `drive-triage-work`

**Scope:** Cross-cutting (entry-point + mid-flight).

**Bucket:** `.experimental/` initially (graduates to `.curated/` after at least one consumer adoption).

**Charter:** Runs the triage workflow at any entry point and mid-flight. Decides which of the eight verdicts applies (per `model.md` § Workflows § Triage and `workflow.md` § Triage outputs) and routes to the right downstream workflow / skill. At entry time, the input is a fresh ask (Linear ticket / bug report / customer feedback / "I should do X"); at mid-flight time, the input is a scope-shift signal (slice growing, project shrinking, surfaced scope). Driven by the agile orchestrator persona (per [`principles/roles-and-personas.md`](principles/roles-and-personas.md)).

**Owned outputs (per verdict):**

- Direct change: routes operator straight to `gh pr create` with intent in the PR body. No further Drive skill.
- Orphan slice: routes to `drive-slice-specify` (orphan mode) + `drive-slice-plan` (orphan mode).
- In-project slice: routes to `drive-slice-specify` (in-project mode) + `drive-slice-plan` (in-project mode).
- New project: routes to `drive-create-project` → `drive-project-specify` → `drive-project-plan`.
- Promote: runs the promotion workflow (Linear pattern 2 per `model.md` § Linear sync — Promotion pattern) + scaffolds the project folder.
- Demote: runs the demotion workflow (per `model.md` § Linear sync — Demotion pattern). Requires operator authorisation before mass-closing Linear issues.
- Spike first: dispatches a single-dispatch slice plan with a spike-flavoured brief (per [`principles/spikes.md`](principles/spikes.md)); re-triages on the artefact.
- Defer: records in `projects/<x>/deferred.md` (in-project) or operator scratch (orphan).

**References:**
- `model.md` § Workflows (Triage); § Linear sync (Promotion + Demotion patterns)
- `workflow.md` § Triage outputs
- `principles/definition-of-ready.md` § Triage gate
- `principles/roles-and-personas.md` § Agile orchestrator persona

### 2.2 `drive-health-check`

**Scope:** Project.

**Bucket:** `.experimental/` initially.

**Charter:** Produces project health rollups. Two modes:

- **Interactive mode (session-bookended).** Operator sits down to drive the project; orchestrator presents an opening rollup *before* asking what to push on; at session end, writes a closing rollup. Per `workflow.md` § Project-health rollup cadence.
- **Unattended mode (trigger-fired).** Every slice merge (hooks into slice closure); after N consecutive dispatches without slice progress (drift alarm; default 3; calibrate per project); on any escalation-worthy event (e.g. design-discussion stop-condition firing).

**Rollup content:**
- Slice progress (delivered / in flight / planned / blocked).
- Drifted slices (slices that hit a design-discussion stop-condition or whose plan needed adaptation).
- Dispatch throughput (count, t-shirt sizes, tier mix).
- Calibration signals (failure modes hit this session; calibration entries added).
- Recommended next pick (or stop-condition surfaced for operator return).

**References:**
- `model.md` § Workflows (cross-cutting health rollup)
- `workflow.md` § Project-health rollup cadence
- `principles/protocol-as-memory.md` § Calibration as memory

### 2.3 `drive-project-plan` (split from `drive-create-plan`)

**Scope:** Project.

**Bucket:** `.curated/`.

**Charter:** Produces a project plan: the composition of slices and direct changes that delivers the project's purpose. Sequences them (stack / parallel) and notes anticipated-vs-known. Does not enumerate the dispatches inside any slice (that's `drive-slice-plan`'s job).

**Owned outputs:**
- `projects/<project>/plan.md` listing slices + direct changes with their relationships and sequencing.
- Linear Issues created for each known slice (linked from the plan).

**References:**
- `model.md` § Ubiquitous language (Slice, Project plan); § Linear sync
- `principles/definition-of-ready.md` § Project DoR (plan is part of project DoR)

### 2.4 `drive-slice-plan` (split from `drive-create-plan`)

**Scope:** Slice.

**Bucket:** `.curated/`.

**Charter:** Produces a slice plan: the dispatch sequence that delivers one PR. Every dispatch sized ≤ M; DoR + DoD declared per dispatch; model tier declared per dispatch. Refuses to finalize with any L/XL dispatch — decompose first. Threads relevant calibration entries (failure-mode catalogue, grep library) into each dispatch's brief skeleton so brief assembly at delegation time can pull them in.

**Owned outputs:**
- For in-project slices: `projects/<project>/slices/<slice>/plan.md`.
- For orphan slices: inline in the PR description's checklist OR in the implementer's working memory (per `model.md` § Persistence shape).

**References:**
- `model.md` § Ubiquitous language (Slice plan, Dispatch); § Invariants (I1, I11)
- `principles/decomposition-and-cost.md` § Dispatch routing under this principle
- `principles/brief-discipline.md` § Brief contents (the slice plan carries brief skeletons)
- `principles/definition-of-ready.md` § Dispatch DoR (slice plan declares DoR per dispatch)

### 2.5 `drive-project-specify` (split from `drive-create-spec`)

**Scope:** Project.

**Bucket:** `.curated/`.

**Charter:** Produces a project spec: purpose statement, scope boundary, project-DoD. Often invoked with design-discussion participation (per [`principles/roles-and-personas.md`](principles/roles-and-personas.md), project owner + agile orchestrator collaboratively). Per invariant I7, the purpose statement is declared immutable at first-dispatch-start; the spec captures the immutability explicitly.

**Owned outputs:**
- `projects/<project>/spec.md`.
- Linear Project description (or linked doc).

**References:**
- `model.md` § Ubiquitous language (Project spec, Purpose statement, Scope boundary); § Invariants (I2, I7, I10)
- `principles/roles-and-personas.md` § Project owner role

### 2.6 `drive-slice-specify` (split from `drive-create-spec`)

**Scope:** Slice.

**Bucket:** `.curated/`.

**Charter:** Produces a slice spec: scope (within parent project's purpose, if any) + slice-DoD + Example-Mapping edge cases. Authored by the implementer. For orphan slices, the spec lives inline in the PR description; for in-project slices, under `projects/<project>/slices/<slice>/spec.md`.

**Owned outputs:**
- Slice spec at the appropriate path (per `model.md` § Persistence shape).
- Linear Issue description (or linked doc).

**References:**
- `model.md` § Ubiquitous language (Slice spec); § Persistence shape
- `principles/brief-discipline.md` § The brief is per-dispatch; the slice spec is per-slice
- `principles/definition-of-done.md` § Slice DoD

### 2.7 `drive-retro-run`

**Scope:** Trigger-based (cross-cutting).

**Bucket:** `.experimental/` initially.

**Charter:** Runs the retro template per [`principles/retro.md`](principles/retro.md). Triggered on dispatch failure, drift event, escapee bug, slice close (if a learning surfaced — asked, not required), project close (mandatory), calibration miss, or explicit operator request. Lands the retro's output (protocol update / calibration update / ADR) in a memory-strong surface; the retro is not complete until the update has landed.

**Owned outputs:**
- Retro artefact in `projects/<project>/retros/<date>-<one-line-name>.md` (in-project) or operator scratch (orphan).
- The landed update (commit / PR / file) — the retro's actual deliverable.

**References:**
- `model.md` § Workflows (cross-cutting retro); § Invariants (I10 — project DoD requires the close retro)
- `principles/retro.md` § The mandatory output
- `principles/protocol-as-memory.md` § The retro is the team's only learning mechanism

## 3. Augmentations summary

For convenience, the augmentations declared in § 1 collected in one table:

| Skill | Augmentation summary |
|---|---|
| `drive-orchestrate-plan` | Per-dispatch DoR pre-flight + WIP-inspection cadence + per-dispatch DoD post-flight + brief template integration + L/XL refusal + design-discussion stop-condition. |
| `drive-close-project` | Mandatory final retro (calls `drive-retro-run`); refusal to delete `projects/<x>/` with unmet project DoD. |
| `drive-create-project` | Project DoR check at entry; seeds slice template + calibration links. |
| `drive-discussion` | Promoted to first-class workflow standing; body documents trigger points + agile orchestrator's escalation responsibility + output contract. |
| `drive-pr-description` | Extended to handle direct-change case (PR description carries the only artefact). |

## 4. Implementation sequencing

Per-skill PRs land canonical-side in `prisma/ignite`. Dependency-respecting order:

1. **Foundation PR.** Vocabulary refresh across all unchanged skills (`drive-agent-personas`, `drive-code-review`/`drive-review-code`, `drive-create-deployment-plan`, `drive-post-update`, `drive-pr-description`, `drive-pr-walkthrough`, `drive-reverse-spec`, `drive-list`). Replace "milestone" / "task" / generic "plan" / generic "step" with consolidated vocabulary. Lower-risk; doesn't depend on new skills.
2. **New principle docs landing.** Optional intermediate PR that pushes copies of the new principle docs into the canonical repo OR (more likely) treats this project's principle docs as the source-of-truth that canonical references by URL. Decision deferred to the PR author.
3. **drive-triage-work PR.** New skill; depends on nothing else (other than the new principles for reference). Lands first among the new skills because it's the entry point for the other new skills' workflows.
4. **drive-project-specify + drive-slice-specify PR.** Pair; together they replace `drive-create-spec` (which is deprecated in the same PR with a pointer to the replacements).
5. **drive-project-plan + drive-slice-plan PR.** Pair; together they replace `drive-create-plan`.
6. **drive-orchestrate-plan augmentation PR.** Adds the five augmentations; depends on `principles/brief-discipline.md`, `principles/definition-of-ready.md`, `principles/definition-of-done.md`, `principles/retro.md` being landed (or referenceable).
7. **drive-discussion promotion PR.** Body update; promotes the mode skill to first-class workflow standing. Independent of others.
8. **drive-retro-run PR.** New skill; depends on `principles/retro.md`.
9. **drive-health-check PR.** New skill; depends on `principles/protocol-as-memory.md` and the augmented `drive-orchestrate-plan` (for unattended-mode trigger interop).
10. **drive-close-project augmentation PR.** Adds mandatory retro + project DoD enforcement; depends on `drive-retro-run` existing.
11. **drive-create-project augmentation PR.** Adds project DoR check + slice template seeding.
12. **drive-process.md rewrite PR.** Per spec AC14. Lands when all skills above are in place so the doc can reference them.

Each PR's body references this plan and the relevant `model.md` section. Consumers of `prisma/ignite` adopt skill-by-skill via `drive-reconcile-skills`.

## 5. Per-PR scoping rules

For Option B (the per-skill canonical PRs):

- **One PR carries one or two related skills.** Pair splits ship together (specify split + plan split); singletons ship alone (triage, health-check, retro-run).
- **No omnibus PRs.** Spec NFR2 forbids; reviewers can't validate a multi-skill change.
- **Each PR carries its own skill body skeleton + Workflow + Pitfalls + Checklist sections.** That's the Option B detail this plan defers to the per-PR work.
- **Each PR references this plan + `model.md` § <relevant>.** So a canonical reviewer can trace the rationale back.
- **Consumers don't migrate in the same PR.** Per spec NFR3, consumer migration is per-consumer follow-up via `drive-reconcile-skills`.

## 6. What this plan does not decide

- The body shape of any individual skill (deferred to per-PR Option B work).
- The exact frontmatter schema canonical-side. Inherits from current `prisma/ignite` convention.
- The migration plan for in-flight `prisma/ignite` work. Per `spec.md` § OQ11, retroactively reshape only with clear payoff; let existing artefacts age out.
- The retirement timeline for `drive-create-spec` / `drive-create-plan` after their splits land. Per consumer adoption schedule via `drive-reconcile-skills`.

## References

- [`model.md`](model.md) — pinned domain model (vocabulary + workflows + invariants the skills enforce)
- [`workflow.md`](workflow.md) — operational lifecycle layered on model
- [`spec.md`](spec.md) — what this project delivers; ACs that mention the skill restructuring
- [`design-decisions.md`](design-decisions.md) § 17 — the split decision rationale
- [`principles/`](principles/) — the principle docs every augmentation references
- `prisma/ignite` `skills/README.md` — naming taxonomy (`<scope>-<verb>-<noun>`)
- `prisma/ignite` `docs/engineering/drive-process.md` — the canonical doc rewritten per spec AC14
