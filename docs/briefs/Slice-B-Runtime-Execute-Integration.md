# Slice B — Runtime Execute Integration (Postgres)

Objective: Execute a real SELECT against Postgres with contract verification and a production-ready marker upsert, while keeping the surface minimal and focused on the authoring loop.

## Scope
- Runtime `execute(plan)` with `onFirstUse` contract verification (no lints/budgets yet)
- Marker helper package `@prisma/marker` (production-ready upsert/read per ADR 021)
- Postgres driver package `@prisma/driver-postgres` (AsyncIterable API, cursor when available)
- Scaffolding script to stamp marker (for dev/CI only), not shipped as a public product feature
- Integration tests using `prisma dev` that stamp → execute → stream rows

Out of scope (future slices): plugins (lints/budgets/telemetry), joins, ORM reshape, migrations.

## References
- [MVP Spec](../MVP-Spec.md)
- [Architecture Overview](../Architecture%20Overview.md)
- [Runtime & Plugin Framework](../architecture%20docs/subsystems/4.%20Runtime%20%26%20Plugin%20Framework.md)
- [Adapters & Targets](../architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md)
- [ADR 021 — Contract Marker Storage](../architecture%20docs/adrs/ADR%20021%20-%20Contract%20Marker%20Storage.md)
- [ADR 027 — Error Envelope & Stable Codes](../architecture%20docs/adrs/ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md)
- [ADR 124 — Unified Async Iterable Execution Surface](../architecture%20docs/adrs/ADR%20124%20-%20Unified%20Async%20Iterable%20Execution%20Surface.md)
- [ADR 125 — Execution Mode Selection & Streaming Semantics](../architecture%20docs/adrs/ADR%20125%20-%20Execution%20Mode%20Selection%20%26%20Streaming%20Semantics.md)
- [ADR 065 — Adapter capability schema & negotiation v1](../architecture%20docs/adrs/ADR%20065%20-%20Adapter%20capability%20schema%20%26%20negotiation%20v1.md)

## Deliverables
- New package: `@prisma/marker`
  - `upsertMarker(client, { coreHash, profileHash, contractJson? })`
  - `readMarker(client)`
  - Creates schema/table if missing; UPSERT id=1 per ADR 021
- New package: `@prisma/driver-postgres`
  - `createPostgresDriver({ connectionString })`
  - Methods: `connect()`, `execute({ sql, params }) -> AsyncIterable<Row>`, `explain?({ sql, params })`, `close()`
  - Use cursors when available; otherwise buffer → expose AsyncIterable
- Runtime minimal integration
  - `createRuntime({ contract, adapter, driver, verify: { mode: 'onFirstUse', requireMarker: true } })`
  - `execute(plan)` → verify marker on first use → lower via adapter → stream via driver
  - Structured errors per ADR 027, e.g. `CONTRACT.MARKER_MISSING`, `CONTRACT.MARKER_MISMATCH`
- Example app scaffolding script
  - `examples/workflows-demo/src/prisma/scripts/stamp-marker.ts` (esr) calls `@prisma/marker.upsertMarker`

## Test Plan
### Integration (Vitest, prisma dev per test)
1. Start prisma dev (programmatic `@prisma/dev`), create DB
2. Emit/load contract fixture (from Slice A’s static contract)
3. Run `stamp-marker.ts` to upsert marker with `{ coreHash, profileHash }`
4. Build a simple Plan via Slice A DSL: `from(t.user).select('id','email').limit(5).build()`
5. Runtime execute → collect rows (`toArray()`) → assert row shape and count
6. Drift test: modify contract hash (simulate) → expect `CONTRACT.MARKER_MISMATCH` on next execute

### Unit
- Driver: cursor path and buffered fallback both return AsyncIterable
- Marker helper: create schema/table if missing; UPSERT idempotency
- Runtime: onFirstUse verify gate; error mapping to ADR 027 envelope

## Milestones & Timeline
- M1 `@prisma/marker` helper and tests (2d)
- M2 `@prisma/driver-postgres` AsyncIterable execute (3d)
- M3 Runtime glue (verify on first use; lower+execute) (2d)
- M4 Integration tests + stamp script (2d)

## Risks & Mitigations
- Risk: driver cursor support not available → Fallback to buffered results but preserve AsyncIterable API
- Risk: marker schema drift → Helper ensures schema/table exist and uses UPSERT per ADR 021
- Risk: capability negotiation needed later → Keep runtime verify minimal now; add negotiation in a later slice

## Acceptance Criteria
- `execute(plan)` performs onFirstUse marker verification and streams results from Postgres
- Marker helper creates schema/table and idempotently stamps `{ coreHash, profileHash }`
- Integration test passes end-to-end (prisma dev → stamp → execute SELECT)
- Errors use ADR 027 codes; missing/mismatched marker fails deterministically
