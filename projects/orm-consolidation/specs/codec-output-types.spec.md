# Summary

Wire `FieldOutputTypes` and a new `FieldInputTypes` from the emitted contract into the Mongo ORM's row type resolution, eliminating ~60 type casts in the retail store example app. Today the ORM re-derives row types through a deep conditional type chain (`InferModelRow`) that TypeScript fails to fully evaluate; switching to the pre-resolved types the emitter already generates fixes this.

# Description

## Problem

The Mongo ORM resolves query result types via `InferModelRow` → `InferFieldBaseType` → `TCodecTypes[CId]['output']`. This chain involves ~7 levels of conditional type evaluation across `IncludedRow`, `InferRootRow`, `VariantRow`, `InferFullRow`, `InferModelRow`, `InferFieldType`, and `InferFieldBaseType`. For complex contracts (like the retail store with 10 models, polymorphism, and value objects), TypeScript cannot fully evaluate these types, producing opaque types that aren't assignable to `string`, `number`, or `Date`.

This forces ~60 explicit casts in the retail store:
- ~15 `as string` casts on string-typed fields in UI components
- ~30 `String()` / `as string` casts on `_id` (ObjectId) fields across data layer and tests
- `Number()` casts on numeric fields
- `as unknown as string` for DateTime fields

Meanwhile, the emitter already generates `FieldOutputTypes` in `contract.d.ts` with fully resolved per-model, per-field types. These are carried in the contract's `TypeMaps` phantom key but the ORM ignores them entirely.

Additionally, there is no `FieldInputTypes` map for create/update operations, so mutation input types also derive from the same broken `InferModelRow` chain.

## Solution

1. Add `FieldInputTypes` generation to the emitter (parallel to existing `FieldOutputTypes`)
2. Emit separate input/output value object type aliases (e.g., `PriceInput` / `PriceOutput`)
3. Add a 4th type parameter to `MongoTypeMaps` for `FieldInputTypes`
4. Update the ORM to prefer `FieldOutputTypes` / `FieldInputTypes` from the contract's `TypeMaps` when available, falling back to `InferModelRow` for older contracts without them
5. Remove all codec-related casts from the retail store

## Relationship to prior work

- **TML-2204** (codec-dispatched type rendering): established `FieldOutputTypes` and `renderOutputType` on codecs
- **TML-2229** (no-emit parameterized types): restore parameterized output types in the no-emit path — deferred, not in scope here
- **FL-01/FL-02/FL-03**: framework limitations discovered by the retail store that this work resolves

# Requirements

## Functional Requirements

### FR-1: Emit `FieldInputTypes` alongside `FieldOutputTypes`

The contract emitter generates a `FieldInputTypes` map for each model, resolving each scalar field to `CodecTypes[codecId]['input']` (instead of `['output']`). Emitted in `contract.d.ts` alongside the existing `FieldOutputTypes`.

### FR-2: Emit separate input/output value object type aliases

For each value object, emit two type aliases: `{Name}Input` and `{Name}Output` (e.g., `PriceInput` / `PriceOutput`). `FieldInputTypes` references the input aliases; `FieldOutputTypes` references the output aliases. Existing un-suffixed aliases (e.g., `Price`) are removed — the output alias replaces them.

**Assumption:** For current Mongo codecs, input and output types are identical (string/string, number/number, Date/Date), so the aliases will be structurally identical. They diverge when parameterized codecs land (TML-2229).

### FR-3: Carry `FieldInputTypes` in `MongoTypeMaps`

`MongoTypeMaps` gains a 4th type parameter `TFieldInputTypes` (default: `Record<string, Record<string, unknown>>`). The emitter's `TypeMaps` expression includes it. `ExtractMongoFieldInputTypes<T>` extractor added.

### FR-4: ORM uses `FieldOutputTypes` for query result types

The ORM's `DefaultModelRow`, `InferFullRow`, `VariantRow`, and `IncludedRow` prefer `FieldOutputTypes[ModelName]` (extracted via `ExtractMongoFieldOutputTypes`) when available. Fallback to `InferModelRow` when the contract was emitted before `FieldOutputTypes` existed.

Row types strip `readonly` from `FieldOutputTypes` properties (matching existing `InferModelRow` behavior via `-readonly`).

### FR-5: ORM uses `FieldInputTypes` for mutation input types

`CreateInput`, `VariantCreateInput`, and `ResolvedCreateInput` prefer `FieldInputTypes[ModelName]` when available. `_id` handling (omitted or optional) and discriminator field omission remain the same.

