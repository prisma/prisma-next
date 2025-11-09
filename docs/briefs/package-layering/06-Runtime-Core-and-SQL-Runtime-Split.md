## Slice 6 — Runtime Core & SQL Runtime Split

### Context
- Runtime currently lives entirely inside `@prisma-next/runtime` and imports SQL-specific types (`SqlContract`, `SqlStorage`, SQL driver, adapter capability manifests). This violates the ring rule and prevents us from supporting additional target families.
- ADR 140 requires a two-layer runtime:
  - `@prisma-next/runtime-core` (core ring): target-neutral kernel responsible for plan validation, marker verification, plugin lifecycle, telemetry, and the runtime SPI definition.
  - `@prisma-next/sql-runtime` (family runtime): SQL-specific implementation that composes runtime-core with SQL adapters/drivers/codecs.
- This slice also needs a small mock-family smoke test to prove runtime-core can host a non-SQL runtime, even if no other family exists yet.

### Goals
1. **Create `@prisma-next/runtime-core`**
   - Move target-neutral runtime logic from `packages/runtime/src` into `packages/runtime/core/src`:
     - Plan validation (core/profile hash checks).
     - Marker verification (reading/parsing marker rows).
     - Plugin orchestration + telemetry recording.
     - Error envelopes/diagnostics shared across families.
   - Define a runtime SPI interface (e.g., `RuntimeFamilyAdapter`) that family runtimes implement to provide lowering/execution behavior.

2. **Create `@prisma-next/sql-runtime`**
   - Implement the family runtime by composing runtime-core with SQL-specific adapters/drivers/codecs.
   - Wire in `createRuntimeContext` (split into core vs SQL pieces as needed) so contexts can be created without referencing SQL from runtime-core.
   - Ensure all public entry points currently exported from `@prisma-next/runtime` are available from `@prisma-next/sql-runtime`.

3. **Provide transitional exports**
   - Keep `@prisma-next/runtime` as a thin facade that re-exports `@prisma-next/sql-runtime` for now (with TODO for Slice 7).

4. **Add a mock-family smoke test**
   - Inside runtime-core’s test suite, build a tiny in-memory family adapter implementing the SPI to prove runtime-core no longer depends on SQL modules.

5. **Update documentation/tests**
   - Architecture Overview + README should describe the new split.
   - All runtime-related tests (unit, integration, e2e) must pass using `@prisma-next/sql-runtime`.

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
1. Scaffold `packages/runtime/core` (package.json/tsconfig/vitest) if not already present from Slice 1. Do the same for `packages/sql/sql-runtime`.
2. Move target-neutral files into runtime-core (`runtime.ts` core pieces, `marker.ts`, plugin orchestration, telemetry helpers, context interfaces).
3. Define the runtime SPI: e.g., interfaces for adapters, driver hooks, codec registries. Ensure runtime-core exposes types used by family runtimes.
4. Implement the SQL runtime by importing runtime-core and wiring in SQL adapters/drivers/codec registries. Ensure `createRuntimeContext` is split (core vs SQL) and exported from the SQL runtime package.
5. Update all imports (CLI, examples, tests) to use `@prisma-next/sql-runtime`.
6. Keep `@prisma-next/runtime` as a facade: re-export SQL runtime APIs and add TODOs for Slice 7.
7. Add the mock-family smoke test inside runtime-core to prove target neutrality.
8. Run all relevant tests (unit, integration, e2e) and lint/typecheck/dependency checks.

### Testing / Verification
- `pnpm --filter @prisma-next/runtime-core test` (includes the mock-family smoke test)
- `pnpm --filter @prisma-next/sql-runtime test`
- `pnpm --filter @prisma-next/runtime test` (if transitional facade remains)
- `pnpm --filter @prisma-next/e2e-tests test`
- `pnpm lint`, `pnpm lint:deps`, `pnpm typecheck`

### Notes
- Keep capability verification + codec registry validation in the SQL runtime unless/until other families implement equivalents.
- Document any temporary re-exports for removal in Slice 7.
