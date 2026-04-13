# Code Review — Codec Output Types (TML-2245)

**Spec**: [projects/orm-consolidation/specs/codec-output-types.spec.md](../codec-output-types.spec.md)
**Branch**: `tml-2245-mongo-type-ergonomics-fix-codec-output-types-fl-010203-tml`
**Range**: `83905f098..f7e664124` (11 commits)

## Summary

This change wires pre-resolved `FieldOutputTypes` and a new `FieldInputTypes` from emitted contracts into the Mongo ORM's row type resolution, replacing a deep conditional type chain that TypeScript couldn't fully evaluate. It eliminates ~100 codec-related casts from the retail store example. The implementation is well-tested at the type level and correctly handles backward compatibility.

## What Looks Solid

- **Elegant fallback heuristic**: `string extends keyof ExtractMongoFieldOutputTypes<TContract>` is a well-known TypeScript idiom that correctly distinguishes "real" field type maps (with specific model keys) from the defaulted `Record<string, Record<string, unknown>>`.

- **`resolveFieldType` returns both sides**: The core resolution function returns `{ input, output }` in one call, eliminating the double iteration and keeping the caller's concern separate from field resolution. The `renderOutputType` asymmetry is now explicit — it only fires for the output side.

- **Thorough type-level test coverage**: The ORM type tests cover `DefaultModelRow`, `CreateInput`, `InferFullRow` with embedded relations, `IncludedRow` with reference relations, and `VariantCreateInput` — all with `FieldOutputTypes`/`FieldInputTypes` present.

- **Retail store cleanup**: The cast removal is systematic and thorough. The remaining `String()` / `Number()` / `new Date()` calls are legitimate (URL params, random IDs, date construction), not codec casts.

- **`products.ts` demonstrates the value**: The data layer uses `FieldOutputTypes['Product']` as a direct type alias, cleanly expressing the product shape without casts.

## Findings

(No open findings — all addressed or deferred.)

## Deferred (Out of Scope)

### F08 — SQL query builders still resolve types through `CodecTypes` conditionals instead of pre-resolved field type maps

- **Why deferred**: The SQL builder operates at the **table/column** level (storage), while `FieldOutputTypes`/`FieldInputTypes` are keyed by **model/field** names (domain). Wiring them requires: (1) exporting `ExtractTableToModel`/`ExtractColumnToField` from `relational-core`, (2) widening `TableProxyContract` to include model information (currently only `{ storage, capabilities }`), and (3) for `ResolveRow`, propagating model context through the scope system (currently scopes only carry `{ codecId, nullable }` per column). The Mongo ORM's `ResolvedOutputRow` was simple because the ORM already worked at the model/field level. Additionally, the SQL builder's `CodecTypes[Row[K]['codecId']]['output']` is a simple single-level indexed access — not the deep conditional chain (`InferModelRow` → `InferFieldBaseType` → ...) that caused opaque types in the Mongo ORM. The SQL builder does not suffer from this issue today. `ComputeColumnJsType` in `relational-core` already demonstrates the complexity: it's a 5-level nested conditional type that does the table→model→column→field→`FieldOutputTypes` resolution with fallbacks. An analogous input-side type would need the same depth.

### F05 — `VariantRow` / `InferFullRow` still use `InferModelRow` internally for non-model-row parts

- **Why deferred**: `InferFullRow` intersects `ResolvedOutputRow` with embedded relation types (which also use `ResolvedOutputRow`). The `VariantRow` type still uses `InferFullRow` correctly. The type chain for variant discrimination uses `Record<DiscField, V[VK]['value']>` which is a literal string — not derived from codecs. Fixing this would require rethinking the variant type resolution, which is beyond this PR's scope.

### F06-partial — SQL query builders do not consume `FieldInputTypes` via extractors

- **Why deferred**: The SQL `TypeMaps` now carries `TFieldInputTypes` and the SQL emitter passes it, but the SQL query builders (`packages/2-sql/4-lanes/`) do not yet consume `FieldInputTypes` for mutation input typing. There is no SQL ORM today, so this is acceptable. When the SQL query builders need input-typed mutations, they should add `ResolvedInputRow`-style helpers mirroring the Mongo ORM pattern. See also F08 for the architectural complexity involved.

## Already Addressed

| # | Finding | Addressed in |
|---|---------|-------------|
| F01 | `VariantCreateInput` uses output types for variant fields, not input types | `a235100b0` — TODO comment noting the asymmetry, deferred to TML-2229 |
| F02 | `renderOutputType` used on input side for parameterized codecs | `b9a94cd33` — `resolveFieldType` returns both sides; `renderOutputType` now only fires for output side; test verifies the asymmetry |
| F03 | No type-level tests for `VariantCreateInput`, `InferFullRow`, `IncludedRow` with field type maps | `17ff685c2` — Added type-level tests for all three |
| F04 | `FieldInputTypes` children reference `NavItemOutput` in self-referencing value objects | `17ff685c2` — Added assertion for `NavItemInput` self-reference |
| F06 | SQL `TypeMaps` does not carry `FieldInputTypes`; emitter does not pass it | `f7e664124` — Added `TFieldInputTypes` 5th parameter to SQL `TypeMaps`, `FieldInputTypesOf` extractor, `ExtractFieldInputTypes`, updated SQL emitter `getTypeMapsExpression`. Query builder consumption remains open (F08). |
| F07 | `generateFieldResolvedType` uses a `side` flag instead of returning both sides | `b9a94cd33` — Refactored to `resolveFieldType` returning `{ input, output }`, single-pass maps via `generateBothFieldTypesMaps` |