### FR-6: Retail store compiles with zero codec-related casts

All `as string`, `String()`, `Number()`, and `as unknown as string` casts on ORM result/input values are removed from the retail store. `pnpm typecheck` passes.

## Non-Functional Requirements

### NFR-1: Backward compatibility

Contracts emitted before `FieldOutputTypes`/`FieldInputTypes` existed (e.g., mongo-demo) continue to work. The ORM falls back to `InferModelRow` when the `TypeMaps` fields are absent (defaulted).

### NFR-2: Type-level performance

The new row type resolution avoids deep conditional type chains. Preferring a direct indexed access (`FieldOutputTypes[ModelName]`) over a multi-level conditional chain reduces TypeScript type instantiation depth.

## Non-goals

- **TML-2229 (no-emit parameterized types)**: restoring `Vector<N>` in the no-emit path is deferred. The no-emit path continues to use `InferModelRow` → `CodecTypes[CId]['output']`.
- **SQL family alignment**: the SQL family does not have `FieldOutputTypes` today. Aligning SQL is out of scope.
- **`renderInputType` on codecs**: parameterized input type rendering (the input-side equivalent of `renderOutputType`) is not needed until TML-2229.

# Acceptance Criteria

- [ ] AC-1: `contract.d.ts` for the retail store contains both `FieldOutputTypes` and `FieldInputTypes` maps with all models
- [ ] AC-2: Value object type aliases are emitted as `{Name}Input` / `{Name}Output` pairs (e.g., `PriceInput`, `PriceOutput`)
- [ ] AC-3: `FieldInputTypes` uses `CodecTypes[codecId]['input']` and references `{Name}Input` value object aliases
- [ ] AC-4: `FieldOutputTypes` uses `CodecTypes[codecId]['output']` and references `{Name}Output` value object aliases
- [ ] AC-5: `MongoTypeMaps` accepts a 4th type parameter for `FieldInputTypes`
- [ ] AC-6: ORM `DefaultModelRow` resolves to `FieldOutputTypes[ModelName]` (with `readonly` stripped) for contracts that carry `FieldOutputTypes`
- [ ] AC-7: ORM `CreateInput` / `ResolvedCreateInput` resolve to `FieldInputTypes[ModelName]` (with `readonly` stripped, `_id` optional, discriminator omitted) for contracts that carry `FieldInputTypes`
- [ ] AC-8: ORM row/input types fall back to `InferModelRow` for contracts without `FieldOutputTypes` / `FieldInputTypes`
- [ ] AC-9: Retail store compiles with zero `as string`, `String()`, `Number()`, `as unknown as string` casts on ORM-produced values
- [ ] AC-10: Mongo demo continues to compile after `MongoTypeMaps` change (backward compatibility)
- [ ] AC-11: ORM unit tests include type-level assertions that `DefaultModelRow` resolves to primitives when `FieldOutputTypes` is present
- [ ] AC-12: ORM unit tests include type-level assertions that `DefaultModelRow` falls back to `InferModelRow` when `FieldOutputTypes` is absent

# Other Considerations

## Security

Not applicable — this is a type-system-only change with no runtime behavior change.

## Cost

No cost impact — no new dependencies, no infrastructure changes.

## Observability

Not applicable.

## Data Protection

Not applicable.

## Analytics

Not applicable.

# References

- [TML-2245](https://linear.app/prisma-company/issue/TML-2245) — Linear ticket
- [TML-2229](https://linear.app/prisma-company/issue/TML-2229) — No-emit parameterized types (deferred)
- [TML-2204](https://linear.app/prisma-company/issue/TML-2204) — Codec-dispatched type rendering (established `FieldOutputTypes`)
- [Framework limitations](projects/mongo-example-apps/framework-limitations.md) — FL-01, FL-02, FL-03
- [Next steps plan](docs/planning/mongo-target/next-steps.md) — Area 1 sequencing
- [ADR 186](docs/architecture%20docs/adrs/ADR%20186%20-%20Codec-dispatched%20type%20rendering.md) — Codec-dispatched type rendering design

# Open Questions

None — all design decisions were resolved in the design discussion:
- Option A (separate `FieldOutputTypes` / `FieldInputTypes`) chosen over unified `FieldTypes` with `{ input, output }`
- Option B (separate `{Name}Input` / `{Name}Output` value object aliases) chosen
- TML-2229 deferred
- `readonly` stripped by ORM, kept in emitted types
