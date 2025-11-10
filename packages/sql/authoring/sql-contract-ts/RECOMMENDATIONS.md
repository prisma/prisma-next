# Recommendations

## Observations
- `src/contract-builder.ts` is ~500 lines and intertwines builder orchestration, normalization, and schema emission.
- The implementation relies on `Mutable` + multiple `as` casts instead of using the target-agnostic core directly.
- Tests cover only normalization success paths; there are no failure-mode tests or d.ts smoke tests.

## Suggested Actions
- Leverage `@prisma-next/contract-authoring` so SQL-specific code only defines storage/model adapters, reducing duplication.
- Extract normalization helpers into their own module so they can be unit-tested and reused by other targets.
- Add negative tests (missing target, invalid column types, mismatched relations) and type tests to lock inference behavior.

