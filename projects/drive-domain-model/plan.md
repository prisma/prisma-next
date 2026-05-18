# Plan — Drive domain model + agile orchestration

The execution plan for landing the work `spec.md` defines. Maps acceptance criteria (AC1-AC15) onto the slices and direct changes that deliver them. Slice composition is shaped by where each piece lives: this repo (`prisma-next` worktree, methodology + calibration) vs the canonical `prisma/ignite` repo (skill bodies + `drive-process.md` rewrite).

## Status snapshot

The consolidation slice (this PR on `tml-2549-agile-agent-orchestration`) is in flight. Methodology + model + principle docs + calibration + restructure plan have landed in commits `34c202d1b..b3da0e2a6`. Remaining: this `plan.md` (final commit of the consolidation slice), then the canonical-side slices in `prisma/ignite`, then the validation + close-out work.

| Slice | Status | Repo | Covers |
|---|---|---|---|
| Consolidation (this PR) | In flight | this repo | AC1 (drafted), AC2, AC3, AC4, AC5 |
| Foundation vocab refresh | Not started | `prisma/ignite` | AC9 (partial — vocabulary half) |
| `drive-triage-work` | Not started | `prisma/ignite` | AC6 |
| `drive-{project,slice}-specify` pair | Not started | `prisma/ignite` | (skill split per AC5) |
| `drive-{project,slice}-plan` pair | Not started | `prisma/ignite` | (skill split per AC5) |
| `drive-orchestrate-plan` augmentation | Not started | `prisma/ignite` | AC7 |
| `drive-discussion` promotion | Not started | `prisma/ignite` | (skill change per AC5) |
| `drive-retro-run` | Not started | `prisma/ignite` | (new skill per AC5) |
| `drive-health-check` | Not started | `prisma/ignite` | (new skill per AC5) |
| `drive-close-project` augmentation | Not started | `prisma/ignite` | (skill augment per AC5) |
| `drive-create-project` augmentation | Not started | `prisma/ignite` | (skill augment per AC5) |
| `drive-process.md` rewrite | Not started | `prisma/ignite` | AC14 |
| Validation: direct change end-to-end | Not started | this repo (exercise) | AC10 |
| Validation: orphan slice end-to-end | Not started | this repo (exercise) | AC11 |
| Validation: promotion end-to-end | Not started | this repo (exercise) | AC12 |
| Validation: demotion end-to-end | Not started | this repo (exercise) | AC13 |
| Audit follow-up | Not started | `prisma/ignite` | AC15 |
| Calibration migration to `prisma-next/docs/` | Not started | this repo | (per `calibration/prisma-next.md` § 8) |
| Project close-out | Not started | this repo | (project DoD per `principles/definition-of-done.md`) |

## Slice composition

### Slice 1: Consolidation (this PR)

**Repo:** this worktree (`tml-2549-agile-agent-orchestration`).

**Scope:** Merge the two predecessor projects into one; produce the substrate every subsequent slice builds on.

**Deliverables (already landed in commits `34c202d1b..b3da0e2a6` + this `plan.md`):**

| Deliverable | File | Status | Covers |
|---|---|---|---|
| Structural consolidation | folder rename, handovers deleted, sibling model promoted, gitignore | ✓ | — |
| Pinned model | `model.md` | ✓ | AC1 |
| Unified spec | `spec.md` | ✓ | — |
| Workflow map | `workflow.md` | ✓ | AC2 |
| README + design-decisions | `README.md`, `design-decisions.md` | ✓ | — |
| Existing principles refresh | `principles/{protocol-as-memory,decomposition-and-cost,spikes}.md` | ✓ | AC3 (partial) |
| New principle docs | `principles/{roles-and-personas,brief-discipline,definition-of-ready,definition-of-done,retro}.md` | ✓ | AC3 |
| Calibration refresh | `calibration/prisma-next.md` | ✓ | AC4 |
| Skill restructuring plan | `skill-restructure.md` | ✓ | AC5 |
| Execution plan | `plan.md` (this file) | In progress | — |

**Sizing:** XL (composes ~14 commits across 13 files; ~3000 lines). Per the model's I1 invariant, an XL slice would normally route to a project — but this *is* the project's substrate slice; subsequent slices ship in the canonical repo, not here. The PR's size is justified by the substrate nature of the content (every file references every other; splitting into multiple PRs would create churn).

**Acceptance for slice 1:** Operator review pass on the consolidated docs; merged to `main` in this repo.

### Slice 2..12: Canonical-side restructure (each in `prisma/ignite`)

Per [`skill-restructure.md`](skill-restructure.md) § 4 (Implementation sequencing). One PR per skill or per related pair:

