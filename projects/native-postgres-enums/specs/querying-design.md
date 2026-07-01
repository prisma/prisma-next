# Native Postgres enums — querying design (exhaustive)

**Status:** settled. The design of record for how a native-enum column is **typed, accessed,
executed, and decoded** on the read/query path. Deliberately exhaustive so the path does not
have to be re-derived. Parent: [`../spec.md`](../spec.md). Sibling:
[`authoring-design.md`](authoring-design.md) (how it is authored), [`migration-design.md`](migration-design.md)
(how the type is created/altered).

Every claim below is grounded in the current implementation (verified on `main`); the
relevant `file:line` is cited inline.

## 0. The one-line summary of the query path

A native-enum column is **just a column with a codec and a value-set**. The read path is the
*existing* SQL read path — it needs **no** native-specific typing code. Only **two** pieces
are new, and both are isolated:

1. a **`db.native_enums`** facade root (runtime member access), a Postgres-only sibling of
   `db.enums`;
2. the **`::type` cast** on bound parameters, whose type name is now per-column rather than
   per-codec — a small wiring change to the adapter's existing `nativeType` cast (§5).

Everything else — the literal-union type, codec resolution, decode, ordering — falls out of
machinery that already ships.

## 1. Worked example

`auth.aal_level` (from `authoring-design.md` §1), queried:

```ts
const s = await db.auth.sessions.findOne({ where: { id, aal: db.native_enums.auth.AalLevel.members.aal2 } })
s.aal   // typed 'aal1' | 'aal2' | 'aal3'  — not string
```

Generated SQL — the bound `aal` parameter carries the enum type as an explicit cast:

```sql
SELECT "aal" FROM "auth"."sessions" WHERE "id" = $1::uuid AND "aal" = $2::auth.aal_level
```

- `s.aal` is `'aal1' | 'aal2' | 'aal3'` because the column carries a `valueSet` ref (§2).
- `db.native_enums.auth.AalLevel` is the new facade root (§3).
- `$2::auth.aal_level` is the per-column cast (§5).
- The decoded value is the plain string `'aal2'` (§4.3 — the codec is text/identity).

## 2. The typed read surface (compile-time)

There are two parallel type carriers, and native enums use the **storage** one — which is
exactly why they need no new typing code.

### 2.1 SQL query-builder / ORM types — from the storage value-set (lands today)

`StorageColumnTypes` / `StorageColumnInputTypes` (TML-2886, **landed**) map
`[namespace][table][column]` to a TS type. The value is computed by `computeColumnType`
([2-sql/3-tooling/emitter/src/index.ts](../../../packages/2-sql/3-tooling/emitter/src/index.ts),
~L425): when a column has a `valueSet`, it resolves the storage `StorageValueSet` and renders
`renderValueSetUnionBase(valueSet.values)` — the literal union — **before** any codec
fallback:

```ts
function computeColumnType(storage, column, side, codecLookup): string {
  let base: string | undefined;
  if (column.valueSet) {
    const valueSet = entityAt<StorageValueSet>(storage, { …column.valueSet });
    base = valueSet ? renderValueSetUnionBase(valueSet.values) : undefined;
  }
  if (base === undefined) base = renderRefinedCodecType(column, side, columnTypeParams(storage, column), codecLookup);
  return column.nullable ? `${base} | null` : base;
}
```

A native-enum column carries a `valueSet` ref (`authoring-design.md` §1), so this branch
fires and the column types as `'aal1' | 'aal2' | 'aal3'` — **no domain enum, no
native-specific path, today.** These maps are consumed by the SQL builder and ORM via
`ExtractStorageColumnTypes` ([2-sql/1-core/contract/src/types.ts](../../../packages/2-sql/1-core/contract/src/types.ts):103,110,198,218),
`table-proxy.ts`, `selection.ts`.

### 2.2 The domain `FieldOutputTypes` path is *not* involved

