# Recommendations

## Observations
- Placeholder package; `src/index.ts` exports nothing while the real DSL remains in `@prisma-next/sql-query`.
- No tests or docs exist for the future home of the relational DSL.

## Suggested Actions
- Move `sql.ts`, raw lane helpers, and AST lowering utilities into this package and wire up exports per Slice 4.
- Add unit tests for query builder DSL operations once the code is in place.

