## Prisma Next v1 goals and execution plan (end of Jan)

This document defines the **v1 goals** for Prisma Next and turns them into a concrete execution plan for the period up to the end of January.

### High-level v1 goals

- **Default PPg client**: Prisma Next is the primary way to talk to Prisma Postgres, with a clear path to becoming Prisma 8’s default client
- **SQL Query Lane**:
  - Covers typical query structures: where clauses, logical expressions, comparators, joins, ordering, distinct/group by (as needed for v1 scenarios)
  - DX as good or better than existing alternatives such as Kysely, Knex, and Drizzle (but more limited in scope)
- **Model Query Lane**:
  - CRUD, simple relationship traversal, and basic pagination patterns
  - DX comparable in quality to today’s Prisma ORM for the covered scenarios (but not the same API)
- **PGVector support**:
  - Column types, index types, parameterized types, and core operations required for at least one semantic-search style hero flow
- **Database admin operations**:
  - Initialize a new project and evolve the DB schema from the contract:
    - `db init` for baseline schema + marker
    - `db update` for additive changes with migrations on disk (indexes, FKs, extensions where needed)
- **Testing story**:
  - Simple utilities to spin up @prisma/dev, apply contract/migrations, seed data, run tests, and tear down
- **CLI TS API**:
  - CLI commands are thin wrappers over a TypeScript API that is available to users directly
- **No-emit workflow**:
  - TS-first contract authoring surface with all framework features and necessary type information
  - Minimal Vite integration so dev loops do not require an explicit “generate” step
- **Telemetry (v1 scope)**:
  - Basic hooks to support runtime metrics similar to existing Prisma telemetry, even if not feature-complete
- **Query linting**:
  - Runtime linting integrated with query plans
  - Initial static analysis via ESLint/TS rules, with a small but meaningful rule set
- **Installation and DX**:
  - Usable in new or existing projects via `prisma-next` CLI and configuration
  - A simpler runtime wiring story via a façade or utility methods to hide implementation details
- **PPg / Console / Studio integration**:
  - Contract, marker, and migration ledger written in a form that Studio/Console can read to visualize PN state and migration history

The rest of this document defines the large projects, timelines, and how they attach to these goals. Each project has its own doc that the project lead will flesh out and maintain.

The intent is:

- To keep the work **parallelizable** (projects can move mostly independently)
- To make it obvious **what “v1-ready” means** for each area
- To ensure the design remains compatible with the longer term architecture in `docs/Architecture Overview.md`

## Timeline at a glance

- **Pass 0 (now → ~1 week)** — Discovery and surfacing
  - Each project lead walks `examples/prisma-next-demo` (and relevant packages) against the v1 goals
  - APIs and contracts that affect multiple projects (query DSL shapes, lint hooks, runtime façade shape, marker/ledger schema) are drafted and agreed in lightweight form
- **Pass 1 (rest of Dec)** — Solid v1 “happy path”
  - `prisma-next-demo` can be stood up from scratch via:
    - contract emit,
    - `db init`/`db update`,
    - runtime client façade,
    - SQL lane + minimal ORM lane
    - PGVector feature end-to-end
    - basic runtime linting
  - No-emit authoring and a minimal Vite path are in place for local dev
- **Pass 2 (early Jan)** — Relational API depth + testable workflows
  - ORM/relational lane is usable for typical CRUD + simple relation traversal
  - @prisma/dev test helpers exist and are used by the example app
  - Runtime linting has a small but meaningful rule set; a static analysis PoC exists (even if only 1–2 rules)
  - The marker/ledger/contract shape that Console/Studio will consume is finalized and documented
- **Pass 3 (mid–end Jan)** — Hardening and v1 story
  - Error surfaces and guardrails are tightened
  - Docs and examples tell a coherent “default PPg client” story
  - We have a clear line between **v1 commitments** and **post-Jan follow-ups**

## Projects

Each project has its own document (linked below). Those docs are owned by the project lead; they should capture:

- v1 (end-of-Jan) goals and non-goals
- milestones/checkpoints
- key dependencies on other projects
- open questions and risks

Project docs:

- **Project A — Query DSLs & Relational Lane**
  - Charter: define and implement v1 **SQL lane + ORM/relational lane** that are DX-friendly, lintable, and compatible with future extensions.
  - Doc: `project-query-dsls-and-relational-lane.md`

- **Project B — Query Linting (Runtime) & Static Analysis Foundations**
  - Charter: make **query linting** a first-class differentiator, starting with runtime linting and laying foundations for static analysis that integrates with the DSLs and contracts.
  - Doc: `project-query-linting-and-static-analysis.md`

- **Project C — Migrations & DB Init**
  - Charter: deliver **`db init` and `db update`** (including PGVector needs) and define the **marker/ledger/contract** shape that Console/Studio can consume.
  - Doc: `project-migrations-and-db-init.md`

- **Project D — Runtime Client Façade & No-Emit / Vite**
  - Charter: provide a **single client surface** for app code and a **no-emit developer workflow**, including a simple Vite integration, so using Prisma Next with PPg feels straightforward.
  - Doc: `project-runtime-facade-and-no-emit.md`

- **Project E — Example App & Testing Story**
  - Charter: turn `examples/prisma-next-demo` into the **hero v1 app** (SQL + ORM + PGVector, via façade and migrations) and define a **reusable @prisma/dev testing pattern**.
  - Doc: `project-example-app-and-testing.md`

## Coordination and ownership

- Each project doc should be owned by **one lead** (to be assigned) who:
  - Drives the v1 planning and keeps the doc up to date.
  - Runs the “walk `prisma-next-demo` against v1 goals” exercise for their area.
  - Reports progress and cross-project blockers in status updates.
- Leads are expected to collaborate closely where contracts overlap:
  - Project A ↔ Project B on lintable DSL shapes and metadata.
  - Project C ↔ Project E on migrations applied in the hero app.
  - Project D ↔ Projects A/B/E on how the façade exposes lanes and lint configuration.

### Subject matter experts (current)

These are tentative SMEs for v1 execution; they are not permanent roles and will overlap:

- **Will**: architecture, design lead.
- **Alexey**: query planning/rendering, query AST support.
- **Jacek**: extension support, performance, query planning/rendering.
- **Alberto**: CLI/TS API, migrations, DDL, control operations.
- **Igal**: query DSLs (SQL query builder; model query builder).

This plan is deliberately high-level; the detailed task breakdowns live in the project docs and the issue tracker.


