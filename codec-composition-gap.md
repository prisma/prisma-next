# Codec Composition Gap: Per-Column Codec Resolution

## Problem

The runtime resolves codecs by looking up the codec ID in a flat registry (`registry.get(codecId)`) on every row, for every column, at decode and encode time. For simple scalar codecs like `pg/int4@1` or `pg/text@1`, this works fine — the registry returns the correct codec.

For **parameterized codecs like `pg/array@1`**, this breaks down. An `int4[]` column and a `timestamptz[]` column both have `codecId: 'pg/array@1'`, so they both resolve to the same base `pgArrayCodec`. This base codec does not know about the element type — it passes arrays through as-is without applying element-level encode/decode.

The consequence: element codecs that perform non-trivial transformations are never applied to array elements. For example:

- `timestamptz[]` — the pg driver returns `Date[]`, but the `timestamptz` codec converts `Date` → ISO string. Without composition, the runtime returns `Date[]` instead of `string[]`.
- `numeric[]` — the pg driver returns `number[]`, but the `numeric` codec converts `number` → `string` for precision safety. Without composition, the runtime returns `number[]`.
- Text protocol — if a driver returns the raw Postgres literal `{1,2,3}`, the base codec returns it as a raw string instead of parsing and element-decoding.

This currently works "by accident" for `text[]` and `int4[]` because the pg driver pre-parses those into correct JS types. But it's driver-dependent behavior, not contract-guaranteed.

## Root Cause

`createExecutionContext` registers codecs into a `CodecRegistry` keyed by codec ID. Since all array columns share `pg/array@1`, there's only one entry in the registry. There is no per-column resolution step.

A factory function `createArrayCodec(elementCodec)` exists and correctly composes element-level encode/decode. But nothing ever calls it — no code path reads `typeParams.element.codecId`, looks up the element codec, composes, and stores the result.

## Current Flow (What Happens Today)

```
Authoring:  listOf(int4Column) → { codecId: 'pg/array@1', typeParams: { element: { codecId: 'pg/int4@1' } } }
    ↓
Emission:   Written to contract.json. Type renderer reads element.codecId → emits Array<number>.
    ↓
Context:    createExecutionContext registers pgArrayCodec under 'pg/array@1'.
            Column typeParams are validated against arrayParamsSchema. That's it.
            element.codecId is never used to compose a per-column codec.
    ↓
Decode:     resolveRowCodec calls registry.get('pg/array@1') → base pgArrayCodec.
            decode(wire) passes the array through. Element codec not consulted.
    ↓
Encode:     resolveParamCodec calls registry.get('pg/array@1') → base pgArrayCodec.
            No encode function. Array passes through. Element codec not consulted.
```

## Proposed Fix

Resolve per-column codecs **upfront** during `createExecutionContext`, not at decode/encode time.

During context creation, for each column in the contract:
1. Look up the column's codec from the registry
2. If the column has `typeParams` and the codec is composable (e.g. `pg/array@1`), look up `typeParams.element.codecId` from the registry and call `createArrayCodec(elementCodec)`
3. Store the resulting composed codec in a per-column map (e.g. `Map<"table.column", Codec>`)

The decode/encode paths would check this map first, falling back to the registry for non-composed codecs.

This would also be faster for *all* codecs — resolve once at startup instead of a registry lookup on every row.

### Possible Mechanism: `init` Hook on `CodecParamsDescriptor`

`CodecParamsDescriptor` already has an optional `init` hook, but it's currently only used for `storage.types` entries (named type helpers), and its result goes into `context.types` — not back into the codec pipeline. The `init` hook could be repurposed or a new hook (e.g. `compose(params, registry) → Codec`) could be added.

## Tests Exposing the Gap

`packages/2-sql/5-runtime/test/array-codec-composition.test.ts` contains 5 tests that demonstrate the missing behavior:

- **Decode `timestamptz[]`**: Asserts that `Date` objects are NOT converted to ISO strings (they should be)
- **Decode `numeric[]`**: Asserts that numbers are NOT converted to strings (they should be)
- **Decode text protocol array**: Asserts that raw `{...}` string is NOT parsed (it should be)
- **Encode `timestamptz[]`**: Asserts that `Date` objects are NOT converted to ISO strings (they should be)
- **Encode `numeric[]`**: Passes through (correct by coincidence, not by design)

When the fix is implemented, these tests should be updated to assert the opposite — that element-level transformations ARE applied.

## Relevant Files

### Codec definition and composition
- `packages/3-targets/6-adapters/postgres/src/core/array-codec.ts` — `createArrayCodec` factory, `pgArrayCodec` base codec, `parsePgTextArray`, `formatPgTextArray`
- `packages/3-targets/6-adapters/postgres/src/core/codecs.ts` — All Postgres codec definitions (see `pgTimestamptzCodec`, `pgNumericCodec` for non-trivial transformations)
- `packages/3-targets/6-adapters/postgres/src/core/codec-ids.ts` — `PG_ARRAY_CODEC_ID` constant

### Runtime context creation
- `packages/2-sql/5-runtime/src/sql-context.ts` — `createExecutionContext` and all helper functions. This is where per-column codec resolution should happen.

### Runtime encode/decode (the hot path)
- `packages/2-sql/5-runtime/src/codecs/decoding.ts` — `decodeRow`, `resolveRowCodec` — does `registry.get(codecId)` per column per row
- `packages/2-sql/5-runtime/src/codecs/encoding.ts` — `encodeParams`, `resolveParamCodec` — does `registry.get(codecId)` per parameter

### Codec registry
- `packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts` — `CodecRegistry` interface, `CodecParamsDescriptor` (has `init` hook), `Codec` interface

### Execution context interface
- `packages/2-sql/4-lanes/relational-core/src/query-lane-context.ts` — `ExecutionContext` type (would need a new field for per-column codec map)

### Runtime adapter registration
- `packages/3-targets/6-adapters/postgres/src/exports/runtime.ts` — Where `pgArrayCodec` and its `arrayParamsSchema` are registered as a `RuntimeParameterizedCodecDescriptor`

### Tests
- `packages/2-sql/5-runtime/test/array-codec-composition.test.ts` — Tests exposing the gap
- `packages/3-targets/6-adapters/postgres/test/array-codec.test.ts` — Unit tests for `createArrayCodec`, `parsePgTextArray`, `formatPgTextArray`

### ADR
- `docs/architecture docs/adrs/ADR 162 - List types as parameterized array codecs.md` — Documents the known limitation under "Costs"

### Authoring
- `packages/3-targets/6-adapters/postgres/src/exports/column-types.ts` — `listOf()` helper
