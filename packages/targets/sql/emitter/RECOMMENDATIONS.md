# Recommendations

## Observations
- Placeholder; SQL emitter hook still lives in `@prisma-next/sql-target`.
- No tests cover hook registration or `.d.ts` generation in the new package.

## Suggested Actions
- Move the SQL emitter hook + tests here and expose a clear entry point for `@prisma-next/emitter`.
- Add tests verifying validation errors, `.d.ts` output, and extension-manifest integration.

