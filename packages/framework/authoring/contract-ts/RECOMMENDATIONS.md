# Recommendations

## Observations
- Another placeholder (`src/index.ts` is empty) even though the workspace exposes `@prisma-next/contract-ts`.
- Downstream documentation still mentions this package without clarifying that SQL-specific code lives elsewhere.

## Suggested Actions
- Update the README to explain that this package is reserved for a future target-agnostic TS surface and point contributors to `@prisma-next/sql-contract-ts` for now.
- Add a failing test or TODO to prevent new code from accidentally landing in the stub.

