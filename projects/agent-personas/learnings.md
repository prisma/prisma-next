# Project learnings — `agent-personas`

> Working ledger of patterns surfaced during this project's `drive-orchestrate-plan` run. Reviewed at close-out: durable cross-cutting patterns migrate to the resulting skills' bodies (since the project's deliverables *are* skill content); project-local patterns drop with the project folder.

### Pin source-material provenance to the commit, not to HEAD, when A/B-testing against historical commits

**Shape.** The implementer's m1 T1.4 A/B test target was the work at extension-contract-spaces commit `68ebbeb25`. Both initial sub-subagent runs (framed and unframed) read the spec at HEAD via the workspace path and got the *post-F6* spec narrative — which retracts the `Authored*` framing being defended at the commit. Both runs surfaced the typology concern as a result, defeating the A/B comparison.

**Why it matters.** When the test variable is a *runtime* construct (persona load) but the inputs include a *project surface that has evolved past the commit under test*, the inputs leak the answer. The framed/unframed contrast collapses because the unframed run is also being prompted with the F6 conclusion, just by a different mechanism. The implementer caught this and re-ran with `git show 68ebbeb25:<spec-path>` for clean inputs; the clean-baseline pair produced the expected verdict difference.

**Action.** When a project's plan asks for an A/B sanity check or replay against a historical commit, the prompt to the test sub-subagents must specify how to read every contextual document (spec, plan, related commit messages) — pinned to the commit (`git show <sha>:<path>`) rather than the workspace tree. The plan's task description should say so explicitly, not leave it to implementer discovery.

### Personas raise the floor; they do not eliminate the post-implementation interactive-review pass

**Shape.** The m1 architect-persona A/B test produced a clear verdict difference (CONCERNS vs SATISFIED on identical evidence) and surfaced typology concerns the unframed run dismissed — but neither the framed run nor the unframed run *fully* recovered the F6 inference (the strongest form: that `Authored*` partition is structurally non-existent). The framed run got close (raised adjacent concerns; flagged the silent `MigrationPlanOperation`/`MigrationOps` aliasing; suggested doc-clarification of the partition) but did not retrace F6 in a single pass.

**Why it matters.** A persona shifts execution-time bias and raises the bar at which a typology concern is dismissed. It does not turn the agent into the user during interactive review (where back-and-forth iteration on a hypothesis is what surfaced F6 in the first place). When pitching the persona library to skeptics, the framing should be "raise the floor of the agent's default scrutiny" — not "replace the human review pass."

**Action.** M2's persona authoring should not over-promise. Each persona doc's stance should describe the lens *bias* it produces, not the conclusions it guarantees. M3's composite-skill design (especially `/drive-pr-local-review`) should keep the user in the loop, not flatten the human pass into "an architect persona reviewed it, you're done."
