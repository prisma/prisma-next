# Recommendations

## Observations
- `loadContractFromTs` bundles esbuild, import allowlisting, purity validation, temporary file management, and module loading all in one file, which makes it hard to unit-test the individual responsibilities.
- The emit command performs manual option resolution and path normalization inside the handler instead of validating options through a shared schema, so extending the CLI means duplicating parsing logic.
- There are no integration tests showing how CLI failures (disallowed imports, bundler errors, missing adapters/extensions) are surfaced to users.

## Suggested Actions
- Split `loadContractFromTs` into smaller utilities (bundle/allowlist plugin, purity checker, module loader, cleanup helper) so each piece can be tested and reused by other loaders.
- Introduce a shared validation schema (e.g., zod) for command options so the emit handler can reuse the same parsing logic and automatically reject invalid combinations.
- Add CLI integration tests that simulate disallowed imports, bundler failures, and missing extension/adapters so the CLI messaging stays helpful as we evolve the toolchain.
