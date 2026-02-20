# ADR 162 — List types as parameterized array codecs

## Context

Users need to store ordered collections of scalar values in database columns — tags on a post, scores on a game, feature vectors of IDs. Postgres supports this natively via typed arrays (`text[]`, `integer[]`, `timestamptz[]`). Other databases have analogous concepts (MongoDB arrays, MySQL JSON arrays) but with fundamentally different wire semantics.

Prisma Next's contract is target-agnostic at the IR level, but codec implementations are target-specific (ADR 030, "thin core, fat targets"). We need a representation that:

- works within the existing parameterized codec pattern (like `pg/enum@1` and `pg/vector@1`)
- preserves element-level type safety in generated `contract.d.ts`
- integrates with every layer: authoring, lowering, type generation, introspection, verification, and runtime

## What problem are we solving?

There is no way to declare a column that holds an ordered list of scalar values. Developers must resort to JSON columns (losing type safety) or manual DDL (losing contract-first guarantees).

Specifically, we need:

- a contract IR representation for list columns that is target-agnostic in shape but target-specific in codec ID
- an authoring helper so developers don't hand-assemble typeParams
- correct SQL lowering (parameter casts like `$1::text[]`)
- correct type emission in `contract.d.ts` (e.g. `Array<number>`, `Array<string | null>`)
- runtime encode/decode that applies the element codec to each array element, regardless of driver wire format
- introspection that maps Postgres array columns back to the contract representation
- schema verification that compares expected vs actual array types

## Design constraints

- **Parameterized codec pattern**: list types must use the existing `codecId` + `typeParams` mechanism, not a new field on `StorageColumn`. This keeps the contract IR stable.
- **Element codec composition**: the array codec must delegate to the element codec for per-element encode/decode, preserving type safety through generics.
- **No nested lists**: single-dimension arrays only. This matches Postgres best practices and avoids combinatorial complexity.
- **Postgres only (v1)**: the contract IR shape is generic, but only the Postgres adapter implements codecs, lowering, introspection, and verification. Future adapters (MongoDB, MySQL JSON) would use their own codec IDs.
- **Wire format duality**: Postgres delivers array data as either text literals (`{1,2,3}`) in text protocol mode or pre-parsed JS arrays in binary mode. The codec must handle both.

## Decision

### 1) Contract IR: parameterized `pg/array@1` codec

Array columns use the same `StorageColumn` shape as any other parameterized type:

```json
{
  "tags": {
    "codecId": "pg/array@1",
    "nativeType": "text[]",
    "nullable": true,
    "typeParams": {
      "element": {
        "codecId": "pg/text@1",
        "nativeType": "text"
      },
      "nullableElement": false
    }
  }
}
```

- `element` — the full element type descriptor (nested `ColumnTypeDescriptor`), containing `codecId`, `nativeType`, and optionally its own `typeParams`. This avoids duplicating element metadata across separate `element`, `elementNativeType`, and `elementTypeParams` fields.
- `nullableElement` — whether individual elements can be null, distinct from column-level `nullable`

#### Nullability model

Array columns support all four combinations of column-level and element-level nullability:

| `nullable` | `nullableElement` | TS type | Meaning |
|---|---|---|---|
| `false` | `false` | `Array<number>` | Required array, no null elements |
| `true` | `false` | `Array<number> \| null` | Optional array, no null elements |
| `false` | `true` | `Array<number \| null>` | Required array, elements may be null |
| `true` | `true` | `Array<number \| null> \| null` | Optional array, elements may be null |

Column-level `nullable` controls whether the entire array value can be `null`. `nullableElement` controls whether individual elements within the array can be `null`. These are orthogonal concerns.

#### Why `nullableElement` is top-level in `typeParams`, not inside `element`

`nullableElement` is a property of the *array type* ("this array permits null holes"), not a property of the *element type* ("what int4 means"). The `element` object is structurally a `ColumnTypeDescriptor` — the same shape used for standalone columns. A standalone `int4` column has no concept of "nullable element"; that notion only exists in the context of a container.

Placing `nullableElement` inside `element` would conflate the element's identity with the container's nullability rules, breaking the structural alignment between `element` and `ColumnTypeDescriptor`. It would also mean the `element` object could no longer be treated as a plain element descriptor in contexts that don't care about the container (e.g., codec lookup, type expansion).

### 2) Authoring: `listOf()` helper

```ts
import { int4Column, listOf } from '@prisma-next/adapter-postgres/column-types';

const scores = listOf(int4Column, { nullableElement: true });
// → { codecId: 'pg/array@1', nativeType: 'int4[]', typeParams: { element: { codecId: 'pg/int4@1', nativeType: 'int4' }, nullableElement: true } }
```

`listOf` nests the element descriptor directly into `typeParams.element`, avoiding duplication of element metadata.

### 3) Codec: generic factory with element delegation

Two codec artifacts:

