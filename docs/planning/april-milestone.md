# April Milestone: Ready for External Contributions

**Goal**: External authors can meaningfully contribute to Prisma Next — SQL database targets, Postgres extensions, middleware, framework integrations, and query DSL extensions. This accelerates progress towards EA/GA.

**Key constraint**: System design decisions must be stable, even if user-facing APIs are still changing. Contributors need confidence that the interfaces they build against won't be reworked.

---

## Approach: architectural validation, not polish

We have five weeks (Mar 31 – May 2, with an offsite in Week 3). The goal for each workstream is to **validate the architecture** — prove that the design decisions hold under real conditions. It is not to polish the experience for users. That's May.

Each workstream is roughly independent, has a single owner, and that owner should progress through it as fast as possible. Each workstream has a priority-ordered queue of **validation points** (VP). Each VP identifies an architectural assumption to test, describes a user story that would prove it, lists the concrete tasks to get there, and defines a **stop condition** — the minimum result that answers the question. Everything beyond the stop condition is deferred. Work proceeds top-down: finish or explicitly stop VP1 before starting VP2. If you finish your workstream early, move to assist on another.

The team's instinct is to perfect. The constraint is: prove the architecture works first, then we polish.

---

## Workstreams

### 1. Migration system

**People**: Saevar

The migration system uses a graph-based data structure for migration history. This is architecturally powerful but unfamiliar to every user coming from linear migration systems (Rails, Django, Prisma ORM, etc.).

**Already validated**: Branch, diverge, merge, and conflict resolution — the graph model's core value proposition for team workflows is implemented and working.

**Key risks**:

- **Data migrations are the highest architectural risk.** The graph model's core invariant (route equivalence) breaks when data matters. If we can't extend routing to handle data invariants, the graph model may need fundamental rework — and we'd rather discover that now than after stabilizing the API. We have a theoretical model ([data-migrations.md](0-references/data-migrations.md), [data-migrations-solutions.md](0-references/data-migrations-solutions.md)) but it is entirely unproven. Prisma ORM had no data migration support, so we have no prior art to lean on.
- The graph-based model is our biggest UX bet. If common use cases aren't dead simple, the power of the graph is irrelevant.

#### Priority queue

**VP1: Data migrations work in the graph model** *(highest risk)*

The entire migration graph is built on the assumption that any migration from contract state A to contract state B is functionally equivalent to any other A→B migration. Data migrations break this assumption — two databases at the same contract hash can have meaningfully different data. The routing model must be extended to define "done" as "contract hash H reached **and** required data invariants satisfied."

User story: I can define a migration that includes a data transformation (e.g. split `name` into `firstName` + `lastName`). I can apply that migration on my local database and a production database. If there are two paths to the destination contract, I have a simple way to ensure that my CD pipeline for production chooses the path that includes my invariant. `plan`, `apply`, and `status` all operate in a way which is aware of the invariant.

Tasks:

1. **Design the data migration representation** — what does a data migration node look like in the graph? What does the runner execute? How is the postcondition checked? Decide between Model A (co-located with structural migrations) and Model B (independent). Key open decisions: routing policy when multiple invariant-satisfying routes exist, and the concrete format of environment refs. Output: a concrete type definition and a sketch of the runner changes, not a document. See [data-migrations.md](0-references/data-migrations.md) and [data-migrations-solutions.md](0-references/data-migrations-solutions.md) for the theoretical model.
2. **Implement a data migration end-to-end** — a migration that splits `name` into `firstName` + `lastName`, with a postcondition invariant. `plan`, `apply`, and `status` all understand "done = hash + invariant satisfied."
3. **Invariant-aware routing** — create a graph with two paths to the same contract hash, only one of which includes the data migration. The system selects the path that satisfies the required invariant. The user has a way to declare which invariants are required for a given environment.

Stop condition: A graph with two paths to the same contract hash. One path includes a data migration (split `name` → `firstName` + `lastName`) with a postcondition invariant. `plan` selects the invariant-satisfying path for an environment that requires it. `apply` executes it. `status` reports "done" only when both the contract hash and the invariant are satisfied. Then stop — routing optimizations, invariant composition, and ref UX are May.

