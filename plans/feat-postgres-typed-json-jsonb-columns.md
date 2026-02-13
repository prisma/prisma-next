# feat(postgres): Add Typed JSON/JSONB Column Support

> PR #144 · Linear: TML-1894 · ADR 155
> Branch: `feat/pg-json-codecs`

---

## 1. Goal

Add first-class `json` and `jsonb` support to the Postgres adapter, end-to-end:
contract authoring, codec registration, emitted types in `contract.d.ts`,
DML parameter casting, DDL passthrough, introspection, and schema verification.

Users declare JSON columns with an **optional Standard Schema value** (e.g., Arktype).
When provided, the emitter derives a **concrete TypeScript object type** from the schema's
JSON Schema output and embeds it in `contract.d.ts`. When omitted, columns fall back to a
safe `JsonValue` union.

---

## 2. Design Evolution — Why Standard Schema, Not String Type Hints

The initial design proposed an inline **string type hint** via `typeParams`:

```ts
// Original design — abandoned
jsonb({ type: '{ displayName: string; tags: string[] }' })
```

This was abandoned for three reasons:

1. **No validation** — A raw string bypasses all compile-time and build-time checks. The
   emitter would blindly paste user input into `.d.ts` files, creating injection risk and
   no way to detect typos or invalid types.

2. **No contract serialization** — `contract.json` needs a machine-readable schema
   representation. A string type expression has no JSON Schema equivalent, so tooling
   (agents, drift detection, diffing) can't reason about the shape of the data.

3. **No cross-library compatibility** — Tying to a string format means every schema library
   would need its own formatter. Standard Schema (`~standard` protocol) is already
   implemented by Arktype, Zod, and Valibot, giving us a single integration point.

### What Standard Schema provides

