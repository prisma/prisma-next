# Recommendations

## Observations
- The package mostly re-exports errors/types but lacks documentation about when other packages should depend on it.
- No tests verify the error helpers exported through `./exports/errors`.

## Suggested Actions
- Add a README clarifying the scope of `@prisma-next/plan` (shared plan metadata + diagnostics).
- Introduce unit tests for the error helpers so consumers can rely on their semantics.
- Consider moving additional plan-related utilities (currently in runtime) here to keep responsibilities clear.

