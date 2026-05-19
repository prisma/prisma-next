# Skill restructuring plan

Maps the consolidated Drive workflow onto skills and shows how the canonical inventory needs to change to land the model.

The skills are built **locally in `prisma-next`** first (`.agents/skills/drive-*/SKILL.md`), validated by use over a couple of weeks of real work, and then promoted upstream to [`prisma/ignite`](https://github.com/prisma/ignite) as a series of small PRs informed by what survived the trial. The execution sequencing is in [`plan.md`](plan.md); this doc describes the target inventory.

## Base assumption

The local build assumes [`prisma/ignite#93`](https://github.com/prisma/ignite/pull/93) is the canonical baseline. PR #93 ships:

- The **project-context convention**: drive-* skills read `drive/<category>/README.md` at the consumer-project root as workflow step 1. Categories include `spec`, `project`, `plan`, `qa`, `code-review`, `pr`, `deployment`, `post-update`.
- **`drive-qa-plan`** + **`drive-qa-run`**: the manual-QA discipline — author a script that exercises the system the way a real user would (script in `projects/<project>/manual-qa.md`), then execute it and produce a severity-classified run report. Manual QA is the *judgement* layer on top of CI: diagnostic clarity, original-bug re-enactment, end-to-end developer-journey smoke, gate-of-gate sanity, exploratory probing.
- **`drive-bootstrap-context`**, **`drive-reconcile-skills`**, **`drive-update-skills`**: the meta-skills that scaffold the `drive/` directory, reconcile drifted skill copies against canonical (extracting project-specific deltas into the right `drive/<category>/README.md`), and pull canonical updates.

The local build effectively forks from PR #93's state — we'll re-converge when we promote upstream.

## 1. Two skill tiers: workflow and atomic

A structural distinction the restructure introduces. **Workflow skills** pilot multi-step loops; **atomic skills** do one bounded thing each.

The distinction matters because it supports gradual AI adoption (per [`principles/gradual-ai-adoption.md`](principles/gradual-ai-adoption.md)) — a team member at the "zero AI" end of the spectrum invokes atomic skills directly as building blocks; the same team member moving toward "full delegation" hands more of the loop to the workflow skills. Both tiers are first-class.

### Workflow tier (three skills)

Shape: `drive-<verb>-workflow`. Pilots a multi-step loop top-to-bottom; returns when the scope's DoD is met. Calls atomic skills as steps.

| Workflow skill | Pilots | Calls (selection) | Status |
|---|---|---|---|
| **`drive-start-workflow`** | Triage + the verdict's setup chain. Routes work to its right shape and runs the immediate setup (creates the project / scaffolds the slice / opens the direct-change PR). Fires at fresh entry AND mid-flight (promote / demote). | `drive-triage-work`; per verdict: `drive-create-project` / `drive-specify-project` / `drive-specify-slice` / `drive-pr-description` (direct-change) / Linear MCP calls for promote-demote. | New |
| **`drive-build-workflow`** | A slice's implementation loop: pre-flight DoR → dispatch loop with WIP inspection → post-flight DoD → review → close. Augmented: intent-validation, L/XL refusal, design-discussion stop-condition, brief assembly per `principles/brief-discipline.md`. | `drive-specify-slice`, `drive-plan-slice`, the dispatch loop, `drive-review-code`, `drive-qa-plan`/`run`, `drive-pr-description`, `drive-pr-walkthrough`, `drive-run-retro` on triggers, `drive-discussion` on stop-condition. | Renamed + augmented from `drive-orchestrate-plan` |
| **`drive-deliver-workflow`** | A project's lifecycle: project init → slice-by-slice (each via `drive-build-workflow`) → health checks on cadence → retros on triggers → mandatory final retro → close. | `drive-create-project`, `drive-specify-project`, `drive-plan-project`, `drive-build-workflow` in a loop, `drive-check-health`, `drive-run-retro`, `drive-close-project`. | New |

### Atomic tier (everything else)

Shape: `drive-<verb>-<noun>` by default. Does one bounded thing. Called either directly by the operator or by a workflow skill as one step in its loop.

The verb comes first, the noun second — so the skill name reads as a command (*"drive specify project"*, *"drive plan slice"*, *"drive run retro"*, *"drive check health"*, *"drive create spec"*, *"drive triage work"*). This is consistent with the existing canonical skills (`drive-create-spec`, `drive-create-plan`, `drive-create-project`, `drive-orchestrate-plan`) and with the verb-led shape of the workflow tier (`drive-<verb>-workflow`).

The one allowed deviation is `drive-<sub-namespace>-<verb>` (or `-<noun>`) **when there's a genuine sub-namespace housing multiple related skills** — e.g. `drive-pr-description` / `drive-pr-walkthrough` / `drive-pr-local-review` group under the `pr` sub-namespace, and `drive-qa-plan` / `drive-qa-run` ([PR #93](https://github.com/prisma/ignite/pull/93)) group under `qa`. *Scope units* (project / slice) are not sub-namespaces — they show up as the **noun** in `drive-<verb>-<noun>`, not as a leading namespace token.

| Atomic skill | Scope | Status under restructure | Bucket |
|---|---|---|---|
| `drive-triage-work` | cross-cutting | **new** | `.experimental` |
| `drive-discussion` | cross-cutting | promoted to first-class workflow standing (stays atomic + mode skill) | `.curated` |
| `drive-specify-project` | project | **new** (split from `drive-create-spec`) | `.curated` |
| `drive-plan-project` | project | **new** (split from `drive-create-plan`) | `.curated` |
| `drive-create-project` | project | augmented | `.curated` |
| `drive-check-health` | project | **new** | `.experimental` |
| `drive-post-update` | project | stays (vocabulary refresh) | `.curated` |
| `drive-specify-slice` | slice | **new** (split from `drive-create-spec`) | `.curated` |
| `drive-plan-slice` | slice | **new** (split from `drive-create-plan`) | `.curated` |
| `drive-review-code` | slice | stays (vocabulary refresh) | `.curated` |
| `drive-qa-plan` | slice | from PR #93 (stays) | `.experimental` |
| `drive-qa-run` | slice | from PR #93 (stays) | `.experimental` |
| `drive-pr-description` | slice / direct change | augmented (direct-change framing) | `.curated` |
| `drive-pr-walkthrough` | slice / direct change | stays | `.curated` |
| `drive-reverse-spec` | slice / project | stays | `.experimental` |
| `drive-create-deployment-plan` | project | stays (vocabulary refresh) | `.curated` |
| `drive-run-retro` | trigger-based | **new** | `.experimental` |
| `drive-close-project` | project | augmented | `.curated` |
| `drive-bootstrap-context` | onboarding | from PR #93 (stays) | `.experimental` |
| `drive-reconcile-skills` | onboarding | from PR #93 (stays) | `.experimental` |
| `drive-update-skills` | onboarding | from PR #93 (stays) | `.experimental` |
| `drive-agent-personas` | cross-cutting | stays (vocabulary refresh) | `.curated` |
| `drive-list` | cross-cutting | stays | `.system` |

Notes on what's deliberately *not* a skill:

- **Direct change** has no dedicated atomic skill — its lightweight path is `drive-start-workflow` → `drive-pr-description` (direct-change framing) → `gh pr create`. No on-disk artefact.
- **Promote** and **demote** (mid-flight scope-shift verdicts) are sequences `drive-start-workflow` runs by calling `drive-triage-work` + Linear MCP tools; not separate atomic skills. Their Linear patterns live in [`model.md`](model.md) § Linear sync.
- **Spike** is a brief-type variant inside `drive-build-workflow`, not a separate skill. See [`principles/spikes.md`](principles/spikes.md).

## 2. Naming convention

Per [`prisma/ignite skills/README.md`](https://github.com/prisma/ignite/blob/main/skills/README.md), the only hard rule is "consistency with existing skills." Shapes used by this restructure:

- **`drive-<verb>-workflow`** for the workflow tier: `drive-start-workflow`, `drive-build-workflow`, `drive-deliver-workflow`. The `-workflow` suffix is the visible cue.
- **`drive-<verb>-<noun>`** for atomic action skills producing an artefact: `drive-create-spec`, `drive-close-project`, `drive-review-code`, `drive-triage-work`, `drive-check-health`.
- **`drive-<sub-namespace>-<verb>`** for atomic skills under a focused area: `drive-pr-description`, `drive-pr-walkthrough`, `drive-qa-plan`, `drive-qa-run`, `drive-specify-project`, `drive-specify-slice`, `drive-plan-project`, `drive-plan-slice`, `drive-run-retro`.
- **`drive-<verb>`** or **`drive-<noun>`** for single-name atomic skills: `drive-list`, `drive-discussion`.

The new skill names match these shapes. The `project-` / `slice-` sub-namespaces (introduced by the split skills) match the precedent set by `pr-` and `qa-`.

## 3. What changes from current to final

### 3.1 Vocabulary refresh (every existing skill)

Every existing canonical drive-* skill body uses pre-model vocabulary in at least one section. The refresh applies these replacements:

| Old word | New word | Why |
|---|---|---|
| milestone (Drive-side) | slice | Linear's "milestone" is unchanged; the Drive-side word for the PR-sized unit becomes "slice." |
| task (PR-sized unit sense) | slice | Slice is the Drive name; Linear keeps "issue." |
| task (agent-invocation sense) | dispatch | The agent-team word is "dispatch"; "step" was a plan-side concept that didn't survive. |
| plan (ambiguous between project / slice) | project plan / slice plan | Mandatory after the spec/plan-skill split lands. |

### 3.2 New skills

**Workflow tier (three; all new or renamed):**

| Skill | What it does | Why it's new |
|---|---|---|
| `drive-start-workflow` | Pilots triage + the verdict's setup chain (creates project / scaffolds slice / opens direct-change PR / runs promote-demote ceremony). | Today, triage routing is implicit and the operator hand-runs the downstream setup. Promoting to a workflow skill makes the path machine-driven and supports unattended-mode operation. |
| `drive-build-workflow` | Pilots a slice's implementation loop: pre-flight DoR → dispatch loop with WIP inspection → post-flight DoD → review → close. | Renamed from `drive-orchestrate-plan` (the old name didn't reflect what the skill does — you don't orchestrate a plan; you execute it). Five augmentations land with the rename. |
| `drive-deliver-workflow` | Pilots a project's lifecycle: init → slice-by-slice (each via `drive-build-workflow`) → health checks → retros → mandatory close retro. | Today the project lifecycle is hand-orchestrated by the operator. Promoting to a workflow skill supports unattended-mode operation and makes the project-DoD enforcement structural rather than convention-bound. |

**Atomic tier (seven new; two pairs replace two existing skills):**

| Skill | What it does | Why it's new |
|---|---|---|
| `drive-triage-work` | Routes an incoming ask (or scope-shift signal) to one of the eight triage verdicts: direct change / orphan slice / in-project slice / new project / promote / demote / spike first / defer. | Triage is load-bearing under the consolidated model (`model.md` § Workflows § Triage). Today the routing is implicit; the new skill makes it explicit and runnable. |
| `drive-specify-project` | Produces a project spec: purpose statement, scope boundary, project-DoD. Often invoked with design-discussion participation. | Split from `drive-create-spec`. Project-spec authoring has meaningfully different inputs, outputs, and templates from slice-spec authoring (D17). |
| `drive-specify-slice` | Produces a slice spec: scope within the parent project's purpose (if any), slice-DoD, Example-Mapping edge cases. Authored by the implementer. | Same split rationale. |
| `drive-plan-project` | Produces a project plan: composition of slices + direct changes with stack / parallel sequencing. Does not enumerate dispatches inside a slice. | Split from `drive-create-plan`. |
| `drive-plan-slice` | Produces a slice plan: dispatch sequence with sizing + DoR + DoD + model tier declared per dispatch; refuses to finalize with L/XL. | Same split rationale. |
| `drive-check-health` | Produces a project-health rollup. Two modes: interactive (session-bookended) and unattended (trigger-fired on slice merges, drift alarms, escalation events). | The rollup is one of the three workflow gaps in the consolidated model (`workflow.md` § Project-health rollup cadence). |
| `drive-run-retro` | Runs a retro on trigger. Mandatory output: a canonical update *or* team-context update *or* ADR. The retro is not done until the update lands in a memory-strong surface. | The retro is the team's only learning mechanism (`principles/protocol-as-memory.md`). Today retros happen ad hoc; the new skill makes triggers + the mandatory-output discipline explicit. |

### 3.3 Augmented existing atomic skills (four)

| Skill | Augmentation |
|---|---|
| `drive-close-project` | Three additions: mandatory final retro (calls `drive-run-retro`; project DoD requires the retro per invariant I10); refusal to delete `projects/<x>/` while project DoD is unmet; manual-QA coverage of the project's user-observable surface is part of project DoD. |
| `drive-create-project` | Two additions: project DoR check at entry (`principles/definition-of-ready.md` § Project DoR); seeds the `drive/<category>/README.md` entries the project's slice work will need (via `drive-bootstrap-context`). |
| `drive-discussion` | Promoted to first-class workflow standing. Body documents trigger points (pre-spec, mid-spec, mid-flight on falsified assumption, mid-flight on obstacle, explicit request) + the agile orchestrator's escalation responsibility + the output contract (spec / plan edit + `design-decisions.md` entry). Stays an atomic mode skill (`disable-model-invocation: true`); fires on trigger from any workflow skill or operator invocation. |
| `drive-pr-description` | Extended to handle the direct-change case: the PR description is the *only* persisted intent artefact for a direct change, so the skill carries the appropriate framing + brevity guidance + the "is this really a direct change, or did triage misroute?" sanity check. |

Note: `drive-build-workflow`'s five augmentations (per-dispatch DoR, WIP-inspection cadence, per-dispatch DoD with intent-validation, brief assembly, L/XL refusal + design-discussion stop-condition) are listed in § 3.2 since the rename + augmentation lands as one piece.

### 3.4 Vocabulary-only refresh

Skills whose bodies don't otherwise change:

`drive-agent-personas`, `drive-review-code`, `drive-create-deployment-plan`, `drive-post-update`, `drive-pr-walkthrough`, `drive-reverse-spec`, `drive-list`.

Plus the five PR #93 skills (`drive-qa-plan`, `drive-qa-run`, `drive-bootstrap-context`, `drive-reconcile-skills`, `drive-update-skills`) which are pre-aligned to the consolidated vocabulary — no body change needed.

### 3.5 Vocabulary retirements (no skill retirements)

No skill is retired by the restructure. Two **vocabulary retirements**:

- **"Milestone"** retires from Drive vocabulary. Where it appears in skill bodies, replace with "slice." Linear's "milestone" remains unchanged on the tracker side.
- **"Task"** retires in its two pre-model senses. Where it referred to a PR-sized unit, replace with "slice." Where it referred to an agent invocation, replace with "dispatch."

## 4. Build sequencing

Skills are built **locally in `prisma-next`** first (`.agents/skills/drive-*/SKILL.md`); see [`plan.md`](plan.md) for the full execution sequence. Dependency-respecting order for the build:

1. **Workflow tier first.** `drive-start-workflow`, `drive-build-workflow`, `drive-deliver-workflow`. Writing the workflows first surfaces the atomic-skill contracts they depend on.
2. **`drive-triage-work` + `drive-discussion` + `drive-run-retro` + `drive-check-health`.** The new atomic skills the workflows call. Built after the workflows so the calling contracts are clear.
3. **Splits.** `drive-specify-project` + `drive-specify-slice`; `drive-plan-project` + `drive-plan-slice`. Each pair is split-and-augment of an existing skill.
4. **Augmentations.** `drive-close-project`, `drive-create-project`, `drive-pr-description`. Augment existing bodies with the new behaviour.
5. **Vocabulary-only refresh** of the remaining skills. Mechanical; lowest-risk.

Once the full family is in place locally, a couple of weeks of real work in `prisma-next` validates the design by use. Calibration entries land in `drive/<category>/README.md` as we hit edge cases. Retros fire on the actual failures.

## 5. Upstream promotion (later)

After the trial period, the trialed-and-survived family is promoted upstream to `prisma/ignite` as a series of small PRs, each independently reviewable. The per-PR ordering aligns with § 4 above. Per-skill PRs land canonical-side stacked on top of PR #93; consumers of `prisma/ignite` adopt skill-by-skill via `drive-reconcile-skills` (already part of PR #93).

[`plan.md`](plan.md) carries the slice-by-slice schedule including the upstream-promotion slices.

## 6. What this plan does not decide

- The body shape of any individual skill — deferred to per-skill build.
- The exact frontmatter schema canonical-side — inherits from current `prisma/ignite` convention.
- The retirement timeline for `drive-create-spec` / `drive-create-plan` after their splits land — per consumer adoption schedule via `drive-reconcile-skills`.
- Whether to add a `drive-direct-change` skill in the future if direct-change framing in `drive-pr-description` proves insufficient (working position: don't until it does).

## References

- [`model.md`](model.md) — pinned domain model (vocabulary + workflows + invariants the skills enforce)
- [`workflow.md`](workflow.md) — operational lifecycle layered on the model
- [`spec.md`](spec.md) — what this project delivers; ACs that mention the skill restructuring
- [`plan.md`](plan.md) — execution plan (build sequence + upstream promotion)
- [`design-decisions.md`](design-decisions.md) — the alternatives ledger (D17 split rationale; later D24/D25/D26 for the workflow-tier separation, rename, and work-locally-first pivot)
- [`principles/`](principles/) — the principle docs every augmentation references; gradual-ai-adoption is the principle the workflow-vs-atomic split serves
- [`prisma/ignite#93`](https://github.com/prisma/ignite/pull/93) — the assumed-landed base (project-context convention + QA pair + meta-skills)
- [`prisma/ignite skills/README.md`](https://github.com/prisma/ignite/blob/main/skills/README.md) — naming convention (consistency-preferred)
