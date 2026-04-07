# Phase 1.75a: Typed JSON Simplification — Execution Plan

## Summary

Move TypeScript type rendering onto codec objects and delete the dead `parameterizedRenderers` infrastructure. After this phase, a codec owns all representations of its type's values — wire format (`encode`/`decode`), JSON serialization (`encodeJson`/`decodeJson`), and TypeScript type expression (`renderType`). Adding parameterized type rendering to a new codec means implementing one method on the codec, not registering a renderer in adapter descriptor metadata.

**Linear:** [TML-2204](https://linear.app/prisma-company/issue/TML-2204)

**Spec:** [projects/orm-consolidation/spec.md](../spec.md) (Phase 1.75a)

## Collaborators

| Role  | Person | Context                                          |
| ----- | ------ | ------------------------------------------------ |
| Maker | Will   | Drives execution                                 |
| FYI   | Alexey | SQL ORM owner — no SQL ORM changes in this phase |

## Prerequisites

- **TML-2206** (value objects) should land first. It restructures `ContractField` into a discriminated union with `ScalarFieldType` (which carries `typeParams`). This plan assumes that structure is in place.
- **TML-2215** (bug fix) has landed — `typeParams` and `typeRef` are emitted on storage columns and model fields.

## Context

### Current state

There are two separate mechanisms for parameterized type rendering, neither fully working:

1. **`parameterizedRenderers` infrastructure (dead code).** Adapter descriptors register `TypeRenderer` entries under `types.codecTypes.parameterized`. These are extracted into a `Map<string, NormalizedTypeRenderer>` by `extractParameterizedRenderers()`, stored on the control stack, threaded through `EmitStackInput` and `emit()` into `GenerateContractTypesOptions` — and then **never consumed**. The emitter's `generateContractTypes` reads `options?.parameterizedTypeImports` but ignores `options?.parameterizedRenderers`. The consumer code (`generateColumnType`, `resolveColumnTypeParams`) was deleted in commit `a39cea308`.

2. **Type-level `parameterizedOutput` on `CodecTypes` (plumbing broken).** `CodecTypes['pg/jsonb@1']` carries a `parameterizedOutput` function type that uses `ResolveStandardSchemaOutput<P>`, which extracts the output type from a schema object's type parameter (via Arktype's `.infer` or Standard Schema's `~standard.types.output`). The authoring surface (`jsonb(myArktypeSchema)`) captures the schema's TypeScript type through a phantom `typeParams.schema` key, and `ResolveStandardSchemaOutput` extracts the output type — this is pure compile-time type resolution, driven by the schema library. The mechanism works in isolation (proven by standalone type tests), but the phantom key gets lost somewhere in the contract builder → validate → query pipeline, so the no-emit path currently resolves to `unknown` instead of the schema-derived type.

### What this changes

Replace both mechanisms with a single pattern: **codec-owned `renderType`**. The codec object provides an optional `renderType(typeParams): string` method that produces a TypeScript type expression at emit time. The emitter needs this because it works from serialized data — at emit time, only `typeParams.schemaJson` (a JSON Schema record) is available, not the original Arktype/Zod schema object with its type parameter. `renderType` turns that serialized representation into a TypeScript type expression string for `contract.d.ts`.

The no-emit path (programmatic contract builder) doesn't need `renderType` — the authoring surface captures the schema's TypeScript type directly, and type-level resolution handles the rest. Codecs without `renderType` fall back to `CodecTypes[codecId]['output']` (the existing type-level path, which works for non-parameterized codecs and branded types).

This follows the same architectural pattern as `encodeJson`/`decodeJson` from [ADR 184](../../../docs/architecture%20docs/adrs/ADR%20184%20-%20Codec-owned%20value%20serialization.md): the codec owns all representations of its type.

## Key references (implementation)

### Codec interfaces

- Framework `Codec` base: [`framework-components/src/codec-types.ts`](../../../packages/1-framework/1-core/framework-components/src/codec-types.ts) (L16–36)
- SQL `Codec` (extends base): [`sql-relational-core/src/ast/codec-types.ts`](../../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts) (L48–66)
- Mongo `MongoCodec` (extends base): [`mongo-codec/src/codecs.ts`](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts) (L6–13)
- Postgres codec implementations: [`adapter-postgres/src/core/codecs.ts`](../../../packages/3-targets/6-adapters/postgres/src/core/codecs.ts)

### Dead infrastructure (to delete)

- `extractParameterizedRenderers()`: [`framework-components/src/control-stack.ts`](../../../packages/1-framework/1-core/framework-components/src/control-stack.ts) (L154–179)
- `TypeRenderEntry`, `ParameterizedCodecDescriptor`: [`framework-components/src/emission-types.ts`](../../../packages/1-framework/1-core/framework-components/src/emission-types.ts) (L6–9, L45–50)
- `TypeRenderer`, `NormalizedTypeRenderer`, `normalizeRenderer`, `interpolateTypeTemplate`: [`framework-components/src/type-renderers.ts`](../../../packages/1-framework/1-core/framework-components/src/type-renderers.ts)
- `parameterizedRenderers` on `EmitStackInput`: [`emitter/src/emit-types.ts`](../../../packages/1-framework/3-tooling/emitter/src/emit-types.ts) (L15)
- `parameterizedRenderers` threading in `emit()`: [`emitter/src/emit.ts`](../../../packages/1-framework/3-tooling/emitter/src/emit.ts) (L23, L59–61)
- `parameterized` in Postgres descriptor: [`adapter-postgres/src/core/descriptor-meta.ts`](../../../packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts) (L194–237)
- `parameterized` in pgvector descriptor: [`pgvector/src/core/descriptor-meta.ts`](../../../packages/3-extensions/pgvector/src/core/descriptor-meta.ts) (L95–97)
- Exports: [`framework-components/src/exports/emission.ts`](../../../packages/1-framework/1-core/framework-components/src/exports/emission.ts), [`exports/control.ts`](../../../packages/1-framework/1-core/framework-components/src/exports/control.ts), [`exports/components.ts`](../../../packages/1-framework/1-core/framework-components/src/exports/components.ts)

### Phantom type infrastructure (to remove)

- Phantom `schema` key on `TypedColumnDescriptor`: [`adapter-postgres/src/exports/column-types.ts`](../../../packages/3-targets/6-adapters/postgres/src/exports/column-types.ts) (L196–208, L224–234)
- `parameterizedOutput` + `ResolveStandardSchemaOutput`: [`adapter-postgres/src/exports/codec-types.ts`](../../../packages/3-targets/6-adapters/postgres/src/exports/codec-types.ts) (L22–53)
- `ExtractParameterizedCodecOutputType` in lane types: [`sql-relational-core/src/types.ts`](../../../packages/2-sql/4-lanes/relational-core/src/types.ts) (L385–395)

### Emission pipeline

- SQL emitter hook: [`sql-contract-emitter/src/index.ts`](../../../packages/2-sql/3-tooling/emitter/src/index.ts)
- Domain type generation helpers: [`emitter/src/domain-type-generation.ts`](../../../packages/1-framework/3-tooling/emitter/src/domain-type-generation.ts)
- JSON type expression renderer: [`adapter-postgres/src/core/json-schema-type-expression.ts`](../../../packages/3-targets/6-adapters/postgres/src/core/json-schema-type-expression.ts)
- `renderJsonTypeExpression`: [`adapter-postgres/src/core/descriptor-meta.ts`](../../../packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts) (L144–162)

### Tests

- Parameterized type emission tests: [`sql-contract-emitter/test/emitter-hook.parameterized-types.test.ts`](../../../packages/2-sql/3-tooling/emitter/test/emitter-hook.parameterized-types.test.ts)
- E2E parameterized tests: [`family-sql/test/emit-parameterized.test.ts`](../../../packages/2-sql/9-family/test/emit-parameterized.test.ts)
- Integration type tests: [`test/integration/test/contract-builder.types.test-d.ts`](../../../test/integration/test/contract-builder.types.test-d.ts) (L487–518)
- Control stack tests: [`framework-components/test/control-stack.test.ts`](../../../packages/1-framework/1-core/framework-components/test/control-stack.test.ts)
- Emitter passthrough test: [`emitter/test/emitter.test.ts`](../../../packages/1-framework/3-tooling/emitter/test/emitter.test.ts) (L406–460)

## Milestones

### Milestone 1: Add `renderType` to the codec interface

Add an optional `renderType` method to the framework `Codec` base interface. Implement on codecs that need emit-time type rendering.

#### 1.1 Add `renderType` to framework `Codec` base

In `framework-components/src/codec-types.ts`, add:

```ts
export interface Codec<...> {
  // ... existing methods ...

  /**
   * Produces a TypeScript type expression for this codec's output type
   * given the column's type parameters. Called by the emitter during
   * contract.d.ts generation for scalar fields with typeParams.
   *
   * Return undefined to fall back to CodecTypes[codecId]['output'].
   */
  renderType?(typeParams: Record<string, unknown>): string | undefined;
}
```

Update `codec()` and `mongoCodec()` factories — no default needed since the method is optional.

#### 1.2 Implement `renderType` on JSON codecs

Move `renderJsonTypeExpression` logic from `descriptor-meta.ts` onto the `pg/jsonb@1` and `pg/json@1` codec objects in `adapter-postgres/src/core/codecs.ts`:

```ts
renderType(typeParams: Record<string, unknown>): string | undefined {
  const typeName = typeParams['type'];
  if (typeof typeName === 'string' && typeName.trim().length > 0) {
    return isSafeTypeExpression(typeName.trim()) ? typeName.trim() : 'JsonValue';
  }
  const schema = typeParams['schemaJson'];
  if (schema && typeof schema === 'object') {
    const rendered = renderTypeScriptTypeFromJsonSchema(schema);
    return isSafeTypeExpression(rendered) ? rendered : 'JsonValue';
  }
  return 'JsonValue';
}
```

#### 1.3 Implement `renderType` on enum codec

The `pg/enum@1` codec renders literal unions from `typeParams.values`:

```ts
renderType(typeParams: Record<string, unknown>): string | undefined {
  const values = typeParams['values'];
  if (!Array.isArray(values)) return undefined;
  return values.map(v => `'${String(v).replace(/'/g, "\\'")}'`).join(' | ');
}
```

#### 1.4 Tests

- `pg/jsonb@1` with `{ type: 'AuditPayload' }` → returns `'AuditPayload'`
- `pg/jsonb@1` with `{ schemaJson: { type: 'object', properties: { name: { type: 'string' } } } }` → returns `'{ name: string }'`
- `pg/jsonb@1` with `{}` → returns `'JsonValue'`
- `pg/jsonb@1` with no `typeParams` → `renderType` not called (method is optional)
- `pg/enum@1` with `{ values: ['USER', 'ADMIN'] }` → returns `"'USER' | 'ADMIN'"`
- `pg/int4@1` (no `renderType`) → method is undefined
- Safety: `renderType` with `import(...)` in type expression → returns `'JsonValue'`

### Milestone 2: Wire the emitter to use codec `renderType`

The emitter calls `codec.renderType(typeParams)` for scalar fields with `typeParams`, and stamps the rendered type into the emitted `contract.d.ts`.

#### 2.1 Make codec registry available to the emitter

The emitter needs access to codec objects (or their `renderType` methods) keyed by `codecId`. Extend `EmitStackInput` with a codec lookup:

```ts
export interface EmitStackInput {
  // ... existing fields ...
  readonly codecLookup?: CodecLookup;
}
```

The `CodecLookup` interface already exists in `framework-components/src/codec-types.ts`. The control stack already has access to codec registries.

#### 2.2 Emit rendered types for scalar fields

After TML-2206, model fields have `type: ScalarFieldType` with optional `typeParams`. When the emitter generates model field types, for scalar fields with `typeParams`:

1. Look up the codec via `codecLookup.get(field.type.codecId)`
2. If the codec has `renderType`, call `codec.renderType(field.type.typeParams)`
3. If it returns a string, use that as the field's TypeScript type expression
4. Otherwise, fall back to `CodecTypes[codecId]['output']`

The rendered type needs to be emitted somewhere that `ComputeColumnJsType` (or its post-TML-2206 equivalent) can pick it up. The cleanest approach depends on TML-2206's final field shape. Options:

- Emit a `resolvedType` property on the field in `contract.d.ts` — `ComputeColumnJsType` checks it first
- Emit a separate per-model type map
- Render model fields as resolved TypeScript types directly (departing from `ContractField` shape for parameterized scalars)

The specific approach should be decided during implementation, considering TML-2206's final `ContractField` structure.

#### 2.3 Tests

- Emit a contract with `jsonb(schema)` column → emitted `contract.d.ts` contains the rendered type (e.g., `{ action: string; actorId: number }`)
- Emit a contract with `jsonb()` column → emitted `contract.d.ts` produces `JsonValue`
- Emit a contract with enum column → emitted `contract.d.ts` contains literal union (`'USER' | 'ADMIN'`)
- Emit a contract with vector column (no `renderType` on codec) → falls back to `CodecTypes['pg/vector@1']['output']`
- E2E: `jsonb(schema)` → author → emit → query → result type is the schema-derived type (type-level test)

### Milestone 3: Remove phantom `typeParams.schema`

Remove the phantom Standard Schema key that was used by the type-level `parameterizedOutput` path.

#### No-emit path analysis

The phantom `schema` key was designed to enable type-level resolution for JSON schemas in the no-emit (programmatic contract builder) path. The authoring surface (`jsonb(myArktypeSchema)`) captures the schema's TypeScript type through the phantom key, and `ResolveStandardSchemaOutput` extracts the output type — this mechanism works in isolation (proven by standalone type tests at L521–558).

However, the **plumbing is broken end-to-end**: the contract builder → validate → query pipeline loses the phantom `schema` somewhere before it reaches `ComputeColumnJsType`. The integration type test at `test/integration/test/contract-builder.types.test-d.ts` (L487–518) asserts that `jsonb(schema)` resolves to `unknown`, not the schema-derived type.

Fixing the no-emit plumbing is out of scope for TML-2204. Since the system is contract-first (production always emits), the no-emit path is primarily a test convenience. Removing the phantom `schema` key does not regress any currently working behavior:

| Path | Branded types (vector, char) | JSON schema types | Enum unions |
|------|-----|-----|-----|
| **Emit** (contract.d.ts) | Works via `CodecTypes['output']` | **Fixed by TML-2204** via `renderType` | **Fixed by TML-2204** via `renderType` |
| **No-emit** (builder) | Works via `parameterizedOutput` | Broken (resolves to `unknown`) — no regression | Not yet supported |

#### 3.1 Remove phantom from `column-types.ts`

In `adapter-postgres/src/exports/column-types.ts`:
- Remove the phantom `schema: TSchema` key from `TypedColumnDescriptor`
- Simplify `createJsonColumnFactory` — return type no longer includes phantom
- Overload signatures for `json()` and `jsonb()` may simplify (the `TypedColumnDescriptor<TSchema>` return type is no longer needed)

#### 3.2 Remove `parameterizedOutput` from JSON `CodecTypes`

In `adapter-postgres/src/exports/codec-types.ts`:
- Remove the `parameterizedOutput` extension on `pg/json@1` and `pg/jsonb@1`
- Remove `ResolveStandardSchemaOutput` and the compile-time `StandardSchemaLike`

Keep `parameterizedOutput` on other codecs (e.g., pgvector's `CodecTypes` in `pgvector/src/types/codec-types.ts`) — branded types still use this path in the no-emit builder.

#### 3.3 Simplify `ComputeColumnJsType`

In `sql-relational-core/src/types.ts`:
- The `ExtractParameterizedCodecOutputType` branch handles the type-level `parameterizedOutput` path
- Keep this branch — it still serves branded types (vector, char, varchar) in the no-emit path
- The JSON-specific `parameterizedOutput` entries are removed (3.2), so this branch will naturally stop affecting JSON codecs

#### 3.4 Delete `ResolveStandardSchemaOutput` type tests

In `test/integration/test/contract-builder.types.test-d.ts`:
- Delete the standalone `ResolveStandardSchemaOutput` type tests (L521–558) — they test a type utility that is being removed
- Keep the "jsonb schema preserves JsonValue fallback in no-emit type path" test (L487–518), updating the assertion if the resolved type changes from `unknown` to `JsonValue`

#### 3.5 Other tests

- `jsonb(schema)` in the no-emit path continues to compile (resolves to `JsonValue` or `unknown` — no change from current behavior)
- `jsonb()` continues to produce `JsonValue`
- Existing vector/char/varchar branded type tests pass (these still work via `CodecTypes[codecId]['parameterizedOutput']`)
- No remaining references to phantom `schema` key in source code

### Milestone 4: Delete dead `parameterizedRenderers` infrastructure

Remove all code that is no longer reachable.

#### 4.1 Delete from `framework-components`

- `extractParameterizedRenderers()` in `control-stack.ts`
- `extractParameterizedTypeImports()` in `control-stack.ts` (if no longer needed)
- `TypeRenderEntry`, `ParameterizedCodecDescriptor` in `emission-types.ts`
- `TypeRenderer`, `TypeRendererString`, `TypeRendererRawFunction`, `TypeRendererTemplate`, `TypeRendererFunction`, `NormalizedTypeRenderer`, `normalizeRenderer`, `interpolateTypeTemplate`, `RenderTypeContext` in `type-renderers.ts`
- `parameterizedRenderers` from the control stack creation in `createControlStack()`
- Update exports in `exports/emission.ts`, `exports/control.ts`, `exports/components.ts`

#### 4.2 Delete from emitter

- `parameterizedRenderers` from `EmitStackInput` in `emit-types.ts`
- `parameterizedRenderers` threading in `emit()` in `emit.ts`
- `parameterizedRenderers` from `GenerateContractTypesOptions` in `emission-types.ts`

#### 4.3 Delete from adapter/extension descriptors

- `parameterized` map in `postgresAdapterDescriptorMeta.types.codecTypes` in `adapter-postgres/src/core/descriptor-meta.ts`
- `parameterized` map in `pgvectorPackMeta.types.codecTypes` in `pgvector/src/core/descriptor-meta.ts`
- `renderJsonTypeExpression` and `isSafeTypeExpression` from `descriptor-meta.ts` (logic moved to codec)
- `ComponentMetadata.types.codecTypes.parameterized` type definition

#### 4.4 Delete `parameterizedTypeImports` if no longer needed

If `parameterizedTypeImports` was only used to carry imports for parameterized renderers (e.g., `JsonValue`, `Vector`), and those imports are now handled through the codec's type import contributions, remove:
- `extractParameterizedTypeImports()` in `control-stack.ts`
- `parameterizedTypeImports` from `EmitStackInput`, `GenerateContractTypesOptions`

If some of these imports are still needed (e.g., `JsonValue` for the rendered type), keep the import mechanism under a clearer name.

#### 4.5 Update tests

- Delete or rewrite `emitter-hook.parameterized-types.test.ts` — these tests passed `parameterizedRenderers` and asserted the bare `{ codecId, nullable }` shape (i.e., they tested that renderers had no effect). Replace with tests that verify codec `renderType` dispatch.
- Update `control-stack.test.ts` — remove `extractParameterizedRenderers` tests
- Update `emitter.test.ts` — remove the "passes parameterizedRenderers to generateContractTypes options" test
- Update `emit-parameterized.test.ts` — rewrite to verify codec `renderType` dispatch end-to-end
- All existing tests pass
- `pnpm build` and `pnpm typecheck` succeed

#### 4.6 Verify no remaining references

Grep for `parameterizedRenderers`, `TypeRenderEntry`, `NormalizedTypeRenderer`, `normalizeRenderer`, `interpolateTypeTemplate`, `parameterized` (in descriptor context) — no remaining references in source code (excluding docs, project artifacts, and ADR historical context).

## Packages touched

| Package | Layer | What changes |
|---------|-------|-------------|
| `@prisma-next/framework-components` | framework/core | Add `renderType` to `Codec` base. Delete `TypeRenderEntry`, `NormalizedTypeRenderer`, `TypeRenderer`, `normalizeRenderer`, `interpolateTypeTemplate`, `extractParameterizedRenderers`, `extractParameterizedTypeImports`, `RenderTypeContext`, `ParameterizedCodecDescriptor`. Remove `parameterizedRenderers` from control stack. |
| `@prisma-next/emitter` | framework/tooling | Add `codecLookup` to `EmitStackInput`. Remove `parameterizedRenderers` threading. |
| `@prisma-next/sql-contract-emitter` | sql/tooling | Wire codec `renderType` dispatch in model field generation. Remove `parameterizedRenderers` from `GenerateContractTypesOptions`. |
| `@prisma-next/adapter-postgres` | targets/adapters | Implement `renderType` on `pg/jsonb@1`, `pg/json@1`, `pg/enum@1` codecs. Remove `parameterized` from descriptor metadata. Delete `renderJsonTypeExpression` from descriptor-meta. |
| `@prisma-next/extension-pgvector` | extensions | Remove `parameterized` from descriptor metadata. |
| `@prisma-next/sql-relational-core` | sql/lanes | Simplify `ComputeColumnJsType` — remove or reduce `ExtractParameterizedCodecOutputType`. |

## Test coverage

| Acceptance criterion | Test type | Milestone |
|---|---|---|
| `renderType` on `pg/jsonb@1` produces schema-derived type | Unit | 1.4 |
| `renderType` on `pg/jsonb@1` returns `JsonValue` with no schema | Unit | 1.4 |
| `renderType` on `pg/enum@1` produces literal union | Unit | 1.4 |
| `renderType` is optional — codecs without it return undefined | Unit | 1.4 |
| Safety: malicious type expressions rejected | Unit | 1.4 |
| Emitter calls `renderType` for scalar fields with `typeParams` | Unit | 2.3 |
| Emitted `contract.d.ts` contains rendered JSON schema type | Snapshot | 2.3 |
| Emitted `contract.d.ts` contains rendered enum union | Snapshot | 2.3 |
| Untyped `jsonb()` emits `JsonValue` | Snapshot | 2.3 |
| Codec without `renderType` falls back to `CodecTypes` output | Unit | 2.3 |
| E2E: `jsonb(schema)` → emit → query → typed result | Type test | 2.3 |
| Phantom `typeParams.schema` removed from source | Grep check | 3.5 |
| `ResolveStandardSchemaOutput` type tests deleted | Grep check | 3.4 |
| `jsonb()` no-emit path compiles (resolves to `JsonValue`/`unknown`) | Type test | 3.5 |
| Branded types (vector, char) still work in both paths | Type test | 3.5 |
| No-emit `jsonb(schema)` does not regress (was already `unknown`) | Type test | 3.5 |
| No remaining `parameterizedRenderers` references in source | Grep check | 4.6 |
| All existing tests pass | Full suite | 4.6 |
| `pnpm build` succeeds | Build | 4.6 |
| `pnpm typecheck` succeeds | Typecheck | 4.6 |

## Follow-ups

### `renderType` on additional codecs

Branded type codecs (vector, char, varchar, numeric, timestamp variants, bit, varbit) currently render at the type level via `parameterizedOutput` and branded types on `CodecTypes`. Adding `renderType` to these codecs is optional — the type-level path works for them. It could be done for consistency (one rendering mechanism instead of two) but is not required.

### `parameterizedTypeImports` cleanup

After deleting `parameterizedRenderers`, the `parameterizedTypeImports` mechanism may still be needed to carry type imports (like `JsonValue`, `Vector`) that are referenced by rendered type expressions. If so, it should be renamed to clarify its purpose (e.g., `renderedTypeImports`). If all needed imports are already covered by `codecTypeImports`, it can be deleted entirely.

### Mongo codec `renderType`

If Mongo introduces parameterized codecs that need type rendering, the framework base interface already supports it. No additional infrastructure needed.