`resolveFieldType`'s enum branch ([1-framework/3-tooling/emitter/src/domain-type-generation.ts:313](../../../packages/1-framework/3-tooling/emitter/src/domain-type-generation.ts:313))
builds a union only when `field.valueSet.entityKind === 'enum'`, by reading the **domain**
enum via `domainEnumLookup` (`generate-contract-dts.ts:155`). A native enum has **no domain
enum**, and the plane-directionality rule forbids a domain field from referencing the storage
value-set ([value-set-ref.ts](../../../packages/1-framework/0-foundation/contract/src/value-set-ref.ts)).
So `FieldOutputTypes` simply does not produce the union for a native-enum field — and it does
not need to, because the SQL/ORM query surface reads `StorageColumnTypes` (§2.1). We touch
neither `resolveFieldType` nor `FieldOutputTypes`.

### 2.3 The no-emit (`typeof contract`) path

The handle-based path mirrors the storage carrier at the type level:
`StorageColumnChannelTypes` / `FieldChannelType` in
[2-sql/2-authoring/contract-ts/src/contract-types.ts](../../../packages/2-sql/2-authoring/contract-ts/src/contract-types.ts)
extract the literal union directly from the authored handle. For an enum field
`EnumValueUnion` pulls the `Values` tuple off the `EnumTypeHandle` generic. The native-enum
column handle carries the same value-set/values, so the no-emit union matches the emitted one.

### 2.4 After the enum-typing-via-codec refactor (TML-2952/2953)

`renderValueType` does **not** exist today (confirmed: no implementation under `packages/`;
it is a planned `CodecDescriptor` method). When TML-2952/2953 land, `computeColumnType`'s
value-set branch is re-routed through `codec.renderValueType(value, channel)` instead of the
free `renderValueSetUnionBase`. Because enum codecs are **text/identity** (the encoded value
*is* the output literal), the rendered union is identical. So native enums are built to the
codec-driven typing but do **not** depend on it — the SQL/ORM union already lands via §2.1.

## 3. Runtime member access — the `db.native_enums` facade root (new)

This is the only new read-side code, and it is confined to the Postgres facade.

### 3.1 The existing `db.enums` (unchanged)

`db.enums` is built by `buildNamespacedEnums(contract.domain)`
([1-framework/0-foundation/contract/src/enum-accessor.ts:66](../../../packages/1-framework/0-foundation/contract/src/enum-accessor.ts:66)),
which walks `domain.namespaces[ns].enum[name]` — a `ContractEnum { codecId, members }`
([domain-types.ts:36](../../../packages/1-framework/0-foundation/contract/src/domain-types.ts:36)) —
and produces an `EnumAccessor` per enum ([enum-accessor.ts:15](../../../packages/1-framework/0-foundation/contract/src/enum-accessor.ts:15)):

```ts
interface EnumAccessor {
  readonly values: readonly JsonValue[];
  readonly names: readonly string[];
  readonly members: Readonly<Record<string, JsonValue>>;  // name → value
  has(v): boolean; hasName(n): boolean; nameOf(v): string | undefined; ordinalOf(v): number;
}
```

Postgres attaches it as `db.enums` ([3-extensions/postgres/src/runtime/postgres.ts:264](../../../packages/3-extensions/postgres/src/runtime/postgres.ts:264)).
It reads the **domain** plane only — a storage-plane native enum never appears here, and we
do not change that.

### 3.2 The new `db.native_enums`

A **new facade root**, sibling of `db.enums`, **composed into the Postgres client only**
(mirroring where `enums` is attached, `postgres.ts:264`). It:

- has the **same accessor shape** — reuse `EnumAccessor` / `ContractEnumAccessor` verbatim;
- is built by a `buildNamespacedNativeEnums(contract.storage)` analog of
  `buildNamespacedEnums` that walks the **storage** `native_enum` entities
  (`storage.namespaces[ns].entries.native_enum[name].members`) instead of the domain `enum`
  slot — the member shape is the same `{ name, value }[]`, so the accessor factory
  (`createEnumAccessor`) is reused unchanged;
- is **Postgres-only** — Mongo/SQLite clients have no native enums and gain no such field.

