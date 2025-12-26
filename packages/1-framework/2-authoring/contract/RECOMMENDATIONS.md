# Recommendations

## Observations
- `TableBuilder.unique`, `.index`, and `.foreignKey` are no-ops—they return the builder instance but never record the constraint metadata, so storage state loses all uniqueness/index/foreign key information.
- The corresponding tests only verify that the methods are callable, not that they mutate the builder state, so the missing functionality has gone unnoticed.
- Many of the error cases in the builder classes still throw raw `Error`s instead of structured diagnostics, which makes it harder for consumers to react programmatically.

## Suggested Actions
- Implement state tracking for uniques, indexes, and foreign keys so that `build()` returns tables with those arrays populated and consumers can rely on the metadata.
- Add regression tests that assert the constraint arrays actually appear in the built table state and that invalid inputs (missing columns, duplicate names) throw structured errors.
- Replace raw `Error` throws with the `planInvalid` helpers (or similar) so downstream runtimes can inspect the error codes/hints.
