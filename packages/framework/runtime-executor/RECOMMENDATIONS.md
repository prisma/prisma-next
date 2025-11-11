# Recommendations

## Observations
- The only test in this package (`mock-family.test.ts`) exercises plan validation and a simple plugin life-cycle, but nothing covers marker verification (`requireMarker`), telemetry recording, or plugin failures.
- The README mentions considering an `Executor` class as part of Slice 17, yet the package currently exposes only the functional `createRuntimeCore`, which is harder to mock or extend.
- There is no documentation showing the expected lifecycle of a `RuntimeFamilyAdapter`, so implementers are left to infer when `validatePlan`, `markerReader`, and telemetry hooks are invoked.

## Suggested Actions
- Add tests that exercise marker verification (marker mismatch), telemetry metadata (fingerprint/lane/outcome), and plugin error handling so these runtime concerns stay covered in the core package.
- Implement or expose an `Executor` wrapper that keeps telemetry/context state alongside the runtime core to match the API hinted at in the README.
- Document the adapter lifecycle, including when each method is called, what the contract looks like, and how to plug budgets/lints so new family runtimes can implement `RuntimeFamilyAdapter` consistently.