```ts
db.native_enums.auth.AalLevel.values        // readonly ['aal1','aal2','aal3']
db.native_enums.auth.AalLevel.members.aal1  // 'aal1'
db.native_enums.auth.AalLevel.has('aal2')   // true
```

### 3.3 Typing the accessor

The accessor's TS type reuses the existing `ContractEnumAccessor<Entry>` /
`NamespacedEnums<TContract>` machinery ([enum-accessor.ts:99](../../../packages/1-framework/0-foundation/contract/src/enum-accessor.ts:99)),
pointed at the storage `native_enum` block instead of the domain `enum` block. The emitted
`contract.d.ts` already literalizes storage entries; the Postgres client interface adds a
`native_enums` field typed as a `NativeEnums<TContract>` derived the same way `NamespacedEnums`
is, but over `TContract['storage']['namespaces'][Ns]['entries']['native_enum']`. No framework
type changes — the derivation lives in the Postgres runtime package. **Both paths are
covered:** the emitted `contract.d.ts` storage block *and* the no-emit (`typeof contract`)
handle (the same dual source `NamespacedEnums` already supports via its
`enumAccessors`-vs-`enum` branch). The no-emit path must work, or `typeof contract` consumers
lose the accessor.

## 4. The runtime execution path (DSL → SQL + params → decode)

### 4.1 Codec resolution is already per-instance

Every AST node carries a `codec: CodecRef` (`{ codecId, typeParams, many }`). At runtime the
`ContractCodecRegistry` resolves a **distinct codec instance per `(codecId, typeParams)`** via
`forCodecRef` — `buildContractCodecRegistry`
([2-sql/5-runtime/src/sql-context.ts](../../../packages/2-sql/5-runtime/src/sql-context.ts):~494)
uses `createAstCodecResolver`
([ast-codec-resolver.ts](../../../packages/2-sql/5-runtime/src/codecs/ast-codec-resolver.ts):31),
content-keyed on `` `${codecId}:${canonicalizeJson(typeParams)}` ``. So `pg.enum`'s
`typeParams.ref` distinguishes one native enum from another **for encode/decode with no new
machinery** — this is the same mechanism `vector(1536)` rides.

### 4.2 The parameter cast (`renderTypedParam`) — static today

`renderTypedParam(index, codecId, codecLookup, many)`
([3-targets/6-adapters/postgres/src/core/sql-renderer.ts:72](../../../packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts:72))
decides whether to append `::<type>` to a bound parameter. Today it reads a **static**
per-codec-id native type: `codecLookup.metaFor(codecId).db.sql.postgres.nativeType`, and
appends the cast when that type is **not** in the inferrable allow-list
`POSTGRES_INFERRABLE_NATIVE_TYPES` (`sql-renderer.ts:46`). Its callers (`renderParamRef`,
`sql-renderer.ts:746/757`) forward only `codecId` and `many` — **`typeParams` is not passed
in.**

`CodecDescriptor.meta` is a plain, static field ([codec-descriptor.ts:39](../../../packages/1-framework/1-core/framework-components/src/shared/codec-descriptor.ts:39)),
one value per codec id (proven: every `vector(N)` shares one `PG_VECTOR_META`,
[pgvector/src/core/codecs.ts:44](../../../packages/3-extensions/pgvector/src/core/codecs.ts:44)).
`CodecLookup.metaFor` takes a `codecId` only ([codec-types.ts:47](../../../packages/1-framework/1-core/framework-components/src/shared/codec-types.ts:47)).

**Why the per-column value must reach the cast:** all native enums share **one** codec id
(`pg/enum@1`), but each has its **own** Postgres type name (`auth.aal_level`,
`public.user_role`, …). A single static `meta.nativeType` cannot serve them. The per-column
`nativeType` is dropped when the `CodecRef` is built (`codecRefForStorageColumn`, §5), so the
fix just threads it through — small and local. §5.

### 4.3 Decode

