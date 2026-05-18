# Skill restructuring plan

This doc maps the consolidated Drive workflow onto skills and shows how the canonical inventory in [`prisma/ignite`](https://github.com/prisma/ignite) needs to change to land the model.

It is the **planning artefact** reviewers use to decide whether the restructuring is sensible. Implementing each change is the job of a per-skill PR in `prisma/ignite`, each of which links back to this doc and the relevant `model.md` section. The skill bodies themselves (frontmatter, Workflow, Pitfalls, Checklist) are drafted in those per-skill PRs, not here.

## Base assumption

All canonical-side PRs proposed here stack on top of [`prisma/ignite#93`](https://github.com/prisma/ignite/pull/93) (the drive-context-convention work). PR #93 ships:

- The **project-context convention**: drive-* skills read `drive/<category>/README.md` at the consumer-project root as workflow step 1. Categories include `spec`, `project`, `plan`, `qa`, `code-review`, `pr`, `deployment`, `post-update`.
- **`drive-qa-plan`** + **`drive-qa-run`**: the manual-QA discipline — author a script that exercises the system the way a real user would (script in `projects/<project>/manual-qa.md`), then execute it and produce a severity-classified run report. Manual QA is the *judgement* layer on top of CI: diagnostic clarity, original-bug re-enactment, end-to-end developer-journey smoke, gate-of-gate sanity, exploratory probing.
- **`drive-bootstrap-context`**, **`drive-reconcile-skills`**, **`drive-update-skills`**: the meta-skills that scaffold the `drive/` directory, reconcile drifted skill copies against canonical (extracting project-specific deltas into the right `drive/<category>/README.md`), and pull canonical updates.

This work treats PR #93 as in place. All references to "the convention," "the QA pair," and "the meta-skills" below assume the PR #93 surface exists.

## 1. The workflow → skill map (start here)

For every activity in the consolidated workflow, this table names the skill that drives it, the skill's scope (one of *project*, *slice*, *dispatch*, *trigger-based*, *cross-cutting*), and its status under the restructure.

| Workflow activity | Scope | Skill | Status under restructure | Bucket |
|---|---|---|---|---|
| Triage incoming work / scope shift | cross-cutting | **`drive-triage-work`** | new | `.experimental` |
| Design discussion (pre-spec / mid-spec / mid-flight) | cross-cutting | `drive-discussion` | promoted to first-class | `.curated` |
| Author project spec | project | **`drive-project-specify`** | new (split from `drive-create-spec`) | `.curated` |
| Author project plan | project | **`drive-project-plan`** | new (split from `drive-create-plan`) | `.curated` |
| Scaffold a project | project | `drive-create-project` | augmented | `.curated` |
| Project-health rollup | project | **`drive-health-check`** | new | `.experimental` |
| Status update on project | project | `drive-post-update` | stays (vocabulary refresh) | `.curated` |
| Author slice spec | slice | **`drive-slice-specify`** | new (split from `drive-create-spec`) | `.curated` |
| Author slice plan | slice | **`drive-slice-plan`** | new (split from `drive-create-plan`) | `.curated` |
| Run slice dispatch loop | slice | `drive-orchestrate-plan` | augmented | `.curated` |
| Code-review a slice | slice | `drive-review-code` | stays (vocabulary refresh) | `.curated` |
| Author manual-QA script for a slice | slice | `drive-qa-plan` | from PR #93 (stays) | `.experimental` |
| Run manual-QA script + report findings | slice | `drive-qa-run` | from PR #93 (stays) | `.experimental` |
| Author PR description (slice or direct change) | slice / direct change | `drive-pr-description` | augmented (direct-change framing) | `.curated` |
| Author PR walkthrough (slice or direct change) | slice / direct change | `drive-pr-walkthrough` | stays | `.curated` |
| Reverse-engineer a spec from an existing PR | slice (sometimes project) | `drive-reverse-spec` | stays | `.experimental` |
| Author a deployment plan | project | `drive-create-deployment-plan` | stays (vocabulary refresh) | `.curated` |
| Run a retro (triggered) | trigger-based | **`drive-retro-run`** | new | `.experimental` |
| Close out a project | project | `drive-close-project` | augmented | `.curated` |
| Bootstrap the `drive/` context directory | cross-cutting (consumer onboarding) | `drive-bootstrap-context` | from PR #93 (stays) | `.experimental` |
| Reconcile drifted skill copies | cross-cutting (consumer onboarding) | `drive-reconcile-skills` | from PR #93 (stays) | `.experimental` |
| Update installed skills from canonical | cross-cutting (consumer onboarding) | `drive-update-skills` | from PR #93 (stays) | `.experimental` |
| Install / discover personas | cross-cutting | `drive-agent-personas` | stays (vocabulary refresh) | `.curated` |
| List available skills | cross-cutting | `drive-list` | stays | `.system` |

Two activities deliberately have *no* dedicated skill:

- **Direct change** bypasses Drive ceremony by design (single PR, no spec / plan / dispatch). It uses `gh pr create` directly with the intent in the PR body. The direct-change framing lives inside `drive-pr-description`, not in a separate skill — that's why `drive-pr-description` is augmented rather than stayed.
- **Promote** and **demote** (the mid-flight scope-shift verdicts from triage) are operations that `drive-triage-work` orchestrates, not separate skills. Their Linear patterns live in `model.md` § Linear sync.

## 2. Naming convention recap

Per [`prisma/ignite skills/README.md`](https://github.com/prisma/ignite/blob/main/skills/README.md), the only hard rule is "consistency with existing skills." The dominant shapes:

- **`drive-<verb>-<noun>`** for action skills producing an artefact: `drive-create-spec`, `drive-close-project`, `drive-orchestrate-plan`, `drive-review-code`, `drive-triage-work`, `drive-health-check`.
- **`drive-<sub-namespace>-<verb>`** for skills under a focused area: `drive-pr-description`, `drive-pr-walkthrough`, `drive-qa-plan`, `drive-qa-run`, `drive-project-specify`, `drive-slice-specify`, `drive-project-plan`, `drive-slice-plan`, `drive-retro-run`.
- **`drive-<verb>`** or **`drive-<noun>`** for single-name skills: `drive-list`, `drive-discussion`.

The new skill names in § 1 each match one of these shapes. The `project-` / `slice-` sub-namespaces (introduced by the split skills) match the precedent set by `pr-` and `qa-`.

## 3. What changes from current to final

### 3.1 Vocabulary refresh (every existing skill)

Every existing canonical drive-* skill body uses pre-model vocabulary in at least one section. The refresh applies these replacements:

| Old word | New word | Why |
|---|---|---|
| milestone (Drive-side) | slice | Linear's "milestone" is unchanged; the Drive-side word for the PR-sized unit becomes "slice." |
| task (PR-sized unit sense) | slice | Slice is the Drive name; Linear keeps "issue." |
| task (agent-invocation sense) | dispatch | The agent-team word is "dispatch"; "step" was a plan-side concept that didn't survive. |
| plan (ambiguous between project / slice) | project plan / slice plan | Mandatory after the spec/plan-skill split lands. |

### 3.2 New skills (seven; two pairs replace two existing skills)

| Skill | What it does | Why it's new |
|---|---|---|
| `drive-triage-work` | Routes an incoming ask (or scope-shift signal) to one of the eight triage verdicts: direct change / orphan slice / in-project slice / new project / promote / demote / spike first / defer. | Triage is load-bearing under the consolidated model (`model.md` § Workflows § Triage). Today the routing is implicit; the new skill makes it explicit and runnable. |
| `drive-project-specify` | Produces a project spec: purpose statement, scope boundary, project-DoD. Often invoked with design-discussion participation. | Split from `drive-create-spec`. Project-spec authoring has meaningfully different inputs, outputs, and templates from slice-spec authoring (decision 17). |
| `drive-slice-specify` | Produces a slice spec: scope within the parent project's purpose (if any), slice-DoD, Example-Mapping edge cases. Authored by the implementer. | Same split rationale. |
| `drive-project-plan` | Produces a project plan: composition of slices + direct changes with stack / parallel sequencing. Does not enumerate dispatches inside a slice. | Split from `drive-create-plan`. |
| `drive-slice-plan` | Produces a slice plan: dispatch sequence with sizing + DoR + DoD + model tier declared per dispatch; refuses to finalize with L/XL. | Same split rationale. |
| `drive-health-check` | Produces a project-health rollup. Two modes: interactive (session-bookended — opening rollup before pick, closing rollup at session end) and unattended (trigger-fired on slice merges, drift alarms, escalation events). | The rollup is one of the three workflow gaps in the consolidated model (`workflow.md` § Project-health rollup cadence). |
| `drive-retro-run` | Runs a retro on trigger. Mandatory output: a protocol update *or* calibration update *or* ADR. The retro is not done until the update lands in a memory-strong surface. | The retro is the team's only learning mechanism (`principles/protocol-as-memory.md`). Today retros happen ad hoc; the new skill makes triggers + the mandatory-output discipline explicit. |

### 3.3 Augmented existing skills (five)

| Skill | Augmentation |
|---|---|
| `drive-orchestrate-plan` | Five additions: per-dispatch DoR pre-flight (`principles/definition-of-ready.md` § Dispatch DoR); WIP-inspection cadence as a named loop step (`principles/brief-discipline.md` § Practical implications); per-dispatch DoD post-flight including intent-validation (`principles/definition-of-done.md` § Dispatch DoD); brief assembly per `principles/brief-discipline.md`; L/XL refusal at dispatch time + design-discussion stop-condition on falsified-assumption events (invariant I12). |
| `drive-close-project` | Three additions: mandatory final retro (calls `drive-retro-run`; project DoD requires the retro per invariant I10); refusal to delete `projects/<x>/` while project DoD is unmet; manual-QA coverage of the project's user-observable surface is part of project DoD (drive-qa-* artefacts checked across the project's slices). |
| `drive-create-project` | Two additions: project DoR check at entry (`principles/definition-of-ready.md` § Project DoR); seeds the `drive/<category>/README.md` entries the project's slice work will need (via `drive-bootstrap-context`). |
| `drive-discussion` | Promoted to first-class workflow standing. Body documents trigger points (pre-spec, mid-spec, mid-flight on falsified assumption, mid-flight on obstacle, explicit request) + the agile orchestrator's escalation responsibility + the output contract (spec / plan edit + `design-decisions.md` entry). Stays a mode skill (`disable-model-invocation: true`). |
| `drive-pr-description` | Extended to handle the direct-change case: the PR description is the *only* persisted intent artefact for a direct change, so the skill carries the appropriate framing + brevity guidance + the "is this really a direct change, or did triage misroute?" sanity check. |

### 3.4 Vocabulary-only refresh

Skills whose bodies don't otherwise change:

`drive-agent-personas`, `drive-review-code` (the rename already landed), `drive-create-deployment-plan`, `drive-post-update`, `drive-pr-walkthrough`, `drive-reverse-spec`, `drive-list`.

Plus the five PR #93 skills (`drive-qa-plan`, `drive-qa-run`, `drive-bootstrap-context`, `drive-reconcile-skills`, `drive-update-skills`) which are pre-aligned to the consolidated vocabulary — no body change needed.

### 3.5 Vocabulary retirements (no skill retirements)

No skill is retired by the restructure. Two **vocabulary retirements**:

- **"Milestone"** retires from Drive vocabulary. Where it appears in skill bodies, replace with "slice." Linear's "milestone" remains unchanged on the tracker side.
- **"Task"** retires in its two pre-model senses. Where it referred to a PR-sized unit, replace with "slice." Where it referred to an agent invocation, replace with "dispatch."

## 4. Implementation sequencing

Per-skill PRs land canonical-side in `prisma/ignite`, stacked on top of PR #93. Dependency-respecting order:

1. **Foundation PR.** Vocabulary refresh across the § 3.4 skills (lower-risk; depends only on PR #93).
2. **`drive-triage-work` PR.** New skill; entry point for the other new skills' workflows.
3. **Specify-split PR.** `drive-project-specify` + `drive-slice-specify`; together deprecate `drive-create-spec` (pointer left behind for consumer migration via `drive-reconcile-skills`).
4. **Plan-split PR.** `drive-project-plan` + `drive-slice-plan`; together deprecate `drive-create-plan`.
5. **`drive-orchestrate-plan` augmentation PR.** Depends on the principle docs being landed (or referenceable by URL).
6. **`drive-discussion` promotion PR.** Body update; independent of others.
7. **`drive-retro-run` PR.** New skill; depends on `principles/retro.md`.
8. **`drive-health-check` PR.** New skill; depends on the augmented `drive-orchestrate-plan` for unattended-mode trigger interop.
9. **`drive-close-project` augmentation PR.** Depends on `drive-retro-run` existing.
10. **`drive-create-project` augmentation PR.** Adds project DoR check + `drive-bootstrap-context` integration.
11. **`drive-pr-description` augmentation PR.** Extends for direct-change framing.
12. **`docs/engineering/drive-process.md` rewrite PR.** Per spec AC14. Lands when all skills above are in place so the doc can reference them.

Consumers of `prisma/ignite` adopt skill-by-skill via `drive-reconcile-skills` (already part of PR #93). No omnibus PRs — spec NFR2 forbids them and reviewers can't validate a multi-skill change.

## 5. Per-PR scoping rules

- One PR carries one or two related skills (split pairs ship together; singletons ship alone).
- Each PR carries its own skill body skeleton + Workflow + Pitfalls + Checklist sections; this plan deliberately doesn't draft them here.
- Each PR references this plan and `model.md` § `<relevant>` so a canonical reviewer can trace the rationale back.
- Consumers don't migrate in the same PR (spec NFR3 — per-consumer follow-up via `drive-reconcile-skills`).
- New `drive/<category>/README.md` categories introduced by new skills (e.g. `drive/triage/`, `drive/retro/`, `drive/health/`) ship in the same PR as their owning skill — the skill knows what context it needs.

## 6. What this plan does not decide

- The body shape of any individual skill — deferred to per-PR work.
- The exact frontmatter schema canonical-side — inherits from current `prisma/ignite` convention.
- The retirement timeline for `drive-create-spec` / `drive-create-plan` after their splits land — per consumer adoption schedule via `drive-reconcile-skills`.
- Whether to add a `drive-direct-change` skill in the future if direct-change framing in `drive-pr-description` proves insufficient (working position: don't until it does).

## References

- [`model.md`](model.md) — pinned domain model (vocabulary + workflows + invariants the skills enforce)
- [`workflow.md`](workflow.md) — operational lifecycle layered on the model
- [`spec.md`](spec.md) — what this project delivers; ACs that mention the skill restructuring
- [`design-decisions.md`](design-decisions.md) § 17 — the split-decision rationale
- [`principles/`](principles/) — the principle docs every augmentation references
- [`prisma/ignite#93`](https://github.com/prisma/ignite/pull/93) — the assumed-landed base (project-context convention + QA pair + meta-skills)
- [`prisma/ignite skills/README.md`](https://github.com/prisma/ignite/blob/main/skills/README.md) — naming convention (consistency-preferred; two dominant shapes)
- `prisma/ignite docs/engineering/drive-process.md` — the canonical doc rewritten per spec AC14
