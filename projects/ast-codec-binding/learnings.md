# Project learnings — ast-codec-binding

> Patterns surfaced during this run. Working ledger; reviewed at close-out for migration to durable docs (per `drive-orchestrate-plan` § Project learnings).

### Public-export deletion needs workspace-wide typecheck, even when scoped tests look clean

**Shape.** A milestone deletes a public export from a workspace package. The owning package's typecheck and tests are clean (the deletion is internally coherent). A different workspace package (here, `test/integration/test/sql-builder/fixtures/contract.ts`) still imports the deleted symbol; package-scoped typecheck of the *owning* package never sees it. A grep across the repo would have surfaced it immediately.

**Why it matters.** The implementer's M3a gate was deliberately package-scoped (per the original plan, to keep M3a tractable while M3b/M3c churn the workspace). That scoping meta-rule is right for additive milestones; it's wrong for deletion milestones. F1 escaped the gate, the reviewer caught it via workspace typecheck, and we ate a re-round we could have avoided.

**Action.** When a milestone (or sub-commit) deletes a public export, the gate must include `pnpm typecheck` workspace-wide AND a cross-package grep for the deleted symbol(s) across `packages/`, `test/`, and `examples/`. The gate cost is minutes; the alternative is a lost round. Pin this in M3a/M3b/M3c gates explicitly and add it to the M3b/M3c orchestrator-prompt reminder list.

### Fresh subagent loses track of own commits mid-round

**Shape.** A fresh `generalPurpose` subagent assigned a multi-commit milestone confidently produced commits 1, 2, 3 — then in its end-of-round report described commits 1 and 2 as "already on the branch from a prior round" while attributing only commit 3 to the round. Git timestamps (and the orchestrator's pre-flight HEAD pointer) confirm all three were authored during the round; the subagent simply lost continuity with its own earlier work.

**Why it matters.** Without independent verification, the orchestrator could mistake the report's framing for a "stray edits between rounds" alarm and burn time investigating who/what made the commits. The implementer's report is unreliable as a record of *who did what*; only the on-disk diff and git history are reliable.

**Action.** When an implementer report misframes its own work, do not waste a round investigating attribution — verify the commits' content matches the milestone's task list against `git log`/`git show`, then proceed to delegate review. The reviewer's protocol is on-disk-first regardless. Record the framing oddity under `code-review.md § Orchestrator notes` so future rounds (and the user) can see the audit trail. Resume the same subagent on subsequent milestones via the Task tool's `resume` parameter to suppress this failure mode.
