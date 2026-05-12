# target-extensible-ir — orchestrator learnings

> Working ledger maintained by the orchestrator across rounds. Per `.claude/skills/drive-orchestrate-plan/SKILL.md § Project learnings`, lessons here are reviewed at close-out: durable cross-cutting knowledge migrates to repo-level docs; project-local lessons are dropped with the project folder.

## Reasoning-effort checkpoints

The user runs the orchestrator at Opus 4.7 Medium by default for quick execution. The orchestrator escalates to Opus 4.7 High Thinking before performing the tasks below; the user is notified at the start of each checkpoint and can upgrade the configuration. The orchestrator notifies the user to downgrade after the checkpoint completes.

### High-reasoning-effort checkpoints (notify the user before performing)

1. **Intent-validation of any non-trivial reviewer verdict** (per SKILL.md loop algorithm step 7). Specifically:
   - A `SATISFIED` verdict that closes a milestone with substantive scope, or where the verdict-vs-intent gap is non-obvious.
   - A verdict carrying multiple findings whose severities should be re-calibrated against cross-milestone context.
   - Any verdict where the reviewer raised escalations (`E<N>` items) needing user-facing decision surfaces — shaping the decision surface well is the orchestrator's load-bearing contribution.
   - Skip when: the verdict is `SATISFIED` with zero findings on a small scope (medium is fine for the pass-through).

2. **Replan triggers** (per SKILL.md § Replan protocol). When a finding invalidates a milestone's design, when the user adds scope mid-loop, when a deferral expands scope, when intent-validation reveals the spec is wrong rather than the implementation. Translating user decisions into spec/plan edits requires considering downstream cascades across the remaining milestones.

3. **Implementer-vs-reviewer pushback adjudication.** When the implementer brings concrete evidence (file paths, diffs, prior commits) contradicting a reviewer finding. Deciding whether to amend the reviewer's record vs. route to the user requires careful evidence weighing.

4. **Stop-condition triage** (per SKILL.md § Stop conditions). Deciding whether a validation gate failure is an in-scope regression or pre-existing fragility, deciding whether the spec/plan are wrong in a way the orchestrator can or cannot correct from intent alone.

5. **Cross-milestone design review (architectural-drift check).** Once every 2-3 SATISFIED milestones, holistically read the as-built state against the spec to surface architectural drift before it hardens. Recommend at minimum: after M3 SATISFIED (Postgres+SQLite consumers exist; the SPI has been exercised end-to-end for the first time) and after M5b SATISFIED (multi-namespace works end-to-end; the Namespace model has been pressure-tested).

6. **ADR drafting/refining passes.** The 3-layer convention ADR and the architectural-principles ADR have lasting design weight beyond this project (they migrate to `docs/architecture docs/adrs/` at close-out). The substantive draft passes — and the M6 refinement pass — deserve high reasoning. Read-and-spot-check passes are fine at medium.

7. **Final pre-PR synthesis.** Before invoking the team's PR-opening skill, a holistic read of the as-built state against the spec, plus a final intent-validation against all milestones together (not just the most recent one).

### Medium-reasoning-effort work (default — quick execution)

- Scaffolding artifacts (`code-review.md`, sub-agent delegation prompts from templates, heartbeat directory setup).
- Spawning or resuming sub-agents with template-shaped prompts.
- Recording sub-agent IDs in `code-review.md § Subagent IDs`.
- Pre-flight checks before each round (confirming `code-review.md` exists, validating gates are declared, recovering subagent IDs).
- Triage of clean `SATISFIED` verdicts on small-scope milestones with zero findings.
- Pass-through escalations where the reviewer has already shaped the user-facing decision well.
- Routine git operations, explicit-staging discipline, commit-message refinement.
- Reading reviewer/implementer reports for routing decisions.
- Confirming narrative-artifact refresh (verifying `system-design-review.md` and `walkthrough.md` reflect HEAD).

### Notification protocol

- **Before performing a checkpoint:** the orchestrator says "Reaching a high-reasoning-effort checkpoint: `<checkpoint #N>` — `<one-line description>`. Recommend upgrading my configuration before I proceed." and waits for the user's confirmation before continuing.
- **After completing a checkpoint:** the orchestrator says "Checkpoint complete. Recommend downgrading back to Medium for the next stretch." so the user can flip back.
- **If the orchestrator unexpectedly hits a body of work that requires high reasoning** (e.g. a routine triage turns out to be a replan trigger): the orchestrator pauses, surfaces the discovery, and recommends the upgrade before continuing.
