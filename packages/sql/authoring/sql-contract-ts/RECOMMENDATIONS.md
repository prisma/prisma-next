# Recommendations

## Observations
- `src/contract-builder.ts` is ~500 lines and still hand-rolls builder orchestration, normalization, and storage mapping while relying on `Mutable` plus casts to keep TypeScript happy, which makes each change risky.
- The validation helpers (`validateContractStructure`, `validateContractLogic`) throw plain `Error` instances built from concatenated messages, so CLIs or runtimes cannot react with stable diagnostics or partner hints.
- The test suite validates normalization and logical paths, but there are no `.test-d.ts` regression checks that pin the public inference surface produced by `defineContract` (codec types, extensions, capabilities, etc.).

## Suggested Actions
- Break the builder into focused modules (normalization, mapping, column helpers) so the SQL layer can reuse smaller pieces and we can drop the `Mutable`/`as` juggling that currently saturates `contract-builder.ts`.
- Wrap validation failures in structured diagnostics (e.g., `planInvalid`/`planUnsupported`) that carry codes, hints, and docs so the CLI/runtime can present actionable errors instead of unstructured strings.
- Add TypeScript inference regression tests (`*.test-d.ts`) that assert the exported API (builders, `Contract` shape) stays stable when new fields or extensions are introduced.
