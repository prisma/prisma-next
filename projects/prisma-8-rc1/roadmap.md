# Roadmap to Prisma 8

Prisma Next becomes **Prisma 8**. We publish **`prisma@8.0.0-rc.1` on July 31** from the prisma/prisma repository, under the same `prisma` package everyone already uses — kept on a pre-release tag, so `npm install prisma` stays on v7 until 8.0.0 final. The release candidate freezes the API. It doesn't promise Prisma 7 parity: it promises that **everything it ships works and is proven**, everything experimental is labeled, and everything absent is named. After the RC, 8.0.0 final ships when the scoreboard is fully green — on criteria, not on a date.

**Ships July 31 · Health: on track · Updated July 21**

There is no internal schedule beyond the ship date: we work the lanes below as fast as they'll go and ship as soon as the critical path clears. Two decisions have dates because other work waits on them: the minimum supported Postgres version (July 22), and the scope call — polymorphism stable or experimental, scoreboard verdicts frozen — on July 24.

## The critical path — three things decide July 31

Everything else has slack. These three don't: if one stalls, the date or the scope moves.

1. **Lossless query results** — *in flight.* Reading relations through `.include()` currently corrupts big numbers and fails on date columns, because database JSON discards precision before our type codecs can intervene. The fix makes every value survive the trip losslessly, delivered as a strict four-stage sequence. The flagship read path has to be correct for "everything we ship works" to be true.
2. **Final schema language** — *spec in progress.* The schema language freezes at the RC. Before it does: reusable field sets (mixins) replace three older mechanisms, native column types move onto type constructors like `pg.timestamptz`, and raw SQL snippets get proper backtick fences instead of escaped strings. Shipping the old spellings would freeze them into the API for the life of v8.
3. **The move into prisma/prisma** — *starting.* The code merges into prisma/prisma on a staging branch, with full CI green there well before it becomes `main` in release week. Prisma 7 moves to a maintenance branch with a public 12-month support promise. Merge mechanics must never be a last-week discovery.

## How far along are we — the scoreboard

The honest progress meter is the **feature-support matrix**: ~326 features × three databases, every cell verified against a named Prisma Next test suite. The draft enumeration is complete and under review ([PR #1000](https://github.com/prisma/prisma-next/pull/1000)). Of the cells that claim availability today:

| | Cells | Meaning |
| --- | ---: | --- |
| ✅ Proven | ~450 | A named Prisma Next test suite demonstrates it works |
| 🟡 Unproven | ~500 | Reachable through the public surface, no proving test yet — **this is the test-writing queue** |
| 🧪 Experimental | ~30 | Shipped, outside the stability promise |
| ❌ Not in 8.0 | ~250 | Deliberate, named absences — not silent gaps |

Progress from here is literal: unproven cells flip to proven as tests land. The rendered matrix ships publicly with the RC as our scoreboard.

## The work

Five lanes, kanban style — items move down as they land. **In flight** means someone is on it now; **up next** is ordered; **queued** waits for a slot or a decision.

### Lane 1 — Make the query engine correct

- **In flight** · Lossless query results (the four-stage sequence above).
- **In flight** · Polymorphism edge-case stream — recent fixes have narrowed from capability gaps to edge cases, which is the signal we want before calling it stable on July 24.
- **Done** · Variant-scoped predicates in count writes · field selection restricted to what was asked for · rejection of ambiguous relation shapes.

### Lane 2 — Finalize the schema language

- **In flight** · Mixins spec: named, reusable field sets (`@@include(WithTimestamps)`) replacing field presets and type aliases.
- **Up next** · Type constructors (`pg.timestamptz`, `sql.char(32)`) replace `@db.*` attributes; `@dbgenerated()` retires in favor of tagged literals.
- **Up next** · Template-tagged literals (`` pg.sql`…` ``) for SQL snippets in schemas — views, partial-index predicates, policy expressions, raw defaults.
- **Up next** · One regeneration of all example schemas and migrations, once, at the end of the lane.

### Lane 3 — Freeze the formats

Everything here changes surface that becomes permanent at the RC. Sequenced as one train so user contracts regenerate once, not five times.

- **Queued** · One consistent error-code scheme across the four systems that exist today, plus a published mapping from every old code. *(Waiting on the format decision.)*
- **Queued** · Rename the `extensionPacks` config key to `extensions`.
- **Queued** · Drop the `sha256:` prefix from all hashes.
- **Queued** · Store each migration contract snapshot once (`migrations/snapshots/`) instead of copying it into every migration folder.

### Lane 4 — Prove it

- **In flight** · The feature matrix (draft under review — the scoreboard above).
- **Up next** · The side-by-side proof: one project, both versions installed, one database; Prisma 7 keeps running its migrations while Prisma 8 adopts and queries the same data. This is the receipt for the incremental-migration promise, and it has never been run end-to-end.
- **Up next** · TypeScript compile-time benchmarks (10/100/500-model schemas) on a public dashboard — before the types freeze, while problems are still fixable.
- **Up next** · Port Prisma 7 test cases against the ~500 unproven scoreboard cells. A stream, not a step; continues past the RC.
- **Done** · Database adoption round-trips cleanly: introspecting an existing database produces a schema our own tooling accepts and verifies (seven defects fixed, proven against live databases).

### Lane 5 — Move house

- **In flight** · History-merge dry run in a fork, then the `v8` staging branch in prisma/prisma with full CI.
- **Queued** · Package renames — `prisma` plus `@prisma/postgres` / `@prisma/sqlite` / `@prisma/mongo`; only the four packages users actually touch change names. Name-collision check against existing `@prisma/*` packages.
- **Queued** · The `v7` maintenance branch with working CI; trusted-publisher configuration for the renamed packages.
- **Queued** · At merge time: close old v7 issues except v7 bugs, pinned explanation issue, deprecation notice on the old `prisma-next` package.

## Recently landed

- **Database adoption round-trips cleanly** — the foundation of the v7 → v8 migration path (seven defects fixed, live-database proof).
- **Polymorphism correctness fixes** — count-writes, field selection, relation-uniqueness validation; the bug stream has narrowed to edge cases.
- **Foreign keys and indexes became first-class contract entities**, and migration operations are ordered by a real dependency graph — the last big contract-shape changes landed ahead of the freeze.
- **The feature matrix draft is up** — 326 features enumerated and verdict-ed across all three databases.
- **Supabase integration shipped and closed out** — a first Supabase project works first-try, including row-level-security migrations.

---

Plan of record: [prisma-next #986](https://github.com/prisma/prisma-next/pull/986) · scoreboard draft: [#1000](https://github.com/prisma/prisma-next/pull/1000) · tracking: [Linear — Prisma 8 RC1](https://linear.app/prisma-company/project/prisma-8-rc1-7592265f700c). Launch communications are planned separately and deliberately not covered here.
