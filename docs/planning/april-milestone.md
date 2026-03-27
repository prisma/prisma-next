# April Milestone: Ready for External Contributions

**Goal**: External authors can meaningfully contribute to Prisma Next — SQL database targets, Postgres extensions, middleware, framework integrations, and query DSL extensions. This accelerates progress towards EA/GA.

**Key constraint**: System design decisions must be stable, even if user-facing APIs are still changing. Contributors need confidence that the interfaces they build against won't be reworked.

See [roadmap.md](roadmap.md) for how this milestone fits into the broader timeline.

---

## Approach: architectural validation, not polish

We have five weeks. The goal for each workstream is to **validate the architecture** — prove that the design decisions hold under real conditions. It is not to polish the experience for users. That's May.

Each workstream below has:

- **Validation questions**: what architectural assumption are we testing?
- **Stop condition**: the minimum result that answers those questions. Everything beyond this is deferred.

The team's instinct is to perfect. The constraint is: prove the architecture works first, then we polish.

---

## Workstreams

### 1. Migration system

**People**: Saevar, Alberto

The migration system uses a graph-based data structure for migration history. This is architecturally powerful but unfamiliar to every user coming from linear migration systems (Rails, Django, Prisma ORM, etc.).

**Validation questions**:

- Can the graph model handle common workflows? Linear development, feature branches that diverge and merge, rollback. Not "is the UX beautiful" — just "does the model express these cases without breaking?"
- Can users inject custom steps? Data migrations and manual SQL. Does the graph model have a slot for user-authored nodes?
- **Can the graph model accommodate data migrations?** This is the highest-risk question. The entire migration graph is built on the assumption that any migration from contract state A to contract state B is functionally equivalent to any other A→B migration — the destination is a contract hash, and any route that reaches it is valid. Data migrations break this assumption. Two databases at the same contract hash can have meaningfully different data. The graph's routing model must be extended to define "done" as "contract hash H reached **and** required data invariants satisfied." We have a theoretical model for this ([data-migrations.md](0-references/data-migrations.md), [data-migrations-solutions.md](0-references/data-migrations-solutions.md)) but it is entirely unproven. Prisma ORM had no data migration support, so we have no prior art of our own to lean on.
- Can a non-expert understand the state of their migrations? The CLI visualization question — "can they tell what's happened and what needs to happen," not "is the output pretty."

**Stop condition**: A demo scenario where two developers branch, each add migrations, merge, and resolve the conflict. One migration includes a manual SQL step. **One migration includes a data transformation with a postcondition invariant check**, and the system correctly treats "contract hash reached + invariant satisfied" as the definition of "done" (not just "contract hash reached"). The graph handles all of this and the CLI can show the state. Planner coverage for every schema change, ergonomic rebase/squash commands, polished output formatting — all May.

**Active work**:

- **Planner extensions**: Extending the migration planner to handle more schema change cases.
- **Conflict resolution**: When migration history diverges (e.g. two branches add migrations), the system must detect and resolve conflicts.
- **Git-style CLI visualization**: Visual representation of migration graph state, diffs, and history in the CLI.

**Not yet started**:

- **Data migrations**: Users need to transform data as part of a migration (e.g. split a `name` column into `firstName` + `lastName`). This is the biggest architectural risk in the migration system. The current graph operations assume any A→B route is equivalent — data migrations break that assumption. Our theoretical model treats data migrations as guarded transitions with postcondition invariants, and extends "desired state" from a contract hash to "contract hash + required data invariants." This model is documented but unproven. Key open decisions: co-located vs. independent data migrations (Model A vs. B), routing policy when multiple invariant-satisfying routes exist, and the concrete format of environment refs. See [data-migrations.md](0-references/data-migrations.md) and [data-migrations-solutions.md](0-references/data-migrations-solutions.md).
- **Manual migration escape hatch**: Users need to write raw SQL migration steps when the planner can't express what they need. This is table-stakes; every migration system has one.
- **Ergonomic graph operations**: The graph-based history needs CLI commands with a similar level of ergonomics to git. Users need to be able to inspect, rebase, squash, and manipulate their migration history without understanding the underlying graph theory. If common workflows (branching, merging, rolling back) aren't intuitive, the graph model becomes a liability rather than an advantage.

**Key risks**:

