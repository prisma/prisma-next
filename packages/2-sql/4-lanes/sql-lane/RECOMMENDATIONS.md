# Recommendations

## Observations
- `src/sql/plan.ts` mixes AST construction with metadata/profile assembly (param descriptors, lane annotations, capability tracking), making the plan path harder to reason about and hard to test in isolation.
- The only integration test in this package (`sql-dml.integration.test.ts`) exercises an INSERT with RETURNING; there is no runtime verification for SELECTs, joins, includeMany, or custom operations, so regressions in those flows go unnoticed.
- The README explains responsibilities but does not show how to wire `schema(context)` into `sql({ context })`, which means new consumers have to study the tests to understand how to bootstrap the lane.

## Suggested Actions
- Split the plan builder into focused modules (AST assembly vs. metadata descriptors) so we can unit test each part and keep runtime metadata generation isolated from SQL string lowering.
- Add integration tests that execute other DSL families (SELECT, joins, includeMany, custom operations) through the runtime to ensure the lane produces executable plans across features.
- Add a getting-started example to the README that walks through creating a context, deriving `schema(context)`, and building a simple `sql({ context })` plan (including `param()` usage) so new adopters can boot strap quickly.
