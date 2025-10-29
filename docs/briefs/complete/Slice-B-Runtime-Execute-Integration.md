# Slice B — Runtime Execute Integration (Postgres)

Objective: Execute a real SELECT against Postgres with contract verification and a production-ready marker write path, while keeping the surface minimal and focused on the authoring loop.

## Scope
- Runtime `execute(plan)` with `onFirstUse` contract verification (no lints/budgets yet)
- Marker helpers are part of `@prisma-next/runtime` (permitted dependency direction): build SQL for ensure schema/table, read, and write (insert/update) per ADR 021
- Postgres driver package `@prisma-next/driver-postgres` (AsyncIterable API, cursor when available)
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
- Marker helpers (in runtime)
  - Export SQL builders: `ensureSchemaStatement`, `ensureTableStatement`, `readContractMarker()`, `writeContractMarker(input)`
  - Portability note: avoid single-statement UPSERT; use read-then-insert or read-then-update pattern for cross-DB support
- New package: `@prisma-next/driver-postgres`
  - `createPostgresDriver({ connectionString })`
  - Methods: `connect()`, `execute({ sql, params }) -> AsyncIterable<Row>`, `explain?({ sql, params })`, `close()`
  - Use cursors when available; otherwise buffer → expose AsyncIterable
- Runtime minimal integration
  - `createRuntime({ contract, adapter, driver, verify: { mode: 'onFirstUse', requireMarker: true } })`
  - `execute(plan)` → verify marker on first use → lower via adapter → stream via driver
  - Structured errors per ADR 027, e.g. `CONTRACT.MARKER_MISSING`, `CONTRACT.MARKER_MISMATCH`
- Example app scaffolding script (exists)
  - `examples/workflows-demo/src/prisma/scripts/stamp-marker.ts` uses runtime marker helpers: ensure schema/table → read → insert or update accordingly

## Test Plan
### Integration (Vitest, prisma dev per test)
1. Start prisma dev (programmatic `@prisma/dev`), create DB
2. Load contract fixture (from Slice A’s static contract)
3. Run `stamp-marker.ts` to write marker with `{ coreHash, profileHash }` via read-then-insert/update
4. Build a simple Plan via Slice A DSL: `from(t.user).select('id','email').limit(5).build()`
5. Runtime execute → collect rows (`toArray()`) → assert row shape and count
6. Drift test: modify contract hash (simulate) → expect `CONTRACT.MARKER_MISMATCH` on next execute

### Unit
- Driver: cursor path and buffered fallback both return AsyncIterable
- Marker SQL helpers: ensure schema/table SQL, read, and write statements are correct; idempotent behavior via test harness
- Runtime: onFirstUse verify gate; error mapping to ADR 027 envelope

## Milestones & Timeline
- M1 Marker SQL helpers stabilized in runtime (done)
- M2 `@prisma-next/driver-postgres` AsyncIterable execute (done)
- M3 Runtime glue (verify on first use; lower+execute) (done)
- M4 Integration tests validate stamp → execute (pending)

## Risks & Mitigations
- Risk: driver cursor support not available → Fallback to buffered results but preserve AsyncIterable API
- Risk: marker schema drift → Helpers ensure schema/table exist and read-before-write avoids UPSERT portability issues
- Risk: capability negotiation needed later → Keep runtime verify minimal now; add negotiation in a later slice

## Acceptance Criteria
- `execute(plan)` performs onFirstUse marker verification and streams results from Postgres
- Marker write path uses ensure schema/table + read-then-insert/update (no single-statement UPSERT)
- Integration test passes end-to-end (prisma dev → stamp → execute SELECT)
- Errors use ADR 027 codes; missing/mismatched marker fails deterministically
