# Recommendations

## Observations
- Suites depend on a shared real database, so tests cannot run in parallel and occasionally interfere with each other.
- Fixtures under `test/fixtures` don’t reset state automatically, leaving manual cleanup to contributors.
- Only the SQL target is exercised; there’s no abstraction for future targets.

## Suggested Actions
- Adopt disposable schemas or provisioned Docker containers per test run to isolate state.
- Add setup/teardown helpers that seed the database and clean up automatically.
- Abstract adapter/runtime bootstrapping so additional targets can plug into the same suite later.