[Standard Schema](https://github.com/standard-schema/standard-schema) is a cross-library
protocol. Any compliant schema value exposes:

| Property                         | Used For                     |
| -------------------------------- | ---------------------------- |
| `~standard.types.output`         | **Compile-time** — TypeScript type narrowing in `contract.d.ts` via `parameterizedOutput` |
| `~standard.jsonSchema.output`    | **Build-time** — serializable JSON Schema stored in `contract.json` `typeParams.schema`   |
| `.expression` (Arktype-specific) | **Optional shortcut** — if the library provides a TS expression string, the renderer uses it directly instead of deriving from JSON Schema |

### Why users are NOT forced to use Arktype

The column factories accept **any** Standard Schema value:

```ts
import { type as arktype } from 'arktype';
import { z } from 'zod';

// Arktype — works
jsonb(arktype({ displayName: 'string', tags: 'string[]', active: 'boolean' }))

// Zod — also works (Zod ships with Standard Schema support)
jsonb(z.object({ displayName: z.string(), tags: z.array(z.string()), active: z.boolean() }))

// No schema — falls back to JsonValue
jsonb()
```

The adapter only reads from the `~standard` protocol surface — it never imports Arktype
directly in the public API. Arktype is used internally for param validation schemas (codec
`paramsSchema`), but that's an implementation detail invisible to users.

---

## 3. Architecture Overview

```
                 ┌─────────────────────────────┐
                 │  User Code (contract.ts)     │
                 │  jsonb(profileSchema)         │
                 └──────────┬──────────────────┘
                            │ Standard Schema value
                            ▼
              ┌──────────────────────────────────┐
              │  column-types.ts                  │
              │  createJsonColumnFactory()        │
              │  → extracts ~standard.jsonSchema  │
              │  → stores in typeParams.schema    │
              │  → optionally stores .expression  │
              │    in typeParams.type             │
              └──────────┬───────────────────────┘
                         │ ColumnTypeDescriptor
         ┌───────────────┼───────────────────────┐
         ▼               ▼                       ▼
  contract.json    descriptor-meta.ts      codec-types.ts
  (typeParams.     (parameterized          (compile-time
   schema: {...})   renderer →              parameterizedOutput
                    renderJsonType          → ResolveStandard
                    Expression())            SchemaOutput<P>)
         │               │                       │
         ▼               ▼                       ▼
  Serializable     contract.d.ts           Type-safe
  artifact for     emitted type:           ResultType<>
  agents/tools     { active: boolean;      inference in
                     displayName: string;  query DSL
                     tags: string[] }
```

### Data flow (authoring → emission → runtime)

1. **Authoring**: `jsonb(schema)` extracts `~standard.jsonSchema.output` → stores as
   `typeParams.schema` (a plain JSON Schema object). If the schema also exposes
   `.expression` (Arktype does), stores it as `typeParams.type`.

2. **Emission**: The parameterized renderer in `descriptor-meta.ts` checks `typeParams`:
   - If `typeParams.type` exists and passes safety check → emit that string directly
   - Else if `typeParams.schema` exists → run `renderTypeScriptTypeFromJsonSchema()` to
     convert JSON Schema → inline TS type expression
   - Else → emit `JsonValue`

3. **Runtime**: Codecs `pg/json@1` / `pg/jsonb@1` encode via `JSON.stringify()`, decode via
   `JSON.parse()`. The adapter casts bound params in INSERT/UPDATE to `::json` / `::jsonb`.

4. **Type inference**: `codec-types.ts` defines `parameterizedOutput` that reads
   `~standard.types.output` at the type level, so `ResultType<>` resolves to the schema's
   output type when using the composable query DSL.

---

## 4. Implementation Steps

### Step 1 — Codec Registration

**Files:**
- `packages/3-targets/6-adapters/postgres/src/core/codec-ids.ts`
- `packages/3-targets/6-adapters/postgres/src/core/codecs.ts`

**What to do:**
- Add constants `PG_JSON_CODEC_ID = 'pg/json@1'` and `PG_JSONB_CODEC_ID = 'pg/jsonb@1'`
- Define `pgJsonCodec` and `pgJsonbCodec` using the `codec()` factory:
  - Wire type: `string | JsonValue`
  - JS type: `JsonValue`
  - `encode`: `JSON.stringify(value)`
  - `decode`: `typeof wire === 'string' ? JSON.parse(wire) : wire`
  - `targetTypes`: `['json']` / `['jsonb']`
  - `meta.db.sql.postgres.nativeType`: `'json'` / `'jsonb'`
- Export `JsonValue` type (recursive union: `string | number | boolean | null | {[k]: JsonValue} | JsonValue[]`)
- Register both codecs in the `defineCodecs()` builder chain

### Step 2 — Standard Schema Extraction Utilities

**Files:**
- `packages/3-targets/6-adapters/postgres/src/core/standard-schema.ts` (new)

**What to do:**
- Define a runtime `StandardSchemaLike` type that reads `~standard.jsonSchema.output`
- Implement `extractStandardSchemaOutputJsonSchema(schema)` — resolves JSON Schema payload
  (handles both static objects and factory functions that accept `{ target: 'draft-07' }`)
- Implement `extractStandardSchemaTypeExpression(schema)` — reads `.expression` string
  (Arktype-specific shortcut)
- Implement `isStandardSchemaLike(value)` — type guard

### Step 3 — JSON Schema → TypeScript Type Expression Renderer

**Files:**
- `packages/3-targets/6-adapters/postgres/src/core/json-schema-type-expression.ts` (new)

**What to do:**
- Implement `renderTypeScriptTypeFromJsonSchema(schema)` — recursive converter:
  - Primitive types: `string`, `number`/`integer` → `number`, `boolean`, `null`
  - `object` with `properties` → `{ key: Type; optionalKey?: Type }`
    - Sorts keys alphabetically for determinism
    - Handles `required` array, `additionalProperties`
  - `array` with `items` → `Type[]` (or tuple `readonly [A, B]` for array items)
  - Combinators: `oneOf`/`anyOf` → union, `allOf` → intersection
  - `enum` → literal union
  - `const` → literal type
  - Unknown/unsupported → `JsonValue` fallback
- Implement helper functions: `escapeStringLiteral`, `quotePropertyKey`, `renderLiteral`,
  `renderUnion`, `renderObjectType`, `renderArrayType`

### Step 4 — Column Type Factories

**Files:**
- `packages/3-targets/6-adapters/postgres/src/exports/column-types.ts`

**What to do:**
- Add static descriptors: `jsonColumn` and `jsonbColumn` (no schema, untyped)
- Add factory functions: `json(schema?)` and `jsonb(schema?)` with overloads:
  - No-arg: returns static descriptor (equivalent to `jsonColumn` / `jsonbColumn`)
  - With schema: validates it's Standard Schema, extracts JSON Schema → `typeParams.schema`,
    optionally extracts `.expression` → `typeParams.type`
- Define `TypedColumnDescriptor<TSchema>` return type that preserves the schema reference
  in `typeParams` for compile-time type inference
- Internal: `createJsonColumnFactory()` shared between `json()` and `jsonb()`
- Internal: `createJsonTypeParams()` for extracting and structuring typeParams

### Step 5 — Codec Type Definitions (Compile-Time)

**Files:**
- `packages/3-targets/6-adapters/postgres/src/exports/codec-types.ts`

**What to do:**
- Extend `CodecTypes` with `pg/json@1` and `pg/jsonb@1` entries:
  - Each has `parameterizedOutput<P>` — a generic function type that resolves
    `~standard.types.output` from `P.schema` at the type level
- Define `ResolveStandardSchemaOutput<P>` — type-level resolver:
  - Checks for `schema.infer` (Arktype's `.infer` shorthand)
  - Falls back to `~standard.types.output`
  - Falls back to `JsonValue` if neither exists
- Export `JsonValue` type

### Step 6 — Descriptor Metadata (Parameterized Rendering)

**Files:**
- `packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts`

**What to do:**
- Add parameterized renderers for `PG_JSON_CODEC_ID` and `PG_JSONB_CODEC_ID`:
  - Both use `renderJsonTypeExpression(params)` function
  - Resolution order: `params.type` string → `params.schema` JSON Schema → `'JsonValue'`
- Add `isSafeTypeExpression(expr)` — rejects `import()`, `require()`, `declare`, `export`,
  `eval()` patterns to prevent code injection in `.d.ts` files
- Add `JsonValue` to `typeImports` array so it's available in generated contract types
- Register both codec IDs in `storage` array with `nativeType: 'json'` / `'jsonb'`

### Step 7 — DML Parameter Casting

**Files:**
- `packages/3-targets/6-adapters/postgres/src/core/adapter.ts`

**What to do:**
- Extend `getCodecParamCast()` to return `'json'` for `PG_JSON_CODEC_ID` and `'jsonb'`
  for `PG_JSONB_CODEC_ID`
- This causes INSERT/UPDATE bound params to render as `$N::json` / `$N::jsonb`
- Pattern follows the existing `VECTOR_CODEC_ID → 'vector'` strategy

### Step 8 — Runtime Adapter Exports

**Files:**
- `packages/3-targets/6-adapters/postgres/src/exports/runtime.ts`

**What to do:**
- Add `jsonTypeParamsSchema` (Arktype: `{ schema: 'object', 'type?': 'string' }`)
- Add `parameterizedCodecDescriptors` for both `PG_JSON_CODEC_ID` and `PG_JSONB_CODEC_ID`
  with the params schema — enables runtime verification of `typeParams` shape
- These descriptors are exposed via `parameterizedCodecs()` on the adapter descriptor

### Step 9 — Control Adapter (Introspection)

**Files:**
- `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts`

**What to do:**
- Ensure `normalizeSchemaNativeType()` maps `'json'` and `'jsonb'` from Postgres catalog
  rows correctly
- DDL passthrough already supports native types — no planner logic change needed for
  `CREATE TABLE ... json / jsonb`

---

## 5. Impact on Queries, Type-Safety, and DDL

### Queries (DML)

- **INSERT / UPDATE**: Params bound to JSON columns are automatically cast:
  ```sql
  INSERT INTO "user" ("email", "profile") VALUES ($1, $2::jsonb)
  UPDATE "user" SET "profile" = $2::jsonb WHERE "user"."id" = $1
  ```
- **SELECT**: JSON columns are decoded via `JSON.parse()` at the codec level, returning
  structured JS objects rather than raw strings
- **WHERE**: JSON columns can be used in equality filters. The adapter casts the param:
  ```sql
  WHERE "user"."profile" = $1::jsonb
  ```

### Type-Safety

- **With schema**: `ResultType<>` resolves to the schema's output type:
  ```ts
  type Row = ResultType<typeof plan>;
  // Row['profile'] → { active: boolean; displayName: string; tags: string[] } | null
  ```
- **Without schema**: Falls back safely:
  ```ts
  // Row['data'] → JsonValue | null
  ```
- **In contract.d.ts**: The emitter renders concrete inline types:
  ```ts
  readonly profile: { active: boolean; displayName: string; tags: string[] } | null;
  readonly meta: { rank: number; source: string; verified: boolean } | null;
  ```
- **Dual-path type resolution**:
  - Compile-time path (`codec-types.ts`): Uses `~standard.types.output` for TypeScript inference
  - Emit-time path (`descriptor-meta.ts`): Uses `~standard.jsonSchema.output` → JSON Schema → TS string

### DDL

- `json` and `jsonb` are native Postgres types — DDL passthrough emits them directly:
  ```sql
  CREATE TABLE "user" (
    "profile" jsonb
  );
  ```
- No special planner logic needed; the existing native-type passthrough handles both types
- Introspection maps `json` / `jsonb` from the Postgres catalog to `pg/json@1` / `pg/jsonb@1`

---

## 6. Test Plan

### Unit Tests

| Test File | Covers |
|-----------|--------|
| `postgres/test/codecs.test.ts` | JSON/JSONB encode/decode round-trips (string, number, boolean, null, object, array, nested) |
| `postgres/test/column-types.test.ts` | Descriptor shapes, `typeParams` emission, Standard Schema validation, overload behavior |
| `postgres/test/standard-schema.test.ts` | `extractStandardSchemaOutputJsonSchema`, `extractStandardSchemaTypeExpression`, `isStandardSchemaLike`, edge cases |
| `postgres/test/json-schema-type-expression.test.ts` | Full JSON Schema → TS renderer: primitives, objects, arrays, tuples, unions, intersections, enums, const, nested, optional properties, `additionalProperties`, edge cases |
| `postgres/test/adapter.test.ts` | INSERT/UPDATE parameter casts (`$N::json`, `$N::jsonb`), stable SQL output |
| `postgres/test/control-adapter.test.ts` | Introspection mapping for json/jsonb columns |

### Integration Tests

| Test File | Covers |
|-----------|--------|
| `test/integration/test/contract-builder.types.test-d.ts` | Type inference: `jsonb(schema)` preserves typed output, `jsonb()` falls back to `JsonValue`, `ResultType<>` resolves correctly |
| `sql-family/test/emit-parameterized.test.ts` | Emitter renders concrete types from `typeParams.schema`, falls back to `JsonValue`, handles Arktype `.expression` shortcut |

### DDL Tests

| Test File | Covers |
|-----------|--------|
| `postgres/test/migrations/planner.case1.test.ts` | `CREATE TABLE` SQL contains `json` / `jsonb` native types |

### E2E Tests

| Test File | Covers |
|-----------|--------|
| `test/e2e/framework/test/dml.test.ts` | Insert/select typed jsonb/json values, round-trip through real Postgres, `ResultType<>` type assertions |
| `test/e2e/framework/test/runtime.projections.test.ts` | JSON columns in projections with joins and filters |
| `test/e2e/framework/test/ddl.test.ts` | DDL creates json/jsonb columns |

---

## 7. Files Changed Summary

### New Files (6)
- `packages/3-targets/6-adapters/postgres/src/core/standard-schema.ts` — Standard Schema extraction utilities
- `packages/3-targets/6-adapters/postgres/src/core/json-schema-type-expression.ts` — JSON Schema → TS type renderer
- `packages/3-targets/6-adapters/postgres/test/column-types.test.ts` — column factory tests
- `packages/3-targets/6-adapters/postgres/test/standard-schema.test.ts` — Standard Schema utility tests
- `packages/3-targets/6-adapters/postgres/test/json-schema-type-expression.test.ts` — renderer tests
- `docs/architecture docs/adrs/ADR 155 - Postgres JSON and JSONB typed columns.md`

### Modified Files (key changes)
- `postgres/src/core/codec-ids.ts` — add `PG_JSON_CODEC_ID`, `PG_JSONB_CODEC_ID`
- `postgres/src/core/codecs.ts` — add `pgJsonCodec`, `pgJsonbCodec`, `JsonValue` type
- `postgres/src/core/adapter.ts` — extend `getCodecParamCast()` for json/jsonb
- `postgres/src/core/descriptor-meta.ts` — add parameterized renderers + `JsonValue` import
- `postgres/src/core/control-adapter.ts` — extend introspection mapping
- `postgres/src/exports/column-types.ts` — add `json()`, `jsonb()`, `jsonColumn`, `jsonbColumn`
- `postgres/src/exports/codec-types.ts` — add `parameterizedOutput` for json/jsonb codecs
- `postgres/src/exports/runtime.ts` — add `parameterizedCodecDescriptors` for json/jsonb
- `postgres/README.md` — document JSON/JSONB usage and examples
- E2E fixtures: `contract.ts`, `contract.json`, `contract.d.ts` — add json/jsonb columns

---

## 8. ADR 155 — Key Decisions Documented

- `json` stores original text; `jsonb` stores binary-normalized (no whitespace, sorted keys, last-key-wins)
- Both map to `JsonValue` at the JS runtime level — behavioral differences only affect storage
- JSON `null` (a value) vs SQL `NULL` (absence of value) — both are valid in JSON columns
- Standard Schema chosen over string hints for validation, serialization, and cross-library support
- Unsupported JSON Schema constructs gracefully degrade to `JsonValue`
