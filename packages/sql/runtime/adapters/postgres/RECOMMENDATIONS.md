# Recommendations

## Observations
- `src/adapter.ts` is 374 lines long and mixes plan compilation, telemetry, capability gating, and driver orchestration, which makes the adapter difficult to test in isolation.
- Operation lowering still relies on `as unknown as` casts (e.g., src/adapter.ts:88) that suppress type errors.
- Tests under `test/` skew toward happy paths; failure modes such as connection loss or invalid plan lowering are untested.

## Suggested Actions
- Split the adapter into smaller modules (capabilities, lowering templates, telemetry, Postgres wire helpers) and keep `adapter.ts` as a coordinator.
- Introduce typed helpers for operation lowering so we can remove the `as unknown as` casts and enable stricter lint rules (`no-unsafe-assignment`, `no-explicit-any`).
- Add unit tests that simulate common failures (driver errors, capability mismatch, telemetry exceptions) instead of relying solely on integration suites.

