# Recommendations

## Observations
- `PostgresDriverImpl` mixes connection acquisition, cursor streaming, buffered fallback, and pooling management in one class, which makes it hard to test the streaming path independently of the buffered fallback path.
- The driver exposes options like `cursorDisabled` and `batchSize`, but there is no documentation or targeted test proving that those options behave as expected.
- Errors from `pg` are rethrown verbatim; there is no translation layer that wraps them in consistent runtime error codes or safe telemetry values.

## Suggested Actions
- Split the driver into focused helpers (client acquisition, cursor executor, buffered executor) and add unit tests for each path, including explicit coverage for when cursor execution fails and when `cursorDisabled` is true.
- Document the available options (`cursorDisabled`, `batchSize`, `poolFactory`) and add tests that assert the driver honors them, making the behavior explicit for runtime integrators.
- Introduce an error wrapper/mapping so driver errors are normalized (e.g., network timeout vs. query error) before bubbling up to the runtime, and add regression tests for the most common Postgres error codes.
