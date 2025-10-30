# Prisma Next — Two‑Week MVP Spec (Workflow‑Oriented)

This spec defines a single, coherent MVP for the two‑week spike. It reflects the leadership proposal’s goals and exit criteria and serves as the source of truth for what we will build and demonstrate.

## Goals (two‑week spike)
- Compatibility import‑swap for a minimal Prisma ORM example app with zero query edits via a compatibility layer
- Safety and coaching value via the budgets plugin blocking an unbounded read and surfacing a clear fix
- Extensibility demonstrated by installing and using a `pgvector` pack without core changes

Supporting goals for developer experience and verification:
- No manual generate: PSL → contract artifacts on save
- Guardrails and budgets enforced pre‑ and post‑execution with stable error envelopes

## Acceptance Criteria
- Example app runs unchanged on PN via a compatibility layer (import‑swap, zero query edits)
- Budgets plugin blocks an unbounded read with an actionable fix
- `pgvector` pack installed and used in the demo without core changes

Supporting acceptance
- Vite plugin auto‑emits contract and blocks on contract errors

## Example App (ESM) — `examples/workflows-demo/`
- `src/prisma/schema.psl` ([Data Contract](./architecture%20docs/subsystems/1.%20Data%20Contract.md)).
- `src/prisma/contract.json`, `src/prisma/contract.d.ts` ([Contract Emitter & Types](./architecture%20docs/subsystems/2.%20Contract%20Emitter%20%26%20Types.md); [ADR 007 — Types Only Emission](./architecture%20docs/adrs/ADR%20007%20-%20Types%20Only%20Emission.md); [ADR 010 — Canonicalization Rules](./architecture%20docs/adrs/ADR%20010%20-%20Canonicalization%20Rules.md)).
- `src/prisma/runtime.ts` (lazy singleton, onFirstUse verify; explicit `runtime.verify()` per [ADR 021 — Contract Marker Storage](./architecture%20docs/adrs/ADR%20021%20-%20Contract%20Marker%20Storage.md)).
- `src/prisma/dsl.ts` (memoized query factories; [ADR 011 — Unified Plan Model](./architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md), [ADR 002 — Plans are Immutable](./architecture%20docs/adrs/ADR%20002%20-%20Plans%20are%20Immutable.md), [ADR 003 — One Query One Statement](./architecture%20docs/adrs/ADR%20003%20-%20One%20Query%20One%20Statement.md)).
- `src/prisma/scripts/seed.ts` (esr runner; idempotent top‑up).
- `migrations/YYYYMMDDThhmm_snake_case/` ([Migration System](./architecture%20docs/subsystems/7.%20Migration%20System.md); [ADR 009 — Deterministic Naming Scheme](./architecture%20docs/adrs/ADR%20009%20-%20Deterministic%20Naming%20Scheme.md)).
- `vite.config.ts` (plugin wired; [ADR 032 — Dev Auto Emit Integration](./architecture%20docs/adrs/ADR%20032%20-%20Dev%20Auto%20Emit%20Integration.md)).
- `prisma-next.config.ts` (CLI‑only config; [Contract Emitter & Types](./architecture%20docs/subsystems/2.%20Contract%20Emitter%20%26%20Types.md); [ADR 097 — Tooling runs on canonical JSON only](./architecture%20docs/adrs/ADR%20097%20-%20Tooling%20runs%20on%20canonical%20JSON%20only.md)).
- `test/*` (Vitest, single‑threaded).

### Scripts (package.json)
- `dev`, `build`, `preview`
- `test` (Vitest), `typecheck` (tsd)
- `seed` (esr)
- `emit`, `verify:contract`, `verify:db`
- `migration:plan`, `migration:verify`, `migration:apply`
- `preflight` (default mode: shadow)