**VP2: Users can author migrations by hand** *(table-stakes)*

Manual SQL and data migrations both require this. Every migration system has an escape hatch where the user writes the migration themselves.

User story: I run a command like `migration new <from> <to>`, and the system scaffolds a migration file for me — pre-populated with the source and destination contract hashes and any boilerplate. I fill in the migration logic (raw SQL, data transformation, or both). The system integrates my hand-authored migration into the graph as a first-class node. I don't create files manually or write raw JSON.

Tasks:

1. **Design the manual authoring surface** — a TypeScript file (e.g. `migration.ts`) where the user uses utility functions to describe the migration, producing a migration data structure when executed. Structural migrations (raw DDL) and data migrations may have different authoring shapes — decide whether they share a surface or not.
2. **Scaffold command** — a CLI command (e.g. `migration new <from> <to>`) that creates the migration file with the correct graph coordinates already filled in. The user shouldn't have to know how to describe "from this contract state to that contract state" — the CLI resolves hashes and generates the skeleton. This is how systems like Active Record work: you never create migration files by hand.
3. **Implement manual SQL migration** — user writes a `.ts` file with raw SQL, it becomes a node in the graph, the runner executes it.

Stop condition: A user runs `migration new`, gets a scaffolded `.ts` file, writes raw SQL in it, and the runner executes it as a first-class graph node. Then stop — polish of the authoring API, documentation, and support for exotic migration shapes are May.

**VP3: The graph scales with large contracts** *(quick pass/fail)*

Every migration node encodes the full contract content. For projects with large contracts, this could cause performance and storage problems.

Tasks:

1. **Generate a 100+ model contract, create a series of migrations, measure** — graph operation time, migration history size on disk, plan/diff time. Pass/fail.

Stop condition: Numbers in hand. If acceptable, move on. If not, file an issue with the measurements and move on — optimization is May.

**Deferred (May)**:

- Ergonomic graph operations (rebase, squash, etc.)
- Polished CLI visualization
- Planner coverage for every schema change case
- Refs UX validation (depends on data migration model existing first)
- Will users understand "refs"? (UX question — refs need to exist before we can test comprehension)

---

### 2. Contract authoring (PSL + TypeScript DSL)

**People:** Alberto

Users describe their domain model — which becomes the contract — in one of two ways: PSL (Prisma Schema Language) or a TypeScript DSL. Both need significant work.

**Key risks**:

- The TS authoring DSL needs to be genuinely pleasant to use — if it feels like writing JSON with extra steps, users will avoid it and we lose the "author in TypeScript" selling point.
- The language server is a DX-critical path. If PSL has new features but the VS Code extension doesn't understand them, users get red squiggles on valid code. This erodes trust fast — but the architecture for fixing this is well understood.

#### Priority queue

**VP1: Symmetric authoring surfaces from shared composition**

Both PSL and TS must present DSLs that are derived from the same framework composition data sources — families, targets, and extension packs contribute type constructors and field presets via the [ADR 170](../../architecture%20docs/adrs/ADR%20170%20-%20Pack-provided%20type%20constructors%20and%20field%20presets.md) registry (ADR 170 defines how extensions contribute authoring helpers like `pgvector.Vector(1536)` to both surfaces through a shared definition), and both surfaces lower through these shared definitions. The two surfaces should be symmetrical in capability — what's expressible in one is broadly expressible in the other — but idiomatically different in each language.

User story: I author the same contract in PSL and in TS. Both use a family-provided type constructor (e.g. `sql.String(length: 35)`) and an extension-provided namespaced type constructor (e.g. `pgvector.Vector(1536)`). Both emit identical contracts.

Tasks:

1. **ADR 170 type constructors and field presets** — implement the shared registry that families, targets, and extension packs use to contribute authoring helpers. Both PSL and TS lower through these definitions.
2. **PSL surface** — parameterized types and field presets. The PSL-side changes needed to consume ADR 170 definitions.
3. **TS DSL surface** — the new DSL that replaces the existing proof-of-concept. Must consume the same ADR 170 definitions as PSL.
4. **Parity test** — author a representative contract in both PSL and TS using at least one family-provided and one extension-provided type constructor. Verify identical contract output.

