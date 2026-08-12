# Aggregation & grouping

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma Next **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma Next public surface, but no proving Prisma Next integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma Next but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma Next.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| Aggregate `count` | ✅ | 🟡 | ✅ | `test/integration/test/sql-orm-client/aggregate.test.ts`; `test/integration/test/mongo/query-builder.test.ts` |
| Aggregate `sum` | ✅ | 🟡 | ✅ | `test/integration/test/sql-orm-client/aggregate.test.ts`; `test/integration/test/mongo/query-builder.test.ts` |
| Aggregate `avg` | ✅ | 🟡 | 🟡 | `test/integration/test/sql-orm-client/aggregate.test.ts` |
| Aggregate `min` | ✅ | 🟡 | ✅ | `test/integration/test/sql-orm-client/aggregate.test.ts`; `test/integration/test/mongo/query-builder.test.ts` (`whole-collection grouping with _id: null`) |
| Aggregate `max` | ✅ | 🟡 | ✅ | `test/integration/test/sql-orm-client/aggregate.test.ts`; `test/integration/test/mongo/query-builder.test.ts` (`whole-collection grouping with _id: null`) |
| `groupBy` | ✅ | 🟡 | ✅ | `test/integration/test/sql-orm-client/group-by.test.ts`; `test/integration/test/mongo/query-builder.test.ts` (`group with accumulators`) |
| `having` | ✅ | 🟡 | 🟡 | `test/integration/test/sql-orm-client/group-by.test.ts` |
| `groupBy` + `orderBy` (builder) | 🟡 | 🟡 | — | |
| `groupBy` + `take` (builder) | 🟡 | 🟡 | — | |
| `groupBy` + `skip` (builder) | 🟡 | 🟡 | — | |
| Per-field non-null counts (`count(field)`) | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/include.test.ts` (`scalar count()`) |
| Relation-scoped aggregate `sum` in `include()` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/include.test.ts` (`scalar sum()`) |
| Relation-scoped aggregate `avg` in `include()` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/include.test.ts` (`scalar avg()`) |
| Relation-scoped aggregate `min` in `include()` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/include.test.ts` (`scalar min()`) |
| Relation-scoped aggregate `max` in `include()` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/include.test.ts` (`scalar max()`) |
| Mongo `bucket` aggregation | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`groups documents into price ranges`) |
| Mongo `facet` aggregation | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`runs multiple sub-pipelines in parallel`) |
| Mongo `sortByCount` aggregation | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`counts and sorts by category frequency`) |
| `aggregate` with `orderBy`/`cursor`/`take`/`skip` pre-aggregation | ❌ | ❌ | — | |
