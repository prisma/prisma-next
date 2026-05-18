# Plan — Drive domain model + agile orchestration

The execution plan for landing the work `spec.md` defines. Maps acceptance criteria (AC1-AC18) onto the slices that deliver them.

## Strategy: build locally, trial, then promote

We're shipping in three phases, in order:

1. **Phase 1 — Shape** (in this repo, this PR). Land the methodology, model, principle docs, calibration, restructure plan, and execution plan. The substrate every subsequent slice builds on.
2. **Phase 2 — Build + trial locally** (in this repo, the same PR). Build the full Drive skill family — three workflow skills + the new atomic skills + augmentations + vocabulary refresh — locally in `prisma-next` `.agents/skills/`. Phase-2 slices ride the same PR as Phase 1 (each slice is its own focused commit; the PR grows commit-by-commit). Once the family is in place, use it in real work for a couple of weeks; retros fire on real failures; calibration entries land in `drive/<category>/README.md`.
3. **Phase 3 — Promote upstream** (in `prisma/ignite`, one PR per skill). Once we know what survived the trial, open the upstream PR series. Each PR carries one or two related skills, stacks on PR #93, independently reviewable.

This replaces the earlier strategy of opening upstream PRs incrementally as each piece was drafted. The trial period catches design problems before they crystallize into canonical bodies that downstream consumers then have to migrate around. Keeping Phase 2 on the same PR lets reviewers see the full family as a coherent whole rather than reviewing pieces in isolation.

## Status snapshot

The shaping slice (this PR on `tml-2549-agile-agent-orchestration`) is in flight. Methodology + model + principle docs + calibration + restructure plan have landed. The remaining work is the local build (Phase 2), the trial use, and the upstream promotion (Phase 3).

| Slice | Phase | Status | Repo | Covers |
|---|---|---|---|---|
| Shape: consolidation (this PR) | 1 | In flight | this repo | AC1 (drafted), AC2, AC3, AC17 |
| Build: workflow tier (3 skills) | 2 | Not started | this repo | AC4 |
| Build: `drive-triage-work` + `drive-discussion` promotion | 2 | Not started | this repo | AC5 |
| Build: spec + plan splits (4 atomic skills) | 2 | Not started | this repo | AC7 |
| Build: `drive-build-workflow` augmentations | 2 | Not started | this repo | AC6 |
| Build: `drive-retro-run` + `drive-health-check` | 2 | Not started | this repo | AC7 |
| Build: atomic augmentations (close-project, create-project, pr-description) | 2 | Not started | this repo | AC7 |
| Build: vocabulary refresh on unchanged skills | 2 | Not started | this repo | AC7, AC8 |
| Trial: real-work use of the family | 2 | Not started | this repo (exercise) | AC9, AC11-AC15 |
| Promote: per-skill PR series | 3 | Not started | `prisma/ignite` | AC10 |
| Promote: `drive-process.md` rewrite | 3 | Not started | `prisma/ignite` | AC16 |
| Promote: audit synthesis annotation | 3 | Not started | `prisma/ignite` | AC18 |
| Close-out: calibration migration into `prisma-next/docs/` | 3 | Not started | this repo | (per `calibration/prisma-next.md` § 8) |
| Close-out: project DoD + delete `projects/drive-domain-model/` | 3 | Not started | this repo | (project DoD per `principles/definition-of-done.md`) |

## Phase 1 — Shape (this PR)

**Repo:** this worktree (`tml-2549-agile-agent-orchestration`).

**Scope:** Merge the two predecessor projects into one; produce the substrate every subsequent slice builds on. Land the workflow-vs-atomic tier distinction; introduce the three workflow skills (`drive-start-workflow`, `drive-build-workflow`, `drive-deliver-workflow`); name the gradual-AI-adoption principle.

**Deliverables (already landed; this commit adds the workflow-tier + gradual-AI-adoption updates):**