Stop condition: A contract authored in both PSL and TS, using at least one family-provided type constructor (e.g. `sql.String(length: 35)`) and at least one extension-provided namespaced type constructor (e.g. `pgvector.Vector(1536)`), emitting identical contracts. Then stop — full vocabulary of helpers, preset coverage, and parameterized type polish are May.

**VP2: TS DSL achieves comparable terseness to PSL**

The current TS authoring surface mirrors the contract JSON structure — extremely verbose, repetitive, and roughly 3–5x longer than the equivalent PSL. The new DSL must close this gap substantially. This is a concrete, measurable proof that the DSL design works, not a UX polish question.

User story: I author a representative contract (multiple models, relations, at least one extension type) in both PSL and the new TS DSL. The TS version is in the same ballpark of length as the PSL version.

Tasks:

1. **Implement the new TS DSL** — (overlaps with VP1 task 3).
2. **Terseness comparison** — take a representative contract, author it in both PSL and TS, compare line counts. Pass/fail.

Stop condition: The TS version of a representative contract is in the same ballpark of length as the PSL version. Then stop — DSL ergonomics, API naming, and syntactic sugar are May.

**VP3: Invisible contract emission in at least one major framework**

The contract emit step — producing `contract.json` and `contract.d.ts` — must be triggered automatically by the dev server and build tool. The developer never runs a manual command. This was a massive pain point for Prisma ORM (`prisma generate`), and Prisma Next's pure TypeScript architecture makes transparent build tool plugins feasible. A Vite plugin PoC already exists in this repo.

User story: I modify my PSL or TS contract definition, save the file, and my dev server automatically re-emits the contract. My types update. I never run a generate command.

Tasks:

1. **End-to-end validation in one framework** — pick a Vite-based framework or Next.js. Modify a contract definition, verify the dev server re-emits and types update without manual intervention.
2. **HMR state mismatch** — validate that `globalThis`-cached runtime instances don't hold stale contracts after re-emission (see [framework integration analysis](0-references/framework-integration-analysis.md#unsolved-interaction-hmr-re-emit-and-runtime-state)).

Stop condition: Modify a contract definition in a running dev server, see the contract re-emitted and types updated without running a manual command. HMR doesn't leave the runtime holding a stale contract. Then stop — plugins for other build tools (Webpack, Turbopack, esbuild) and production build integration are May.

**Tasks (not validation points)**:

- **Language server update**: The VS Code extension's language server is coupled to Prisma 7's version of PSL. It needs to load `prisma-next.config.ts`, use it to interpret PSL, and support new features. The architecture is well understood; this is mechanical work. Eventually we want to rewrite it to not depend on the existing Rust implementation, building a Prisma 7 parser as well.

**Deferred (May)**:

- PSL grammar extensibility by extensions (e.g. extensions contributing new top-level concepts like views alongside models). The PSL grammar is expected to remain closed for extension; extensions contribute first-class concepts through the existing grammar, not by extending it.
- Full vocabulary of helpers, parameterized type polish, and preset coverage.
- Language server rewrite away from Rust dependency.

---

### 3. Runtime pipeline (ORM, query builders, middleware, framework integration)

**People**: Alexey

The ORM client, SQL DSL, middleware pipeline, and runtime together form the execution path from query to result. Multiple architectural assumptions along this path are untested under real-world conditions.

**Key risks**:

- The ORM client and SQL DSL together form the primary user-facing query surface. If transactions aren't supported, extensions can't surface their operations, or the runtime breaks under RSC concurrency, users can't build real applications.
- The runtime interfaces are being stabilized for external contributors. If they're designed exclusively for request-response queries, a future streaming solution (Prisma Postgres, Supabase Realtime, or the Mongo PoC's change streams) may require breaking changes to interfaces contributors have already built against.

#### Priority queue

**VP1: Transactions and SQL DSL as escape hatch**

The ORM must support transactions, and the SQL DSL must interoperate with the ORM within a transaction. The SQL DSL is the escape hatch for the ORM — users will drop into it mid-transaction when they hit something the ORM can't express. If the two query surfaces can't share a transaction, the escape hatch is broken.

