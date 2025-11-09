## Slice 6 — Runtime Core & SQL Runtime Split

### Context
- Runtime currently lives in `@prisma-next/runtime` and depends directly on SQL types (`SqlContract`, `SqlStorage`, SQL driver).
- ADR 140 calls for a target-neutral runtime core with family runtimes plugging in via an SPI.

### Goals
1. Extract the plan verification + plugin lifecycle + telemetry kernel into `@prisma-next/runtime-core`.
2. Implement an SQL-specific runtime package (`@prisma-next/sql-runtime`) that satisfies the core SPI by wiring in SQL adapters, codecs, and drivers.
3. Update existing runtime consumers/tests to instantiate the SQL runtime via the new interface.
4. Ensure runtime context creation (`createRuntimeContext`) is split appropriately (core vs SQL-specific pieces).
5. Add a lightweight smoke test (could live in runtime-core tests) that wires a mock/non-SQL family into `runtime-core` to prove the SPI works without SQL dependencies.
6. Maintain current runtime behavior and test coverage; no new features.

### Non-goals
- Changing adapter SPI semantics (covered already in ADR 016).
- Refactoring codec/operation registries beyond moving them to the appropriate packages from Slice 5.
- Removing the legacy `@prisma-next/runtime` package yet—provide a transitional re-export if necessary until Slice 7.

### Deliverables
- `@prisma-next/runtime-core` package exporting the SPI + shared utilities.
- `@prisma-next/sql-runtime` package implementing the SPI and providing the public runtime entrypoint for SQL.
- Updated tests (integration + e2e) pointing to the SQL runtime.
- Documentation snippet (Architecture Overview, README) noting the new split.

### Step Outline
1. Move target-agnostic runtime logic (plan validation, marker checks, plugin orchestration) into runtime-core.
2. Create SQL runtime package that composes runtime-core with SQL adapters/drivers.
3. Update `createRuntimeContext` and related helpers to live with runtime-core (or SQL runtime) as appropriate.
4. Adjust all imports; provide transitional exports from `@prisma-next/runtime` if needed.
5. Run runtime unit tests, integration tests, and e2e suites.

### Testing / Verification
- `pnpm --filter @prisma-next/runtime-core test` (including the mock-family smoke test)
- `pnpm --filter @prisma-next/sql-runtime test`
- `pnpm --filter @prisma-next/runtime test` (if transitional package remains)
- `pnpm --filter @prisma-next/e2e-tests test`

### Notes
- Keep capability verification + codec registry validation in the SQL runtime unless/until other families implement equivalents.
- Document any temporary re-exports for removal in Slice 7.
