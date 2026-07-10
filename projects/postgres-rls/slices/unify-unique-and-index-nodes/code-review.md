# Slice 2.6 — code review ledger (rebuilt)

Spec: [`spec.md`](./spec.md) · Design: [`design.md`](./design.md) · Plan: [`plan.md`](./plan.md).

The prior 24-commit attempt (merge unique into index) was discarded — it merged two distinct schema elements into one node, forcing back the tree-massaging the slice exists to remove. Branch reset to `origin/main`; rebuilding the small correct slice per the design.

## Subagent IDs

| Role | ID | Model | Notes |
| --- | --- | --- | --- |
| Implementer | persistent (resumed) | sonnet | rebuild dispatch |
| Reviewer | persistent (resumed) | opus | |

## AC scoreboard

| AC | Status | Evidence |
| --- | --- | --- |
| AC-1 reconciliation pass + caller-less predicates deleted; differ runs on trees as derived; `diff-tree-normalization.ts` gone | ⬜ | |
| AC-2 `SqlUniqueIR`/`SqlIndexIR` two distinct nodes; `isEqualTo` symmetric; no marker/dedupe/fail-loud | ⬜ | |
| AC-3 FK normalization folded into derivation; no pre-diff pass survives | ⬜ | |
| AC-4 structural behaviour pinned; extra-tolerance grading provably unchanged; full gate green | ⬜ | |

## Orchestrator notes

- 2026-07-10: operator rejected the merge-into-one-node model as a violation of "one node per element, no tree massaging." Branch reset to origin/main; corrected design in `design.md`. The correct slice: delete the reconciliation, keep the two nodes, fold FK resolution into derivation, `SqlIndexIR.isEqualTo` symmetric. Deliberate behaviour change (satisfaction cases become drift), fenced to unique/index (axis-2 extra-tolerance untouched).
