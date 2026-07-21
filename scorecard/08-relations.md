# Relations

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma Next **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma Next public surface, but no proving Prisma Next integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma Next but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma Next.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| `belongsTo` | ✅ | 🟡 | ✅ | `test/integration/test/sql-orm-client/include.test.ts` (`stitches one-to-many and one-to-one relations`); `test/integration/test/mongo/orm.test.ts` (`include() on a reference relation`) |
| `hasOne` | ✅ | 🟡 | 🟡 | `test/integration/test/sql-orm-client/include.test.ts` (`stitches one-to-many and one-to-one relations`) |
| `hasMany` | ✅ | 🟡 | 🟡 | `test/integration/test/sql-orm-client/include.test.ts` (`stitches one-to-many and one-to-one relations`) |
| Eager `include()` | ✅ | 🟡 | ✅ | `test/integration/test/sql-orm-client/include.test.ts`; `test/integration/test/mongo/orm.test.ts` |
| Nested includes (depth-2 / depth-3+) | ✅ | 🟡 | 🟡 | `test/integration/test/sql-orm-client/nested-includes.test.ts` |
| Include refinements | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/nested-includes-refinements.test.ts` |
| `combine(...)` include branches | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/include.test.ts` (`combine`) |
| Self-relations | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/self-relations.test.ts` |
| Explicit many-to-many (junction model) | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/mn-include.test.ts`; `test/integration/test/sql-orm-client/mn-filter.test.ts` |
| To-many relation filter `some` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/mn-filter.test.ts` (`u.tags.some(...)`) |
| To-many relation filter `every` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/mn-filter.test.ts` (`u.tags.every(...)`) |
| To-many relation filter `none` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/mn-filter.test.ts` (`u.tags.none(...)`) |
| Referential action `onDelete` | ✅ | ✅ | — | `test/integration/test/referential-actions.integration.test.ts` (runtime behavior); `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`ON DELETE CASCADE`, `ON DELETE SET NULL`) |
| Referential action `onUpdate` | 🟡 | 🟡 | — | |
| Polymorphism — single-table inheritance (STI) | 🧪 | 🧪 | 🧪 | `test/integration/test/sql-orm-client/polymorphism-include-relationships.test.ts`; `test/integration/test/mongo/orm.test.ts` (`all() on a polymorphic root`) |
| Polymorphism — multi-table inheritance (MTI) | 🧪 | 🧪 | 🧪 | `test/integration/test/sql-orm-client/polymorphism-include-relationships.test.ts` |
| To-one relation filters (`is` / `isNot`) | ❌ | ❌ | — | |
| Implicit many-to-many (inferred `_AToB`) | ❌ | ❌ | — | |
| Fluent relation traversal (`.posts().author()`) | ❌ | ❌ | — | |
