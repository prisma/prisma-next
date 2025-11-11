# Recommendations

## Observations
- The suite spins up a single dev Postgres instance (with fixed port ranges) and relies on manual `DROP TABLE`/`CREATE TABLE` calls, which prevents the tests from running in parallel and makes cleanup brittle.
- Fixtures do not automatically reset state, so each test must remember to drop tables and rewrite markers, leading to duplicated cleanup logic.
- The package only tests the SQL runtime surface; there is no abstraction that would allow reusing these end-to-end flows for other lanes or adapters in the future.

## Suggested Actions
- Adopt disposable schemas or ephemeral databases per test (unique schema names or random ports) so the suite can run concurrently without cross-test interference.
- Provide centralized setup/teardown helpers that seed data and clean markers automatically instead of relying on inline `DROP TABLE` calls in every test.
- Abstract runtime/context initialization (adapter + runtime builder + plan execution) so other targets/adapters can plug into the suite without duplicating boilerplate.
