# Codec Output Types — Execution Plan

## Summary

Wire `FieldOutputTypes` and a new `FieldInputTypes` from emitted contracts into the Mongo ORM's row type resolution, eliminating ~60 type casts in the retail store. The emitter gains input-side type generation; `MongoTypeMaps` gains a 4th type parameter; the ORM prefers pre-resolved field types over `InferModelRow`; and both example apps are re-emitted.

**Spec:** `projects/orm-consolidation/specs/codec-output-types.spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | William Madden | Drives execution |

## Milestones

### Milestone 1: Emitter generates `FieldInputTypes` and split value object aliases

Deliver the emitter changes that produce `FieldInputTypes` alongside `FieldOutputTypes`, with separate `{Name}Input` / `{Name}Output` value object type aliases. Validate by re-emitting the retail store and mongo-demo contracts and inspecting the generated `contract.d.ts`.

**Tasks:**

- [ ] 1.1 Add type-level tests for the desired emitter output shape (input/output value object aliases, `FieldInputTypes` map structure)
- [ ] 1.2 Parameterize `generateFieldResolvedType` to accept `'input' | 'output'` side — currently hardcodes `['output']` on line 234 of `domain-type-generation.ts`
- [ ] 1.3 Split `generateValueObjectType` to emit `{Name}Input` / `{Name}Output` aliases — input aliases use `CodecTypes[...]['input']`, output aliases use `CodecTypes[...]['output']`
- [ ] 1.4 Update `generateFieldOutputTypesMap` to reference `{Name}Output` value object aliases instead of un-suffixed names
- [ ] 1.5 Add `generateFieldInputTypesMap` (or generalize) to produce the input-side map referencing `{Name}Input` aliases
- [ ] 1.6 Update `generate-contract-dts.ts` to emit `FieldInputTypes` alongside `FieldOutputTypes`
- [ ] 1.7 Update Mongo emitter `getTypeMapsExpression()` to return `'MongoTypeMaps<CodecTypes, OperationTypes, FieldOutputTypes, FieldInputTypes>'`
- [ ] 1.8 Re-emit retail store `contract.d.ts` — verify it contains both maps and split value object aliases
- [ ] 1.9 Re-emit mongo-demo `contract.d.ts` — verify it gains `FieldOutputTypes` and `FieldInputTypes`

### Milestone 2: `MongoTypeMaps` carries `FieldInputTypes`

Extend the contract type infrastructure to carry the new input types map and extract it.

**Tasks:**

- [ ] 2.1 Add type-level tests for `MongoTypeMaps` 4th parameter and `ExtractMongoFieldInputTypes`
- [ ] 2.2 Add 4th type parameter `TFieldInputTypes` to `MongoTypeMaps` in `contract-types.ts` (default: `Record<string, Record<string, unknown>>`)
- [ ] 2.3 Add `ExtractMongoFieldInputTypes<T>` extractor (parallel to `ExtractMongoFieldOutputTypes`)
- [ ] 2.4 Verify backward compatibility: mongo-demo contract (2-param `MongoTypeMaps`) still compiles

### Milestone 3: ORM uses `FieldOutputTypes` / `FieldInputTypes`

Update the ORM type chain to prefer pre-resolved field types from the contract's `TypeMaps`. Fallback to `InferModelRow` for older contracts. Remove casts from the retail store.

**Tasks:**

- [ ] 3.1 Add type-level ORM tests: `DefaultModelRow` resolves to primitives when `FieldOutputTypes` is present
- [ ] 3.2 Add type-level ORM tests: `DefaultModelRow` falls back to `InferModelRow` when `FieldOutputTypes` is absent
- [ ] 3.3 Add type-level ORM tests: `CreateInput` resolves via `FieldInputTypes` when present, falls back otherwise
- [ ] 3.4 Implement `ResolvedOutputRow<TContract, ModelName>` helper — prefers `ExtractMongoFieldOutputTypes[ModelName]` with `-readonly`, falls back to `InferModelRow`
- [ ] 3.5 Implement `ResolvedInputRow<TContract, ModelName>` helper — same logic for `ExtractMongoFieldInputTypes`
- [ ] 3.6 Wire `DefaultModelRow` to use `ResolvedOutputRow`
- [ ] 3.7 Wire `InferFullRow` and `VariantRow` to use `ResolvedOutputRow` instead of `InferModelRow`
- [ ] 3.8 Wire `CreateInput` / `VariantCreateInput` / `ResolvedCreateInput` to use `ResolvedInputRow`
- [ ] 3.9 Verify ORM tests pass (type-level and runtime)
- [ ] 3.10 Remove all `as string`, `String()`, `Number()`, `as unknown as string` casts on ORM values in retail store
- [ ] 3.11 Run `pnpm typecheck` on the retail store — verify zero codec-related cast errors
- [ ] 3.12 Run retail store tests — verify all pass

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| AC-1: retail store contract.d.ts contains both maps | Manual inspection + snapshot | M1 task 1.8 | Verify during re-emit |
| AC-2: value object aliases emitted as `{Name}Input` / `{Name}Output` | Unit (emitter) | M1 task 1.1 | Test `generateValueObjectType` output |
| AC-3: `FieldInputTypes` uses `['input']` and input VO aliases | Unit (emitter) | M1 task 1.1 | Test `generateFieldInputTypesMap` output |
| AC-4: `FieldOutputTypes` uses `['output']` and output VO aliases | Unit (emitter) | M1 task 1.1 | Test `generateFieldOutputTypesMap` output |
| AC-5: `MongoTypeMaps` 4th param | Type-level | M2 task 2.1 | Verify type accepts 4th param |
| AC-6: `DefaultModelRow` resolves via `FieldOutputTypes` | Type-level | M3 task 3.1 | Assert field types are primitives |
| AC-7: `CreateInput` resolves via `FieldInputTypes` | Type-level | M3 task 3.3 | Assert input types are primitives |
| AC-8: fallback to `InferModelRow` | Type-level | M3 task 3.2 | Contract without `FieldOutputTypes` |
| AC-9: retail store zero casts | Compilation | M3 task 3.11 | `pnpm typecheck` passes |
| AC-10: mongo-demo backward compat | Compilation | M2 task 2.4 | `pnpm typecheck` passes |
| AC-11: ORM type assertion — primitives when present | Type-level | M3 task 3.1 | |
| AC-12: ORM type assertion — fallback when absent | Type-level | M3 task 3.2 | |

## Open Items

- **Value object alias naming convention**: un-suffixed aliases (e.g., `Price`) are removed and replaced with `PriceOutput`. Any user code importing `Price` from `contract.d.ts` must be updated to `PriceOutput`. This is a breaking change to the emitted contract shape.
- **Retail store data layer**: files like `src/data/products.ts` import `FieldOutputTypes` directly — these must be updated to reference the new value object alias names.
- **Downstream package builds**: after changing `MongoTypeMaps` and ORM types, run `pnpm build` to refresh `dist/*.d.mts` declarations before validating downstream TypeScript usage.
