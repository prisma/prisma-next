# Prisma Next Roadmap

## Priorities

We need to give two types of guarantee:

- **Stability** (of APIs), user-facing and contributor-facing
- **Correctness**, the system behaves as expected under real-world conditions

We don't provide either of those guarantees right now because:

- In order to freeze our APIs, we need confidence that the design decisions and system constraints we've committed to will not change (right now we're backtracking and reworking parts of the system every day)
- In order to be confident in the correctness of the system we need a much more thorough test suite covering multiple databases, drivers, execution environments and modes and exhaustive query combinations (this takes a lot of effort to produce and depends on stable APIs)

So our highest priority right now is to **validate our design decisions**. The simplest way to do that is to **implement one example of each major UX or execution flow** in the system, to at least a proof of concept level.

## Milestones

### ✅ March 4th: Public announcement, work in the open

We announce our plans for Prisma Next and Prisma 7. The repo becomes public and we talk openly about our innovations, accepting feedback from the community to help shape our development.

### Public demonstrations of capability

- ⌛ **Benchmarks** 
- **Migrations** 
  - ✅ Happy path (I can plan and run a migration that updates my DB to match my Prisma schema)
  - Conflict resolution 
  - ⌛ Git-style visualization in the CLI **Demo app**
  - ✅ Streaming
  - ✅ PSL
- **Ergonomic TS schema API**

### Side quests

- **ParadeDB PoC** 
  - We have scaffolded a representative example of the ParadeDB solution and we can hand it over to their team to extend
  - This demonstrates an extension providing a new database primitive

### April: Ready for external contributions

> **Detailed plan**: [april-milestone.md](april-milestone.md)

External authors can meaningfully contribute to the development of Prisma Next. This accelerates our progress towards EA/GA. In particular, this requires the system design decisions to be stable, even if user-facing APIs are still changing.

**What external contributors can create:**

- SQL database targets
- Postgres extensions
- Middleware for telemetry, error reporting, query linting
- Integrations with frameworks like Next.js (see [framework-integration-analysis.md](0-references/framework-integration-analysis.md))
- Extending depth and breadth of query DSLs

**Mongo PoC (essential — prerequisite for extension ecosystem):**

We have scaffolded a representative example of the Mongo solution and we can hand it over to their team to extend. See [mongo-poc-plan.md](mongo-target/mongo-poc-plan.md) for the detailed plan.

*Why this is essential, not optional:* The April milestone is "ready for external contributions." We plan to invite community authors to build extensions (validators, GraphQL integrations, visualization tools, etc.). Our [community generator analysis](0-references/community-generator-migration-analysis.md) shows that 31 of 33 community generator use cases are conceptually family-agnostic — they care about models, fields, and relations, not SQL tables specifically. But today, every interface an extension would consume is SQL-specific (`SqlContract`, `ExecutionContext`, the ORM client). If we stabilize these SQL-specific interfaces for external authors without first validating the document family, we risk:

- **Ecosystem fragmentation**: Extensions that only work with SQL. When MongoDB ships, those users get no access to the extension ecosystem.
- **Breaking changes**: Discovering later that the family-agnostic contract surface needs to look different, forcing rework of already-published extensions.
- **Target fragmentation within SQL**: Without a second family forcing the abstraction, we may also miss target-level coupling (e.g. extensions that silently depend on Postgres-specific storage details).

What it validates:

- The architecture can accommodate a non-SQL database target end-to-end
- What the family-agnostic contract surface looks like in practice (is `ContractBase` sufficient, or does it need to evolve?)
- How extensions detect and traverse different contract families
- Whether a single consumer library (e.g. a validator extension) can realistically target both SQL and document families
- What the runtime context looks like for a document target
- How extensions should declare which targets/families they support

What the deliverable looks like — a scaffolded MongoDB target with at minimum:

- A `DocumentContract` populated from a real schema (PSL or TS authoring)
- A document execution context that a consumer library can accept
- At least one consumer library example that works against both SQL and document contracts (e.g. a trivial validator or schema-to-JSON-Schema tool)
- Enough to hand off to the MongoDB team to extend, and enough to give us confidence in the extension interfaces we stabilize

Community signal: Gives a credible answer to Prisma 6 MongoDB users who feel left behind by the Prisma Next announcement.

**Other April prerequisites:**

- Most system design constraints have been validated (i.e. a second SQL database is supported, e.g. SQLite, in MVP)
- During this time we reach out to potential contributors: authors of Prisma generators, Arktype, Zod, NestJS, and other packages with close integrations (see [community-generator-migration-analysis.md](0-references/community-generator-migration-analysis.md))

### May: Ready for public use / EA in Postgres (+ 1 other)

We actively encourage users to try out Prisma Next. APIs are considered reasonably stable, the system is expected to be correct.

- Postgres is well-supported
- At least a second SQL database is well-supported
- Industry partners like CodeWithAntonio are making videos on how to use Prisma Next
- Docs:
  - How to get started (installation, configuration, etc.)
  - How to change your DB schema (`db update`, migrations, drift, conflicts)
  - How to read and write to your DB (ORM queries, SQL queries, transactions)
  - How to install extensions (and a list of available extensions)
  - Generated reference docs for public APIs

### June/July: EA for all other DBs

We release Prisma Next in EA for all FCDBs, and hopefully other DBs are supported through extensions.

- All FCDBs supported
- ORM + SQL query DSLs thoroughly tested
- Nightly ecosystem tests
- Nightly benchmarks
- Smooth upgrade path
  - You will be able to run Prisma Next + Prisma 7 in parallel, and gradually shift execution/traffic from one to the other (to verify the behavior is the same)
  - Users don't want to rewrite all their queries and application logic, and we'll try to give them a way to avoid this

## Secondary Goals

- **More ergonomic contract authoring TS DSL**: The existing API was derived from the contract JSON so it's very low-level and hard to read. Ideally we want something more readable and easier to explore.
- **Second DB (SQLite) support**: We need to start decoupling from Postgres (Kysely lane, migration planning, various other systems have Postgres implementation details).
- **Static analysis**: True static analysis of queries (ESLint plugin or otherwise).

## Related documents

- [April Milestone Plan](april-milestone.md) — detailed workstreams and deliverables for the April milestone
- [Framework Integration Analysis](0-references/framework-integration-analysis.md) — hard problems for integrating Prisma Next into popular frameworks
- [Community Generator Migration Analysis](0-references/community-generator-migration-analysis.md) — mapping Prisma ORM community generators to Prisma Next extension capabilities
- [MongoDB PoC Plan](mongo-target/mongo-poc-plan.md) — detailed plan for the MongoDB proof of concept

