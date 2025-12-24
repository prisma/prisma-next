## Project A — Query DSLs & Relational Lane

### Purpose

Define and implement the v1 **SQL lane + ORM/relational lane** so that:

- Typical application queries (filters, joins, pagination, simple aggregates) are easy to express.
- A minimal **model-centric API** (Model lane) exists for CRUD and simple relationship traversal.
- The design is **lintable** (runtime + future static analysis) and compatible with the long-term architecture.

This project owns the authoring surfaces for relational queries; it does **not** own migrations, runtime execution, or the client façade (those are separate projects, with tight collaboration).

---

### v1 (end-of-Jan) goals

- **SQL lane API defined and implemented**
  - Clear API for:
    - `from`, `select`, `where` (comparators + AND/OR), `orderBy`, `limit/offset`, basic joins.
  - Types derive from `contract.d.ts` without leaking `any` into public signatures.
  - All queries needed by the v1 hero app(s) can be expressed via this lane.

- **ORM / relational lane MVP defined and implemented**
  - Model-centric builder (e.g. `orm.user()`) with:
    - `findUnique`, `findMany`, `create`, `update`, `delete` for at least one or two representative models.
    - One supported `include` pattern (1‑many) that lowers to existing SQL lane constructs.
  - Model lane compiles strictly through the SQL lane; no parallel query implementation.

- **Lint-friendly design**
  - Public DSL APIs are **statically recognizable** for ESLint/TS rules:
    - Conventional call patterns (no opaque metaprogramming hiding tables/columns).
    - Sufficient metadata in types (e.g. model/table ID, lane, operation kind) to support static rules.
  - Plans produced by both lanes carry enough meta for runtime linting:
    - Lane identifier, table/model references, key structural info (e.g. presence of limits, where clauses).

- **Demo integration**
  - `examples/prisma-next-demo`:
    - Uses SQL lane for its SQL-style examples.
    - Uses Model lane for a parallel set of flows (CRUD + 1‑many `include`) where appropriate.

---

### Non-goals (post-Jan)

- Full relational feature parity with a mature ORM (nested writes, deep includes, complex filtering on relations).
- Rich relation filters (e.g. `some`/`none`/`every` on arbitrarily deep relation graphs) beyond what the v1 hero app needs.
- Advanced pagination features (cursor-based pagination with full ergonomics).
- Multi-target ORM abstraction beyond Postgres/SQL-family.

---

### Early milestones (Pass 0 / early Pass 1)

- **Inventory & API sketch**
  - Walk `examples/prisma-next-demo` and:
    - Catalogue existing SQL lane usage and any proto-ORM usage.
    - Identify which query shapes are required for v1 vs. post-Jan.
  - Draft written API shapes for:
    - SQL lane (core methods + typical usage examples).
    - Model lane (builder entrypoints, CRUD signatures, `include` usage).
  - Review API drafts with:
    - Query linting project (to ensure lintability and static matchability).
    - Runtime façade project (to ensure clean exposure to app code).

- **Minimal end-to-end vertical slice**
  - Implement a vertical slice where:
    - A simple query is authored with both SQL and Model lanes.
    - The resulting plans execute successfully through the current runtime and adapter.

---

### Dependencies and collaboration

- **Project B — Query Linting & Static Analysis**
  - Agree on:
    - DSL call patterns that static rules can easily identify.
    - The metadata required on plans for runtime linting.

- **Project D — Runtime Client Façade & No-Emit / Vite**
  - Ensure the façade can expose SQL and Model lanes in a way that matches the intended developer experience.

- **Project E — Example App & Testing Story**
  - Align on which flows in `prisma-next-demo` are the “hero” relational scenarios that this project must support for v1.

---

### Open questions / to be refined by the project lead

- Exact naming and ergonomics of the ORM API (e.g. `findFirst` vs. `findMany` with limits, how `include` is expressed).
- How much relation filtering to support in v1 versus deferring to post-Jan.
- How to layer relational filters and PGVector queries in a way that feels natural but remains statically analyzable.


