# April Milestone: Ready for External Contributions

**Goal**: External authors can meaningfully contribute to Prisma Next — SQL database targets, Postgres extensions, middleware, framework integrations, and query DSL extensions. This accelerates progress towards EA/GA.

**Key constraint**: System design decisions must be stable, even if user-facing APIs are still changing. Contributors need confidence that the interfaces they build against won't be reworked.

See [roadmap.md](roadmap.md) for how this milestone fits into the broader timeline.

---

## Approach: architectural validation, not polish

We have five weeks. The goal for each workstream is to **validate the architecture** — prove that the design decisions hold under real conditions. It is not to polish the experience for users. That's May.

Each workstream below has a priority-ordered queue of **validation points** (VP). Each validation point identifies an architectural assumption to test, describes a user story that would prove it, lists the concrete tasks to get there, and defines a **stop condition** — the minimum result that answers the question. Everything beyond the stop condition is deferred. Work proceeds top-down: finish or explicitly stop VP1 before starting VP2.

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

Both PSL and TS must present DSLs that are derived from the same framework composition data sources — families, targets, and extension packs contribute type constructors and field presets via the [ADR 170](../../architecture%20docs/adrs/ADR%20170%20-%20Pack-provided%20type%20constructors%20and%20field%20presets.md) registry, and both surfaces lower through these shared definitions. The two surfaces should be symmetrical in capability — what's expressible in one is broadly expressible in the other — but idiomatically different in each language.

User story: I author the same contract in PSL and in TS. Both use a family-provided type constructor (e.g. `sql.String(length: 35)`) and an extension-provided namespaced type constructor (e.g. `pgvector.Vector(1536)`). Both emit identical contracts.

Tasks:

1. **ADR 170 type constructors and field presets** — implement the shared registry that families, targets, and extension packs use to contribute authoring helpers. Both PSL and TS lower through these definitions.
2. **PSL surface** — parameterized types, field presets, historical pain points. These are the PSL-side changes needed to consume ADR 170 definitions.
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

**Validation questions**:

- **Transactions**: Can the ORM open a transaction, execute two mutations, and commit/rollback?
- **ORM + SQL DSL transaction interop**: Can a user open a transaction via the ORM client and execute SQL DSL queries within it? The SQL DSL is the escape hatch for the ORM — users will drop into it mid-transaction when they hit something the ORM can't express. If the two query surfaces can't share a transaction, the escape hatch is broken.
- **SQL DSL as escape hatch**: Can a user express a query in the SQL DSL that the ORM can't, and execute it?
- **Extension-contributed operations (ORM)**: When pg_vector is added, does the ORM client surface its operations?
- **Extension-contributed operations (SQL DSL)**: When pg_vector is added, does the SQL DSL surface its query operations?
- **Middleware request rewriting**: Can a middleware short-circuit execution and serve a result without hitting the database? Currently middlewares are observers only. A caching middleware forces the architecture to support interception, short-circuiting, and result injection — which validates that the middleware interface can support the full range of use cases (rate limiting, access control, query rewriting), not just observability.
- **RSC concurrency safety**: Does the ORM client and runtime work correctly when multiple React Server Components query in parallel through a shared instance? The runtime has mutable state (`verified`, `startupVerified`), the ORM has a lazily-populated Collection cache — both are exposed by RSC's concurrent rendering model. (See [framework integration analysis, Hard problem 2](framework-integration-analysis.md#hard-problem-2-concurrent-statefulness-under-rsc).)

**Stop condition**: A script that (1) opens a transaction, does two ORM mutations, commits; (2) within that same transaction, executes a SQL DSL query alongside ORM operations; (3) executes a standalone SQL DSL query the ORM can't express; (4) uses an extension-contributed operation via both the ORM and SQL DSL; (5) runs a caching middleware that short-circuits a repeated query. Plus a Next.js App Router page with 5 parallel Server Components querying through a shared runtime — it either works or we've found the concurrency issues and know what to fix. Full middleware API design, RSC pool sizing guidance, edge runtime validation — all May.

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

**People**: Will, Serhii (after SQLite)

**Status**: Planning complete, implementation not started

