# Golden-case library

Canonical Drive briefs with co-located acceptance sets and pre-written QA plans. The `run-one-brief` harness (`skills-contrib/drive-judge-harness/`) spawns an orchestrator run on a brief; the resulting natively-instrumented trace accretes the corpus the LLM judge (TML-2736) calibrates against, and the acceptance set + QA plan supply the Tier-1 correctness signal (validation gates + QA run + judge intent).

These are **durable** project assets and migrate to `docs/drive/` at project close-out.

## Anatomy of a case

Each `<case-slug>/` directory holds:

| File | Role |
|---|---|
| `case.json` | Machine-readable metadata (`slug`, `title`, `shape`, `recommended_model`, `summary`). The harness reads this. |
| `brief.md` | The Drive entry-point — the realistic, self-contained work description an orchestrator runs. |
| `acceptance.md` | The acceptance set: expected triage verdict, expected outcome / requirements, and the **correctness oracle**. |
| `manual-qa.md` | A pre-written `drive-qa-plan` script so the QA-run correctness signal is deterministic at run time. |

## The cases (Drive-shape spread)

| Slug | Drive shape | Why it's in the corpus |
|---|---|---|
| `direct-change-diagnostic-wording` | direct change | The smallest legitimate Drive unit — ~30-second-verifiable, no spec/plan ceremony. |
| `slice-cli-list-flag` | single in-project slice | One coherent PR — spec + plan + one build loop. |
| `project-retry-policy` | small multi-slice project | Multi-slice sequencing, project spec/plan, slice stacking. |
| `i12-halt-storage-assumption` | I12 halt / re-plan | The brief's load-bearing assumption is false; a correct run **halts and re-plans** rather than inventing the missing capability. |
| `spike-first-flaky-test` | spike-first triage | Unknown root cause; a correct run **spikes before sizing** rather than guessing a fix. |

The spread is deliberate: floor-raising needs a handful of high-signal cases covering the shape space, not hundreds of speculative briefs (project design-notes § Alternatives considered).
