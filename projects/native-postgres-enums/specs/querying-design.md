# Native Postgres enums — querying design (exhaustive)

**Status:** settled. The design of record for how a native-enum column is **typed, accessed,
executed, and decoded** on the read/query path. Deliberately exhaustive so the path does not
have to be re-derived. Parent: [`../spec.md`](../spec.md). Sibling:
[`authoring-design.md`](authoring-design.md) (how it is authored), [`migration-design.md`](migration-design.md)
(how the type is created/altered).

Every claim below is grounded in the current implementation (verified on `main`); the
relevant `file:line` is cited inline.

## 0. The one-line summary of the query path

A native-enum column is **just a column with a value-set** — the same read path a check-enum
column uses; it needs **no** native-specific typing code. Only **two** pieces are new, and both
are isolated:

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

- `s.aal` is `'aal1' | 'aal2' | 'aal3'` because the column's value-set drives its type (§2).
- `db.native_enums.auth.AalLevel` is the new facade root (§3).
- `$2::auth.aal_level` is the per-column cast (§5).
- The decoded value is the plain string `'aal2'` (§4.3 — the codec is text/identity).

## 2. The typed read surface (compile-time)

A native-enum column is typed by its **value-set**, through the existing post-TML-2952 value-set
→ codec machinery — the **same path a check-enum column uses**. The column carries a `valueSet`
ref (to the value-set derived from the `native_enum` entity, see `authoring-design.md` §2.5); no
domain enum, no parameterized-codec `renderOutputType`.

### 2.1 Emitted contract (`StorageColumnTypes`) — the value-set branch

`computeColumnType`
([2-sql/3-tooling/emitter/src/index.ts](../../../packages/2-sql/3-tooling/emitter/src/index.ts), ~L456)
gates on `if (column.valueSet)` and renders the literal union from the value-set **through the
codec** — `renderValueSetType(valueSet.values, column.codecId, side, codecLookup)` →
`codecLookup.renderValueLiteralFor(codecId, value, side)` per value → `'aal1' | 'aal2' | 'aal3'`:

```ts
function computeColumnType(storage, column, side, codecLookup): string {
  let base: string | undefined;
  if (column.valueSet) {
    const valueSet = entityAt<StorageValueSet>(storage, { …column.valueSet });
    base = valueSet ? renderValueSetType(valueSet.values, column.codecId, side, codecLookup) : undefined;
  }
  if (base === undefined) base = renderRefinedCodecType(column, side, columnTypeParams(storage, column), codecLookup);
  return column.nullable ? `${base} | null` : base;
}
```

A native-enum column carries a `valueSet` ref, so this branch fires — the **same branch a check
enum uses** (TML-2952 made it enum-agnostic: *"the domain enum is no longer a typing input"*).
`StorageColumnTypes` is consumed by the SQL builder and ORM via `ExtractStorageColumnTypes`
([2-sql/1-core/contract/src/types.ts](../../../packages/2-sql/1-core/contract/src/types.ts):103,110,198,218),
`table-proxy.ts`, `selection.ts`.

### 2.2 The domain `FieldOutputTypes` path is *not* involved

Post-2952, `resolveFieldType` gates on the field's resolved value-set, not a domain-enum
override; a native enum has no domain enum, and the SQL query surface reads `StorageColumnTypes`
(§2.1) regardless. We touch neither `resolveFieldType` nor `FieldOutputTypes`.

### 2.3 No-emit (`typeof contract`) — the one gap (TML-2960)

The no-emit path does **not** yet reach the value union for a native column. `CodecChannelType`
([2-sql/2-authoring/contract-ts/src/contract-types.ts](../../../packages/2-sql/2-authoring/contract-ts/src/contract-types.ts))
resolves a column's `typeof contract` type by **`codecId` alone** — it does not read the
`valueSet` — so a native column types as the codec's base type (`string`), not the union, in
`typeof contract`. This is the same gap **every** value-set column has today; TML-2952 explicitly
left the no-emit path untouched. Closing it (making no-emit read the value-set) is **TML-2960**,
out of scope for this slice. **Emit typing (§2.1) is what the MVP ships.**

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
content-keyed on `` `${codecId}:${canonicalizeJson(typeParams)}` ``. `pg.enum` is a **param-free
text codec** — encode/decode is identical for every native enum (text passthrough), so it
resolves to a single instance; per-enum distinction lives in the value-set (typing) and
`nativeType` (cast), not the codec.

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

**Alternative — compute the type name at render time** from the codec's `typeParams` (pass them
through to `renderTypedParam` and derive the cast type there). Rejected: the column already
carries its `nativeType`, so carrying it on the ref is simpler and keeps the SQL text builder
free of codec-param logic — no benefit to re-deriving at render.

Schema-qualification: non-`public` enum types cast as `$N::auth.aal_level`. The `native_enum`'s
`namespaceId` qualifies the type name baked onto the column at authoring time, so the qualified
name is already present when the cast is rendered.

## 6. Ordering (`ORDER BY`)

A native enum's sort order **is** the declaration order of its values (a property of the
Postgres type). So `ORDER BY aal` on a native-enum column sorts `aal1 < aal2 < aal3` using the
type's own order — **no `array_position(...)` rewrite** is needed (unlike the text+`CHECK`
strategy, where the column is plain text and order must be synthesized). This is a *reduction*
in query machinery for native enums, not an addition.

## 7. What is new vs reused (query path)

**New (small):**
1. **`db.native_enums`** facade root (§3) — Postgres-only, reuses `EnumAccessor`; new code in
   the Postgres runtime package only.
2. **Per-column `::type` cast** (§5) — the per-instance native type on the parameter +
   `renderTypedParam` preferring it. Local to the Postgres adapter + `CodecRef` builder.
3. The **`pg/enum@1` codec** itself (text decode + `renderValueLiteral` + a per-column
   `nativeType`) — new code, but the value-set → codec typing *mechanism* it plugs into is reused.

**Reused (everything else):**
- value-set → codec typing — `computeColumnType` / `renderValueSetType` / `renderValueLiteral`
  (post-TML-2952), the same path check enums use (§2).
- per-instance codec resolution `forCodecRef` / `AstCodecResolver` (§4.1).
- decode via `codec.decode` (§4.3); `pg.enum` is text/identity.
- the whole DSL → lowering → runtime pipeline.
- native type ordering removes the `array_position` rewrite (§6).

## 8. Open questions

None open in the design. Notes: the cast is always emitted via the adapter's `nativeType`
mechanism (§4–§5); the `db.native_enums` accessor types from **both** the emitted block and the
no-emit handle (§3.3). The one deferred item is **no-emit column typing** (§2.3) — tracked as
TML-2960, out of this slice's scope.
