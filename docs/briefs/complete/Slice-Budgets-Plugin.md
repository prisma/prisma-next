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
- SQL size budget
- EXPLAIN integration and caching (ADR 023) beyond a disabled config stub
- SQL parsing
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
  - `BudgetsOptions = { maxRows?: number; defaultTableRows?: number; tableRows?: Record<string, number>; maxLatencyMs?: number; severities?: { rowCount?: 'warn' | 'error'; latency?: 'warn' | 'error' }; explain?: { enabled?: boolean } }`

### Behavior and Semantics
- Pre‑exec (lane‑agnostic):
  - Any SELECT without a detectable LIMIT is treated as over the row budget by default (heuristic), per MVP‑Spec.
  - DSL refinement (single‑table): determine table name from `plan.meta.refs.tables[0]`; lookup `tableRows[table]` with fallback `defaultTableRows`.
  - If DSL LIMIT `N` is present → `estimatedRows = min(N, tableEstimate)`; else treat as unbounded with `estimatedRows = tableEstimate`.
  - If `estimatedRows > maxRows` → emit `BUDGET.ROWS_EXCEEDED`.
    - Severity resolves to blocking if `rowCount` severity is `error` or runtime `mode` is `strict`; otherwise warn via `ctx.log`.
  - Detectable LIMIT definition: derived from lane‑provided structure only (e.g., DSL AST or explicit `plan.meta` hints). The plugin does not parse SQL text. If no lane‑level limit signal exists, treat as no LIMIT.
- Streaming (all lanes):
  - Track observed rows; when `observed > maxRows` → throw `BUDGET.ROWS_EXCEEDED` and terminate iteration
- After‑execute (all lanes):
  - Enforce latency budget: if `latencyMs > maxLatencyMs` → emit `BUDGET.TIME_EXCEEDED` (warn by default).

### Stable Codes (ADR 027)
- Errors thrown/logged use:
  - `BUDGET.ROWS_EXCEEDED` with `details = { source: 'heuristic' | 'observed', estimatedRows?, observedRows?, maxRows }`
  - `BUDGET.TIME_EXCEEDED` with `details = { latencyMs, maxLatencyMs }`
- Severity mapping:
  - Row‑count: default `error` (blocking); overridable via `severities.rowCount`
  - Latency: default `warn` (advisory)

### Defaults (MVP‑Spec)
- `maxRows: 10_000`
- `defaultTableRows: 10_000`
- `tableRows: { user: 10_000, post: 50_000, purchase: 25_000 }` (example app)
- `maxLatencyMs: 1_000`
- `severities: { rowCount: 'error', latency: 'warn' }`
- `explain.enabled: false` (optional stub)

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
- Any SELECT without a detectable LIMIT is treated as over the row budget pre‑exec per policy, lane‑agnostic.
- DSL SELECT with LIMIT `N` passes if `min(N, tableRows[table]) ≤ maxRows`; otherwise blocks pre‑exec.
- Any lane: streaming stops with `BUDGET.ROWS_EXCEEDED` when observed row count exceeds `maxRows`.
- Latency budget emits `BUDGET.TIME_EXCEEDED` (warn) when `latencyMs > 1_000`.

### Test Plan
Integration (Vitest):
- Start ephemeral Postgres via `@prisma/dev`; stamp marker; create `user` table; insert a few rows
- Case A: Unbounded SELECT (no LIMIT, any lane available) → expect `BUDGET.ROWS_EXCEEDED` pre‑exec
- Case B: Bounded DSL SELECT with small LIMIT → rows stream; no budget error
- Case C: Any lane, large stream (simulate with cursor disabled fallback) → expect `BUDGET.ROWS_EXCEEDED` during iteration
- Case D: Latency — `select pg_sleep(1.5)` in raw lane (or equivalent) → `BUDGET.TIME_EXCEEDED` (warn)

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