User story: I open a transaction via the ORM client, execute two mutations, then drop into the SQL DSL to run a query the ORM can't express — all within the same transaction. I commit, and all three operations are atomic. I can also use the SQL DSL standalone for queries the ORM doesn't support.

Tasks:

1. **ORM transaction support** — open a transaction, execute two ORM mutations, commit/rollback.
2. **SQL DSL standalone query** — express and execute a query in the SQL DSL that the ORM can't.
3. **ORM + SQL DSL transaction interop** — within an ORM-opened transaction, execute a SQL DSL query. Both surfaces share the same connection and transaction context.

Stop condition: A script that opens a transaction, does two ORM mutations, executes a SQL DSL query within the same transaction, and commits. Plus a standalone SQL DSL query. Then stop — transaction isolation levels, savepoints, and nested transactions are May.

**VP2: Extension-contributed operations flow through both query surfaces**

When an extension pack like pgvector is added, its operations must surface in both the ORM client and the SQL DSL. This is the query-side counterpart of ADR 170 — extensions must flow from contract authoring through to the query surface. The codec trait system ([PR #247](https://github.com/prisma/prisma-next/pull/247)) gates operators by codec-declared semantic traits (`equality`, `order`, `numeric`, `textual`, `boolean`); this gating must apply equally to both query surfaces, not just the ORM. Currently the operator-to-trait mapping lives in `sql-orm-client` and needs to be shared.

User story: I add pgvector to my contract. Both `db.posts.where(...)` (ORM) and `db.sql.from(posts).where(...)` (SQL DSL) surface pgvector's operations. Both surfaces gate available operators based on codec traits — a `vector` field gets similarity search but not `like()`.

Tasks:

1. **ORM extension-contributed operations** — when pgvector is added, the ORM client reads the operations registry and surfaces extension-contributed query methods.
2. **SQL DSL pack extensibility** — pgvector contributes query operations to the SQL DSL.
3. **Shared operator-trait mapping** — move the operator-to-trait mapping from `sql-orm-client` to `relational-core` so both query surfaces use the same trait gating (follow-up from PR #247).

Stop condition: An extension-contributed operation (e.g. pgvector similarity search) is usable via both the ORM and SQL DSL. Trait gating works on both surfaces — a `bool` field rejects `gt()` on both. Then stop — full extension operation API design and discovery ergonomics are May.

**VP3: RSC concurrency safety**

The runtime has mutable state (`verified`, `startupVerified`), the ORM has a lazily-populated Collection cache — both are exposed by React Server Components' concurrent rendering model, where multiple components query in parallel through a shared instance. (See [framework integration analysis, Hard problem 2](0-references/framework-integration-analysis.md#hard-problem-2-concurrent-statefulness-under-rsc).)

User story: I have a Next.js App Router page with 5 parallel Server Components, each querying through a shared Prisma Next runtime. They all return correct results without race conditions, stale state, or connection pool exhaustion.

Tasks:

1. **RSC concurrency PoC** — a Next.js App Router page with parallel Server Components querying through a shared runtime. Observe whether runtime state, Collection caching, and connection pooling behave correctly.
2. **Identify and document issues** — if there are concurrency problems, document what they are and what needs to change. If it works, document why.

Stop condition: The PoC either works or we've identified the specific concurrency issues and know what to fix. Then stop — pool sizing guidance, edge runtime validation, and production-ready concurrency guarantees are May.

**VP4: Middleware supports request rewriting**

Currently middlewares are observers only. A caching middleware forces the architecture to support interception, short-circuiting, and result injection — validating that the middleware interface can support the full range of use cases (rate limiting, access control, query rewriting), not just observability.

User story: I add a caching middleware that computes a cache key from the query AST. On a cache hit, it short-circuits execution and serves the cached result without hitting the database. On a miss, it lets the query through and caches the result.

Tasks:

1. **Caching middleware** — implement a middleware that computes cache keys from the query AST, short-circuits for hits, caches misses. Forces the middleware interface to support interception and result injection.

Stop condition: A repeated query is served from cache without hitting the database. The middleware interface supports short-circuiting and result injection. Then stop — cache invalidation strategies, TTL, and middleware composition are May.

**VP5: Runtime interfaces accommodate streaming subscriptions**

The runtime, middleware, and plugin interfaces assume request-response queries — `execute()` runs a query, returns a finite `AsyncIterableResult`, and the plugin lifecycle (`beforeExecute → onRow → afterExecute`) completes. Streaming subscriptions (Supabase Realtime, MongoDB change streams, future Prisma Postgres streaming) have a fundamentally different lifecycle: they don't complete until closed. If we stabilize these interfaces for contributors without validating streaming, we risk closing a door that's strategically important to keep open.

Supabase Realtime is the validation target because it's a production-grade streaming API over Postgres, and it uses a completely different transport (WebSocket via the Supabase JS client) from regular queries (TCP via `pg`). This stress-tests the adapter abstraction — the adapter must surface streaming as a capability alongside regular query execution, with the runtime agnostic to the underlying transport.

User story: I subscribe to changes on a Postgres table through Supabase Realtime, using the PN runtime. Change events flow through the runtime's plugin pipeline. I can cancel the subscription and it cleans up. The same runtime instance handles both regular request-response queries and streaming subscriptions without architectural contortion.

Tasks:

1. **Supabase adapter with streaming capability** — wrap the Supabase JS client as a driver. Regular queries use the Postgres connection; streaming uses `supabase.channel().on('postgres_changes', ...)`. The adapter exposes both capabilities. Local testing via `supabase start` (Docker).
2. **Runtime `subscribe()` operation** — a new operation type on the runtime, distinct from `execute()`. Returns an unbounded `AsyncIterableResult` of change events. Plugins receive `beforeSubscribe` / `onChange` / `onUnsubscribe` hooks (or a minimal subset sufficient to prove the pattern).
3. **Cancellation and cleanup** — the subscription can be cancelled via `AbortSignal` or explicit `close()`. The adapter cleans up the WebSocket channel. No leaked connections or orphaned subscriptions.

Stop condition: A script that opens a Supabase Realtime subscription through the PN runtime, receives at least one change event through the plugin pipeline, and cancels cleanly. The runtime handles both `execute()` and `subscribe()` on the same instance. Then stop — subscription filtering, reconnection, backpressure, and production-quality error handling are all later. The point is proving the runtime interfaces can accommodate streaming, not shipping a streaming feature.

**Side quest: Benchmarks**

Comparative benchmark suite (Prisma Next vs Prisma ORM vs raw driver). High-visibility content piece — publish as soon as the ORM has enough query support to run the suite. In progress.

**Deferred (May)**:

- Full middleware API design and composition model
- RSC pool sizing guidance
- Edge runtime validation
- Transaction isolation levels, savepoints, nested transactions
- Streaming: subscription filtering, reconnection, backpressure, production error handling

---

### 4. MongoDB PoC — validate the second database family

**People**: Will, Serhii (after SQLite)

**Status**: Planning complete, implementation not started

**Why this blocks the milestone**: We plan to invite community authors to build extensions. Our [community generator analysis](0-references/community-generator-migration-analysis.md) shows 31 of 33 use cases are family-agnostic — but every interface an extension would consume today is SQL-specific. Stabilizing these interfaces without validating a second family risks ecosystem fragmentation (extensions that only work with SQL), breaking changes (discovering later that the family-agnostic surface needs to look different), and target fragmentation within SQL (extensions that silently depend on Postgres-specific storage details).

**Key risks**:

- The ORM client and SQL DSL are both coupled directly to SQL. The SQL DSL is useless for Mongo. The ORM client's interface (`findMany`, `create`, `where`) is conceptually family-agnostic, but its implementation (query compilation into SQL AST) is deeply SQL-coupled. We need a document ORM implementation — but without a shared interface, the two implementations will diverge and users lose consistency across families.
- The runtime execution plan shape (`ExecutionPlan` with `sql: string`) may need to generalize to accommodate non-SQL queries.
- We don't yet know where the deepest coupling points are. This workstream is exploratory — the task breakdown will evolve as we discover what breaks.

#### Priority queue

**VP1: The architecture accommodates a second database family**

This is proven by building a vertical slice through the stack for a document database (MongoDB). Unlike the SQLite workstream, this tests family abstraction (SQL vs document), not target abstraction (Postgres vs SQLite within SQL). Every layer of the stack is under test.

Layers under test:

- **Contract surface**: Can a consumer library traverse models and fields of both SQL and document contracts without family-specific code?
- **Contract authoring**: Can TS authoring produce a document contract? Common parts (models, fields, relations) should be shared; storage-specific parts (collections, embedded documents, ObjectId) are family-specific.
- **Contract emit**: Can the emitter produce a valid document contract with correct types?
- **Type system / codecs**: Do BSON codecs work through the same codec registry and trait system?
- **Runtime execution**: Can the runtime execute a non-SQL query plan? Does the middleware pipeline handle it?
- **ORM client**: Does a document ORM client satisfy a shared interface with the SQL ORM client — conventional behaviors (`findMany`, `create`, `where`, etc.) are consistent — while compiling to Mongo-native queries? The shared interface is the guard against the two family implementations diverging. The goal is a Mongo-native experience, not a "swap target" portability story.

Not applicable in April: migration planner/runner (Mongo is schemaless in the DDL sense), SQL generation, query escape hatch DSL (deferred — the ORM is the only query surface for documents in April). Note: document databases still need data-level schema evolution (renaming fields, restructuring nested documents, splitting collections). If the data invariant model from workstream 1 works well, it may become the foundation for document schema evolution — that's a cross-workstream connection worth tracking.

User story: I author a document contract in TS, emit it, and query a MongoDB database through the Prisma Next runtime and ORM. A consumer library (e.g. a validator or schema-to-JSON-Schema tool) works against both my SQL contract and my document contract without family-specific code.

Tasks (sequential discovery phases — each phase may reveal changes needed before the next can proceed):

1. **Contract surface + authoring** — define a document contract type, author it in TS. Does the contract structure generalize? Do authoring surfaces handle family-specific storage concepts (collections, embedded documents, ObjectId)?
2. **Emit** — emit the document contract (`contract.json` + `contract.d.ts`). Does the emitter generalize beyond SQL?
3. **Runtime execution** — execute a Mongo query through the runtime. Does the execution plan generalize? Does middleware work with non-SQL plans?
4. **ORM client + shared interface** — build a document ORM client that satisfies a shared interface with the SQL ORM client. Does query compilation abstract cleanly, or is SQL AST baked in too deep?
5. **Cross-family consumer library** — the final proof. A consumer library that works against both SQL and document contracts without family-specific code.

Stop condition: A consumer library works against both a SQL and a document contract without family-specific code, backed by a real vertical slice (not just types) where the document contract was authored, emitted, and queried through the runtime and ORM. Both ORM clients satisfy a shared interface. Then stop — production-quality MongoDB driver, aggregation pipeline DSL, comprehensive codec coverage, and Mongo-native query ergonomics are all later.

---

### 5. Second SQL database (SQLite)

**People**: Serhii

**Status**: Not started

**Why it matters**: Multiple systems have Postgres implementation details baked in (Kysely lane, migration planning, etc.). Supporting a second SQL target forces us to decouple target-specific assumptions from the core, which is a prerequisite for contributors building new SQL targets. SQLite also unlocks the path to Cloudflare D1 (SQLite-at-the-edge), which is a strategic target for edge framework support (see [framework integration analysis](0-references/framework-integration-analysis.md)).

**Key risk**: Postgres-specific assumptions may be deeply embedded across many layers. The value of this workstream is discovering every coupling point in one pass — each layer's assumptions are exposed by the next layer downstream.

#### Priority queue

**VP1: End-to-end vertical slice — author, emit, migrate, query SQLite**

This is a single forcing function that tests every layer of the stack against a second SQL target. The layers under test:

- **Contract authoring**: When the target is SQLite, do PSL and TS authoring surfaces present SQLite-appropriate types, defaults, and capabilities (e.g. no enums, different native types, different default generators)? ADR 170 type constructors from the SQLite target should replace those from Postgres.
- **Contract emit**: Can the emitter produce a valid contract for a SQLite target, without Postgres-specific assumptions in native types, capabilities, or storage details?
- **Migration planner + runner**: Can the planner generate SQLite-compatible DDL? Postgres-specific syntax (`SERIAL`, `ALTER TABLE ... ADD COLUMN ... DEFAULT`, enum types) won't work.
- **SQL generation**: Does the ORM and SQL DSL generate SQLite-compatible SQL? Different identifier quoting, no `RETURNING` on older SQLite, different function names, different type affinity system.
- **Type system / codecs**: SQLite has no strict type system (type affinity, no enums, limited date support). Do the codecs handle this, or do they assume Postgres types?
- **Capability gating**: Does the capability system correctly gate features SQLite doesn't support (e.g. server-side cursors, `RETURNING`)? Features that can't work should fail with a clear error.

User story: I author a contract targeting SQLite, emit it, plan and apply a migration to create the tables, then run `db.users.all()` and get correct rows back.

Tasks:

1. **SQLite target package** — target definition with SQLite-appropriate type constructors, codecs, capabilities, and DDL generation.
2. **SQLite adapter** — driver that connects to SQLite (e.g. via `better-sqlite3`), executes queries, and decodes results.
3. **End-to-end test** — author a contract, emit, migrate, query. Fix every Postgres coupling point encountered along the way.

Stop condition: A contract authored, emitted, migrated, and queried against SQLite end-to-end. The adapter can be rough. The point is that every layer — emit, migrate, generate SQL, execute, decode results — works without Postgres assumptions. Where it doesn't, we've found and fixed (or documented) the coupling points. Then stop — SQLite feature parity, performance, and production readiness are May.

**VP2: D1 extensibility** *(optional, architectural check)*

Cloudflare D1 is SQLite-at-the-edge, accessed via HTTP inside Workers. If the SQLite adapter bakes in assumptions that prevent an HTTP-based D1 adapter from layering on top (e.g. native bindings, local filesystem), the path to edge framework support is blocked.

User story: I can look at the SQLite adapter's interface and confirm that a D1 adapter could implement the same interface using Cloudflare's HTTP-based D1 API, without forking the SQLite target.

Tasks:

1. **Architectural review** — inspect the adapter interface for assumptions that prevent HTTP-based adapters. Document whether D1 can layer on top or what would need to change.

Stop condition: A written assessment of whether D1 can layer on the SQLite foundation. No implementation required — just confirmation that the door is open or identification of what blocks it.

---

### 6. Contributor readiness

**People**: unassigned (depends on stable interfaces from workstreams 2–5; a good workstream for someone who finishes early)

The milestone goal is "ready for external contributions." The other workstreams validate the architecture; this workstream validates that someone outside the team can actually build on it.

**Key risk**: We can validate every architectural assumption and still fail the milestone if contributors can't figure out how to build extensions without asking us questions.

#### Priority queue

**VP1: An external contributor can build an extension end-to-end using only published docs and examples**

User story: Someone unfamiliar with the codebase wants to build a middleware extension. They find a "build your first extension" guide, follow it, and have a working extension without asking the team any questions. They can also browse example extensions (SQL target, Postgres extension, middleware, framework integration) as templates for other extension types.

Tasks:

1. **Example extensions** — at least one working example of each extension type we want contributors to build: SQL database target, Postgres extension (e.g. ParadeDB handoff), middleware (e.g. a query lint rule — the lint plugin is in PoC state and lint rules are a natural first extension for contributors), framework integration. These serve as templates.
2. **API reference** — generated or hand-written documentation for extension-facing interfaces. Contributors need to know what interfaces to implement and what contracts to satisfy.
3. **"Build your first extension" guide** — walks through building a trivial extension (e.g. a middleware) from scratch using the docs and examples.
4. **Handoff to developer relations** — package the docs, examples, and guide for the dev relations team to use in community outreach (reaching out to authors of Prisma generators, Arktype, Zod, NestJS, and other packages with close integrations — see [community-generator-migration-analysis.md](0-references/community-generator-migration-analysis.md)).

Stop condition: A team member who hasn't worked on extensions can scaffold and build a trivial middleware extension using only the docs and examples, without asking questions. Then stop — comprehensive docs, video tutorials, and community management are the dev relations team's job.


