# Summary

Confidence in correctness across Postgres, SQLite, and MongoDB via a shared, parameterized test suite that exercises the same scenarios on every target. The May milestone outlines three milestones: shared infrastructure (M1), ORM scenario coverage (M2), and migration scenario coverage (M3). Migration coverage is the immediate priority; ORM coverage informs harness design but is on deck.

# Description

Today's tests are per-target and ad hoc. The 35 SQLite migration tests in `test/e2e/framework/test/sqlite/migrations/` have no Postgres or Mongo equivalent; the 14 SQL-builder integration tests run only against Postgres; Mongo migration tests are hand-rolled per file. As M3 lands, hand-authoring per-target copies of every migration scenario would triple test count without commensurate value. A shared harness that lets one test body run across multiple targets (within a family) — and a parallel-but-separate adapter shape for cross-family targets — is the unblocker.

The harness has three layers:

- **L0 — generic core**: `applyMigration(target, options, callback)` parameterized by a `TestTargetAdapter<TContract, TSchemaIR, TDriver, TPolicy>`. Lives in `@prisma-next/test-utils/migration-harness`. No target deps.
- **L1 — within-family fan-out**: `describeAcrossTargets(group, cases, body)` generates one `describe` per target so a single test body runs across SQLite + Postgres (within the SQL family). Lives in `@prisma-next/test-utils/migration-fanout`.
- **L2 — concrete adapters**: per-target `TestTargetAdapter` instances. Currently in `test/e2e/framework/test/migration-targets/{sqlite,postgres}.ts` and `test/integration/test/mongo/mongo-test-target.ts`. Long-term home is an open question — see Open Questions.

# Requirements

## Functional Requirements

- A single `applyMigration` callsite per test runs the planner + runner + introspect + verify against a target-specific database lifecycle, then hands the test a target-typed driver and schema IR.
- A test author writes the assertion body once; the L1 fan-out helper runs it against each SQL target with target-specific contract construction.
- Cross-family tests (SQL vs Mongo) use the same `TestTargetAdapter` shape but are written as parallel `describe` blocks because the contract types diverge.
- Failures attribute clearly: every fan-out generates `${groupName} — ${targetName}` so vitest output identifies the target.
- Database lifecycle is automated per test for SQLite (tempfile) and Postgres (`@prisma/dev`); shared per file for Mongo (`MongoMemoryReplSet` owned by the test's `beforeAll`).

## Non-Functional Requirements

- The harness must not introduce build-graph cycles. `@prisma-next/test-utils` is dependency-free (only types) so it can be devDepended by foundation packages without cycling.
- Concrete adapters live close to their existing dependency clusters (test packages or target packages) so they don't drag target deps into `test-utils`.
- Type inference should propagate target-specific types through `applyMigration` calls so test authors see `SqliteTestDriver` / `MongoControlDriver` etc. without casts.

## Non-goals

- A unified harness covering both migrations and ORM operations. Their lifecycles differ (per-test fresh database vs shared database with many tests); forcing one shape over both is premature abstraction. Two harnesses, one set of adapters.
- Cross-family contract sharing. SQL and Mongo contracts have different shapes (`Contract<SqlStorage>` vs `MongoContract`) and there is no useful "logical model" abstraction above them. Shared *intent* in test discipline; separate *code* in the test files.
- Workers as an explicit target dimension in the harness. Open question carried over from May planning — see [Open Questions](#open-questions).
- Tests of the harness itself beyond opportunistic unit tests of pure helpers and the smoke test per adapter. prisma/prisma's functional suite has no harness unit tests; volume of consumer tests is the canary.

# Acceptance Criteria

## M1 — Shared infrastructure

- [x] Generic `TestTargetAdapter` interface and `applyMigration` core in `@prisma-next/test-utils/migration-harness`.
- [x] Concrete adapters for SQLite, Postgres, and MongoDB. Real `verifySqlSchema` and `verifyMongoSchema` wired.
- [x] Smoke tests proving each adapter works end-to-end at runtime.
- [x] L1 SQL fan-out helper (`describeAcrossTargets`) shipping a working cross-target test.
- [x] Existing SQLite migration tests (35 across 5 files) migrated onto the new harness with no test-body changes (via thin compatibility shim in `harness.ts`).
- [ ] Long-term home for concrete adapters decided. *(Pending — see Open Questions.)*
- [ ] Workers dimension decision documented. *(Pending — out of immediate scope; see Open Questions.)*

## M2 — ORM scenario coverage *(future)*

- [ ] ORM harness analogous to migration harness: target-typed `prisma` global, shared schema across many tests.
- [ ] CRUD, relations/includes, filtering/ordering, aggregations, edge cases — each tested across all three targets.
- [ ] Failures attribute to a specific target and feed the WS2 gaps log.

## M3 — Migration scenario coverage *(active)*

- [ ] `migration plan`, `migration apply`, `migration status` exercised on Postgres, SQLite, MongoDB for: add model, add field, add relation, drop model, rename field.
- [ ] Manual migration scaffold + apply on each target.
- [ ] Data migration on each target.
- [ ] All migration scenarios authored once per family (via L1) rather than once per target.

# References

- Linear project: https://linear.app/prisma-company/project/pn-may-ws4-multi-target-test-harness-ee1b4ec0a6ba
- May planning doc: `docs/planning/may-milestone.md` (WS4 section)
- Pairing partner: @serhii (prisma/prisma functional client suite)
- prisma/prisma functional test suite (reference): `.claude/repos/prisma/prisma/packages/client/tests/functional/`

# Open Questions

- **Long-term home for concrete adapters.** Options: (a) per-target package sub-entries (e.g. `@prisma-next/target-sqlite/test-target`) — natural co-location, but pulls `test-utils` into target package deps; (b) new `@prisma-next/test-targets-*` packages — clean separation, more packaging overhead; (c) keep in test packages where they are now — pragmatic but prevents reuse from other test packages. The cycle constraint (`@prisma-next/contract` devDeps `test-utils`, so `test-utils` cannot depend on anything that depends on `contract`) rules out the obvious "central in test-utils" option. Likely (a) when there's a clear consumer outside the current test packages.
- **Workers test dimension.** Add a Workers (Miniflare) target to the harness, or treat the MAP port as the sole Workers validation? Carry-over from May planning. Not load-bearing for M3.
- **MongoDB replset sharing.** Each mongo test file currently pays its own `MongoMemoryReplSet` spinup cost (~5–30s). Once Mongo migration coverage grows, pooling the replset at a vitest workspace level may be worth doing. Not yet.
- **Fixture emission in CI.** `pnpm fixtures:emit` is manual; stale-fixture risk for any test that imports pre-emitted contracts. Independent of harness work but worth wiring into `pretest` for the relevant packages.
