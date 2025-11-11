# Recommendations

## Observations
- `test/integration/test` mixes CLI, emitter, runtime, and contract tests in one Vitest project, so failures are hard to triage.
- Fixtures share mutable global state, so parallel test execution is flaky.
- Some tests still import from `@prisma-next/sql-query`, which blocks removal of the legacy package.

## Suggested Actions
- Split the suite into focused folders (CLI, emitter, runtime) with their own Vitest configs for clearer ownership.
- Provide helper utilities to create isolated temp dirs/DB schemas per test to eliminate state bleed.
- Update imports to the new packages now so Slice 7 can delete `@prisma-next/sql-query`.