**Why this blocks the milestone**: We plan to invite community authors to build extensions. Our [community generator analysis](0-references/community-generator-migration-analysis.md) shows 31 of 33 use cases are family-agnostic — but every interface an extension would consume today is SQL-specific. Stabilizing these interfaces without validating a second family risks ecosystem fragmentation and breaking changes. See the [roadmap rationale](roadmap.md#april-ready-for-external-contributions) for the full argument.

**Validation questions**:

- Can a single extension consume both SQL and document contracts? This is the family abstraction test — the core question of whether the extension ecosystem can be family-agnostic.
- Is `ContractBase` sufficient as the family-agnostic surface, or does it need to evolve?
- How do extensions detect and traverse different contract families?
- How should extensions declare which targets/families they support?
- Can both PSL and TS authoring produce a document contract? This tests whether the authoring layer is family-agnostic too, not just the extension consumption layer.

**Stop condition**: One consumer library (e.g. a trivial validator or schema-to-JSON-Schema tool) that works against both a SQL contract and a document contract, without family-specific code. The moment that works, stop. Don't build a real MongoDB driver — the architecture is validated.

**Detailed plan**: [mongo-poc-plan.md](mongo-target/mongo-poc-plan.md)

---

### 5. Second SQL database (SQLite)

**People**: Serhii

**Status**: Not started

**Why it matters**: Multiple systems have Postgres implementation details baked in (Kysely lane, migration planning, etc.). Supporting a second SQL target forces us to decouple target-specific assumptions from the core, which is a prerequisite for contributors building new SQL targets. SQLite also unlocks the path to Cloudflare D1 (SQLite-at-the-edge), which is a strategic target for edge framework support (see [framework integration analysis](0-references/framework-integration-analysis.md)).

**Validation questions**:

- **Contract authoring**: When the target is changed from Postgres to SQLite, do both PSL and TS authoring surfaces respond correctly? Available types, defaults, and capabilities should change to reflect what SQLite supports — e.g. no enums, different native types, different default generators. The type constructors and field presets (ADR 170) provided by the SQLite target should replace those from Postgres.
- **Contract emit**: Can the emitter produce a valid contract for a SQLite target? Are there Postgres-specific assumptions in the contract structure (native types, capabilities, storage details)?
- **Migration planner + runner**: Can the planner generate SQLite-compatible DDL and apply it? Postgres-specific DDL syntax (`SERIAL`, `ALTER TABLE ... ADD COLUMN ... DEFAULT`, enum types, etc.) won't work on SQLite. This is where target-specific coupling in the migration system will surface.
- **SQL generation**: Does the ORM and SQL DSL generate SQLite-compatible SQL? Different identifier quoting, no `RETURNING` on older SQLite, different function names, different type affinity system.
- **Type system / codecs**: SQLite has no strict type system (type affinity, no enums, limited date support). Do the codecs handle this, or do they assume Postgres types?
- **Capability gating**: Does the capability system correctly gate features that SQLite doesn't support (e.g., server-side cursors, specific join types, `RETURNING`)? Features that degrade gracefully on SQLite should degrade; features that can't work should fail with a clear error.
- **D1 extensibility (optional)**: Is the adapter architecture layered such that a Cloudflare D1 adapter can build on top of the SQLite foundation? D1 is HTTP-based and runs inside Workers — the SQLite adapter shouldn't bake in assumptions that prevent this.

**Stop condition**: A contract authored, emitted, migrated, and queried against SQLite end-to-end. Specifically: emit a contract for a SQLite target, plan and apply a migration, then run `db.users.all()` and get correct rows back. The adapter can be rough. The point is that every layer of the stack — emit, migrate, generate SQL, execute, decode results — works without Postgres assumptions. Where it doesn't, we've found the coupling points.

---

## Tangential topics

These are not primary workstreams but are important enough to track in this plan.

### Benchmarks

Comparative benchmark suite (Prisma Next vs Prisma ORM vs raw driver). High-visibility deliverable that substantiates our performance claims. In progress (Alexey).

### ParadeDB PoC

Scaffolded extension that provides a new database primitive. Demonstrates that the extension model can go beyond middleware and schema tooling. Handoff target for the ParadeDB team.

### Community outreach

Reaching out to potential contributors: authors of Prisma generators, Arktype, Zod, NestJS, and other packages with close integrations (see [community-generator-migration-analysis.md](0-references/community-generator-migration-analysis.md)). Depends on stable interfaces and contributor documentation. Can't meaningfully start until the core workstreams have landed.

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

## Scheduling

Five weeks remain (Mar 31 – May 2, with an offsite in Week 3). Rather than a fixed weekly timeline, each workstream has a priority-ordered task queue. Work proceeds top-down: finish or explicitly stop VP1 before starting VP2.

## Open questions

- For the language server: is updating the existing Prisma 7 language server feasible, or does it need a rewrite?
- Is the ParadeDB PoC dependent on the MongoDB PoC (both validate extension interfaces), or can they proceed in parallel?