## Vite Plugin — `@prisma/vite-plugin-prisma-next`
- Watches `src/prisma/schema.psl`.
- Emits `contract.json` + `.d.ts` deterministically ([Contract Emitter & Types](./architecture%20docs/subsystems/2.%20Contract%20Emitter%20%26%20Types.md); [ADR 010](./architecture%20docs/adrs/ADR%20010%20-%20Canonicalization%20Rules.md)).
- Blocks dev server on parse/validate/hash mismatch ([Contract Emitter & Types](./architecture%20docs/subsystems/2.%20Contract%20Emitter%20%26%20Types.md); [ADR 006 — Dual Authoring Modes](./architecture%20docs/adrs/ADR%20006%20-%20Dual%20Authoring%20Modes.md)).
- No guardrails/budgets here (runtime concern; [Runtime & Plugin Framework](./architecture%20docs/subsystems/4.%20Runtime%20%26%20Plugin%20Framework.md)).

## Query Lanes & API
- Packages/exports ([Architecture Overview](./Architecture%20Overview.md) — Query Lanes; [Runtime & Plugin Framework](./architecture%20docs/subsystems/4.%20Runtime%20%26%20Plugin%20Framework.md)):
  - `@prisma/sql`: `sql`, `schema`
  - `@prisma/orm`: `orm`
  - `@prisma/runtime`: `createRuntime`, `lints`, `budgets`, `telemetry`
- Memoized app surface (`src/prisma/dsl.ts`):
  - `import contract from './contract.json'`
  - `export const root = sql(contract)`
  - `export const t = schema(contract).tables`   // unqualified: `t.user`
  - `export const query = orm(root)`
- Builders are explicit; all lanes call `.build()` to produce immutable Plans ([ADR 011](./architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md), [ADR 002](./architecture%20docs/adrs/ADR%20002%20-%20Plans%20are%20Immutable.md)).
- Results: `AsyncIterable<Row>` by default ([ADR 124](./architecture%20docs/adrs/ADR%20124%20-%20Unified%20Async%20Iterable%20Execution%20Surface.md)/[ADR 125](./architecture%20docs/adrs/ADR%20125%20-%20Execution%20Mode%20Selection%20%26%20Streaming%20Semantics.md)).

### SQL Lane
- Core relational builder (select, where eq/and/or, joins, orderBy, limit, aggregates)
- Relation traversal across named tables (Query Lanes; [Adapters & Targets](./architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md) for lowering decisions)

### ORM Lane (thin reshape layer)
- Same relational capabilities as SQL lane
- Traversal 1:N, N:1
- Default per‑relation limit 100 and order `createdAt desc` (fallback PK desc); overridable via chained options on relation selection
- Runtime reshapes joined rows to nested objects according to Plan projection ([Runtime & Plugin Framework](./architecture%20docs/subsystems/4.%20Runtime%20%26%20Plugin%20Framework.md) — Execution Pipeline)

### Raw SQL Lane
- Tagged literal: `root.raw\`select * from "user" where id = ${id}\`` ([ADR 012 — Raw SQL Escape Hatch](./architecture%20docs/adrs/ADR%20012%20-%20Raw%20SQL%20Escape%20Hatch.md))
- Function form: `root.raw(text, { params, refs?, annotations? })` ([ADR 018 — Plan Annotations Schema](./architecture%20docs/adrs/ADR%20018%20-%20Plan%20Annotations%20Schema.md))
- Lints/budgets apply consistently across lanes ([ADR 022](./architecture%20docs/adrs/ADR%20022%20-%20Lint%20Rule%20Taxonomy.md)/[ADR 023](./architecture%20docs/adrs/ADR%20023%20-%20Budget%20Evaluation.md)):
  - Built‑in best‑effort: `no-select-star`, `no-missing-limit`
  - Require `refs` to enable: `no-unindexed-predicate`, `read-only-mutation`