Result decoding resolves a codec per projection item via
`ContractCodecRegistry.forCodecRef(item.codec)`
([2-sql/5-runtime/src/codecs/decoding.ts:38](../../../packages/2-sql/5-runtime/src/codecs/decoding.ts:38))
and calls `codec.decode(wireValue, cellCtx)` per cell (`decoding.ts:226`), driven by
`decodeRow` (`decoding.ts:245`) from the runtime loop (`sql-runtime.ts:360`). The `pg.enum`
codec is **text/identity**: `decode('aal2') → 'aal2'`. No new decode path; no runtime
value-validation (the type and the compile-time union already constrain the value — the parent
project ruled out a third runtime check).

## 5. The `::type` cast — a small wiring change to the adapter's existing mechanism

The adapter already casts by `nativeType`; the per-column type name just has to reach
`renderTypedParam`. Two ways; recommendation first, in plain terms.

**Recommended — carry the resolved type name on the lowered parameter.** The column already
stores its own Postgres type name in `StorageColumn.nativeType`
([storage-column.ts:15](../../../packages/2-sql/1-core/contract/src/ir/storage-column.ts:15))
— for a native-enum column that field is `aal_level` (schema-qualified `auth.aal_level`).
That type name is currently dropped when the `CodecRef` is built (`codecRefForStorageColumn`
[relational-core/src/codec-ref-for-column.ts:22](../../../packages/2-sql/4-lanes/relational-core/src/codec-ref-for-column.ts:22)
reads `typeRef`/`typeParams`/`codecId`/`many`, never `nativeType`); stamp it there onto the
`CodecRef`. `renderTypedParam` then
**prefers a type name carried on the parameter** over the static `metaFor(codecId)` lookup,
and emits `$N::auth.aal_level`. The SQL text builder gains **no** knowledge of enums or the
contract — it just uses an attached type name when present, and falls back to the static codec
meta for every other codec (`vector`, `jsonb`, text, …). `aal_level` is not in
`POSTGRES_INFERRABLE_NATIVE_TYPES`, so the cast is always emitted.

Concretely, the change is: (a) the lowerer stamps the parameter with the column's `nativeType`
for `pg.enum` columns; (b) `renderTypedParam` reads a ref-carried `nativeType` first. Additive
and local to the Postgres adapter + lowerer.

**Alternative — resolve at render time.** Pass `typeParams` through to `renderTypedParam` and
give the SQL text builder a resolver so it can look up the `native_enum` entity from
`typeParams.ref` and read its type name. Rejected as the default: it couples the text builder
to codec params and entity resolution (contract knowledge it does not have today), for no
benefit over resolving once during lowering.

Schema-qualification: non-`public` enum types cast as `$N::auth.aal_level`. The resolved
`native_enum` carries its `namespaceId`, so the qualified name is available at lowering time —
another reason to resolve there, not at render.

## 6. Ordering (`ORDER BY`)

A native enum's sort order **is** the declaration order of its values (a property of the
Postgres type). So `ORDER BY aal` on a native-enum column sorts `aal1 < aal2 < aal3` using the
type's own order — **no `array_position(...)` rewrite** is needed (unlike the text+`CHECK`
strategy, where the column is plain text and order must be synthesized). This is a *reduction*
in query machinery for native enums, not an addition.

## 7. What is new vs reused (query path)

**New (two pieces):**
1. **`db.native_enums`** facade root (§3) — Postgres-only, reuses `EnumAccessor`; new code in
   the Postgres runtime package only.
2. **Per-column `::type` cast** (§5) — the per-instance native type on the parameter +
   `renderTypedParam` preferring it. Local to the Postgres adapter + lowerer.

**Reused (everything else):**
- `StorageColumnTypes` value-union typing (§2.1, TML-2886, landed).
- per-instance codec resolution `forCodecRef` / `AstCodecResolver` (§4.1).
- decode via `codec.decode` (§4.3); `pg.enum` is text/identity.
- the whole DSL → lowering → runtime pipeline; no-emit typing (§2.3).
- native type ordering removes the `array_position` rewrite (§6).

## 8. Open questions

None. The cast is always emitted via the adapter's `nativeType` mechanism (§4–§5); the
`db.native_enums` accessor types from **both** the emitted `contract.d.ts` block and the
no-emit handle (§3.3).
