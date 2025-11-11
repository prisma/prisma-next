# Recommendations

## Observations
- `src/adapter.ts` is ~380 LOC that bundles select/insert/update/delete rendering, join/include helpers, operation lowering, and SQL templating in one file, making it hard to test or swap out pieces.
- Although the README promises mapping Postgres errors into `RuntimeError`, the implementation never references `RuntimeError` or any structured error envelopes—everything is thrown as a plain `Error`.
- The current tests focus on SQL generation but don’t cover failure scenarios (driver/network errors) or the error mapping that is expected by the runtime.

## Suggested Actions
- Break the adapter into smaller renderer modules (projection, where, join, include, operation templates) so each chunk can be verified and there is a clear extension point for other dialects.
- Add a `RuntimeError` mapper that inspects Postgres error codes and exposes them with stable codes/hints (per ADR 068), along with unit tests covering at least one common error, like unique-violation.
- Expand the test suite to simulate driver failures/cancelled queries and to verify the generated SQL when capabilities like `returning`/`includeMany` are combined with custom operations.