## Plan & Runtime
- Plan.meta (MVP): `{ target, coreHash, profileHash?, lane, refs{tables, columns[{table,column}]}, projection, annotations }` ([ADR 011](./architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md), [ADR 018](./architecture%20docs/adrs/ADR%20018%20-%20Plan%20Annotations%20Schema.md)).
- Runtime verification mode: `onFirstUse` by default (construction has no side‑effects); explicit `runtime.verify()` throws `CONTRACT.MARKER_MISMATCH` ([ADR 021](./architecture%20docs/adrs/ADR%20021%20-%20Contract%20Marker%20Storage.md)).
- Plugins enabled in example runtime ([Runtime & Plugin Framework](./architecture%20docs/subsystems/4.%20Runtime%20%26%20Plugin%20Framework.md)):
  - `lints` (mode strict; [ADR 022](./architecture%20docs/adrs/ADR%20022%20-%20Lint%20Rule%20Taxonomy.md))
  - `budgets` (rows 10_000 error; latency 1_000 ms warn; [ADR 023](./architecture%20docs/adrs/ADR%20023%20-%20Budget%20Evaluation.md))
- Pre‑exec heuristics (before execution):
  - Any SELECT without LIMIT is treated as over row budget (policy decides error/warn) ([ADR 023](./architecture%20docs/adrs/ADR%20023%20-%20Budget%20Evaluation.md))
  - Optional EXPLAIN (no ANALYZE) can refine estimates when enabled ([ADR 115 — Extension guardrails & EXPLAIN policies](./architecture%20docs/adrs/ADR%20115%20-%20Extension%20guardrails%20%26%20EXPLAIN%20policies.md))
- Table size heuristics input:
  - `{ defaultTableRows: 10_000, tableRows: { user: 10_000, post: 50_000, purchase: 25_000 } }`

## Guardrails & Budgets
- Lint Rule Taxonomy ([ADR 022](./architecture%20docs/adrs/ADR%20022%20-%20Lint%20Rule%20Taxonomy.md)):
  - `no-select-star: error`
  - `mutation-requires-where: error`
  - `no-missing-limit: warn`
  - `no-unindexed-predicate: warn`
  - `read-only-mutation: error` (extension of v1 set for MVP)
- Budgets ([ADR 023](./architecture%20docs/adrs/ADR%20023%20-%20Budget%20Evaluation.md)):
  - `row-count-budget`: error at 10_000
  - `latency-budget`: warn at 1_000 ms
- Error envelope ([ADR 027](./architecture%20docs/adrs/ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md)): `RuntimeError` with stable codes/categories (PLAN/RUNTIME/ADAPTER/BUDGET/LINT/MIGRATION/PREFLIGHT/CONTRACT/CONFIG).

## Migrations & Preflight
- Scope for the two‑week spike: additive local migrations only; rename/drop, SQL escape hatch within migrations, and PPg preflight as a service are out of scope for the spike
- [Migration System](./architecture%20docs/subsystems/7.%20Migration%20System.md) with ADRs: [001](./architecture%20docs/adrs/ADR%20001%20-%20Migrations%20as%20Edges.md), [021](./architecture%20docs/adrs/ADR%20021%20-%20Contract%20Marker%20Storage.md), [028](./architecture%20docs/adrs/ADR%20028%20-%20Migration%20Structure%20%26%20Operations.md), [029](./architecture%20docs/adrs/ADR%20029%20-%20Shadow%20DB%20preflight%20semantics.md), [037](./architecture%20docs/adrs/ADR%20037%20-%20Transactional%20DDL%20Fallback.md), [038](./architecture%20docs/adrs/ADR%20038%20-%20Operation%20idempotency%20classification%20%26%20enforcement.md), [039](./architecture%20docs/adrs/ADR%20039%20-%20DAG%20path%20resolution%20%26%20integrity.md), [044](./architecture%20docs/adrs/ADR%20044%20-%20Pre%20%26%20post%20check%20vocabulary%20v1.md), [051](./architecture%20docs/adrs/ADR%20051%20-%20PPg%20preflight-as-a-service%20contract.md), [102](./architecture%20docs/adrs/ADR%20102%20-%20Squash-first%20policy%20%26%20squash%20advisor.md).
- Directory: `examples/workflows-demo/migrations/`; name pattern `YYYYMMDDThhmm_snake_case` ([ADR 009](./architecture%20docs/adrs/ADR%20009%20-%20Deterministic%20Naming%20Scheme.md)).
- CLI (default config from `prisma-next.config.ts`):
  - `emit`, `verify contract`, `verify db`, `diff` ([Contract Emitter & Types](./architecture%20docs/subsystems/2.%20Contract%20Emitter%20%26%20Types.md); [Data Contract](./architecture%20docs/subsystems/1.%20Data%20Contract.md))
  - `migration plan`, `migration verify`, `migration apply` ([ADR 001](./architecture%20docs/adrs/ADR%20001%20-%20Migrations%20as%20Edges.md)/[ADR 028](./architecture%20docs/adrs/ADR%20028%20-%20Migration%20Structure%20%26%20Operations.md)/[ADR 044](./architecture%20docs/adrs/ADR%20044%20-%20Pre%20%26%20post%20check%20vocabulary%20v1.md))
  - `preflight` (default mode: shadow) ([ADR 029](./architecture%20docs/adrs/ADR%20029%20-%20Shadow%20DB%20preflight%20semantics.md))
