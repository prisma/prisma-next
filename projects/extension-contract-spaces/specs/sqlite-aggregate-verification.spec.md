# TML-2463 — SQLite aggregate path verification

## Summary

The Linear ticket [TML-2463](https://linear.app/prisma-company/issue/TML-2463/upgrade-sqlite-targets-planner-to-the-multi-space-aggregate-path) asks for the SQLite target to be upgraded onto the aggregate planner / multi-space runner pipeline that Postgres uses. **This work was already delivered as part of M2 R5 / M2.5 / M6** of the parent contract-spaces project, where the SQL family — shared between Postgres and SQLite — was lifted onto the aggregate pipeline as a single change.

This spec documents the verification pass that confirms TML-2463's acceptance criteria hold today and records the one regression-coverage gap closed in service of it.

## Where the work landed

| AC                                                                                | Where it landed                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. SQLite planner produces per-space `MigrationPlan`s                             | `SqliteMigrationPlanner.plan(...)` accepts `spaceId` and stamps it on the produced plan. The aggregate planner's `synthStrategy` calls it via the family SPI, identical to Postgres. (commit `dc65c5708`, refactor `15e7a5bce`.) |
| 2. `db init` / `db update` for SQLite route through `executeAggregateApply`       | Both commands route through `executeAggregateApply` in `cli/src/control-api/operations/db-apply-aggregate.ts` for **all** families. There is no SQLite-only branch. (M2.5 commit `934bc7ed6`.)                                   |
| 3. Multi-space scenarios for SQLite have parity coverage with Postgres            | `runner.multi-space.test.ts` (262 LOC: success + AM4-rollback + empty-list) and `db-init-update.cli.test.ts` (583 LOC: AM4 / AM9 / AM10 / AM11 / codec hooks) — slightly more coverage than the Postgres equivalents.            |
| 4. No regression on single-space (n=1, app-only) SQLite                           | Closed by the new explicit n=1 regression test added under this verification pass (see § Regression coverage closed below).                                                                                                      |

## Regression coverage closed

Every existing SQLite `db init` / `db update` aggregate test declared at least one extension pack. AC4 ("the aggregate path collapses cleanly to one app member") was satisfied behaviourally but had no direct test pinning it. This spec adds one focused test:

- **`packages/3-targets/6-adapters/sqlite/test/migrations/db-init-update.cli.test.ts`** — `'collapses cleanly to a single app member when no extensions are declared (TML-2463 AC4 — n=1 regression)'`. Runs `executeDbInit` with `extensionPacks: []` against a fresh SQLite database, asserts a single `app` marker row, asserts the user table is created, asserts `perSpace.length === 1` with `kind: 'app'`, then runs `executeDbUpdate` to confirm the aggregate path still short-circuits to a no-op when the live DB already matches.

That is the entire delta this verification pass adds to the codebase.

## Why no `hasMultiSpaceRunner` removal

The Linear ticket's "Notes for implementer" says:

> Once this lands, only the Mongo family (TML-2408) remains on the single-space path, and the cleanup in the follow-up ticket can proceed.

The `hasMultiSpaceRunner` capability guard at `framework-components/src/control/control-capabilities.ts:89` is satisfied today by every target — Postgres + SQLite implement `executeAcrossSpaces` for real, and Mongo implements a degenerate single-space shim that errors with `MONGO_MULTI_SPACE_UNSUPPORTED` for `length !== 1` (commit `549e809f9`). Removing the guard now would replace an upfront capability check with a worse runtime failure for Mongo + multi-space callers. Guard removal is therefore deferred to **TML-2408** (port contract spaces to the Mongo family), which removes Mongo's degenerate shim by giving it a genuine multi-space implementation.

## Acceptance criteria

- [x] **AC-V1.** All four ACs in TML-2463 hold against current `main` + the n=1 regression test.
- [x] **AC-V2.** `pnpm --filter @prisma-next/adapter-sqlite test` is green (124 tests).
- [x] **AC-V3.** The new n=1 test fails if removed and runs in well under a second (no DB-process startup cost — uses `node:sqlite`).

## Validation gate

- `pnpm --filter @prisma-next/adapter-sqlite test`
- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm lint:deps`
- `pnpm build`

## Out of scope

- **Removing `hasMultiSpaceRunner`** — gated on TML-2408.
- **`cli.db-verify.aggregate-schema.test.ts` SQLite parallel** — that test exercises `db verify`'s F23 fix (live-schema pre-projection per member). The fix lives in the SQL family's shared aggregate verifier, so SQLite gets the behaviour for free. A SQLite-targeted parallel would be additive coverage, not a TML-2463 deliverable. If it surfaces value during M5 close-out, fold it in there.
- **Migration CLI (`migration plan` / `status` / `apply`) SQLite e2e** — tracked under the parent project's M6 T6.8.

## References

- Linear ticket: [TML-2463](https://linear.app/prisma-company/issue/TML-2463/upgrade-sqlite-targets-planner-to-the-multi-space-aggregate-path).
- Parent project spec: [`spec.md`](../spec.md).
- Related follow-up: [TML-2408](https://linear.app/prisma-company/issue/TML-2408) — port contract spaces to the Mongo family; gates `hasMultiSpaceRunner` removal.
