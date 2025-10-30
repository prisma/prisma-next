## Compatibility Layer — Prisma Import‑Swap (MVP) — Design Brief

### Objective
Enable the example app to run unchanged by swapping Prisma Client imports for a minimal compatibility layer. Support only the Prisma APIs exercised by the example app, map them to Prisma Next’s query plane (ORM/DSL → Plans → Runtime), and preserve the tight feedback loop (budgets, verification).

### Non‑Goals (MVP)
- Full Prisma Client surface area (transactions, middleware, batching, raw SQL escape hatch, aggregations, `$extends`, `$transaction`, `$use`, etc.)
- Migrations or schema generation. This slice is runtime‑only.
- Exact Prisma error types/messages. We keep ADR‑027 envelopes; mapping can be added later.

### Contract Artifact Strategy (MVP)
- No emitter in this slice. Use a static, hand‑authored `contract.json` committed to the repo.
- Location: `examples/workflows-demo/src/prisma/contract.json` (loaded by the example runtime and compatibility layer).
- Content: minimum `DataContract` fields needed by the runtime and DSL/ORM builders:
  - `target` (e.g., `"postgres"`), optional `targetFamily`
  - `coreHash` (fixed placeholder for demo; updated manually when schema changes)
  - optional `profileHash` (may equal `coreHash` for MVP)
  - `storage.tables`: per table → columns (name, type, nullable), primary keys, simple indexes used by demo queries
- Updates are manual for the MVP. When demo schema changes, update the static contract accordingly; no code generation in this slice.

### High‑Level Approach
- Provide a drop‑in `PrismaClient` with only the model methods used by the example app. Methods translate Prisma args into PN ORM/DSL builders, compile to a single Plan per call, and execute through the PN runtime.
- Keep the compatibility layer thin and declarative: a method map translates args → query shape → projection → Plan.
- Preserve guardrails: runtime verification and budgets plugin run unchanged.

### Package and Import Strategy
- Package: `@prisma-next/compat-prisma`
- Entry: `PrismaClient` class exposing a subset of Prisma methods; shaped close enough for import‑swap in the example app.
- Example app wiring (two options):
  - Path alias in bundler/tsconfig to resolve `@prisma/client` → `@prisma-next/compat-prisma`
  - Explicit import change in the demo only (still zero query edits)

### Supported API Surface (MVP)
Inventory from `examples/prisma-orm-demo` (locks scope):
- Client lifecycle
  - `new PrismaClient()`
  - `$disconnect()`
- Model: `user`
  - `user.findUnique({ where: { id: string } })`
  - `user.create({ data: { email: string; name: string } })`

Optional (not currently used by demo; keep mapping notes but do not implement unless needed):
- `findMany`, `findFirst`, `select`, `include`, `orderBy`, `take/skip`