- Edges are deterministic JSON with ops + pre/post checks; idempotency enforced ([ADR 038](./architecture%20docs/adrs/ADR%20038%20-%20Operation%20idempotency%20classification%20%26%20enforcement.md)).
- Contract marker/ledger managed per [ADR 021](./architecture%20docs/adrs/ADR%20021%20-%20Contract%20Marker%20Storage.md); drift detection per [ADR 123](./architecture%20docs/adrs/ADR%20123%20-%20Drift%20Detection,%20Recovery%20%26%20Reconciliation.md).

## Seed Data (esbuild‑runner `esr`)
- Idempotent top‑up to targets: users 10k, posts 50k, purchases 25k.
- Deterministic when `--seed` provided.

## Tests & Automation
- Test runner: Vitest single‑threaded (`threads: false`).
  - Global `testTimeout: 1000`; suites that start prisma dev/seed override to ~15s.
- Typecheck tests: `tsd` (Type helpers largely tested in packages; example app includes minimal tests).
- Local DB orchestration: `@prisma/dev` programmatic API to start/stop prisma dev per workflow test; set `process.env.DATABASE_URL`; run seed via `esr`.
- Drizzle harness: drizzle‑orm + pg (no drizzle‑kit), inline schema; run equivalent queries; record lack of diagnostics (non‑gating). Use harness side‑by‑side in the safety demo to contrast PN’s budgets‑based unbounded read block

## CI — GitHub Actions
- Optional supportive infra for the spike: a CI required check is a GitHub status check that must pass for merges and can fail on error‑severity envelopes from PN’s error taxonomy. It is supportive evidence for quality but not a spike exit criterion
- Trigger: `pull_request` → main.
- Required check name: `Prisma Next Workflows`.
- Node: 20.x.
- Behavior:
  - Runs emit/verify, migration plan/verify/preflight/apply (where applicable), runtime workflow tests, and Drizzle comparison.
  - Fails on any error‑severity envelope ([ADR 027](./architecture%20docs/adrs/ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md)); Drizzle comparison recorded but non‑gating.
  - Posts a PR comment table: `Workflow | PN outcome (codes) | Drizzle outcome | Time to first feedback (ms) | Notes`.