| Slice # | PR scope | Bucket landed | Sizing |
|---|---|---|---|
| 2 | Foundation vocabulary refresh across unchanged skills | `.curated/`, `.experimental/`, `.system/` | M (mechanical; many files) |
| 3 | `drive-triage-work` (new) | `.experimental/` | M |
| 4 | `drive-project-specify` + `drive-slice-specify` (split) + `drive-create-spec` deprecation | `.curated/` | M |
| 5 | `drive-project-plan` + `drive-slice-plan` (split) + `drive-create-plan` deprecation | `.curated/` | M |
| 6 | `drive-orchestrate-plan` augmentation (the five additions) | `.curated/` | M |
| 7 | `drive-discussion` promotion-to-first-class (body update) | `.curated/` | S |
| 8 | `drive-retro-run` (new) | `.experimental/` | S |
| 9 | `drive-health-check` (new) | `.experimental/` | M |
| 10 | `drive-close-project` augmentation (mandatory retro + DoD enforcement) | `.curated/` | S |
| 11 | `drive-create-project` augmentation (project DoR check + slice template seeding) | `.curated/` | S |
| 12 | `drive-process.md` rewrite (canonical doc) | `docs/engineering/` | M-L (one big doc but mostly composing pre-written principles) |

**Each PR carries:**
- Skill body / doc body content (Option B work per `skill-restructure.md`).
- A PR description referencing this project's `model.md` + `skill-restructure.md` + the relevant principle docs.
- A vocabulary check (no "milestone" / "task" in pre-model senses in the changed files).
- A `drive-reconcile-skills` auto-classification check (no model-incompatible drift left silently extracted).

**Acceptance per slice:** Canonical-side review pass + merge.

### Slice 13..16: End-to-end validation

| Slice # | Validates | How exercised | Covers AC |
|---|---|---|---|
| 13 | Direct change path | Trivial change taken through `drive-triage-work` → `gh pr create` | AC10 |
| 14 | Orphan slice path | Bug-fix-scale entry point through `drive-triage-work` → `drive-slice-specify` (orphan) → `drive-slice-plan` (orphan) → `drive-orchestrate-plan` → merge | AC11 |
| 15 | Promotion path | Ticket triaged at `drive-triage-work` as "needs project ceremony" → promotion workflow runs → Linear Project created + original ticket promoted-pattern-applied | AC12 |
| 16 | Demotion path | In-flight project whose remaining scope is one PR → demotion workflow runs → surviving Linear issue stands alone + Linear Project Cancelled / Completed | AC13 |

**Sizing per validation slice:** XS-S (the exercise is small; the validation is "the path worked"). Happens as natural work flows through the new path, not as a contrived exercise — these are real changes that happen to be the first of their kind under the new path.

### Slice 17: Audit follow-up

**Repo:** `prisma/ignite`.

**Scope:** Per `spec.md` FR9 / AC15. Annotate `projects/drive-context-convention/audit/SYNTHESIS.md` to note that several of its Tier 1 recommendations were superseded by this work. Audit reports themselves stay unmodified.

**Sizing:** XS.

**Acceptance:** Synthesis carries the supersedure annotation; audit reports unchanged.

### Slice 18: Calibration migration

**Repo:** this worktree (`prisma-next`).

**Scope:** Once the canonical skill restructure is stable AND `prisma-next` has adopted the new canonical, migrate `calibration/prisma-next.md` into `prisma-next/docs/` (likely under `docs/engineering/agile-calibration.md` or similar) and update references in the methodology project to point there.

**Trigger:** Stability signal — at least one full cycle of the new path (triage → slice → dispatch → review → close → retro) completed in `prisma-next` without surfacing calibration gaps.

**Sizing:** S (file move + reference updates).

### Slice 19: Project close-out

**Repo:** this worktree (`prisma-next`).

**Scope:** Per `principles/definition-of-done.md` § Project DoD. Run mandatory final retro (`drive-retro-run`); verify all ACs met; migrate any remaining long-lived docs to durable homes; delete `projects/drive-domain-model/`; clean up references; close the Linear Project.

**Sizing:** S.

**Acceptance:** Project DoD's required items all met (per the project DoD calibration overlay in `calibration/prisma-next.md` § 3.1, soon migrated).

## Sequencing + dependencies

