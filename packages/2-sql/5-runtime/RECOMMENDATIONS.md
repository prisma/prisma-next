# Recommendations

## Observations
- Despite the README claiming there are unit tests for context creation, codec validation, and runtime execution, the package currently contains only a `test/utils.ts` helper file—no `.test.ts` files verify those flows.
- The runtime surface exposes plugins, codec validators, and marker helpers, but there is no documentation showing how to compose them (when to call `validateCodecRegistryCompleteness`, how to plug budgets/lints, etc.).
- Consumers have to replicate runtime context creation logic because no exported helper in this package encapsulates the canonical wiring of adapter + driver + extensions.

## Suggested Actions
- Add focused tests in this package that exercise `createRuntimeContext`, `createRuntime`, plugin lifecycle (before/on/after hooks), codec validation, and marker statement generation so regressions in the SQL runtime are caught here.
- Document the runtime composition pattern (adapter + driver + extension packs + verification options) and call out the recommended plugin lifecycle so new contributors know how to extend it.
- Provide a helper in this package that wires the canonical context/adapter/driver trio so integration tests and consumers don’t need to duplicate that logic.