- **Data migrations are the highest architectural risk.** The graph model's core invariant (route equivalence) breaks when data matters. If we can't extend routing to handle data invariants, the graph model may need fundamental rework — and we'd rather discover that now than after stabilizing the API.
- The graph-based model is our biggest UX bet. If common use cases (linear development, feature branches, team collaboration) aren't dead simple, the power of the graph is irrelevant.

---

### 2. Contract authoring (PSL + TypeScript DSL)

**People:** Will, Alberto

Users describe their domain model — which becomes the contract — in one of two ways: PSL (Prisma Schema Language) or a TypeScript DSL. Both need significant work.

**Validation questions**:

- Can both PSL and TS express the same contract using shared type constructors and field presets provided by families, targets, and extension packs? This is the [ADR 170](../../architecture%20docs/adrs/ADR%20170%20-%20Pack-provided%20type%20constructors%20and%20field%20presets.md) question. Type constructors and field presets are the interface through which extensions contribute to the authoring surface — if an extension pack author wants to add `pgvector.Vector(1536)` as a type that works in both PSL and TS, ADR 170's registry is the mechanism they build against.
- Can the language server load a Prisma Next config and not reject valid syntax?

**Stop condition**: A contract authored in both PSL and TS, using at least one family-provided type constructor (e.g. `sql.String(length: 35)`) and at least one extension-provided namespaced type constructor (e.g. `pgvector.Vector(1536)`), emitting identical contracts. The language server doesn't red-squiggle valid PSL. The full vocabulary of helpers, parameterized type polish, and preset coverage are May.

**Deferred**: PSL grammar extensibility by extensions (e.g. extensions contributing new top-level concepts like views alongside models). The PSL grammar is expected to remain closed for extension; extensions contribute first-class concepts through the existing grammar, not by extending it. We believe the architecture supports adding this later if needed.

**Active work**:

- **PSL — parameterized types**: Extending PSL with support for parameterized/generic types.
- **PSL — field presets**: Default field configurations that reduce boilerplate.
- **PSL — historical pain points**: Addressing known PSL limitations and community complaints from Prisma ORM.
- **TypeScript authoring DSL** (new, Alberto): A new DSL that matches PSL's expressiveness. The current TS authoring surface was a proof-of-concept that mirrors the contract JSON structure directly — extremely verbose, repetitive, and unpleasant to write. The new DSL replaces it entirely.
- **Type constructors and field presets** ([ADR 170](../../architecture%20docs/adrs/ADR%20170%20-%20Pack-provided%20type%20constructors%20and%20field%20presets.md)): Shared registry for families, targets, and extension packs to provide authoring helpers. Both PSL and TS lower through the same helper definitions. This is the extension contribution interface for the authoring layer.

**Not yet started**:

- **Language server update**: The VS Code extension's language server is coupled to Prisma 7's version of PSL. It needs to load `prisma-next.config.ts`, use it to interpret PSL, and support new features.

**Key risks**:

- The language server is a DX-critical path. If PSL has new features but the VS Code extension doesn't understand them, users get red squiggles on valid code. This erodes trust fast.
- The TS authoring DSL needs to be genuinely pleasant to use — if it feels like writing JSON with extra steps, users will avoid it and we lose the "author in TypeScript" selling point.

---

### 3. Runtime pipeline (ORM, query builders, middleware, framework integration)

**People**: Alexey, Serhii, Will

The ORM client, SQL DSL, middleware pipeline, and runtime together form the execution path from query to result. Multiple architectural assumptions along this path are untested under real-world conditions.

**Validation questions**:

- **Transactions**: Can the ORM open a transaction, execute two mutations, and commit/rollback?
- **SQL DSL as escape hatch**: Can a user express a query in the SQL DSL that the ORM can't, and execute it?
- **Extension-contributed operations (ORM)**: When pg_vector is added, does the ORM client surface its operations?
- **Extension-contributed operations (SQL DSL)**: When pg_vector is added, does the SQL DSL surface its query operations?
- **Middleware request rewriting**: Can a middleware short-circuit execution and serve a result without hitting the database? Currently middlewares are observers only. A caching middleware forces the architecture to support interception, short-circuiting, and result injection — which validates that the middleware interface can support the full range of use cases (rate limiting, access control, query rewriting), not just observability.
- **RSC concurrency safety**: Does the ORM client and runtime work correctly when multiple React Server Components query in parallel through a shared instance? The runtime has mutable state (`verified`, `startupVerified`), the ORM has a lazily-populated Collection cache — both are exposed by RSC's concurrent rendering model. (See [framework integration analysis, Hard problem 2](framework-integration-analysis.md#hard-problem-2-concurrent-statefulness-under-rsc).)