```
Slice 1 (consolidation, this PR)
    │
    ├─→ Slice 2 (foundation vocab refresh)
    │       │
    │       ├─→ Slice 3 (drive-triage-work)
    │       │       │
    │       │       └─→ Slices 13-16 (validation paths)
    │       │
    │       ├─→ Slice 4 (specify split)
    │       ├─→ Slice 5 (plan split)
    │       ├─→ Slice 6 (orchestrate-plan augmentation)
    │       │       │
    │       │       └─→ Slice 9 (health-check)
    │       │
    │       ├─→ Slice 7 (discussion promotion)
    │       │
    │       └─→ Slice 8 (retro-run)
    │               │
    │               └─→ Slice 10 (close-project augmentation)
    │
    └─→ Slice 11 (create-project augmentation)
            │
            └─→ Slice 12 (drive-process.md rewrite)
                    │
                    └─→ Slice 17 (audit follow-up)
                            │
                            └─→ Slice 18 (calibration migration; gated by stability signal)
                                    │
                                    └─→ Slice 19 (project close-out)
```

Slices 4, 5, 7, 8, 11 can land in parallel after Slice 2. Slices 3, 6 are gating; everything downstream depends on them.

## Cadence

- **Slice 1** ships as one PR review-and-merge cycle (operator approves consolidation; merges).
- **Slices 2-12** ship at the consumer's adoption pace. Per `spec.md` NFR2, each is independently reviewable in the canonical repo. No omnibus.
- **Slices 13-16** happen as natural work flows; the agile orchestrator notices "this is the first promotion under the new path" and marks the validation box.
- **Slices 17-19** are close-out work, gated on the canonical restructure being stable enough that consumers don't expect more churn.

## Risks

| Risk | Mitigation |
|---|---|
| Canonical-side restructure stalls without per-skill follow-through | This `plan.md` enumerates each skill PR explicitly; project health check (`drive-health-check`) surfaces the missing-slice signal. |
| Consumer drift: `prisma-next` (and others) adopt unevenly | Per `spec.md` NFR3, `drive-reconcile-skills` is calibrated for model-incompatible drift to surface as upstream-worthy. Consumer migration is per-consumer and not blocking. |
| Vocabulary discipline erodes in canonical PRs | Per `spec.md` NFR5, the grep for floating vocabulary should return empty across canonical bodies after the rewrite. A pre-merge check (or PR template item) lands in Slice 2. |
| Demotion path edge cases discovered late | Slice 16's exercise is the discovery vehicle. If issues surface, the demotion workflow updates in this project (`model.md` § Linear sync — Demotion pattern); skill restructure refs update. |
| Project drag: calibration migration (Slice 18) gets deferred indefinitely | Calibration migration is gated on the stability signal; if 60 days pass with no calibration entries added, that IS the stability signal — migrate. |

## Mid-flight adaptation

Per [`principles/retro.md`](principles/retro.md) and `model.md` invariant I12 (no silent agent-side amendments): any mid-flight learning that affects this plan is captured via retro + landed update. If a canonical PR surfaces an issue with the model itself (rare; the substrate is meant to be stable), the issue triggers a design discussion before the canonical PR proceeds.

The plan can change. Spec and model are stable.

## Acceptance recap (AC1-AC15)

| AC | Where it lands | Status |
|---|---|---|
| AC1 | `model.md` | Drafted; operator sign-off pending |
| AC2 | `workflow.md` | Drafted |
| AC3 | `principles/{eight docs}` | Drafted |
| AC4 | `calibration/prisma-next.md` | Drafted |
| AC5 | `skill-restructure.md` | Drafted |
| AC6 | `drive-triage-work` skill in `prisma/ignite` | Pending Slice 3 |
| AC7 | `drive-orchestrate-plan` augmentation in `prisma/ignite` | Pending Slice 6 |
| AC8 | Per-skill canonical PRs | Pending Slices 4-11 |
| AC9 | Vocabulary grep clean across canonical bodies | Pending Slice 2 (+ ongoing) |
| AC10 | Direct change end-to-end exercise | Pending Slice 13 |
| AC11 | Orphan slice end-to-end exercise | Pending Slice 14 |
| AC12 | Promotion end-to-end exercise | Pending Slice 15 |
| AC13 | Demotion end-to-end exercise | Pending Slice 16 |
| AC14 | `docs/engineering/drive-process.md` rewrite | Pending Slice 12 |
| AC15 | Audit synthesis annotation | Pending Slice 17 |

## References

- [`spec.md`](spec.md) — what to deliver
- [`model.md`](model.md) — the substrate every slice builds on
- [`workflow.md`](workflow.md) — operational layer
- [`skill-restructure.md`](skill-restructure.md) — per-skill verdicts + sequencing
- [`principles/`](principles/) — the rituals every augmented skill enforces
- [`calibration/prisma-next.md`](calibration/prisma-next.md) — worked-example calibration
- [`design-decisions.md`](design-decisions.md) — chronological record of decisions (D1-D20)
