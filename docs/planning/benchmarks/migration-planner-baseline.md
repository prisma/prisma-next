# Postgres migration planner baseline — deferred

Intended as the companion to [`migration-graph-baseline.md`](./migration-graph-baseline.md), addressing the "plan/diff time" half of [April milestone VP3](../april-milestone.md#priority-queue).

**Deferred.** The descriptor-based Postgres planner is being reworked end-to-end in parallel with this PR (ongoing work). Benchmarking the current implementation would measure code that is about to change substantially, so the measurement is not useful as a baseline. We'll produce numbers once the rework has landed and the planner surface has stabilised.

Storage costs (VP3's third concern) are analysed separately in [`projects/graph-based-migrations/disk-sizing-investigation.md`](../../../projects/graph-based-migrations/disk-sizing-investigation.md); they are unaffected by the planner rework.