## Workflow Cases (concrete) with Codes
- Typecheck feedback: select nonexistent column `t.user.nonexistent` → compile‑time failure (tsd), no runtime envelope.
- Guardrail feedback: unbounded `select id from post` → `LINT.NO_LIMIT` (warn) → fix adds `LIMIT` ([ADR 022](./architecture%20docs/adrs/ADR%20022%20-%20Lint%20Rule%20Taxonomy.md)).
- Read‑only mutation: attempt INSERT into `active_users` view → `LINT.READ_ONLY_MUTATION` (error) ([ADR 022](./architecture%20docs/adrs/ADR%20022%20-%20Lint%20Rule%20Taxonomy.md); [ADR 127 — Views as extension-owned read-only sources](./architecture%20docs/adrs/ADR%20127%20-%20Views%20as%20extension-owned%20read-only%20sources.md)).
- Unindexed predicate: `select id from purchase where user_id = $1` → `LINT.UNINDEXED_PREDICATE` (warn) ([ADR 022](./architecture%20docs/adrs/ADR%20022%20-%20Lint%20Rule%20Taxonomy.md)).
- Budgets pre‑exec: `select * from user` (no LIMIT) → `BUDGET.ROWS_EXCEEDED` (error via heuristic) ([ADR 023](./architecture%20docs/adrs/ADR%20023%20-%20Budget%20Evaluation.md)).
- Budgets post‑exec: `select pg_sleep(1.5)` in raw lane → `BUDGET.TIME_EXCEEDED` (warn) ([ADR 023](./architecture%20docs/adrs/ADR%20023%20-%20Budget%20Evaluation.md)).
- Faulty migration preflight: add non‑null `User.status` without default → `MIGRATION.PRECHECK_FAILED` (error) ([ADR 044](./architecture%20docs/adrs/ADR%20044%20-%20Pre%20%26%20post%20check%20vocabulary%20v1.md)/[ADR 029](./architecture%20docs/adrs/ADR%20029%20-%20Shadow%20DB%20preflight%20semantics.md)).
- Custom migration verify failure: add FK `purchase(user_id)` without supporting index → `MIGRATION.POSTCHECK_FAILED` (error) ([ADR 028](./architecture%20docs/adrs/ADR%20028%20-%20Migration%20Structure%20%26%20Operations.md)/[ADR 044](./architecture%20docs/adrs/ADR%20044%20-%20Pre%20%26%20post%20check%20vocabulary%20v1.md)).
- Contract drift: edit PSL (Vite emits new contract); call `runtime.verify()` or first execute → `CONTRACT.MARKER_MISMATCH` (error) ([ADR 021](./architecture%20docs/adrs/ADR%20021%20-%20Contract%20Marker%20Storage.md)/[ADR 123](./architecture%20docs/adrs/ADR%20123%20-%20Drift%20Detection,%20Recovery%20%26%20Reconciliation.md)).
- Drizzle comparison: replicate unbounded select & read‑only mutation; expect no diagnostics; non‑gating.

## Open/Deferred (post‑MVP)
- Raw SQL lane: deeper parse for refs without caller hints ([ADR 019 — TypedSQL as Separate CLI](./architecture%20docs/adrs/ADR%20019%20-%20TypedSQL%20as%20Separate%20CLI.md) is out of scope for MVP).
- Additional lints (cartesian joins, PII policies), TypedSQL lane, richer telemetry sinks ([ADR 024](./architecture%20docs/adrs/ADR%20024%20-%20Telemetry%20Schema.md)).
- Multi‑adapter support; rename/drop planning hints ([ADR 028](./architecture%20docs/adrs/ADR%20028%20-%20Migration%20Structure%20%26%20Operations.md) extensions; [ADR 116 — Extension‑aware migration ops](./architecture%20docs/adrs/ADR%20116%20-%20Extension-aware%20migration%20ops.md)).

## Two‑axis plan (brief)
- Compatibility + Functionality: start with a minimal P0 example app and prove import‑swap to PN; expand the app’s feature set and prove porting at each step so functionality and compatibility advance together
- Exposure: widen the audience as capability grows — insiders conversations → insider demos → new‑app scaffolding → Prisma 8 prerelease → Prisma 8

## Value delivery checkpoints (brief)
- Can port an example app (import‑swap, zero query edits), with guardrails and `pgvector` in demo
- Can scaffold a new PN + PPg app (CRUD + vector) with guardrails and CI checks
- Cohort A can port via import‑swap across common read paths; additive migrations locally
- External adapters begin to land (new SQL target; Mongo initiated externally)
