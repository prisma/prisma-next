# Learnings — remove-sql-branching-from-framework-cli

> Per `.agents/skills/drive-orchestrate-plan/SKILL.md § Project learnings`. Working ledger; reviewed at close-out for migration into durable docs.

### Pre-existing intermittent in `cli/test/control-api/contract-emit.test.ts`

**Shape.** The test "serializes overlapping emits per output path so the last submission wins on disk" (in `packages/1-framework/3-tooling/cli/test/control-api/contract-emit.test.ts` near line 228) fails approximately 1 out of 3 runs at HEAD. Reproduced across M1 R1 (the implementer reported `cli` + `adapter-sqlite` failing once on the first `pnpm test:packages`) and M2 R1 (reproduced by the reviewer running `pnpm --filter @prisma-next/cli test` three times — runs 1 and 3 passed, run 2 failed exactly that one test). `git log` shows the test predates this project's base commit, so it's pre-existing fragility, not a regression.

**Why it matters.** Two kinds of damage:
1. Recurring false-positive failures in cloud-agent loops slow iteration and require humans (or the orchestrator's intent-validation) to discriminate "real test failure" from "the same intermittent again."
2. CI runs of this PR (and any other PR on this branch lineage) will sporadically fail this single test, requiring re-runs to be sure of green.

**Action.**
- During this project's loop: do NOT file as a finding (§ Findings discipline — pre-existing fragility outside this PR's scope is not actionable in this PR).
- During this project's loop: surface to the orchestrator's intent-validation lens so the orchestrator can distinguish "this run's flake is the known one" from "this run hit a real bug," and re-run rather than chase.
- At close-out: recommend a follow-up Linear issue to either fix the test (probably needs a synchronization barrier on the per-output FIFO that was added recently) or relax the assertion that's flaking.

### Plan amendment authority — orchestrator vs implementer

**Shape.** The orchestrator added a plan amendment to M2 task 2.1 ("M1-bridge cleanup") naming two **AST extension fields** (`PslDocumentAst.headerComment`, `PslModel.comment`) for removal if unused. The implementer interpreted "fields no longer needed" to extend to "the user-visible warning text the fields used to carry is no longer needed" — a different decision. The reviewer caught the regression as F1 (must-fix).

**Why it matters.** Plan amendments are scoped writing; subagents can over-interpret them. The amendment said "AST extension fields" but the implementer dropped (a) the fields, (b) the upstream content that flowed through them, and (c) the snapshot test asserting the user-visible output. Each of (b) and (c) is a separable choice from (a).

**Action.**
- Plan amendments should explicitly distinguish **structural changes** (delete a type field) from **observable behaviour changes** (delete a user-visible warning). Use plain language: "Delete the field. **Preserve the warning text** by emitting it as a synthetic comment node in the AST construction step."
- When a plan amendment instructs a deletion, re-state observable behaviour invariants alongside ("output shape unchanged for users").
- When intent-validating, specifically check whether the implementer's resolution of an authorized deletion stayed within structural-only scope, or extended to observable-behaviour scope without authorization. The latter is the F1 class.

### Subagent intent-fidelity gap on byte-identical-output ACs

**Shape.** A9 says "SQL `contract infer` produces byte-identical PSL output to before (snapshot-tested)." The implementer interpreted this as "the snapshot tests pass" — and updated the snapshots when they no longer matched. Snapshot tests are evidence of stability *over time*; updating them as part of a PR makes them evidence of *this PR's stability*, not of regression-freedom against the pre-PR baseline.

**Why it matters.** "Byte-identical" ACs are the canonical place for unauthorised UX changes to land silently: the implementer changes the output, updates the snapshot, the test passes, the subagent reports green. Without a baseline-against-prior-output check, regressions slip past.

**Action.**
- For "byte-identical" ACs: the reviewer's evidence must include either (a) a comparison against a frozen baseline (e.g. a fixture file from before the PR) or (b) a manual diff of the snapshot files between the project base commit and HEAD.
- The orchestrator's intent-validation should specifically ask: "did snapshot tests update during this round? If yes, are the deltas authorized in the plan?"
- When writing a future spec with a byte-identical AC, prefer naming the freezing mechanism explicitly (e.g. "fixture file at `<path>`, generated from `<commit>` before this work, must remain bit-equal to inferred output").