**Stop condition**: A script that (1) opens a transaction, does two ORM mutations, commits; (2) executes a SQL DSL query the ORM can't express; (3) uses an extension-contributed operation via both the ORM and SQL DSL; (4) runs a caching middleware that short-circuits a repeated query. Plus a Next.js App Router page with 5 parallel Server Components querying through a shared runtime — it either works or we've found the concurrency issues and know what to fix. Full middleware API design, RSC pool sizing guidance, edge runtime validation — all May.

**Active work**:

- **SQL Query DSL** (new): A new SQL query builder that will replace the current SQL Query plan and the Kysely plan. This becomes the escape hatch for the ORM client.
- **ORM client maturation**: The ORM client has most of its core functionality, but is missing key components:
    - **Transactions**: No transaction support yet.
    - **Extension-contributed operations**: The ORM client doesn't respond when an extension like pg_vector is added. It needs to read the operations registry, incorporate custom data types, and surface extension-contributed query methods.

**Not yet started**:

- **SQL DSL pack extensibility**: Extension packs like pgvector need to contribute query operations to the SQL DSL, not just the ORM.
- **Caching middleware**: A middleware that computes cache keys from the query AST, short-circuits execution for cache hits, and serves cached results. Forces the middleware interface to support request rewriting, not just observation.
- **RSC concurrency PoC**: A Next.js App Router page with parallel Server Components querying through a shared Prisma Next runtime. Validates runtime state safety and ORM Collection cache behavior under concurrent access.

**Key risk**: The ORM client and SQL DSL together form the primary user-facing query surface. If transactions aren't supported, extensions can't surface their operations, or the runtime breaks under RSC concurrency, users can't build real applications.

---

### 4. MongoDB PoC — validate the extension ecosystem boundary

**People**: Will

**Status**: Planning complete, implementation not started

**Validation question**: Can a single extension consume both SQL and document contracts? This is the family abstraction test.

**Stop condition**: A `DocumentContract`, a document execution context, and one consumer library working against both families. The moment that works, stop. Don't build a real MongoDB driver.

