# Recommendations

## Observations
- `src/runtime.ts` still imports SQL-specific types (`SqlContract`, `SqlDriver`), violating the ring boundary.
- The file is large and interleaves plan validation, plugin orchestration, telemetry, and adapter wiring.
- Most helper functions lack direct unit tests; coverage depends on integration/e2e suites.

## Suggested Actions
- Move all target-neutral logic into `@prisma-next/runtime-core` and keep this package as a transitional facade until Slice 7.
- Add unit tests for marker validation, telemetry recording, and codec registry checks to catch regressions earlier.
- Enable stricter lint rules (no-floating-promises, explicit function return types) to protect lifecycle code.

