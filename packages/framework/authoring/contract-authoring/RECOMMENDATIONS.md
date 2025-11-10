# Recommendations

## Observations
- `ContractBuilder`/`TableBuilder` depend on pervasive `as` casts when cloning builder state, eroding the compile-time guarantees this package should provide.
- Runtime validation is limited to generic `Error` throws (e.g., `table-builder.ts` checking for `namespace/name@version`), so upstream consumers cannot produce structured diagnostics.
- The tests under `test/` cover only the happy path; there are no negative cases for duplicate table names, invalid relations, or missing targets.

## Suggested Actions
- Shift builder state to immutable data structures with explicit types so TypeScript can enforce invariants without `as`.
- Replace ad-hoc `Error` throws with error helpers (possibly from `@prisma-next/plan`) that carry stable codes and context.
- Expand the test suite with failure scenarios (duplicate tables, invalid relation wiring, missing target/core hash) and add property-based tests for column normalization.

