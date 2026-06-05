# Code review — check-single-target-multi-space (TML-2835)

> Reviewer maintains scoreboard/findings/round-notes/summary; orchestrator owns § Subagent IDs + § Orchestrator notes.

## Summary

- **Current verdict:** _(pending)_
- **AC scoreboard totals:** 0 PASS / 0 FAIL / 1 NOT VERIFIED
- **Open findings:** 0

## Acceptance criteria scoreboard

| AC ID | Description (short) | Dispatch | Status | Evidence |
| ----- | ------------------- | -------- | ------ | -------- |
| AC-1 | `check <ref>` resolves a non-app-space migration; `--space` narrows single-target; cross-space ambiguous ref errors PRECONDITION; exit codes still documented in `--help` | D1 | NOT VERIFIED | — |

## Subagent IDs

- **Implementer:** D1 = _(pending)_ (sonnet; harness has no resume — fresh per dispatch).
- **Reviewer:** _(pending)_

## Findings log

_(none yet)_

## Round notes

_(round 1 will land here)_

## Orchestrator notes

**Build executed via the drive-build-workflow protocol directly** (not re-invoking the skill — its full body was loaded an hour ago for the TML-2801 slice; re-reading would only burn context). Same loop: dispatch → intent-validate DoD → opus reviewer pass → on SATISFIED push + open PR (operator wants autonomous + auto-PR). Single-dispatch slice. Model tiers per `drive/calibration/model-tier.md`: implementer sonnet (design pinned in spec, reuses TML-2801's enumerateCheckSpaces pattern, precise brief); reviewer opus.
