# Migration write-path validation — Learnings

> Per-project working ledger of patterns surfaced during this run (per `.agents/skills/drive-orchestrate-plan/SKILL.md § Project learnings`). At close-out the orchestrator + user review this file together — durable cross-cutting lessons migrate to repo-level docs (e.g. an ADR, a contributor doc); project-local lessons are dropped with the project folder.

## Test-as-anti-feature-pin escapee class

**Shape.** A pre-existing test that *codifies* a behavior the spec calls out as a foot-gun. m4 R1's reconnaissance found `'falls back to a synthesized manifest when the existing migration.json is unparseable'` in `packages/1-framework/3-tooling/cli/test/migration-cli.test.ts` — a test whose entire assertion was the silent-swallow-and-resynthesize path the spec § Description case (1) calls out as the foot-gun being fixed. The test wasn't subtly wrong (m2's "lax scaffolding" pattern); it was actively wrong, asserting the inverted contract.

**Why it matters.** When a hardening project adds fast-fail behavior, pre-existing tests asserting the prior swallow path will conflict with the new AC. Two failure modes if missed:

1. The implementer adds the new test alongside the old one; vitest runs both; the old test fails because the silent path is gone; the implementer panics or weakens the new behavior to make both pass.
2. The new test passes, but the old test continues to assert the wrong-by-design behavior, fragmenting the test suite's contract.

**Action.** Pre-implementation reconnaissance for any fast-fail / hardening project should explicitly include "grep for tests asserting the silent-swallow path." The implementer's deferral-protocol task-description-ambiguity carve-out is the right escape hatch when found, but recognising the class up front is cheaper than discovering it mid-implementation. The replacement (deletion + new test in the same line range, same commit) reads as a faithful test-update, not a deletion-plus-addition.

**Recommended for repo-level capture.** A short note in the engineering doc on hardening projects, or a checklist item in the project-shaping prompt for `drive-create-spec` when the spec is a hardening one.

## Repo-wide test parallelism flake class

**Shape.** Transient single-test failures that don't reproduce on focused or repo-wide re-run. Across this project: m4 R2 saw a clipped failure in `migration-cli.test.ts` (didn't reproduce on runs 2–3); m5 R1 saw failures in `@prisma-next/emitter#test` and `@prisma-next/adapter-postgres#test` (both green on focused re-run and repo-wide re-run). Three different test files, two milestones.

**Why it matters.** Three flakes across three different packages is starting to look like a repo-level fragility (parallelism, tmpdir contention, esbuild worker pool, `tsx` process spawning under `pnpm test:packages`'s concurrent turbo execution). A project-local response (retry, reduce concurrency in this package) would only address the specific suite; the pattern is broader.

**Action.** Surface as a separate observability/CI follow-up at close-out. The plan's risk register already named the class (m4 R2 inheritance); m5 R1 confirms it isn't isolated. Not blocking for this PR. Suggested follow-up scope: repo-wide turbo concurrency tuning, tmpdir isolation review, possibly a deterministic-retry policy for `pnpm test:packages` in CI.

**Recommended for repo-level capture.** File as a Linear ticket for the team (e.g. "Investigate repo-wide test parallelism flakes in `pnpm test:packages`").

## TML-2274 deletion-path breadcrumbs

**Shape.** Two of this project's three new validation sites (m3's `assertBookendsMatchMeta` + `errorStaleContractBookends`) are scheduled for removal as part of TML-2274 (remove `fromContract` / `toContract` from the manifest). The implementer's m3 work added explicit JSDoc breadcrumbs in `migration-base.ts` documenting the TML-2274 deletion path, so the future TML-2274 implementer reads "this is interim code" at the call site rather than discovering it from commit history.

**Why it matters.** Interim code without a written deletion plan can persist indefinitely. Cross-referencing the future-removal ticket in the JSDoc makes the disposition explicit and gives the deleter a clean target.

**Action.** Project-local. The breadcrumbs land with this PR. No further action.

## Spec/plan corruption from save-time formatter

**Shape.** Twice during this project (initial drafting in agent mode; workspace handoff into cloud agent), the spec.md and plan.md files showed unstaged modifications from a save-time formatter that destructively rewrote markdown. Specifically: link syntax `[text](url)` rewrapped to `` `[text](url)` `` (corrupting the link); HTML-style placeholders `<index>`, `<path>` stripped; bold marker positions shifted; checkbox lines `- [ ]` flattened to `- `.

**Why it matters.** The corruption was destructive and silent (no error). On the workspace transition specifically, it would have been easy to commit the corruption if the orchestrator hadn't run `git diff` before staging.

**Action.** Project-local for this run (the orchestrator caught it both times via `git checkout --` to discard). For the user's awareness: if a save-time formatter is running on markdown in the IDE/agent harness, it's worth investigating before the next markdown-heavy project. Possibly the harness's preview/render mode is incidentally writing back to disk; possibly an extension configured for stricter markdown is doing it.

**Recommended for repo-level capture.** Not yet — wait to see if it recurs in future projects. If it does, the user should investigate their IDE/harness configuration.

## Subagent continuity across milestones worked cleanly

**Shape.** Per the skill's § Subagent continuity protocol, one persistent implementer (`8b9d259f-319b-4248-b7be-a58ebe4cf828`) and one persistent reviewer (`bc58f3b8-e44a-41d0-b440-c3d1a63fe9a2`) ran the entire project — six rounds (m1 R1, m2 R1, m3 R1, m4 R1, m4 R2, m5 R1). Resume-mode follow-up prompts were terse; both subagents trusted their prior transcripts cleanly.

**Why it matters.** Validates the skill's design choice to default to resume rather than spawn-fresh. Concrete benefits observed:
- The implementer's m3 reconnaissance leaned on their cached read of `migration-base.test.ts` from m2, avoiding re-read cost.
- The reviewer's m4 R2 round was a 2-paragraph "F1 closes" appendage to existing SDR/walkthrough sections rather than a substantive rewrite, because the cumulative posture was already documented.
- Neither subagent ever produced "wait, did I do this already?" anomalies that the SKILL.md flags as the failure mode of fresh-spawn-every-round.

**Action.** None — confirms the protocol. Recommend keeping resume as default.

**Recommended for repo-level capture.** Not yet, but a couple more projects' worth of evidence will solidify it. If the pattern holds, worth documenting in the harness/skill notes as a positive example.
