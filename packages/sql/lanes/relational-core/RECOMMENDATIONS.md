# Recommendations

## Observations
- `schema.ts` still imports `RuntimeContext` (see TODO at top), so the extraction from runtime is incomplete.
- `operations-registry.ts` duplicates logic that should live in `@prisma-next/operations`.
- Package lacks documentation explaining how to consume the exported table/column proxies.

## Suggested Actions
- Replace the `RuntimeContext` dependency with a minimal interface so this package no longer reaches into runtime once Slice 6 lands.
- Swap the local operations registry for the shared `@prisma-next/operations` helpers when Slice 5 is done.
- Add a README describing how to build a schema from this package (tables, columns, params, operations).

