## Project B — Query Linting (Runtime) & Static Analysis Foundations

### Purpose

Make **query linting** a first-class differentiator for Prisma Next v1 by:

- Providing a practical **runtime linting** experience out of the box.
- Designing the hooks and patterns needed for **future static analysis** (ESLint/TS-based), even if only a small PoC exists by end of Jan.

This project owns linting rules and their integration points; it does not own the core runtime or DSL implementations, but must strongly influence their design.

---

### v1 (end-of-Jan) goals

- **Runtime linting hook contract**
  - A well-defined hook surface in the runtime executor, at least:
    - **Per-plan** lint hook that receives:
      - Plan metadata (lane, operation kind, referenced tables/models).
      - A stable, structured representation of the query (AST or normalized description).
      - Contract-related context where needed (e.g. annotations about tables).
    - Optional **per-execution** hook (e.g. row counts, duration), if feasible without over-complicating v1.

- **Initial runtime rule set implemented**
  - A small but meaningful set of rules wired and active for all plans in the v1 hero app, such as:
    - Unbounded `SELECT` on tables marked as large or critical.
    - Missing `WHERE` on `findMany`/equivalent against such tables.
    - Suspicious PGVector queries (e.g. similarity search without a `LIMIT`).
  - A simple, documented way to:
    - Enable/disable individual rules.
    - Surface lint findings (e.g. logging, structured output) in the example app.

- **Static analysis PoC**
  - An ESLint (or TS) rule set prototype that can:
    - Recognize calls into the PN DSLs (SQL and ORM lanes).
    - Resolve at least the model/table name and operation type from those calls.
    - Optionally read the emitted contract JSON to apply one or two basic static rules.
  - At least **one or two real static rules** implemented, even if rough (e.g. “unbounded `findMany` on large model”).

- **Alignment with DSL and contract design**
  - Clear guidance (documented) for:
    - How DSLs should expose metadata to support linting.
    - What contract annotations will be available in v1 (e.g. flags for “large” tables) and how rules can use them.

---

### Non-goals (post-Jan)

- Comprehensive policy system (budgets, authorization policies, multi-tenant constraints).
- Full dataflow-aware static analysis (tracking conditions through control flow).
- Highly configurable organization-wide lint config UX; v1 can start with simple configuration.

---

### Early milestones (Pass 0 / early Pass 1)

- **Integration design with runtime and DSLs**
  - Pair with:
    - Runtime owner to define the exact runtime hook interface.
    - Query DSL/ORM owner to agree on:
      - Patterns that static rules will match (how queries are authored).
      - What metadata must be attached to plans for runtime rules.

- **First runtime rule wired**
  - Implement a single, simple rule (e.g. warn on unbounded select) end-to-end:
    - Author query in the demo app.
    - See a lint event produced by the runtime hooks.
    - Decide how that event is surfaced in dev (e.g. console/log with structured data).

- **Static analysis feasibility probe**
  - Build a small experiment that:
    - Parses a demo app file.
    - Recognizes at least one DSL call and logs the inferred table/model.
  - Use this to confirm or adjust DSL API shapes before they are finalized.

---

### Dependencies and collaboration

- **Project A — Query DSLs & Relational Lane**
  - Needs consistent, recognizable call patterns and rich enough metadata on plans.
  - Will influence how operations, models, and tables are identified in both runtime and static contexts.

- **Project D — Runtime Client Façade & No-Emit / Vite**
  - Façade needs to expose a straightforward way for applications to:
    - Configure linting (turn rules on/off, set severity).
    - Consume lint output (for logs, dev overlays, or later UI integration).

- **Project E — Example App & Testing Story**
  - The hero app must exercise linting:
    - At least one or two “bad” queries intentionally present for demonstration/tests.

---

### Open questions / to be refined by the project lead

- Minimum lint configuration model for v1 (hard-coded defaults vs. simple config object).
- How to report lint results in a way that can later be surfaced in tools like Studio or dashboards.
- Which additional contract annotations (beyond schema) are worth adding now to enable useful linting rules without overcomplicating authoring.
