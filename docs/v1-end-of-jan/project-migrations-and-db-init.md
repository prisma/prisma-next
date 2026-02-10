## Project C — Migrations & DB Init

### Purpose

Design and implement the **`db init` and `db push`** experience for v1 so that:

- A new or existing PPg database can be brought under Prisma Next control from a contract.
- Schema changes for the v1 hero app (including PGVector needs) can be applied safely in development.
- The **marker, contract, and migration ledger** are written in a form that Console/Studio can consume.

This project owns how contracts become database schema and how schema evolution is represented; it does **not** own query authoring, runtime execution, or Studio UI (but must collaborate closely with those owners).

---

### v1 (end-of-Jan) goals

- **`db init` command implemented**
  - Reads config and contract (TS/PSL source via emit or no-emit path) and:
    - Creates the baseline schema for the v1 hero app, including:
      - All core tables and indexes needed by the example,
      - PGVector extension, column type(s), and index(es) required by the PGVector flow.
    - Writes the contract marker (including `storageHash`/`profileHash`) into the database.
  - Handles basic existing-schema scenarios for v1:
    - Fails clearly if the database is non-empty in ways that conflict with the contract.
    - Is safe to re-run in obvious “idempotent” cases (e.g. marker already matches and schema unchanged).

- **`db push` for additive changes**
  - Supports **additive schema evolution** for the v1 hero app:
    - New tables, new columns, basic indexes.
    - PGVector-related changes required for v1 (e.g. adding an index).
  - Produces and applies **on-disk migrations** in a simple linear format:
    - Enough structure that later tools and humans can inspect the history.
  - Updates the marker and ledger appropriately after successful application.

- **Marker / contract / ledger shape defined for Console/Studio**
  - The schema and tables used to store:
    - The current contract,
    - Marker (`storageHash`, `profileHash`, adapter profile, etc.),
    - A minimal append-only migration ledger,
  - Are:
    - Documented for other teams (Console/Studio),
    - Stable enough that Studio can rely on them to render a basic “contract + migration history” view.

- **Demo integration**
  - `examples/prisma-next-demo`:
    - Can be stood up from scratch with `emit` + `db init` against PPg/@prisma/dev.
    - Uses `db push` for the small set of schema changes we need during v1 development.
    - Documents the “from empty DB to running app” workflow that early adopters should follow.

---

### Non-goals (post-Jan)

- Complex or destructive migration planning (drops, renames, data migrations).
- Branching or multi-environment migration graphs.
- Full-blown drift detection and automated reconciliation beyond what marker checks already provide.
- Rich migration authoring UX (e.g. interactive editors); v1 can rely on CLI and basic files.

---

### Early milestones (Pass 0 / early Pass 1)

- **Inventory & minimal DDL matrix**
  - Walk `examples/prisma-next-demo` schema (including PGVector usage) and:
    - Enumerate the exact tables, columns, indexes, and extensions v1 must support.
    - Classify which schema changes we expect during v1 (to scope `db push`).

- **CLI and API sketch**
  - Draft the UX and TS API for:
    - `db init` (flags, config resolution, behavior on existing DBs),
    - `db push` (what’s supported, how conflicts are reported).
  - Review with:
    - Runtime/client façade project (how app/dev flows call into these),
    - Example app project (to ensure the hero workflow feels natural).

- **First vertical slice**
  - Implement a thin vertical slice where:
    - `db init` creates schema + marker for a minimal subset of the demo schema on an empty DB.
    - The example app (or a small script) can query that schema successfully through the current runtime.

---

### Dependencies and collaboration

- **Project A — Query DSLs & Relational Lane**
  - Needs stable table/column contracts; changes in mappings or schema shape must be coordinated.

- **Project D — Runtime Client Façade & No-Emit / Vite**
  - Façade and no-emit workflow will dictate how and when `emit`, `db init`, and `db push` are invoked in dev.

- **Project E — Example App & Testing Story**
  - The hero app defines the canonical schema and schema changes this project must support for v1.
  - Integration tests for migrations should live with or share patterns from this project.

- **Console/Studio team**
  - Needs a stable marker/contract/ledger schema and minimal documentation to build basic visualizations.

---

### Open questions / to be refined by the project lead

- Exact boundaries of what `db push` will support in v1 versus deferring to post-Jan (e.g. index changes, enum changes).
- How strict to be on existing-schema detection versus allowing more lenient adoption paths.
- What minimal annotations or metadata are worth adding now (e.g. tagging migrations or tables) to help later tooling without overcomplicating v1.



