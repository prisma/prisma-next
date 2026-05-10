# Project learnings — `architecture-patterns-catalogue`

Patterns surfaced during the orchestrated implement-review loop on this project. Per [`drive-orchestrate-plan` § Project learnings](../../.claude/skills/drive-orchestrate-plan/SKILL.md), this file is a working ledger; at close-out the orchestrator + user review it together and decide which lessons migrate to durable docs vs. drop with the project folder.

## Spec-vs-on-disk drift in seed material is a recurring class

**Shape.** A project's spec cites file paths, ADR titles, or symbols as "reference implementations" to ground its claims. When the spec is read cold by an implementer who verifies every cited path on disk, four classes of drift surface: (a) the path is wrong (a directory was renamed or never existed); (b) the symbol is illustrative-only (cited as if it ships in the codebase but actually only appears as code-fence content in another doc); (c) an ADR title in the spec is wrong even though the ADR file exists; (d) multiple ADR files share a number, requiring full-filename disambiguation.

In this project: 4 instances surfaced during M2 R1 alone (`EmissionSpi` directory, `ColumnRegistry` symbol, ADR 117 title, ADRs 187/207 sharing numbers).

**Why it matters.** A catalogue, ADR, or any doc that propagates spec inaccuracies inherits them — and the catalogue's whole point is to be the architect's working library. The implementer must verify every cited path before quoting it; correcting in the durable artifact (catalogue) is sufficient since the spec is transient.

**Action.** Implementer verifies every spec-cited path on disk before quoting. Corrections land in the durable artifact, not the (transient) spec. Orchestrator records the discrepancies in the unattended-decisions log so the user has visibility on the spec-vs-disk delta at close-out without needing to re-derive it.

---

## Scaffold-commit pattern: per-commit-gate-green has a one-commit gap on harness extensions

**Shape.** When a milestone introduces N coupled artifacts that cross-reference each other (every entry's "Related patterns" links siblings; bidirectional refs prevent topological ordering), one initial scaffold commit creates N inert stubs so all link targets exist on disk from commit-1 onward. Each subsequent commit replaces a stub with full content. The per-commit link-check gate stays green throughout.

This breaks down in one specific case: when the harness itself needs extending (e.g. EXTRA_TARGETS gains a new file type, requiring the link-check script to be widened to walk that type). The harness change must land in a single commit; the file-type-extension and the file-the-extension-points-at can't both be gate-covered before the same commit lands. There is a one-commit gap where the gate appears green but doesn't actually cover the new file type.

In this project: surfaced in M3 R1 when `EXTRA_TARGETS` extended to include `.cursor/rules/adr-writing.mdc` (a `.mdc` file). The link-check script's `.md`-only file walker would have silently skipped it. Caught during pre-validation; bundled the script fix with the EXTRA_TARGETS extension in the same commit so the gate became correct from the moment it could matter.

**Why it matters.** The scaffold-commit pattern advertises per-commit-gate-green as its load-bearing property; a quiet exception case erodes that contract. The intermediate-commit re-test in the close-out checklist (M3 plan task) caught this; without that re-test, the harness gap would have shipped silently.

**Action.** When extending a validation harness during a milestone, bundle the harness change with the extension that exposes it (don't split into a "harness widening" commit + "use the new harness" commit — the gate would be wrong between them). Recurring projects should keep the intermediate-commit re-test as a durable close-out check.

---

## `git stash pop` is the wrong tool for "snapshot working tree before temporary checkout"

**Shape.** Implementer wants to verify a claim at an intermediate commit boundary. Reflexive workflow: `git stash --include-untracked` → `git checkout <sha>` → run check → `git checkout <branch>` → `git stash pop`.

When the working tree is clean (a typical end-of-round state), `git stash` produces nothing — but `git stash pop` then pops a pre-existing **unrelated** stash from another branch, polluting the working tree with that stash's content (and possibly conflicts).

In this project: occurred in m2 R1 (reviewer; popped a `tml-2276`-branch stash with 6 file modifications + a delete-by-us conflict) and again in m3 R1 (implementer; same shape). Recovery cheap (`git reset --hard HEAD` for the implementer; `git checkout HEAD -- .agents/skills/` for the reviewer, since the reviewer had partial review-artifact writes uncommitted), but the time wasted on cleanup is annoying.

**Why it matters.** A subagent doing intermediate-commit verification work loses several minutes to recovery and may surface the incident as a procedural anomaly that the orchestrator has to triage. The pattern is recurring — two rounds, two roles, same incident shape.

**Action.** Subagents prefer `git show <sha>:<path>` (single-file-at-a-commit reads, no checkout, no stash) for the common case, or `git worktree add <tmpdir> <sha>` (full snapshot at a commit, isolated from the current working tree) for whole-tree verifications. Avoid `git stash pop` unconditionally unless the prior `git stash push` was confirmed to have stashed something (`git stash list` before pop). The skill's delegation prompts already warn against `git stash` for this case; future templates may want to make the warning more prominent.

---

## Findings discipline pays for itself

**Shape.** The reviewer's `drive-pr-local-review`-shaped instinct is to file every observation as a finding. The `drive-orchestrate-plan` skill's findings-discipline rule (every finding must be in-PR-actionable; "consider for future" / "no action" / "out of scope" go elsewhere) forces the reviewer to triage observation type *before* filing.

In this project: across four review rounds (m1 R1, m2 R1, m2 R2, m3 R1), only two findings were filed (m2 R1 F1 — README intro stale; reviewer-suggested plan amendments folded directly into plan.md instead of as findings). The implementer's delegation prompts stayed clean; the work-backlog interpretation of the findings log was preserved.

**Why it matters.** Most reviewer instincts produce noise when applied to an iterate-implement loop. The discipline rule is the difference between a clean implementer prompt (one finding to action) and a noisy one (eight findings, three of which say "consider this for the future and otherwise do nothing").

**Action.** Surface plan-amendment candidates to the orchestrator separately from the findings log. The orchestrator translates them into `plan.md` edits before the next implementer round runs. This keeps the findings log as a true work backlog and makes the reviewer→orchestrator→implementer information flow cleaner.
