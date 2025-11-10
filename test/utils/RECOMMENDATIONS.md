# Recommendations

## Observations
- Only `src/timeouts.ts` exists; other reusable helpers live inside individual test suites, causing duplication.
- No tests ensure these utilities behave correctly in ESM contexts.

## Suggested Actions
- Add shared helpers for spinning up runtimes/adapters/contracts so integration/e2e suites stop copy/pasting setup code.
- Create tests (or d.ts smoke tests) to ensure these utilities remain ESM-friendly.

