# Roadmap to Prisma 8 RC1

Prisma Next — the contract-first rewrite of Prisma — ships as **Prisma 8**. On **July 31** we publish **`prisma@8.0.0-rc.1`** from the `prisma/prisma` repository: the same repository and the same npm package Prisma users already know. The release candidate is published under a pre-release tag, so `npm install prisma` keeps installing Prisma 7 until 8.0.0 final ships. Prisma 8 carries **PostgreSQL to general availability** — and that is all: **MongoDB ships in early access**, and **SQLite is a proof of concept** at this stage. A release candidate freezes the public API; it does not promise Prisma 7 feature parity. Its promise is different: **everything it ships works and is proven by a test**, everything experimental is labeled, and everything absent is named rather than silently missing.

**Updated July 21 · Health: on track · Ships July 31 · Tasks: 1 done / 12 in flight / 22 not started · [Scoreboard](https://github.com/prisma/prisma-next/pull/1000): ~450 proven / ~500 unproven / ~30 experimental / ~250 not in 8.0**

## What needs to happen to release v8-RC1

Six things must be true on release day. Everything on this page belongs to one of them.

1. **[Queries must return correct values](#1-queries-must-return-correct-values)** — *in progress · Alexey.* The main remaining defect: values read through relation-loading corrupt or fail.
2. **[The schema language must reach its final form](#2-the-schema-language-must-reach-its-final-form)** — *in flight · Serhii.* Whatever syntax the RC ships is permanent for the life of v8; three language projects are running.
3. **[Every name and format users depend on must be final](#3-every-name-and-format-users-depend-on-must-be-final)** — *in progress · Will.* The error-code consolidation is in review; config keys, hashes, and generated-file layouts still to do.
4. **[The release's claims must be proven](#4-the-releases-claims-must-be-proven)** — *scoreboard drafted, proofs open · everyone.* "It works" and "you can migrate incrementally" each need a runnable receipt.
5. **[The code must move into prisma/prisma](#5-the-code-must-move-into-prismaprisma)** — *starting · Alexey.* Repository merge, publishing pipeline, and years of open v7 issues.
6. **[The rough edges users hit on day one must be gone](#6-the-rough-edges-users-hit-on-day-one-must-be-gone)** — *not started · everyone.* Small fixes that would be embarrassing under announcement-day attention.

Two decisions gate work and have dates: the minimum supported Postgres version (July 22 — it blocks final scoreboard verdicts), and the polymorphism stable-or-experimental call (July 24, decided by whether its bug stream has flattened). A third is already made: error codes standardize on dotted namespace codes (like `ORM.DECODE_FAILED`), and the consolidation is in review. July 24 is also the day the scoreboard verdicts freeze and scope stops moving. There is no other internal schedule: we work these sections as fast as they'll go and ship when they're done.

---

## 1. Queries must return correct values

Prisma 8's core promise at the RC is that the query paths it ships are correct. One significant defect class remains, plus the tail of an almost-finished one.

<details><summary>⏳ <b>Values read through relation-loading bypass their type codecs — big numbers silently corrupt, date columns throw</b> · critical path</summary>

When a query loads a relation (say, a post together with its author), Postgres assembles the nested rows into JSON inside the database, using its `json_agg` function. JSON numbers cannot represent everything a database column can hold: a 64-bit integer or arbitrary-precision decimal gets silently rounded to the nearest JavaScript-representable number before Prisma's type codecs ever see it, and date/time values arrive in a format the decoder rejects — so a plain `DateTime` column read through `.include()` throws today.

The fix: every type codec gains an explicit *lossless* JSON form (big numbers travel as strings, for example), and the SQL we generate is changed to produce that form inside the database. It lands as four pull requests in strict sequence — foundations, per-database codec descriptors, the switch-over, then aggregate typing. The switch-over is a breaking change: users regenerate their contract files, and some aggregate result types change (a `count()` becomes a `bigint`, decimal sums become strings — precise instead of approximately convenient).

Tracked as [TML-3060](https://linear.app/prisma-company/issue/TML-3060/plan-codec-json-projections); in flight now.
</details>

<details><summary>⬜ <b>`date` columns fail at runtime when read through relation-loading</b></summary>

The codec that correctly handles Postgres `date` values exists and is strict (it rejects impossible dates like February 31st rather than silently normalizing them). But nothing connects the `date` column type to that codec yet, so reading a `date` column through `.include()` fails. The connection is a one-line change that deliberately waits for the schema-language work below (which reshapes how column types bind to codecs), and a failing test already pins the exact behavior — when the fix lands, that test flips from red to green.
</details>

<details><summary>⏳ <b>Binary columns read through relation-loading return hex text instead of bytes</b></summary>

Same disease as the big one above, concrete instance: a `Bytes` column selected inside `.include()` comes back as the raw hexadecimal text Postgres uses in JSON (`\x48656c6c6f`) while the TypeScript types promise a `Uint8Array`. Fixed by the same lossless-JSON work; a separate ticket ([TML-2990](https://linear.app/prisma-company/issue/TML-2990)) tracks it so it can't be forgotten in the sweep. In progress.
</details>

<details><summary>⏳ <b>Places where the TypeScript types and the runtime disagree</b></summary>

Two known mismatches, both "the type signature promises one thing, the running code returns another":

- `Timestamp`/`Timestamptz` columns: the declared output type is a branded string, but the codec actually returns a JavaScript `Date` ([TML-2391](https://linear.app/prisma-company/issue/TML-2391), in progress).
- Projects that use the schema types directly without running contract emission (`typeof contract`) get types that ignore per-instance codec parameters and enum value sets — so a column can typecheck against values the database will reject ([TML-2960](https://linear.app/prisma-company/issue/TML-2960), in progress).

A type that lies is a correctness bug with a delay on it; both must be resolved (or the type corrected to tell the truth) before the types freeze.
</details>

<details><summary>⏳ <b>Finish the polymorphism bug tail — then decide: stable or experimental</b></summary>

Polymorphism means models that inherit from a base model, stored across joined tables (multi-table inheritance). It has been the source of most of Prisma 8's recent correctness bugs. The encouraging signal: recent fixes are narrow edge cases rather than missing capabilities, and no known-broken or skipped tests remain in the area. The open list, so the tail is visible rather than vibes:

- Explicit `.select(...)` on a polymorphic include doesn't restrict variant-table columns ([TML-2783](https://linear.app/prisma-company/issue/TML-2783), in progress — the core fix landed, follow-up open).
- Variant lookup is namespace-flat, so two variants with the same name in different namespaces can't be addressed ([TML-2841](https://linear.app/prisma-company/issue/TML-2841), in progress).
- The model accessor's return type isn't variant-aware ([TML-2847](https://linear.app/prisma-company/issue/TML-2847), in progress).
- The shorthand `.where({priority: 1})` form rejects variant fields that the callback form accepts ([TML-2982](https://linear.app/prisma-company/issue/TML-2982), open).
- Bulk `createAll()` on a variant silently drops write annotations ([TML-2600](https://linear.app/prisma-company/issue/TML-2600), open).
- A variant model declaring a column that collides with a base-table column silently merges instead of failing validation ([TML-2827](https://linear.app/prisma-company/issue/TML-2827), open).

On July 24 we decide from this list and the discovery rate, not from hope: if it's shrinking and nothing new is appearing, polymorphism ships inside the stability promise; otherwise it ships clearly labeled experimental and stabilization continues after the RC without blocking it.
</details>

---

## 2. The schema language must reach its final form

Users write their data model in Prisma Schema Language (PSL) files. Whatever syntax the RC accepts is the syntax v8 supports forever — so every planned change to the language must land before July 31 or be abandoned. Four language changes are planned — mixins, native column types, directional relations, and tagged SQL fences — plus two items that follow from them: removing `@dbgenerated()` builds on the tagged fences, and the example schemas get regenerated once at the end. All of it is coordinated so users' generated files change once, not once per change.

<details><summary>⏳ <b>Mixins: reusable, named sets of fields</b></summary>

The long-standing ask — share `createdAt`/`updatedAt`/tenant-id fields across many models without copy-paste — gets a first-class answer: define the fields once in a named `mixin` block, include them with `@@include(WithTimestamps)`. Mixins deliberately take no parameters (variations get their own names), and they replace two existing mechanisms that grew complicated trying to solve the same problem: *field presets* (pack-shipped field templates with an argument system) and *type aliases*. Both retire.

Decided by the team on July 20; design in progress. Tracked as [TML-3055](https://linear.app/prisma-company/issue/TML-3055/psl-mixins-named-field-set-reuse-retire-field-presets-type-aliases-and). This is the largest single pre-release work item.
</details>

<details><summary>⏳ <b>Native column types move onto type constructors; `@db.*` attributes are deleted</b></summary>

Prisma 7 spelled database-native column types with attributes: `email String @db.VarChar(255)`. Prisma 8 replaces that spelling with the type written directly in the type position: `email VarChar(255)`, `id Uuid`, `payload Jsonb`. The type says what the column is; no attribute needed. All `@db.*` attribute support is deleted from the language before the freeze — shipping both spellings would freeze both forever.

This has its own running project ("Remove `@db.*` attributes from PSL"): Postgres native types as bare PSL scalar types is in review ([TML-2986](https://linear.app/prisma-company/issue/TML-2986)), and the unification that makes every scalar type a zero-argument type constructor under one contribution mechanism is in progress ([TML-2985](https://linear.app/prisma-company/issue/TML-2985)). The `date`-column fix from section 1 lands here.
</details>

<details><summary>⏳ <b>Relations get a directional spelling; `@relation(name:)` retires</b></summary>

Prisma 7 expressed relations with paired fields on both models and disambiguated with `@relation(name: "...")` strings — a spelling users routinely get wrong. Prisma 8 replaces it with directional syntax: a foreign key declares where it points (`from`/`to`), many-to-many goes through an explicit junction (`through: Junction`) or an implicit one synthesized for you, and multi-hop paths spell the route out (`a -> J.b -> J.c -> T.d`). Five slices, all in flight ([TML-2940](https://linear.app/prisma-company/issue/TML-2940) through [TML-2944](https://linear.app/prisma-company/issue/TML-2944)). This is frozen-surface work on exactly the same clock as mixins: whatever relation spelling the RC accepts is the spelling for the life of v8.
</details>

<details><summary>⬜ <b>SQL embedded in schemas gets proper fences instead of escaped strings</b></summary>

Schemas sometimes need to carry a piece of literal SQL: a view definition, a partial-index condition, a row-level-security policy expression, a database-computed default. Today those travel as ordinary quoted strings, with all the escaping pain that implies. The accepted design ([ADR 129](docs/architecture%20docs/adrs/ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md)) is a tagged backtick fence — `` pg.sql`SELECT 1` `` — with no string interpolation, cleanly handed to the extension that owns it. It is not implemented yet; if it doesn't land, the quoted-string form freezes as the API.
</details>

<details><summary>⬜ <b>`@dbgenerated()` is removed; database-computed defaults become tagged fences</b></summary>

Prisma 7 spelled "the database computes this default" as an attribute wrapping a SQL string: `@default(dbgenerated("gen_random_uuid()"))` — a quoted string with escaping problems and no ownership story. Prisma 8 removes `@dbgenerated()` entirely: a raw SQL default is written as a tagged backtick fence (the mechanism above), so the same one syntax carries every piece of embedded SQL in a schema. This depends on the tagged-fence implementation landing first. It also reaches beyond the parser: the Postgres and SQLite default-handling code and the introspection path (which meets `dbgenerated`-shaped defaults in every real existing database, and must *emit* tagged fences for them) all change with it.
</details>

<details><summary>⬜ <b>Regenerate every example schema and migration — once, at the end</b></summary>

All of the above changes what generated schema and migration files look like. The example projects and their committed migrations get regenerated a single time after the last language change lands, rather than churning after each one.
</details>

---

## 3. Every name and format users depend on must be final

Users write `catch` blocks against error codes, commit generated contract and migration files to their repositories, and write config files against our keys. All of that becomes permanent API at the RC. Five changes must land first — sequenced together, because several of them alter the same generated files and users should see one change, not five.

<details><summary>⏳ <b>One error-code scheme instead of four</b> · format decided, consolidation in review</summary>

Prisma 8 grew four separate error systems with two incompatible code formats — about 46 codes shaped like `PN-CLI-4001` and about 89 shaped like `RUNTIME.DECODE_FAILED` — plus roughly sixteen error classes carrying no code at all, including the database driver errors users hit most often. The format decision is made: **dotted namespace codes win** (`RUNTIME.DECODE_FAILED`-style). The structural consolidation is in review ([TML-3067](https://linear.app/prisma-company/issue/TML-3067)), and the sweep converting the ORM's codeless throws into structured `ORM.*` errors is in progress ([TML-3070](https://linear.app/prisma-company/issue/TML-3070)). Still to come with it: the published table mapping every old code to its new one. Prisma 7's `P1001`-style codes are deliberately not carried over — the upgrade guide will include a translation table for migrating monitoring rules and runbooks.
</details>

<details><summary>⬜ <b>Rename the `extensionPacks` config key to `extensions`</b></summary>

A simple rename with a deep reach: the key appears in user config files, in the schema of the generated contract document, and in the code that canonicalizes and hashes contracts — about 350 files. Breaking, so it happens now or never. While in there, the config format gets a sweep for any other key we'd regret freezing as-is. ([TML-2462](https://linear.app/prisma-company/issue/TML-2462))
</details>

<details><summary>⬜ <b>Hashes lose their `sha256:` prefix</b></summary>

Prisma 8 identifies contracts and migrations by content hash, and today every hash is written with an algorithm prefix: `"storageHash": "sha256:9f49…"`. The prefix adds nothing (the algorithm isn't going to vary per hash) and it appears everywhere users see a hash — generated contract files, migration manifests, the bookkeeping tables Prisma maintains in the user's database. The textual form of hashes freezes at the RC, so the prefix is dropped now, in one sweep across roughly 368 source files plus regenerated examples.
</details>

<details><summary>⬜ <b>Store each contract snapshot once instead of copying it into every migration</b></summary>

Every migration folder currently carries full copies of the data contract it goes from and to — so a project with N migrations stores roughly 2N copies of N+1 distinct documents. They move to a single `migrations/snapshots/` folder, one file per distinct contract, named by its content hash; migration folders already record which hashes they go from and to, so they need no new linking files. Safe to do (a migration's identity hash deliberately doesn't cover the snapshots, so no existing migration is invalidated) and urgent to do (the migrations folder layout is one of the things that freezes — users commit these folders to their repositories).
</details>

<details><summary>⬜ <b>Sweep out the old `prisma-next` name everywhere it's baked in</b></summary>

After the package rename (section 5), the old name survives in places that are easy to forget and hard to change later: the project templates that `prisma-next init` writes for new users, the agent skills it installs into user projects, the documentation links embedded inside error messages (which must resolve to real pages on release day), and internal-looking names that are actually permanent — environment variable names, the per-user config file path, telemetry identifiers. Each gets an explicit keep-or-rename decision before the freeze makes the choice for us.
</details>

---

## 4. The release's claims must be proven

The announcement will make two big claims: *everything Prisma 8 ships works*, and *you can run Prisma 7 and Prisma 8 side by side and migrate incrementally*. With early-access adoption having been thin, tests have to do the confidence-building work that production feedback normally would. Each claim gets a runnable receipt.

<details><summary>⏳ <b>The feature scoreboard: ~326 features × 3 databases, every "works" backed by a named test</b></summary>

A matrix of every feature against every supported database (Postgres, SQLite, MongoDB). Each cell holds a verdict: **works** (and names the test suite that proves it), **unproven** (reachable, but no test demonstrates it yet), **experimental** (shipped, outside the stability promise), or **not in 8.0** (a deliberate, written-down absence — nothing is allowed to be silently missing). The rows come from two directions: everything Prisma 8's public surface exposes, crossed with every notable Prisma 7 capability, so absences are named rather than discovered.

The draft is up for review as [PR #1000](https://github.com/prisma/prisma-next/pull/1000). Current draft counts: **~450 cells proven, ~500 unproven, ~30 experimental, ~250 named absences.** The unproven column is literally the remaining test-writing queue, and the rendered matrix ships publicly with the RC — progress from here on is cells flipping from unproven to proven.
</details>

<details><summary>⏳ <b>Capabilities still landing before the verdicts freeze on July 24</b></summary>

Several features are mid-flight; their scoreboard cells can't get final verdicts until they land or get cut:

- **Native scalar arrays** — `String[]`, `Int[]` and friends as real Postgres array columns, end-to-end from schema authoring through querying, filtering, and mutation. Slices 2 and 3 in flight ([TML-2912](https://linear.app/prisma-company/issue/TML-2912), [TML-2913](https://linear.app/prisma-company/issue/TML-2913)).
- **Enums on every database** — the plan to treat enums as an application-level concept so they work uniformly on Postgres, SQLite, and MongoDB rather than only where the database has native enums ([TML-2815](https://linear.app/prisma-company/issue/TML-2815), planning in progress).
- **Polymorphism in the TypeScript authoring path** — schemas written in TypeScript (instead of PSL) can't declare inheritance yet; the PSL path can ([TML-2228](https://linear.app/prisma-company/issue/TML-2228), open). Until it lands, the scoreboard carries the asymmetry explicitly.

Anything on this list that misses July 24 gets its cells stamped as they actually are — unproven, experimental, or not in 8.0 — rather than holding the freeze.
</details>

<details><summary>⬜ <b>Raw SQL query support — running an arbitrary SQL statement when the ORM and builder can't</b></summary>

"Raw queries" is a headline row every Prisma 7 user will look for: hand a parameterized SQL string to the client and get rows back, or an affected-row count. Prisma 8 ships part of this today and has to settle the rest before the scoreboard freezes.

What already works is a raw SQL *fragment* inside the typed builder — `` fns.raw`…` `` for a function or operator the operation registry doesn't expose (`array_agg`, `ts_rank`, a vendor extension), composing with the rest of a built query. It's proven by tests on Postgres and SQLite, and MongoDB has its own raw-command escape hatch. What's missing is the *statement-level* path — running a whole SQL string on its own — and that's the work:

- **A public API for running an arbitrary SQL statement.** The `$queryRaw`/`$executeRaw` parity surface: one call that takes a parameterized SQL string and returns rows, another that returns an affected-row count, issued straight to the driver rather than through the query compiler. The substrate all exists — the driver already exposes a `query(sql, params)` method, there is a raw execution-plan shape, and the guardrail evaluator already runs on it — but nothing surfaces it to users. A real app built on Prisma 8 had to hand-assemble an internal execution plan just to run a `truncate`, and casting around the missing type then crashed a guardrail ([TML-2672](https://linear.app/prisma-company/issue/TML-2672)). The design is written down ([ADR 012](docs/architecture%20docs/adrs/ADR%20012%20-%20Raw%20SQL%20Escape%20Hatch.md)); the helper is not built.
- **Safe by construction, with an explicit unsafe door.** Interpolated values always travel as bind parameters, never spliced into the SQL text. The rare case that genuinely needs a query string assembled at runtime gets a separate, clearly-named entry point — so the dangerous path is the one a user has to ask for by name.
- **Read-versus-write intent the guardrails can see.** A raw statement declares whether it reads or writes (and whether it carries a `WHERE`/`LIMIT`), so the existing lint and budget guardrails — mutation-needs-a-filter, result-size limits — apply to raw SQL too, and the missing-metadata crash above is gone. Core does no SQL parsing here by design; the caller states the intent.
- **A decided answer for result typing and the composition helpers.** Raw rows come back as the database sends them; a typed-results story (Prisma 7's TypedSQL) and the `Prisma.sql`/`Prisma.join`/`Prisma.raw`/`Prisma.empty` fragment-composition helpers are currently marked *not in 8.0*. Whichever way each lands, it gets named on the scoreboard rather than left ambiguous.
- **One frozen-surface fix on the piece that already shipped.** The builder's `` fns.raw`…` `` infers a value's database type from its JavaScript runtime type — a guess baked into a public API — so it's replaced with an explicit codec before the surface freezes ([TML-2959](https://linear.app/prisma-company/issue/TML-2959)).

The bar for July 24 is a verdict, not necessarily a finished feature: statement-level raw SQL either ships with a proving test or becomes a written-down "not in 8.0" absence — not a reachable-but-untested cell nobody can act on.
</details>

<details><summary>⬜ <b>The side-by-side proof: both versions, one database, migrating incrementally</b></summary>

The incremental-migration story is: keep Prisma 7 running and owning your database schema; install Prisma 8 alongside it in the same project; let Prisma 8 *adopt* the database read-only (it derives a schema from the live database, verifies the database matches, and records that fact — without touching Prisma 7's migration state); move code over gradually; cut over once at the end. Every individual mechanism in that story exists and is tested. **The whole story has never been run end-to-end** — a planned real-world evaluation never happened — which makes it the release's biggest untested claim.

So we build it as a permanent test: one project with both versions installed, one Postgres database, Prisma 7 running its migrations and Prisma 8 adopting, querying, and re-adopting after schema changes — run under each of npm, pnpm, Yarn, and Bun, because installing two versions side by side is exactly where package managers differ. Must be green by July 24, or the announcement's migration claim gets scaled back to what's actually proven. The upgrade guide's code samples get lifted from this project, so the documentation is executable by construction.
</details>

<details><summary>⬜ <b>TypeScript performance measured before the types freeze</b></summary>

Prisma 8 leans heavily on advanced TypeScript types, which is exactly the pattern that can make a big project's type-checking slow. We measure now — generated projects of 10, 100, and 500 models, checked with both today's TypeScript and the new Go-based TypeScript 7 compiler — because if the numbers are bad, the types can only be fixed while they're still allowed to change. Results publish to a public dashboard, and pull requests fail if they make type-checking meaningfully more expensive (measured by the compiler's deterministic work counters, not by flaky wall-clock time on shared CI runners).
</details>

<details><summary>⬜ <b>Port Prisma 7's accumulated edge-case tests against the unproven cells</b></summary>

Prisma 7's functional test suite encodes years of database and query edge cases. Converting it wholesale would take months and mostly port API details that no longer exist — so we mine it instead: for each scoreboard cell that says "works" without a proving test, find the Prisma 7 tests covering that feature and port just those scenarios. Where comparing against Prisma 7's behavior is cheaper than porting assertions, the side-by-side project doubles as the comparison harness. This is a stream, not a step; it continues past the RC, visibly, on the public scoreboard.
</details>

<details><summary>✅ <b>Adopting an existing database round-trips cleanly</b> · landed</summary>

The adoption path had a credibility problem: deriving a schema from a live database produced output that Prisma 8's own tooling then rejected or flagged as drifted — a user had independently written a 260-line repair script to fix our output, and it matched the workaround script in our own repository. Seven distinct defects were fixed, and the whole loop (read the database → derive the schema → emit the contract → verify the database matches) now runs as an automated test against live databases. This is the foundation the side-by-side proof builds on.
</details>

---

## 5. The code must move into prisma/prisma

Prisma 8 has so far been developed in a separate repository, `prisma/prisma-next`. Before release, everything moves into `prisma/prisma` — the repository users already watch, star, and file issues against — so Prisma 8 arrives as the main line of Prisma, not a side project. Moving is much more than copying code: the two repositories' git histories have to be joined, CI has to run green in its new home, the npm publishing pipeline has to serve v8 and v7 side by side, thousands of open v7 issues and pull requests need a decision, and the automation in other repositories that points at prisma/prisma has to keep working afterward. Prisma 7 doesn't stop: it continues from a `v7` branch in the same repository, with bug fixes promised for 12 months after 8.0.0 final ships.

<details><summary>⏳ <b>Join the two repositories' histories on a staging branch</b></summary>

First a rehearsal in a disposable fork: combine prisma-next's history with prisma/prisma's and check the result is livable — `git log` and `git blame` still make sense, old tags still resolve, the repository doesn't balloon. Then the real `v8` branch inside prisma/prisma, with the complete test suite green and kept green until release week, when it becomes `main`. The merge gets rehearsed for weeks; it is never improvised at the deadline.
</details>

<details><summary>⬜ <b>Rewire the publishing pipeline — inside prisma/prisma and in the repositories connected to it</b></summary>

prisma/prisma's release automation currently exists to publish Prisma 7. After the move it does two jobs: publish v8 from `main` and keep publishing v7 patches from the `v7` branch, without either disturbing the other. (Publish permissions on the `prisma` npm package are already in hand; what remains is configuration, including the per-package "trusted publishing" setup that lets CI publish without long-lived secrets.) Beyond the repository itself, workflows in several other repositories and open pull requests are wired into prisma/prisma's publishing today; each connection has to be found and re-pointed. The first concrete task is the inventory — a written list of every workflow that touches prisma/prisma's publishing, so the rewiring is a checklist instead of a surprise.
</details>

<details><summary>⬜ <b>Take over the `prisma` package name — carefully</b></summary>

The `prisma` package becomes Prisma 8's command-line tool, published under a pre-release tag so `npm install prisma` keeps giving people Prisma 7 until 8.0.0 final. The three per-database packages users import get new names: `@prisma/postgres`, `@prisma/sqlite`, `@prisma/mongo` (checked for collisions against the many `@prisma/*` names Prisma 7 already publishes). Only those four packages rename — the ~60 internal packages that arrive automatically as dependencies keep their `@prisma-next/*` names and are explicitly not part of the supported surface. The v8 tool installs a single command, `prisma-next` — deliberately *not* `prisma`, so in a project that has both versions installed, `prisma` always unambiguously means Prisma 7, on every package manager. (Whether v8 ever claims the bare `prisma` command is deferred; adding a command later breaks nothing.) The old `prisma-next` package gets a deprecation notice pointing at its new home.
</details>

<details><summary>⬜ <b>Decide the fate of every open v7 issue and pull request</b></summary>

prisma/prisma has years of open issues and PRs written against Prisma 7. When v8 becomes `main`, we close everything except genuine v7 bug reports (which stay open against the `v7` branch), post a pinned issue explaining what happened and why, and answer follow-ups with a saved reply pointing at it. This deliberately happens at merge time, not earlier — closing thousands of issues weeks before there's an announcement to point at would produce weeks of confusion. Issue templates get a version chooser at the same time, so new reports arrive sorted into v7 vs v8.
</details>

<details><summary>⬜ <b>The `v7` maintenance branch, with working CI</b></summary>

Prisma 7's code, tests, and release automation move to a `v7` branch in prisma/prisma and must actually work there — this branch is where 12 months of promised bug fixes ship from, so a broken CI setup on it would turn every future v7 patch into an archaeology project.
</details>

---

## 6. The rough edges users hit on day one must be gone

None of these block anything technically. All of them are what a skeptical engineer meets in their first hour, under announcement-day attention.

<details><summary>⬜ <b>A dropped database connection can crash the host process</b></summary>

When an idle pooled connection drops (a database restart, a network blip), the error has no listener attached and crashes the whole Node.js process. A production-readiness bug, not housekeeping — fixed before anyone's production meets it. ([TML-2655](https://linear.app/prisma-company/issue/TML-2655))
</details>

<details><summary>⬜ <b>A deprecation warning prints on every single database connection</b></summary>

The underlying Postgres driver prints a deprecation notice each time a connection opens. Harmless, but it's the first thing every new user sees, and it reads as "this isn't finished." ([TML-2628](https://linear.app/prisma-company/issue/TML-2628))
</details>

<details><summary>⬜ <b>Open security alerts on dependencies</b></summary>

The announcement puts many eyes on the repository; a visible backlog of automated vulnerability alerts on day one is a bad look and a support-ticket magnet. Cleared before the merge. ([TML-2789](https://linear.app/prisma-company/issue/TML-2789))
</details>

<details><summary>⬜ <b>The npm page and editor experience for the packages people actually open</b></summary>

The `prisma` package's README becomes Prisma 8's face on npm. The four public packages' exported functions and types are what users see when they hover in their editor — those documentation comments get an audit. The ~60 internal packages get a short standard notice identifying them as implementation detail. ([TML-1799](https://linear.app/prisma-company/issue/TML-1799))
</details>

<details><summary>⏳ <b>First-class editor support for the schema language</b></summary>

A language users write by hand deserves an editor that helps: formatting, autocomplete, syntax coloring, and diagnostics for Prisma 8's schema language, served by its language server. This work is running now — hooking the formatter to the language server, keyword and model-type completions, semantic-token coloring, and replacing the legacy schema parser with the new syntax-tree parser underneath it all (the "Language Tools Support Prisma Next PSL" project — e.g. [TML-2929](https://linear.app/prisma-company/issue/TML-2929), [TML-2947](https://linear.app/prisma-company/issue/TML-2947), [TML-2948](https://linear.app/prisma-company/issue/TML-2948)). It also has to track the schema-language changes in section 2 as they land, or the editor will underline the new syntax as errors.
</details>

<details><summary>⬜ <b>The editor doesn't fight itself in a two-version project</b></summary>

Users migrating incrementally will have Prisma 7's VS Code extension installed *and* Prisma 8's language server in the same project. Nobody has verified they coexist peacefully over schema files. Checked — and fixed or documented — before the announcement invites everyone into exactly that setup.
</details>

<details><summary>⬜ <b>Claims we haven't verified get verified or softened</b></summary>

Support statements that end up in the announcement get checked first: Windows, Bun, and Deno support levels; the telemetry first-run notice's wording; and whether the telemetry backend survives announcement-scale traffic.
</details>

---

## Recently landed

- **Adopting an existing database round-trips cleanly** — seven defects fixed, proven against live databases (details in section 4).
- **Polymorphism fixes narrowed to edge cases** — count-write scoping, field-selection restriction, relation-uniqueness validation (section 1).
- **The last big contract-format changes landed ahead of the freeze** — foreign keys and indexes became first-class entities in the contract document, and migration operations are now ordered by a real dependency graph.
- **The feature scoreboard draft is up** — 326 features enumerated and verdict-ed across all three databases ([PR #1000](https://github.com/prisma/prisma-next/pull/1000)).
- **The Supabase integration shipped and closed out** — a first Supabase project works first-try, including row-level-security migrations.

---

*Detailed working docs: [the release project](https://github.com/prisma/prisma-next/pull/986) · tracking: [Linear — Prisma 8 RC1](https://linear.app/prisma-company/project/prisma-8-rc1-7592265f700c) · launch communications are planned separately and not covered here. This page is updated as work lands.*
