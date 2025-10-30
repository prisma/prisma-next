## Budgets Plugin — MVP Slice Plan

### Objective
Deliver a lane‑agnostic budgets plugin integrated via the runtime plugin framework that enforces a row‑count budget with deterministic, early feedback. Prioritize pre‑execute heuristics for DSL lane and streaming post‑checks for all lanes.

### Scope (MVP)
- Implement a `budgets` plugin with row‑count enforcement:
  - Pre‑exec heuristic for DSL single‑table SELECT using LIMIT and table size hints
  - Post‑exec streaming enforcement for all lanes (terminate on overage)
- Runtime plugin registration via explicit `plugins` array on `createRuntime` options
- Stable error codes and severities per ADR 027
- Defaults aligned to MVP‑Spec; EXPLAIN disabled for MVP
- Keep diagnostics/telemetry out of runtime core; provide `log` in plugin context

### Out of Scope (MVP)
- Latency budget enforcement (wire later in the same plugin)
- SQL size budget
- EXPLAIN integration and caching (ADR 023)
- Non‑DSL LIMIT inference or SQL parsing
- Lints plugin; broader guardrail taxonomy

### API Surface
- Runtime options (additions):
  - `plugins?: Plugin[]` (default `[]`)
  - `mode?: 'strict' | 'permissive'` (default `'strict'`)
- Plugin types (ctx kept minimal):
  - `Plugin = { name: string; beforeExecute?(plan, ctx); onRow?(row, plan, ctx); afterExecute?(plan, result, ctx); }`
  - `ctx = { contract, adapter, driver, mode, now: () => number, log: Log }`
  - `Log = { info(x): void; warn(x): void; error(x): void }`
- Budgets plugin factory:
  - `budgets(options?: BudgetsOptions): Plugin`
  - `BudgetsOptions = { maxRows?: number; defaultTableRows?: number; tableRows?: Record<string, number>; severities?: { rowCount?: 'warn' | 'error'; latency?: 'warn' | 'error' } }`

### Behavior and Semantics
- Pre‑exec (DSL only):
  - If `plan.meta.lane !== 'dsl'` or `plan.ast` absent → skip pre‑exec estimation (treat as unknown)
  - Determine table name from `plan.meta.refs.tables[0]`
  - Lookup `tableRows[table]` with fallback `defaultTableRows`
  - If no LIMIT → treat as unbounded; compute estimate = table estimate
  - If LIMIT `N` → `estimatedRows = min(N, tableEstimate)`
  - If `estimatedRows > maxRows` → emit `BUDGET.ROWS_EXCEEDED`
    - Severity resolves to blocking error if `rowCount` severity is `error` OR runtime `mode` is `strict`
    - Otherwise, log a warn via `ctx.log` and continue
- Streaming (all lanes):
  - Track observed rows; when `observed > maxRows` → throw `BUDGET.ROWS_EXCEEDED` and terminate iteration
- After‑execute (all lanes):
  - For MVP, only log `{ rowCount, latencyMs }`; latency budget wiring deferred

### Stable Codes (ADR 027)
- Errors thrown/logged use:
  - `BUDGET.ROWS_EXCEEDED` with `details = { source: 'heuristic' | 'observed', estimatedRows?, observedRows?, maxRows }`
- Severity mapping:
  - Row‑count: default `error` (blocking); overridable via `severities.rowCount`
  - Latency: default `warn` (advisory); wired later

### Defaults (MVP‑Spec)
- `maxRows: 10_000`
- `defaultTableRows: 10_000`
- `tableRows: { user: 10_000, post: 50_000, purchase: 25_000 }` (example app)
- `severities: { rowCount: 'error', latency: 'warn' }`
- EXPLAIN disabled

### Runtime Integration
- The runtime invokes plugin hooks in order:
  - `beforeExecute(plan, ctx)` prior to driver execution (may throw to block)
  - `onRow(row, plan, ctx)` for each streamed row (may throw to stop)
  - `afterExecute(plan, { rowCount, latencyMs, completed }, ctx)` after success or failure
- Diagnostics channel remains outside runtime; plugins use `ctx.log`

### Example Usage (Example App)
Minimal sketch of wiring in app runtime (illustrative; implementation will be separate):

```ts
import { createRuntime } from '@prisma-next/runtime'
import { budgets } from '@prisma-next/runtime/plugins/budgets'

const runtime = createRuntime({
  contract,
  adapter,
  driver,
  verify: { mode: 'onFirstUse', requireMarker: true },
  plugins: [
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      tableRows: { user: 10_000, post: 50_000, purchase: 25_000 },
    }),
  ],
})
```

### Acceptance Criteria (Locked)
- Unbounded DSL SELECT without LIMIT blocks pre‑exec with `BUDGET.ROWS_EXCEEDED`.
- DSL SELECT with LIMIT `N` passes if `min(N, tableRows[table]) ≤ maxRows`; otherwise blocks pre‑exec.
- Any lane: streaming stops with `BUDGET.ROWS_EXCEEDED` when observed row count exceeds `maxRows`.
- Non‑DSL plans are treated as unbounded pre‑exec (no LIMIT inference), relying only on the post‑check.

### Test Plan
Integration (Vitest):
- Start ephemeral Postgres via `@prisma/dev`; stamp marker; create `user` table; insert a few rows
- Case A: Unbounded DSL SELECT (no LIMIT) → expect `BUDGET.ROWS_EXCEEDED` pre‑exec
- Case B: Bounded DSL SELECT with small LIMIT → rows stream; no budget error
- Case C: Any lane, large stream (simulate with cursor disabled fallback) → expect `BUDGET.ROWS_EXCEEDED` during iteration

Unit (offline):
- Heuristic estimator picks `refs.tables[0]` and applies `min(LIMIT, tableEstimate)`
- Severity mapping respects `rowCount: 'warn' | 'error'` and runtime mode

### Risks & Mitigations
- False positives for non‑DSL lanes → rely on post‑check only; document limitation
- Cursor fallback cannot stop DB work → still terminate consumer early; document behavior
- Table size hints drift → expose overrides via `tableRows` and sane default

### Timeline & Milestones
- M1: Plugin types, runtime hook wiring, budgets plugin skeleton (1d)
- M2: DSL heuristic + streaming enforcement + tests (1–2d)
- M3: Example app wiring + CI test inclusion (0.5d)

### References
- ADR 023 — Budget evaluation & EXPLAIN policy
- ADR 027 — Error envelope & stable codes
- Architecture Overview — Runtime & Plugin Framework
- MVP‑Spec — Guardrails & Budgets



