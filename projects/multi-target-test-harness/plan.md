# Multi-target Test Harness — Project Plan

**Spec:** `projects/multi-target-test-harness/spec.md`

## Status

- **M0** investigation: ✅ done (informally — see references below; no separate write-up).
- **M1** infrastructure: 🟡 in progress. Generic core, fan-out helper, real adapters, and migration of existing 35 SQLite tests are landed. Long-term adapter home and Workers dimension pending.
- **M2** ORM coverage: ⬜ not started. Design will follow once M1 stabilizes.
- **M3** migration coverage: 🔴 immediate next milestone. Active priority per user.

## Milestones

### Milestone 0: Investigate prisma/prisma functional client suite

Survey prisma/prisma's existing cross-target test infrastructure and decide what to adopt, adapt, or replace.

**Tasks:**

- [x] Read prisma/prisma's `tests/functional/_utils/` (matrix DSL, plan expansion, codegen, lifecycle).
- [x] Read prisma/prisma's `packages/integration-tests/` (per-target factory pattern).
- [x] Decide reuse-vs-adapt-vs-rebuild per piece: matrix DSL idea ✅ adapt, codegen pipeline ❌ rebuild (we're contract-first), per-suite DB-name substitution ✅ adopt, opt-out-with-reason ✅ adopt, two-phase code+types runner ❌ skip (not relevant to our shape).

### Milestone 1: Shared test suite infrastructure

Generic harness, concrete adapters per target, fan-out helper for within-family scenarios, and lifecycle that survives the existing test-suite migration.

**Tasks:**

- [x] **Generic core** — `TestTargetAdapter<TContract, TSchemaIR, TDriver, TPolicy>` interface and `applyMigration` helper in `@prisma-next/test-utils/migration-harness`. Dependency-free to avoid build-graph cycles.
- [x] **Concrete adapters** — `sqliteTestTarget`, `postgresTestTarget`, `createMongoTestTarget({ uri })`. Real planner/runner/introspect/verify wiring.
- [x] **L1 fan-out helper** — `describeAcrossTargets(group, cases, body)` in `@prisma-next/test-utils/migration-fanout`. Generates one `describe` per target so the same assertion body runs across SQLite + Postgres.
- [x] **Smoke tests** — runtime proof on each target (`cross-sql.spike.test.ts`, `mongo-spike.test.ts`).
- [x] **Migrate existing tests** — 35 SQLite migration tests across 5 files now run through the new harness via a thin compatibility shim in `harness.ts`. No test bodies changed.
- [ ] **Long-term home for concrete adapters** — see Open Questions in spec. Currently in `test/e2e/framework/test/migration-targets/` (sqlite, postgres) and `test/integration/test/mongo/` (mongo).
- [ ] **Workers dimension decision** — see Open Questions in spec. Not load-bearing for M3.

**Checkpoint:** a single test body runs against Postgres + SQLite via `describeAcrossTargets`; mongo runs the same shape via parallel `describe`. Each target uses its own database instance. Failures attribute to a specific target via `${groupName} — ${name}` describe naming. Setup/teardown is automated. *Met for the active surface.* Adapter home + Workers dimension are the remaining items but neither blocks M3.

### Milestone 2: ORM scenario coverage *(future)*

Exercise the ORM through representative scenarios across all three targets. Will require an ORM harness analogous to the migration harness (target-typed `prisma` global, shared schema across many tests). Design after M1 stabilizes — don't unify with migration harness; the lifecycles differ (per-test fresh DB vs shared DB many tests).

**Tasks:**

- [ ] CRUD operations across all targets.
- [ ] Relations and includes.
- [ ] Filtering and ordering.
- [ ] Aggregations.
- [ ] Edge cases — NULL handling, empty results, type coercion, large result sets.

### Milestone 3: Migration scenario coverage *(active)*

Exercise the migration workflow across targets, authoring each scenario once per family via the L1 fan-out.

**Tasks:**

- [ ] Plan + apply common schema changes — add model, add field, add relation, drop model, rename field — fanned out across SQLite + Postgres via L1; mongo authored as parallel describe.
- [ ] Manual migration — scaffold + apply on each target.
- [ ] Data migrations — run on each target.

**Checkpoint:** `migration plan`, `migration apply`, `migration status` work correctly on Postgres, SQLite, and MongoDB for the listed scenarios. Manual + data migrations integrate into the graph on all targets.

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/multi-target-test-harness/spec.md`
- [ ] Migrate long-lived docs into `docs/`
- [ ] Strip repo-wide references to `projects/multi-target-test-harness/**`
- [ ] Delete `projects/multi-target-test-harness/`