| Deliverable | File | Status | Covers |
|---|---|---|---|
| Structural consolidation | folder rename, handovers deleted, sibling model promoted, gitignore | ✓ | — |
| Pinned model | `model.md` | ✓ (workflow-tier section added) | AC1 |
| Unified spec | `spec.md` | ✓ (work-locally-first + workflow tier reflected) | — |
| Workflow map | `workflow.md` | ✓ (workflow-tier rows + cadence) | AC2 |
| Problem statement | `problem-statement.md` | ✓ | — |
| README + design-decisions | `README.md`, `design-decisions.md` | ✓ | — |
| Principle docs | `principles/{eight previously-shipped + gradual-ai-adoption}.md` | ✓ | AC3 |
| Calibration | `calibration/prisma-next.md` | ✓ | AC17 |
| Skill restructuring plan | `skill-restructure.md` | ✓ (workflow tier + build-locally rewrite) | — |
| Execution plan | `plan.md` (this file) | ✓ (rewritten for build-locally) | — |

**Sizing:** XL. As the project's substrate slice, the size is justified by the cross-referential nature of the docs (every file references every other; splitting into multiple PRs would create churn). Subsequent phases ship in separate PRs.

**Acceptance for shaping slice:** Operator review pass on the consolidated docs; merged to `main` in this repo.

## Phase 2 — Build + trial locally

**Repo:** this worktree (`prisma-next`). Skills land in `.agents/skills/drive-<name>/SKILL.md` (where `.claude/skills` is a symlink to `.agents/skills`).

Sequencing follows [`skill-restructure.md`](skill-restructure.md) § 4. Each slice below is a focused commit on this PR. (Earlier draft had each slice as its own PR; on operator instruction we keep Phase 2 on the same PR so reviewers see the full family as a coherent whole.)

| Slice # | Scope | Sizing | Covers |
|---|---|---|---|
| 2 | Workflow tier: draft `drive-start-workflow`, `drive-build-workflow`, `drive-deliver-workflow`. Writing the workflows first surfaces the atomic-skill contracts they depend on. | L | AC4 |
| 3 | `drive-triage-work` (new) + `drive-discussion` promotion to first-class | M | AC5 |
| 4 | Spec split: `drive-project-specify` + `drive-slice-specify` (with `drive-create-spec` deprecation) | M | AC7 |
| 5 | Plan split: `drive-project-plan` + `drive-slice-plan` (with `drive-create-plan` deprecation) | M | AC7 |
| 6 | `drive-build-workflow` augmentations: per-dispatch DoR, WIP-inspection cadence, per-dispatch DoD with intent-validation, brief template, L/XL refusal + design-discussion stop-condition | M | AC6 |
| 7 | `drive-retro-run` (new) | S | AC7 |
| 8 | `drive-health-check` (new) | M | AC7 |
| 9 | Atomic augmentations: `drive-close-project` (mandatory retro), `drive-create-project` (project DoR + bootstrap), `drive-pr-description` (direct-change framing) | M | AC7 |
| 10 | Vocabulary refresh across the unchanged skills (mechanical; many files) | M | AC7, AC8 |

**Each Phase-2 commit carries:**