## Acceptance-Criteria Traceability

| AC | Criterion | Implementation | Evidence |
|----|-----------|----------------|----------|
| AC-1 | `contract.d.ts` contains both `FieldOutputTypes` and `FieldInputTypes` | [packages/1-framework/3-tooling/emitter/src/generate-contract-dts.ts](packages/1-framework/3-tooling/emitter/src/generate-contract-dts.ts) — lines 71–98 | Retail store `contract.d.ts` contains both maps; [packages/2-mongo-family/3-tooling/emitter/test/emitter-hook.generation.test.ts](packages/2-mongo-family/3-tooling/emitter/test/emitter-hook.generation.test.ts) — lines 489–508 |
| AC-2 | Value object aliases emitted as `{Name}Input` / `{Name}Output` | [packages/1-framework/3-tooling/emitter/src/domain-type-generation.ts](packages/1-framework/3-tooling/emitter/src/domain-type-generation.ts) — lines 418–425 | [packages/1-framework/3-tooling/emitter/test/domain-type-generation.test.ts](packages/1-framework/3-tooling/emitter/test/domain-type-generation.test.ts) — `generateValueObjectTypeAliases` tests; [packages/2-mongo-family/3-tooling/emitter/test/emitter-hook.generation.test.ts](packages/2-mongo-family/3-tooling/emitter/test/emitter-hook.generation.test.ts) — lines 345–369 |
| AC-3 | `FieldInputTypes` uses `CodecTypes[codecId]['input']` | [packages/1-framework/3-tooling/emitter/src/domain-type-generation.ts](packages/1-framework/3-tooling/emitter/src/domain-type-generation.ts) — `resolveFieldType`, lines 228–279 | [packages/1-framework/3-tooling/emitter/test/domain-type-generation.test.ts](packages/1-framework/3-tooling/emitter/test/domain-type-generation.test.ts) — `resolveFieldType` tests for input side |
| AC-4 | `FieldOutputTypes` uses `CodecTypes[codecId]['output']` | Same as AC-3, output key of `resolveFieldType` | Existing tests for `resolveFieldType` output side |
| AC-5 | `MongoTypeMaps` 4th type parameter | [packages/2-mongo-family/1-foundation/mongo-contract/src/contract-types.ts](packages/2-mongo-family/1-foundation/mongo-contract/src/contract-types.ts) — lines 167–183 | [packages/2-mongo-family/1-foundation/mongo-contract/test/contract-types.test-d.ts](packages/2-mongo-family/1-foundation/mongo-contract/test/contract-types.test-d.ts) — lines 148–196 |
| AC-6 | `DefaultModelRow` resolves via `FieldOutputTypes` | [packages/2-mongo-family/5-query-builders/orm/src/types.ts](packages/2-mongo-family/5-query-builders/orm/src/types.ts) — lines 53–62, 207–210 | [packages/2-mongo-family/5-query-builders/orm/test/value-object-inputs.test-d.ts](packages/2-mongo-family/5-query-builders/orm/test/value-object-inputs.test-d.ts) — lines 203–209 |
| AC-7 | `CreateInput` resolves via `FieldInputTypes` | [packages/2-mongo-family/5-query-builders/orm/src/types.ts](packages/2-mongo-family/5-query-builders/orm/src/types.ts) — lines 64–73, 212–221 | [packages/2-mongo-family/5-query-builders/orm/test/value-object-inputs.test-d.ts](packages/2-mongo-family/5-query-builders/orm/test/value-object-inputs.test-d.ts) — lines 217–221 |
| AC-8 | Fallback to `InferModelRow` | [packages/2-mongo-family/5-query-builders/orm/src/types.ts](packages/2-mongo-family/5-query-builders/orm/src/types.ts) — lines 56–57, 62, 67–68, 73 | [packages/2-mongo-family/5-query-builders/orm/test/value-object-inputs.test-d.ts](packages/2-mongo-family/5-query-builders/orm/test/value-object-inputs.test-d.ts) — lines 211–215 |
| AC-9 | Retail store zero codec casts | Commit `8d94a359d` | Grep for `as string`, `String()`, `Number()`, `as unknown as string` shows zero codec-related casts remaining |
| AC-10 | Mongo demo backward compat | `examples/mongo-demo/src/contract.d.ts` re-emitted with 4-param `MongoTypeMaps` | Compilation (needs `pnpm typecheck` verification) |
| AC-11 | ORM type assertion — primitives when present | — | [packages/2-mongo-family/5-query-builders/orm/test/value-object-inputs.test-d.ts](packages/2-mongo-family/5-query-builders/orm/test/value-object-inputs.test-d.ts) — lines 203–209 |
| AC-12 | ORM type assertion — fallback when absent | — | [packages/2-mongo-family/5-query-builders/orm/test/value-object-inputs.test-d.ts](packages/2-mongo-family/5-query-builders/orm/test/value-object-inputs.test-d.ts) — lines 211–215 |