- **`pgArrayCodec`** — base codec registered in the codec registry as `pg/array@1`. Uses `unknown` wire/JS types. Handles the common case where the pg driver returns pre-parsed arrays. Carries the arktype params schema for runtime validation.

- **`createArrayCodec(elementCodec)`** — factory that produces a composed codec with correct generics:

```ts
function createArrayCodec<TElementWire, TElementJs>(
  elementCodec: Codec<string, TElementWire, TElementJs>,
): Codec<
  typeof PG_ARRAY_CODEC_ID,
  string | (TElementWire | null)[],    // wire: text literal OR pre-parsed array
  (TElementJs | null)[]                 // JS: always array with nullable elements
>
```

Both artifacts share `pg/array@1` as their codec ID. The registry can only hold one entry per ID, so only the base `pgArrayCodec` is registered. `createArrayCodec` exists as a composition primitive but is not yet wired into the runtime — see [Runtime codec composition gap](#runtime-codec-composition-gap) below.

The wire type union reflects the two paths:
- `string` — Postgres text array literal (e.g. `{1,2,3}`), parsed by `parsePgTextArray`
- `(TElementWire | null)[]` — pre-parsed by the pg driver in binary mode

`parsePgTextArray` and `formatPgTextArray` handle the Postgres text array wire format, including quoting, escaping, and NULL representation.

### 4) SQL lowering: always-cast parameters

All DML parameters (INSERT values, UPDATE SET) are cast to their column's `nativeType`:

```sql
INSERT INTO "post" ("id", "tags") VALUES ($1::int4, $2::text[])
UPDATE "post" SET "scores" = $1::int4[] WHERE ...
```

The adapter appends `::nativeType` to every parameter in INSERT/UPDATE contexts using the column metadata from the contract. This is universal — no codec-specific branching. Scalar casts like `$1::int4` are redundant but harmless; extension types like `$1::vector` and array types like `$1::text[]` require them. This eliminates the need for the adapter to know about specific codec IDs, keeping extension types like pgvector fully decoupled from core adapter code.

### 5) Type generation: parameterized type renderer

The `pg/array@1` renderer in `descriptor-meta.ts` emits TypeScript types by reading `element.codecId` from the nested element descriptor:

```ts
// For element: { codecId: 'pg/int4@1', nativeType: 'int4' }, nullableElement: false
Array<CodecTypes['pg/int4@1']['output']>

// For element: { codecId: 'pg/text@1', nativeType: 'text' }, nullableElement: true
Array<CodecTypes['pg/text@1']['output'] | null>
```

### 6) Introspection: array type normalization

Postgres reports array columns via `information_schema` with `data_type = 'ARRAY'` and `udt_name` prefixed with `_` (e.g. `_text`, `_int4`). The `format_type()` function returns the human-readable form (e.g. `integer[]`).

`normalizeSchemaNativeType` and `normalizeFormattedType` strip the `[]` suffix, normalize the base type (e.g. `integer` → `int4`), and re-append `[]`. This produces canonical forms like `int4[]`, `timestamptz[]` for verification comparison.

### 7) Schema verification: array type expansion

`expandParameterizedNativeType` constructs the expected native type from `element.nativeType` + `[]` suffix when the codec is `pg/array@1`. Verification then compares this against the introspected native type.

### 8) Target scope and future extensibility

This implementation is Postgres-specific (`pg/array@1`). The contract IR shape (codecId + typeParams with element reference) is reusable, but other targets would use their own codec IDs:

- **MongoDB**: arrays are native BSON — a `mongo/array@1` codec would likely be identity (no parsing), since the driver handles everything
- **MySQL**: no native array type — arrays would map to JSON columns with a different codec and different wire semantics
- **CockroachDB**: Postgres-compatible, could reuse `pg/array@1` directly

Each target owns its codec implementation. The contract IR pattern is shared; the wire mechanics are not.

## Worked example: insert and select with array columns

### Scenario

- Table `post` with `tags text[] NOT NULL` and `scores int4[]`
- Insert a row, then select it back

### Contract

```json
{
  "post": {
    "columns": {
      "id": { "codecId": "pg/int4@1", "nativeType": "int4", "nullable": false },
      "tags": {
        "codecId": "pg/array@1", "nativeType": "text[]", "nullable": false,
        "typeParams": { "element": { "codecId": "pg/text@1", "nativeType": "text" } }
      },
      "scores": {
        "codecId": "pg/array@1", "nativeType": "int4[]", "nullable": true,
        "typeParams": { "element": { "codecId": "pg/int4@1", "nativeType": "int4" } }
      }
    }
  }
}
```

### Authoring

```ts
import { int4Column, textColumn, listOf } from '@prisma-next/adapter-postgres/column-types';

// Using defineContract builder:
.table('post', (t) =>
  t
    .column('id', { type: int4Column })
    .column('tags', { type: listOf(textColumn) })
    .column('scores', { type: listOf(int4Column), nullable: true })
    .primaryKey(['id']),
)
```

### Flow

#### A) Lane produces AST with parameter references

- Plan `params`: `[1, ['prisma', 'typescript'], [95, 87, 100]]`

#### B) Adapter lowers to SQL with casts

```sql
INSERT INTO "post" ("id", "tags", "scores") VALUES ($1::int4, $2::text[], $3::int4[])
```

The `::int4`, `::text[]`, and `::int4[]` casts are emitted universally for all DML parameters based on the column's `nativeType`.

#### C) Codec encodes parameters

For the base `pgArrayCodec`, arrays pass through as-is (the pg driver accepts JS arrays directly for array parameters).

#### D) Driver binds and executes

The pg driver serializes the JS arrays into the Postgres wire protocol.

#### E) Driver returns row values

On SELECT, the pg driver returns arrays as JS arrays (binary mode) or the runtime receives text literals (text mode).

#### F) Codec decodes row values

The runtime calls `registry.get('pg/array@1')` which returns the base `pgArrayCodec`:

- Binary mode: `pgArrayCodec.decode([95, 87, 100])` → `[95, 87, 100]` (passthrough)
- Text mode: `pgArrayCodec.decode('{95,87,100}')` → `['95', '87', '100']` (parsed from text literal, elements remain strings)

The element codec (`pg/int4@1`) is **not** consulted for individual elements. For `int4[]` and `text[]` this produces correct results because the pg driver pre-parses elements into the correct JS types. For element types with non-trivial transformations (e.g. `timestamptz` converting `Date` → ISO string), element-level decoding would not be applied. See [Runtime codec composition gap](#runtime-codec-composition-gap).

### Generated TypeScript type

```ts
// In contract.d.ts
tags: Array<CodecTypes['pg/text@1']['output']>        // Array<string>
scores: Array<CodecTypes['pg/int4@1']['output']> | null // Array<number> | null
```

## Consequences

### Benefits

- No new fields on `StorageColumn` — uses the established parameterized codec pattern
- Full type safety from authoring through runtime: element types flow through generics
- Introspection and verification work with no special-case schema queries
- Universal `::nativeType` parameter casting eliminates codec-specific branching in the adapter, keeping extension types decoupled from core
- Clear extensibility path for other targets without shared implementation coupling

### Costs

- `parsePgTextArray` / `formatPgTextArray` add ~80 lines of parsing logic; this is tested but is a surface for edge cases in exotic array content
- No query operators (`@>`, `<@`, `&&`, `ANY()`) — follow-up work
- Element-level codec composition is not yet wired into the runtime — see next section

### Runtime codec composition gap

The runtime resolves codecs by doing a flat `registry.get(codecId)` lookup per column, per row, at decode and encode time. All array columns share `codecId: 'pg/array@1'`, so they all resolve to the same base `pgArrayCodec`, which passes arrays through without applying element-level transformations.

`createArrayCodec(elementCodec)` exists as a factory that correctly composes element-level encode/decode. But no code path calls it: nothing reads `typeParams.element.codecId`, looks up the element codec from the registry, composes a per-column codec, and stores it where the encode/decode paths can find it.

**What works today**: `text[]` and `int4[]` — the pg driver pre-parses these into correct JS types (`string[]`, `number[]`), so the base codec's passthrough produces correct results.

**What breaks**: Element types with non-trivial codec transformations:
- `timestamptz[]` — the codec converts `Date` → ISO string, but element decode is never applied, so the runtime returns `Date[]` instead of `string[]`
- `numeric[]` — the codec converts `number` → `string` for precision safety, but element decode is never applied
- Text protocol — if a driver returns the raw Postgres literal `{1,2,3}`, the base codec returns it as a raw string instead of parsing and element-decoding

**Why this is a problem**: The contract says "this column's element type is `pg/timestamptz@1`" but the runtime never applies that codec. Correct behavior depends on the pg driver's pre-parsing, which is driver-specific and not guaranteed by the contract.

**Path forward**: Resolve per-column codecs upfront during `createExecutionContext` instead of at decode/encode time. For each column with `typeParams`, compose the appropriate codec (e.g. `createArrayCodec(elementCodec)`) and store it in a per-column map. The decode/encode paths would check this map first, falling back to the registry for non-composed codecs. See `codec-composition-gap.md` in the repo root for a detailed analysis.

Tests exposing this gap exist in `packages/2-sql/5-runtime/test/array-codec-composition.test.ts`.

### Out of scope

- Multi-dimensional arrays (`integer[][]`)
- Array query operators
- Non-Postgres targets
- Nested lists / composite element types

## Related

- ADR 030 — Result decoding & codecs registry
- ADR 114 — Extension codecs & branded types
- ADR 131 — Codec typing separation
- ADR 155 — Driver/Codec boundary value representation and responsibilities