**Why this blocks the milestone**: We plan to invite community authors to build extensions. Our [community generator analysis](community-generator-migration-analysis.md) shows 31 of 33 use cases are family-agnostic — but every interface an extension would consume today is SQL-specific. Stabilizing these interfaces without validating a second family risks ecosystem fragmentation and breaking changes. See the [roadmap rationale](roadmap.md#april-ready-for-external-contributions) for the full argument.

**Deliverables**:

- `DocumentContract` type populated from a real schema (PSL or TS authoring)
- Document execution context that a consumer library can accept
- At least one consumer library example working against both SQL and document contracts
- Handoff-ready scaffold for the MongoDB team to extend

**Detailed plan**: [mongo-poc-plan.md](mongo-target/mongo-poc-plan.md)

**Key questions to answer**:

- Is `ContractBase` sufficient as the family-agnostic surface, or does it need to evolve?
- How do extensions detect and traverse different contract families?
- How should extensions declare which targets/families they support?

---

### 5. Second SQL database (SQLite)

**People**: Serhii

**Status**: Not started

**Why it matters**: Multiple systems have Postgres implementation details baked in (Kysely lane, migration planning, etc.). Supporting a second SQL target forces us to decouple target-specific assumptions from the core, which is a prerequisite for contributors building new SQL targets. SQLite also unlocks the path to Cloudflare D1 (SQLite-at-the-edge), which is a strategic target for edge framework support (see [framework integration analysis](framework-integration-analysis.md)).

**Validation questions**:

- **Contract authoring**: When the target is changed from Postgres to SQLite, do both PSL and TS authoring surfaces respond correctly? Available types, defaults, and capabilities should change to reflect what SQLite supports — e.g. no enums, different native types, different default generators. The type constructors and field presets (ADR 170) provided by the SQLite target should replace those from Postgres.
- **Contract emit**: Can the emitter produce a valid contract for a SQLite target? Are there Postgres-specific assumptions in the contract structure (native types, capabilities, storage details)?
- **Migration planner + runner**: Can the planner generate SQLite-compatible DDL and apply it? Postgres-specific DDL syntax (`SERIAL`, `ALTER TABLE ... ADD COLUMN ... DEFAULT`, enum types, etc.) won't work on SQLite. This is where target-specific coupling in the migration system will surface.
- **SQL generation**: Does the ORM and SQL DSL generate SQLite-compatible SQL? Different identifier quoting, no `RETURNING` on older SQLite, different function names, different type affinity system.
- **Type system / codecs**: SQLite has no strict type system (type affinity, no enums, limited date support). Do the codecs handle this, or do they assume Postgres types?
- **Capability gating**: Does the capability system correctly gate features that SQLite doesn't support (e.g., server-side cursors, specific join types, `RETURNING`)? Features that degrade gracefully on SQLite should degrade; features that can't work should fail with a clear error.
- **D1 extensibility**: Is the adapter architecture layered such that a Cloudflare D1 adapter can build on top of the SQLite foundation? D1 is HTTP-based and runs inside Workers — the SQLite adapter shouldn't bake in assumptions that prevent this.

**Stop condition**: A contract authored, emitted, migrated, and queried against SQLite end-to-end. Specifically: emit a contract for a SQLite target, plan and apply a migration, then run `db.users.all()` and get correct rows back. The adapter can be rough. The point is that every layer of the stack — emit, migrate, generate SQL, execute, decode results — works without Postgres assumptions. Where it doesn't, we've found the coupling points.

---

## Tangential topics

These are not primary workstreams but are important enough to track in this plan.

### Benchmarks

Comparative benchmark suite (Prisma Next vs Prisma ORM vs raw driver). High-visibility deliverable that substantiates our performance claims. In progress (Alexey).

### ParadeDB PoC

Scaffolded extension that provides a new database primitive. Demonstrates that the extension model can go beyond middleware and schema tooling. Handoff target for the ParadeDB team.

### Community outreach

Reaching out to potential contributors: authors of Prisma generators, Arktype, Zod, NestJS, and other packages with close integrations (see [community-generator-migration-analysis.md](community-generator-migration-analysis.md)). Depends on stable interfaces and contributor documentation. Can't meaningfully start until the core workstreams have landed.

---

## Dependencies

```
MongoDB PoC ──────→ Stable extension interfaces ──→ Community outreach
                                                 ↗
SQLite target ────→ Decoupled core ─────────────

ADR 170 (type constructors) → PSL + TS parity ──→ Extensions contribute authoring syntax
                                                                    ↓
                              SQL DSL pack ops ──→ Extensions contribute query operations
                                                                    ↓
                              Caching middleware → Middleware supports rewriting, not just observation
                                                                    ↓
                              RSC PoC ───────────→ Runtime validated under real-world concurrency
```

- **MongoDB PoC** and **SQLite target** are the two validation axes: one validates the family abstraction (SQL vs document), the other validates the target abstraction (Postgres vs SQLite within SQL). Both must land before we can confidently stabilize interfaces for external contributors.
- **ADR 170** (type constructors and field presets) is the extension contribution interface for the authoring layer. Both PSL extensibility and the TS DSL depend on it.
- **SQL DSL pack extensibility** and **ORM extension-contributed operations** are the query-side counterpart of ADR 170 — extensions need to flow from contract authoring through to query surface.
- **Caching middleware** validates that the middleware pipeline supports the full range of extension use cases, not just observability.
- **RSC concurrency PoC** validates the runtime under the highest-impact framework's execution model.
- **Migration system** is largely independent — it has its own design validation path.
- **Community outreach** depends on stable interfaces and contributor docs; it's the last thing that can start.

## Five-week timeline

### Week 1: Mar 24–28

<!-- TODO -->

### Week 2: Mar 31–Apr 4

<!-- TODO -->

### Week 3: Apr 7–11

<!-- TODO -->

### Week 4: Apr 14–18

<!-- TODO -->

### Week 5: Apr 21–25

<!-- TODO -->

---

## Open questions

- What is the priority order across the five workstreams? How do we sequence work given the team we have?
- For migrations: what is the minimum viable set of graph operations that makes the UX acceptable for common workflows?
- For the language server: is updating the existing Prisma 7 language server feasible, or does it need a rewrite?
- Is the ParadeDB PoC dependent on the MongoDB PoC (both validate extension interfaces), or can they proceed in parallel?