Unsupported in MVP (hard errors if used)
- Filters beyond single‑field equality (`OR`, `AND`, ranges, LIKE, IN/NOT IN`, null checks)
- Multi‑field `orderBy`, distinct, groupBy, aggregates
- Updates and deletes; nested writes
- Relations and deep `include`

### Mapping Strategy
1) Model registry
   - Build from the PN `contract.json`: tables → models, columns → fields, relations → includes.
2) Where clause (eq only)
   - Map `{ field: value }` to `t.<model>.<field>.eq($param)`.
3) Projection
   - `select` → explicit projection; default to minimal projection required by include/ordering when absent.
4) Includes (read‑only)
   - 1:N and N:1 via joins; runtime reshapes to nested objects using Plan projection per MVP.
   - Apply default per‑relation limit 100 and `createdAt desc` (fallback to PK desc); allow override via include options when present in demo.
5) Order/Limit/Pagination
   - `orderBy` (single field) → ORDER BY
   - `take` → LIMIT; `skip` → OFFSET
6) Plan & Execute
   - Reads: compile to a single SELECT Plan via DSL/ORM; execute via runtime.
   - Writes (create): compile a single INSERT Plan using a minimal compat write path (parameterized INSERT emitted as a Plan; no general write DSL). Budgets enforce via observed rowCount; no EXPLAIN.

### Runtime & Guardrails Integration
- Verify database marker vs contract on first use per runtime settings.
- Budgets: pre‑exec heuristic (LIMIT) and on‑row row‑count enforcement apply transparently to compatibility calls.
- Error envelopes follow ADR‑027. For MVP, we do not wrap them into Prisma error classes.

### Configuration
- `new PrismaClient({ runtime, adapter, driver, contract, mode })` or `new PrismaClient()` with a default singleton runtime loaded from the app’s `src/prisma/runtime.ts`.
- Minimal, explicit, and tree‑shakable; no global side effects.

### Error Semantics
- Unsupported features throw `CONFIG.INVALID` with a clear message referencing the unsupported Prisma arg.
- Guardrail violations throw `BUDGET.*`/`LINT.*` per ADR‑027.
- Contract mismatches throw `CONTRACT.*` errors per runtime verification.

### Acceptance Criteria (MVP)
- Example app runs unchanged (import‑swap only) across supported routes.
- `user.findUnique({ where: { id } })` maps to one SELECT Plan and returns the matching row or null.
- `user.create({ data })` maps to one INSERT Plan and returns the created row with id.
- Guardrails remain active for reads (budgets), and writes succeed without EXPLAIN.
- Unsupported features surface clear, stable errors and workaround guidance.

### Test Plan
- Golden behavior parity tests for each used Prisma call in the demo:
  - Inputs (args) → emitted SQL snapshot (normalized) → rows (shape)
  - With/without `select`/`include`, pagination, ordering
- Guardrail case: unbounded findMany (no `take`) → `BUDGET.ROWS_EXCEEDED` pre‑exec
- Marker verification case to confirm contract drift handling

#### Dual‑implementation harness (P0 vs PN+compat)
- A single test suite runs each demo query against two implementations:
  1) P0 Prisma (`@prisma/client`) — baseline
  2) PN + compatibility layer — import‑swap
- Mechanism:
  - Create a shared query module that accepts a `client` with only the used methods (`user.findUnique`, `user.create`).
  - Instantiate `clientP0 = new PrismaClient()` and `clientPN = new PrismaCompatClient({ runtime, adapter, driver, contract })`.
  - Run the same tests twice (parameterized) with `clientP0` and `clientPN` and assert parity of results (shape and values).
  - Optionally snapshot normalized SQL/fingerprint for PN; P0 SQL is not required.
- DB orchestration:
  - Use the same local Postgres for both implementations.
  - Reset schema between tests and seed once per run to ensure stable IDs and determinism.
  - For PN path, load the static `contract.json` and stamp the marker before running queries.

### Risks & Mitigations
- Hidden demo dependencies on Prisma features outside scope → mitigate by inventorying actual calls first and constraining demo routes if needed.
- Join explosion and reshape complexity with `include` → keep includes single‑level; default relation limits; use runtime reshape.
- Error mismatch vs Prisma → document ADR‑027 envelopes; optionally add a thin mapping later.

### Milestones & Timeline
- M1: Method inventory from the demo + scope lock (0.5d)
- M2: Minimal `PrismaClient` class with `findMany`/`findUnique` and eq where, select, order/take/skip (1–1.5d)
- M3: Single‑level `include` with default per‑relation limit and reshape (1–1.5d)
- M4: Example app import‑swap and tests (0.5–1d)

### References
- MVP‑Spec: Compatibility import‑swap, zero query edits; guardrails/budgets
- Architecture Overview: Query Lanes; Runtime & Plugin Framework
- ADR‑011: Unified Plan model; ADR‑027: Error envelope; ADR‑023: Budgets

### Clarification Needed
- Please confirm the exact Prisma API calls used by the `prisma-orm-demo` (models and methods), including which args (`where` shapes, `select`/`include`, `orderBy`, `take/skip`). This locks scope and test cases.