- The skill body content (frontmatter + Workflow + Pitfalls + Checklist + project-context loading per PR #93 convention).
- A commit message referencing the project's `model.md` + `skill-restructure.md` + the relevant principle docs.
- A vocabulary check (no "milestone" / "task" in pre-model senses in the changed files).
- New `drive/<category>/README.md` categories (`drive/triage/`, `drive/retro/`, `drive/health/`) seeded if the slice introduces them.

**Acceptance per Phase-2 commit:** Operator review on the diff before continuing to the next commit. The whole PR ships together once all Phase-2 commits + the trial slice are done.

### Trial period

| Slice # | Validates | How exercised | Covers AC |
|---|---|---|---|
| 11 | The full family by use | Real `prisma-next` work over ≥ 2 weeks using the new skills. Retros fire on real failures. Calibration entries land in `drive/<category>/README.md`. Walkthroughs 1-3 run as natural work flows. | AC9, AC11-AC15 |

Not a contrived exercise — these are real changes that happen to be the first of their kind under the new path. The agile orchestrator notices "this is the first promotion under the new path" and marks the validation box.

The trial slice can run in parallel with the later Phase-2 build slices (e.g. as the workflow tier lands, we start using it; the splits land later and slot in).

## Phase 3 — Promote upstream

**Repo:** `prisma/ignite` (per-skill PRs).

After the trial, each surviving skill is promoted upstream. The per-PR order aligns with Phase 2 above. Each PR stacks on PR #93, independently reviewable, no omnibus.

| Slice # | PR scope (in `prisma/ignite`) | Sizing |
|---|---|---|
| 12 | Foundation vocabulary refresh across unchanged skills | M |
| 13 | Workflow tier: `drive-start-workflow`, `drive-build-workflow` (rename + augment from `drive-orchestrate-plan`), `drive-deliver-workflow` | L |
| 14 | `drive-triage-work` | M |
| 15 | Spec split: `drive-project-specify` + `drive-slice-specify` + `drive-create-spec` deprecation | M |
| 16 | Plan split: `drive-project-plan` + `drive-slice-plan` + `drive-create-plan` deprecation | M |
| 17 | `drive-discussion` promotion-to-first-class | S |
| 18 | `drive-retro-run` | S |
| 19 | `drive-health-check` | M |
| 20 | Atomic augmentations: `drive-close-project`, `drive-create-project`, `drive-pr-description` | M |
| 21 | `drive-process.md` rewrite | M-L |
| 22 | Audit synthesis annotation (`projects/drive-context-convention/audit/SYNTHESIS.md`) | XS |

**Acceptance per Phase-3 slice:** Canonical-side review pass + merge in `prisma/ignite`.

## Close-out (in this repo)

| Slice # | Scope | Sizing |
|---|---|---|
| 23 | Calibration migration: move `calibration/prisma-next.md` content into `prisma-next/docs/` (likely `docs/engineering/agile-calibration.md`) once the upstream restructure has stabilised. Update methodology-project references. | S |
| 24 | Project close-out: run mandatory final retro (`drive-retro-run`); verify all ACs met; migrate any remaining long-lived docs to durable homes; delete `projects/drive-domain-model/`; clean up references. | S |

**Trigger for Slice 23:** Stability signal — at least one full cycle of the new path (triage → slice → dispatch → review → close → retro) completed in `prisma-next` without surfacing calibration gaps. If 60 days pass post-promotion with no calibration entries added, that IS the stability signal — migrate.

## Sequencing + dependencies

```
Phase 1: Slice 1 (this PR)
    │
    ▼
Phase 2: Slice 2 (workflow tier)
    │
    ├─→ Slice 3 (drive-triage-work + drive-discussion)
    ├─→ Slice 4 (specify split)        ┐
    ├─→ Slice 5 (plan split)            ├─ can run in parallel after Slice 2
    ├─→ Slice 6 (build-workflow aug)    │
    ├─→ Slice 7 (drive-retro-run)       │
    ├─→ Slice 8 (drive-health-check)    │ (depends on build-workflow for trigger interop)
    ├─→ Slice 9 (atomic augmentations)  │
    └─→ Slice 10 (vocabulary refresh)   ┘
                │
                ▼
Phase 2: Slice 11 (trial use) ──── runs alongside the later build slices
                │
                ▼
Phase 3: Slices 12-22 (upstream promotion, in canonical order)
                │
                ▼
Close-out: Slice 23 (calibration migration; gated by stability signal)
                │
                ▼
Close-out: Slice 24 (project close-out)
```

## Cadence

- **Phase 1 (Slice 1)** ships as one PR review-and-merge cycle.
- **Phase 2 build slices (Slices 2-10)** ship at workshop pace — one PR at a time on the local branch, merged once review passes.
- **Phase 2 trial (Slice 11)** runs in parallel with the later build slices; the validation boxes get checked as real-world flows hit them.
- **Phase 3 promotion (Slices 12-22)** ships at canonical adoption pace. Per `spec.md` AC10, each is independently reviewable. No omnibus.
- **Close-out (Slices 23-24)** is gated on stability signal + project DoD.

## Risks

| Risk | Mitigation |
|---|---|
| Trial period reveals the workflow tier is wrong-shape | That's exactly what the trial is for. Fixing the design before upstream PRs is cheaper than fixing it after. Adjust + extend trial. |
| Trial drags on without producing learnings | Build trial-end criteria into the slice 11 success conditions: at least three retros fired + landed updates. If no learnings surface, the design is probably right OR usage is too sparse to validate — escalate as a design discussion. |
| Local skill drift from canonical PR #93 baseline | Trial period freezes our local skills as a snapshot of PR #93 + the new family. We re-converge during Phase 3 PR-by-PR. |
| Phase-3 promotion stalls without per-skill follow-through | Plan enumerates each skill PR explicitly; `drive-health-check` surfaces the missing-slice signal. |
| Consumer drift: other repos (besides `prisma-next`) adopt unevenly | Per `spec.md` AC10, each PR is independently reviewable. `drive-reconcile-skills` is calibrated for model-incompatible drift to surface as upstream-worthy. Consumer migration is per-consumer and not blocking. |
| Vocabulary discipline erodes in canonical PRs | The grep for floating vocabulary should return empty across canonical bodies after the rewrite. A pre-merge check (or PR template item) lands in Slice 12. |

## Mid-flight adaptation

Per [`principles/retro.md`](principles/retro.md) and `model.md` invariant I12 (no silent agent-side amendments): any mid-flight learning that affects this plan is captured via retro + landed update. If a Phase-2 slice surfaces an issue with the model itself (rare; the substrate is meant to be stable), the issue triggers a design discussion before the slice proceeds.

The plan can change. Spec and model are stable.

## Acceptance recap (AC1-AC18)

| AC | Where it lands | Status |
|---|---|---|
| AC1 | `model.md` | Drafted; operator sign-off pending |
| AC2 | `workflow.md` | Drafted |
| AC3 | `principles/{nine docs}` | Drafted (gradual-ai-adoption new this PR) |
| AC4 | Three workflow skills locally | Pending Slice 2 |
| AC5 | `drive-triage-work` locally | Pending Slice 3 |
| AC6 | `drive-build-workflow` augmentations locally | Pending Slice 6 |
| AC7 | Remaining restructured skills locally | Pending Slices 3-10 |
| AC8 | Vocabulary grep clean across local bodies | Pending Slice 10 (+ ongoing) |
| AC9 | Two-week trial + ≥ 3 retros with landed updates | Pending Slice 11 |
| AC10 | Per-skill PR series in `prisma/ignite` | Pending Slices 13-20 |
| AC11 | Direct change end-to-end (during trial) | Pending Slice 11 |
| AC12 | Multi-PR project end-to-end (during trial) | Pending Slice 11 |
| AC13 | Mid-flight assumption-falsification (during trial) | Pending Slice 11 |
| AC14 | Demotion end-to-end (during trial) | Pending Slice 11 |
| AC15 | Orphan slice end-to-end (during trial) | Pending Slice 11 |
| AC16 | `drive-process.md` rewrite | Pending Slice 21 |
| AC17 | `calibration/prisma-next.md` | Drafted |
| AC18 | Audit synthesis annotation | Pending Slice 22 |

## References

- [`spec.md`](spec.md) — what to deliver
- [`model.md`](model.md) — the substrate every slice builds on
- [`workflow.md`](workflow.md) — operational layer
- [`skill-restructure.md`](skill-restructure.md) — workflow + atomic tier inventory
- [`principles/`](principles/) — the rituals every augmented skill enforces; gradual-AI-adoption is the principle the two-tier split serves
- [`calibration/prisma-next.md`](calibration/prisma-next.md) — worked-example calibration
- [`design-decisions.md`](design-decisions.md) — chronological record of decisions
