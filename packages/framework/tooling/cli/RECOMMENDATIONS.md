# Recommendations

## Observations
- `src/load-ts-contract.ts` (~230 LOC) combines bundling, allowlist enforcement, JSON serialization, and temp-file management in a single module.
- Command handlers duplicate option parsing/validation logic because there is no shared helper or schema definition.
- Few tests cover failure scenarios (esbuild errors, disallowed imports, impure exports).

## Suggested Actions
- Refactor `load-ts-contract.ts` into smaller modules (allowlist plugin, bundler wrapper, purity validator) and unit-test each piece.
- Introduce a shared command/option parser (zod/yargs) to eliminate duplicated flag validation across commands.
- Add CLI integration tests asserting disallowed imports fail with actionable errors and bundler failures surface the esbuild diagnostics.

