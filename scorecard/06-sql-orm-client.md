# SQL ORM client

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma Next **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma Next public surface, but no proving Prisma Next integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma Next but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma Next.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| `where(...)` (callback / where input / shorthand) | ✅ | ✅ | — | `test/integration/test/sql-orm-client/mn-filter.test.ts`; `test/e2e/framework/test/sqlite/orm.test.ts` (`findMany › with filter`) |
| `select(...)` projection | ✅ | ✅ | — | `test/integration/test/sql-orm-client/include.test.ts`; `test/e2e/framework/test/sqlite/orm.test.ts` |
| `orderBy(...)` | ✅ | ✅ | — | `test/integration/test/sql-orm-client/self-relations.test.ts` (`orderBy on a depth-1 self-relation`); `test/e2e/framework/test/sqlite/orm.test.ts` (`with ordering`) |
| `take` / `skip` | ✅ | ✅ | — | `test/integration/test/sql-orm-client/pagination.test.ts`; `test/e2e/framework/test/sqlite/orm.test.ts` (`with take and skip`) |
| `cursor(...)` keyset pagination | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/pagination.test.ts` (`cursor() applies forward and backward boundaries`) |
| `distinct` / `distinctOn` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/pagination.test.ts` (`distinct()`, `distinctOn()`) |
| `first()` | ✅ | ✅ | — | `test/integration/test/sql-orm-client/first.test.ts`; `test/e2e/framework/test/sqlite/orm.test.ts` (`findFirst`) |
| `all()` (streamed results) | ✅ | ✅ | — | `test/integration/test/sql-orm-client/include.test.ts`; `test/e2e/framework/test/sqlite/orm.test.ts` (`findMany › returns all rows`) |
| `create` | ✅ | ✅ | — | `test/integration/test/sql-orm-client/create.test.ts`; `test/e2e/framework/test/sqlite/orm.test.ts` (`create`) |
| `createAll` | ✅ | ✅ | — | `test/integration/test/sql-orm-client/create.test.ts`; `test/e2e/framework/test/sqlite/orm.test.ts` (`createAll`) |
| `createCount` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/create.test.ts` (`createCount`) |
| `update` | ✅ | ✅ | — | `test/integration/test/sql-orm-client/update.test.ts`; `test/e2e/framework/test/sqlite/orm.test.ts` (`update`) |
| `updateAll` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/update.test.ts` (`updateAll`) |
| `updateCount` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/update.test.ts` (`updateCount`) |
| `delete` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/delete.test.ts` (`delete`) |
| `deleteAll` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/delete.test.ts` (`deleteAll`) |
| `deleteCount` | ✅ | ✅ | — | `test/integration/test/sql-orm-client/delete.test.ts` (`deleteCount`); `test/e2e/framework/test/sqlite/orm.test.ts` (`deleteCount`) |
| `upsert` (conflict fallback + explicit criteria) | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/upsert.test.ts` |
| `aggregate(spec)` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/aggregate.test.ts` |
| `groupBy` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/group-by.test.ts` (`groupBy().aggregate() returns grouped counts`) |
| `GroupedCollection.having` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/group-by.test.ts` (`having((having) => having.count().gt(1))`) |
| `GroupedCollection.aggregate` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/group-by.test.ts` (`groupBy().aggregate()`) |
| `include(relation, refine?)` eager load | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/include.test.ts` |
| Registered collection methods / subclasses | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/orm.test.ts` |
| Execution mutation default: generated id | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/create.test.ts` (`execution mutation defaults`); `test/integration/test/sql-orm-client/collection-mutation-defaults.test.ts` |
| Execution mutation default: `@updatedAt` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/collection-mutation-defaults.test.ts` |
| Comparison operator `eq` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/first.test.ts` (`user.id.eq(2)`) |
| Comparison operator `neq` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/field-reference.test.ts` (`u.name.neq('Bob')`) |
| Comparison operator `in` | 🟡 | 🟡 | — | |
| Comparison operator `notIn` | 🟡 | 🟡 | — | |
| Comparison operator `gt` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/aggregate.test.ts` (`post.views.gt(999)`) |
| Comparison operator `lt` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/field-reference.test.ts` (`BinaryExpr.lt` column comparison) |
| Comparison operator `gte` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/aggregate.test.ts` (`post.views.gte(20)`) |
| Comparison operator `lte` | 🟡 | 🟡 | — | |
| Comparison operator `isNull` | 🟡 | 🟡 | — | |
| Comparison operator `isNotNull` | 🟡 | 🟡 | — | |
| `like` textual filter | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/ilike.test.ts` (`u.name.like('%Ali%')`) |
| `ilike` textual filter | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/ilike.test.ts` (`u.name.ilike('%Ali%')`) |
| String `contains` first-class helper | 🟡 | 🟡 | — | |
| String `startsWith` first-class helper | 🟡 | 🟡 | — | |
| String `endsWith` first-class helper | 🟡 | 🟡 | — | |
| `findUniqueOrThrow` / `findFirstOrThrow` terminal | ❌ | ❌ | — | |
| Per-query / global `omit` | ❌ | ❌ | — | |
| `createMany({ skipDuplicates })` | ❌ | ❌ | — | |
| `updateMany({ limit })` | ❌ | ❌ | — | |
| `relationLoadStrategy: 'query' \| 'join'` | ❌ | ❌ | — | |
| `Prisma.skip` | ❌ | ❌ | — | |
| `strictUndefinedChecks` | ❌ | ❌ | — | |
| `findUnique` auto-batching (dataloader) | ❌ | ❌ | — | |
