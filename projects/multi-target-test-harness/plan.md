# Multi-target Test Harness — Project Plan

## Summary

_Drafted via drive-create-plan. Replace this placeholder._

**Spec:** `projects/multi-target-test-harness/spec.md`

## Milestones

### Milestone 0: Investigate prisma/prisma functional client suite

Survey prisma/prisma's existing cross-target test infrastructure (functional client suite + matrix runner) and decide what to adopt, adapt, or replace for Prisma Next. Pair with @serhii.

**Tasks:**

- [ ] Written assessment of the prisma/prisma harness (what works, what doesn't translate, reuse vs rebuild).
- [ ] Concrete recommendation feeding into M1 design.

### Milestone 1: Shared test suite infrastructure

Parameterized test runner that takes a target configuration (connection, adapter, contract) and runs the same suite against each target, with automated database lifecycle.

**Tasks:**

- [ ] Test harness design — parameterized runner across target configs.
- [ ] Database lifecycle — automated setup, migration, seeding, teardown for each target's test database.
- [ ] Target configurations — working configs for Postgres, SQLite, and MongoDB.
- [ ] Workers dimension decision — Miniflare target vs MAP port as sole Workers validation.

**Checkpoint:** a single test file runs the same scenario against Postgres, SQLite, and MongoDB. Each target uses its own database instance and adapter. Failures are clearly attributed to a specific target. Setup/teardown is fully automated. The Workers dimension decision is documented.

### Milestone 2: ORM scenario coverage

Exercise the ORM through representative scenarios across all three targets.

**Tasks:**

- [ ] CRUD operations across all targets.
- [ ] Relations and includes — relation traversal, eager loading, nested queries.
- [ ] Filtering and ordering — where clauses, sorting, pagination.
- [ ] Aggregations — count, sum, avg, min, max, group by.
- [ ] Edge cases — NULL handling, empty results, type coercion, large result sets.

**Checkpoint:** comprehensive ORM scenario suite runs green on all three targets. Failures filed in gaps log for WS2 with clear target attribution.

### Milestone 3: Migration scenario coverage

Exercise the migration workflow across targets.

**Tasks:**

- [ ] Plan and apply common schema changes — add model, add field, add relation, drop model, rename field.
- [ ] Manual migrations — scaffold and apply a manual migration on each target.
- [ ] Data migrations — run a data migration on each target.

**Checkpoint:** `migration plan`, `migration apply`, and `migration status` work correctly on Postgres, SQLite, and MongoDB for common schema-change scenarios. Manual and data migrations integrate into the graph on all targets.

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/multi-target-test-harness/spec.md`
- [ ] Migrate long-lived docs into `docs/`
- [ ] Strip repo-wide references to `projects/multi-target-test-harness/**` (replace with canonical `docs/` links or remove)
- [ ] Delete `projects/multi-target-test-harness/`
