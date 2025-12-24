## Project E — Example App & Testing Story

### Purpose

Turn `examples/prisma-next-demo` into the **hero v1 application** and define a **reusable testing pattern** (especially with @prisma/dev) so that:

- There is a single, concrete reference for “how to use Prisma Next as your PPg client”.
+- Teams can copy the testing approach to exercise their own apps with minimal friction.

This project owns the example application(s), their wiring to the CLI and runtime façade, and the recommended testing utilities/patterns; it does **not** own the underlying runtime, DSLs, or migrations but must reflect their v1 capabilities accurately.

---

### v1 (end-of-Jan) goals

- **Hero app defined and implemented**
  - `examples/prisma-next-demo` clearly demonstrates:
    - Core CRUD flows on representative models.
    - At least one simple relation traversal (e.g. 1‑many `include`).
    - A PGVector-powered feature (e.g. semantic search) using the same PGVector support exposed to users.
  - The app:
    - Uses the **runtime client façade** rather than low-level wiring.
    - Relies on **`emit` + `db init`/`db push`** for schema management.
    - Has clear configuration for PPg vs. @prisma/dev usage.

- **Testing story with @prisma/dev**
  - Provide a small set of documented test helpers that:
    - Spin up an @prisma/dev database.
    - Run contract emit + `db init`/`db push` as needed.
    - Seed sample data for the demo scenarios.
    - Tear down cleanly.
  - Demo tests:
    - Use these helpers end-to-end.
    - Exercise SQL lane, ORM lane, and PGVector flows through the façade.
    - Are written in a form that is easy for users to copy and adapt.

- **Linting demonstrated**
  - The hero app and tests:
    - Trigger at least a couple of **runtime linting rules**, with expectations around how they surface (e.g. logs, structured output).
    - Optionally include one example of a **static lint rule** (if available) with documentation on how to enable it.

---

### Non-goals (post-Jan)

- Multiple fully fleshed-out example apps for different stacks; v1 focuses on a single strong reference implementation.
- Exhaustive coverage of every feature in examples; the goal is a representative slice that exercises the core v1 story.
- Complex test harnesses or abstractions beyond what’s needed to make copy-paste patterns clear.

---

### Early milestones (Pass 0 / early Pass 1)

- **Hero scenarios definition**
  - Walk `examples/prisma-next-demo` and:
    - Identify which existing flows map cleanly onto v1 goals.
    - Decide on a small set of canonical scenarios (e.g. “basic CRUD”, “user with posts”, “semantic search”).
  - Align with:
    - DSL/ORM project on the exact queries that should be considered “hero”.
    - Migrations project on the schema and evolution the app will rely on.

- **First end-to-end slice**
  - Ensure there is at least one path where:
    - Contract is emitted and applied via `db init`.
    - The app uses the façade to run a query end-to-end against PPg or @prisma/dev.
    - A test case exercises the same path using shared helpers.

---

### Dependencies and collaboration

- **Project A — Query DSLs & Relational Lane**
  - Hero scenarios must be expressible via the SQL and ORM lanes.
  - Changes in lane APIs must be reflected promptly in the example code and tests.

- **Project B — Query Linting & Static Analysis**
  - Example code should intentionally include:
    - “Good” queries that pass linting,
    - A small number of “bad” queries to showcase linting behavior (and to test it).

- **Project C — Migrations & DB Init**
  - Example app bootstrapping and tests depend on reliable `emit` + `db init`/`db push` flows.

- **Project D — Runtime Client Façade & No-Emit / Vite**
  - Example app is the primary consumer of the façade and no-emit/Vite workflows in v1.
  - Feedback from the example app should inform adjustments to façade ergonomics.

---

### Open questions / to be refined by the project lead

- Exact framing and documentation of the hero app (what narrative we tell users about it).
- How many variants of the example (e.g. pure SQL vs. ORM) to maintain without overextending.
- How strongly to couple the testing utilities to @prisma/dev versus leaving room for alternative setups.



