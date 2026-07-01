# Native Postgres enums — authoring design (exhaustive)

**Status:** settled. This is the design of record for how a native Postgres enum is
authored, represented, typed, cast, and enforced. It is deliberately exhaustive so the
design does not have to be re-derived. Parent: [`../spec.md`](../spec.md).

Grounded in the current machinery (all verified on `main`):
- pack-contributed entities: `postgresAuthoringEntityTypes` + `postgresAuthoringPslBlockDescriptors` + a lowering factory ([postgres/src/core/authoring.ts](../../../packages/3-targets/3-targets/postgres/src/core/authoring.ts)) — the RLS `policy`/`role` pattern.
- the PSL generic extension block `kw [name] { key = value }` ([psl-parser syntax-kind.ts](../../../packages/1-framework/2-authoring/psl-parser/src/syntax/syntax-kind.ts)).
- parameterized codecs (ADR 208) referenced via `field.column(vector(1536))` / a PSL function-call field type.
- the SQL cast policy `renderTypedParam` reading **static** `meta.db.sql.postgres.nativeType` per codec-id ([adapter-postgres sql-renderer.ts](../../../packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts), ADR 205).
- the parameterized-codec typing machinery — `renderOutputType` (the `vector(N)` path).

## 0. One construct, not two

A native Postgres enum is authored with **one construct**: a pack-contributed
`native_enum` **entity** plus a `pg.enum(<ref>)` **codec** on the fields that use it. There
is **no "domain enum realized as native"** path — a native enum is a Postgres *type*, not a
domain enum (see `../spec.md` "Decision"). The `native_enum` entity provides everything the
app needs: its members drive a new **`db.native_enums`** facade root (a Postgres-only sibling
of `db.enums`, §5) and are baked into the `pg.enum` codec's params (which drives typing, §5);
the managed phase renders `CREATE TYPE` from them. There is **no value-set** on the native path.

The two cases differ only in **control grade** and **who owns the type**, not in the
authoring surface:

| | declares | grade | PN emits DDL? |
| --- | --- | --- | --- |
| **Externally-managed (Supabase) / adopted** — phase 1 | the extension (in its `contract.prisma`), or contract-infer on adoption | `external` (the pack's `defaultControlPolicy`) | no — the type already exists |
| **Authored** — phase 2 | a user | `managed` (default) | yes — `CREATE TYPE`, and the cheap in-place ops |

> This supersedes the earlier "phase-2 = realize a domain enum as a native type" framing.
> Converting an existing check-realized domain enum to native (or back) remains a non-goal
> (a realization swap; see `../spec.md`).

## 1. Worked example (the shape everything below elaborates)

Supabase's `auth.aal_level` (`CREATE TYPE auth.aal_level AS ENUM ('aal1','aal2','aal3')`),
used by sessions. **PSL** (in the Supabase extension's `contract.prisma`):

```prisma
namespace auth {
  native_enum AalLevel {        // pack-contributed entity (like a policy/role block)
    aal1 = "aal1"               // variadic `memberName = "value"` list
    aal2 = "aal2"
    aal3 = "aal3"
    @@map("aal_level")          // the Postgres type name (as models @@map to table names)
  }

  model AuthSession {
    id  Uuid            @id
    aal pg.enum(AalLevel)       // field bound to the pg.enum codec (values baked from the block)
    @@map("sessions")
  }
}
```

**Emitted contract** (`storage` plane, `public`/`auth` namespace):

```jsonc
"storage": { "namespaces": { "auth": { "entries": {

  "native_enum": {
    "AalLevel": {
      "kind": "postgres-enum",
      "typeName": "aal_level",
      "members": [ { "name": "aal1", "value": "aal1" },
                   { "name": "aal2", "value": "aal2" },
                   { "name": "aal3", "value": "aal3" } ],
      "control": "external"
    }
  },

  "table": { "sessions": { "columns": {
    "aal": {
      "nativeType": "aal_level",                             // → the $N::aal_level cast
      "codecId": "pg/enum@1",
      "typeParams": { "values": ["aal1", "aal2", "aal3"] },  // → typing (the value union)
      "nullable": false
    }
  } } }
} } } }
```

**Generated read query** (the cast comes from the column's per-instance `nativeType`):

```sql
SELECT "aal" FROM "auth"."sessions" WHERE "id" = $1::uuid
-- and where `aal` is compared/bound: $N::aal_level
```

**Typed surface:**

```ts
const s = await db.auth.sessions.findOne({ where: { id } })
s.aal                                     // 'aal1' | 'aal2' | 'aal3'   (not string)
db.native_enums.auth.AalLevel.values      // readonly ['aal1','aal2','aal3']  (Postgres-only facade root)
db.native_enums.auth.AalLevel.members.aal1 // 'aal1'
```

## 2. The `native_enum` pack-contributed entity

### 2.1 PSL surface

A generic extension block, keyword **`native_enum`**, inside a `namespace` (native enums are
schema-scoped):

```prisma
native_enum <HandleName> {
  <memberName> = "<value>"   // one or more; `value` is the codec-encoded (text) enum label
  …
  @@map("<pg_type_name>")    // optional; defaults to snake_case(HandleName)
}
```

- `<HandleName>` is the authoring identifier fields reference (`pg.enum(HandleName)`), and the
  contract entity name. Like a model name.
- The body is a **variadic** `memberName = "value"` list — the enum's members, reusing the
  existing variadic block mechanism (the SQL `enum` block, §2.2). `memberName` is the code
  identifier surfaced on `db.native_enums.…members`; `"value"` is the string stored in the
  Postgres type and on the wire. Members are **always** authored as explicit `key = value`
  pairs — there is no name-only shorthand (a bare member is a diagnostic), enforced by the
  lowering factory. For all of Supabase's enums `memberName === value`, but both tokens are
  always written.
- `@@map` gives the Postgres type name (snake_case), mirroring how models `@@map` to table
  names. Required for adoption/external where the DB type name is fixed; defaults to
  `snake_case(HandleName)` when omitted.
- **Grade** is *not* a per-block attribute. It comes from the pack's `defaultControlPolicy`
  (the Supabase extension already sets `external`); an authored user contract defaults to
  `managed`. (A per-entity override could ride the generic `control` mechanism later; not
  part of this design.)

### 2.2 The PSL block descriptor (parser)

A new entry in `postgresAuthoringPslBlockDescriptors`, reusing the **existing** variadic-block
mechanism — the same shape the SQL family's `enum` block already ships
([2-sql/9-family/src/core/authoring-entity-types.ts:169](../../../packages/2-sql/9-family/src/core/authoring-entity-types.ts:169)):

```ts
native_enum: {
  kind: 'pslBlock',
  keyword: 'native_enum',
  discriminator: 'postgres-enum',
  name: { required: true },
  parameters: {},              // no fixed keys
  variadicParameters: true,    // open `memberName = "value"` body — EXISTING flag
}
```

**Not new capability.** `AuthoringPslBlockDescriptor.variadicParameters`
([framework-authoring.ts:225](../../../packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts:225))
already opens a block body to an arbitrary `key = value` list: the parser accepts every entry
generically, and the validator skips unknown-key rejection when the flag is set. The SQL/Mongo
`enum` block is a shipping instance. `native_enum` reuses it verbatim; the lowering factory
(§2.3) turns members into the entity — and rejects a bare (value-less) member (§2.1).

### 2.3 The entity type + lowering (interpreter)

A new entry in `postgresAuthoringEntityTypes` (sibling of `role`/`policy`):

```ts
native_enum: {
  kind: 'entity',
  discriminator: 'postgres-enum',
  validatorSchema: PostgresNativeEnumSchema,   // { kind: 'postgres-enum', typeName, members: [{name,value}], control? }
  output: { factory: lowerNativeEnumFromBlock },
}
```

`lowerNativeEnumFromBlock(block, ctx)` produces the `native_enum` IR node:
- `typeName` ← `@@map` or `snake_case(block.name)`.
- `members` ← the block's `name = "value"` pairs, **in declaration order** (order is the
  Postgres enum sort order; §6).
- `control` ← `ctx` default control policy (`external` for the Supabase pack).

### 2.4 The IR node + contract representation

`PostgresNativeEnum` — a target-owned top-level `DiffableNode` (the RLS `PostgresRole`
template): `identity()` on the type name, `isEqualTo()` over ordered members, `children()`
none. Lives at `storage.namespaces[ns].entries.native_enum[HandleName]`, kind
`postgres-enum`, carrying `typeName`, ordered `members[{name,value}]`, and `control`.
Composed into the pack via `composeSqlEntityKinds([…, nativeEnumEntityKind])`; validator +
serializer alongside `policy`/`role`. (Phase-2 concern; §3 of `../spec.md`.)

### 2.5 No value-set

Native enums do **not** derive a value-set (that is the check-enum path). The entity's members
are the single source: they drive `db.native_enums` (§5), and their values are baked into the
`pg.enum` codec's `typeParams` at authoring time (§3.3) — which is what drives typing. The
value-on-both-sides redundancy (entity members + baked codec params) is the intentional,
emitter-guaranteed cross-level redundancy (ADR 172).

### 2.6 TS surface (mirror; byte-identical contract)

PSL and TS must lower to byte-identical contracts (the `authoring.ts` field-preset comment
states this invariant). The TS mirror:
- `helpers.nativeEnum('AalLevel', member('aal1','aal1'), …, { map: 'aal_level' })` — a
  Postgres-target free function (the `helpers.enum`/`helpers.rls` contribution pattern),
  returning a handle.
- the field: `aal: field.column(pg.enum(AalLevel))` — the parameterized-codec column helper
  (ADR 208 `field.column(vector(1536))` pattern), where `pg.enum(handle)` is the column-type
  descriptor.

## 3. The `pg.enum` codec

### 3.1 What it is

A **new parameterized codec**, id `pg/enum@1` (the old value-blind `pg/enum@1` was deleted in
the TML-2853 cutover; this re-introduces a correct one), built on the **`vector(N)` template**.
It is a text codec (enum values are text on the wire) whose **params carry the enum's values**
(and its type name), baked from the `native_enum` block at authoring time:

```
field:  aal pg.enum(AalLevel)
column: { codecId: 'pg/enum@1', typeParams: { values: ['aal1','aal2','aal3'] }, nativeType: 'aal_level' }
```

- **encode/decode:** text passthrough (`encode('aal1') → 'aal1'`, `decode('aal1') → 'aal1'`).
  No runtime value-validation (the type + compile-time union enforce; the parent project
  ruled out a third runtime check).
- **typing:** `renderOutputType({ values })` → the value union (§5), exactly as `vector`'s
  `renderOutputType` → `Vector<N>`.
- **`nativeType`** = the type name (`aal_level`), carried on the column — drives the `::type`
  cast (§4).

### 3.2 What authoring resolution yields

Resolving `pg.enum(AalLevel)` → the `native_enum` entity at authoring time (§3.3) bakes two
things onto the column:
1. the **type name** (`typeName`, e.g. `aal_level`) → the column's `nativeType` → the
   `::aal_level` cast (§4).
2. the **values** (`members[].value`) → the codec's `typeParams.values` → the value-union
   typing (§5).

### 3.3 Field-type resolution

- **PSL:** `pg.enum(AalLevel)` is a function-call field type. **Postgres-specific** field
  lowering recognizes the `pg.enum(<ref>)` form, resolves `<ref>` to the `native_enum` block in
  the same document, and **bakes** its values + type name into the column: `{ codecId:
  'pg/enum@1', typeParams: { values }, nativeType }`. (Not the generic declarative
  type-constructor template — that only maps scalar literals into `typeParams`, not entity refs.)
- **TS:** `field.column(pg.enum(AalLevel))` — `pg.enum(handle)` returns a `ColumnTypeDescriptor`
  carrying `codecId`, `typeParams: { values }`, and `nativeType`, the way `vector(1536)` returns
  one carrying `{ length }`.

## 4. The `nativeType` cast — the adapter's existing mechanism, one small wiring change

The adapter **already** casts bound parameters by `nativeType`: `renderTypedParam`
([sql-renderer.ts:72](../../../packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts:72))
emits `$N::<T>` when a `nativeType` is outside the inferrable allow-list. The only gap is
*which* `nativeType` it reads.

### 4.1 The gap

Today `renderTypedParam` reads a **static, per-codec-id** value
(`codecLookup.metaFor(codecId).db.sql.postgres.nativeType`), and the per-column `nativeType` is
**dropped when the `CodecRef` is built** — `codecRefForStorageColumn`
([relational-core/src/codec-ref-for-column.ts:22](../../../packages/2-sql/4-lanes/relational-core/src/codec-ref-for-column.ts:22))
reads `typeRef`/`typeParams`/`codecId`/`many` but never `columnDef.nativeType`. `pg/enum@1` is
**one** codec id serving **many** Postgres types (`aal_level`, `factor_type`, …), so a static
per-codec-id value cannot serve it — the per-column value must reach the cast.

### 4.2 The wiring (small, local)

Two hops, threading one already-known string (`StorageColumn.nativeType`):

1. `codecRefForStorageColumn` stamps `columnDef.nativeType` onto the `CodecRef` it builds.
2. `renderTypedParam` (via `renderParamRef`) **prefers a ref-carried `nativeType`** over the
   static `metaFor(codecId)` meta; every other codec (`vector`/`jsonb`/text) is unaffected.

`aal_level` is not in `POSTGRES_INFERRABLE_NATIVE_TYPES`, so the renderer emits `$N::aal_level`
(schema-qualified for non-`public` types — the resolved `native_enum` carries its
`namespaceId`). Additive and confined to the Postgres adapter + the `CodecRef` builder.
(Equivalently, the value stamped can be the `pg.enum` codec's per-instance `nativeType`
resolved from its ref — same result; the point is the cast reads the per-column value, not the
static codec meta.)

## 5. Typing, `db.native_enums`, enforcement — all downstream, all reused/derived

- **Typing (value union) — parameterized-codec typing.** The `pg.enum` codec's output type is
  the value union from its `typeParams.values` — the `vector(N)` mechanism. Emit:
  `computeColumnType`'s codec-refined branch calls `renderOutputTypeFor` → the codec's
  `renderOutputType({ values })`. No-emit (`typeof contract`): `CodecChannelType` applies the
  codec's parameterized output type. **No value-set, no `EnumTypeHandle`, no dependency on
  TML-2952/2953.** The domain-plane `FieldOutputTypes` path is not involved (a native enum has
  no domain enum). Full detail: [`querying-design.md`](querying-design.md) §2.
- **`db.native_enums` — a new Postgres-only facade root.** Native-enum members are surfaced
  through a **new `db.native_enums`** accessor: a sibling of `db.enums` composed into the
  Postgres client facade only ([3-extensions/postgres/src/runtime/postgres.ts](../../../packages/3-extensions/postgres/src/runtime/postgres.ts)).
  It has the **same shape** as `db.enums` (`values`/`names`/`members`/`has`/`nameOf`/
  `ordinalOf`) and reuses the `EnumAccessor` mechanics, but is built from the `native_enum`
  entities' members rather than the domain `enum` slot. **`db.enums` is unchanged** — it stays
  the real-PN (domain) enum accessor (`buildNamespacedEnums(contract.domain)`) and native
  enums never appear in it. This is the only new read-side code, and it touches nothing outside
  the Postgres facade.
- **Enforcement.** The native **type** enforces membership. External: the type already
  exists. Managed phase: `CREATE TYPE … AS ENUM (<values in declaration order>)`, values taken
  from the entity's members. **No `CHECK` is written to the table** (contrast the check
  strategy).

## 6. Ordering

Postgres enum sort order is the *declaration* order of the values. `native_enum`'s member
order is preserved (ordered arrays) through: block → IR `members` → the codec's
`typeParams.values` (and, managed phase, `CREATE TYPE … AS ENUM (…)`). Declaration-order
`ORDER BY` on a native-enum column uses the
native type's own ordering (no `array_position` rewrite needed — unlike the text+check
strategy, the native type *is* ordered), so `ORDER BY aal` sorts `aal1 < aal2 < aal3` by the
type.

## 7. What is genuinely new vs reused

**New (small; all via existing mechanisms):**
1. **The `pg/enum@1` codec** (§3) — a parameterized text codec (the `vector(N)` template) whose params carry the enum's values (baked at authoring); `renderOutputType` is the value union.
2. **Per-column `nativeType` to the cast** (§4) — stamp `columnDef.nativeType` on the `CodecRef`; `renderTypedParam` prefers it. Small, local to the adapter + `CodecRef` builder.
3. **The `db.native_enums` facade root** (§5) — a Postgres-only sibling of `db.enums`, built from the `native_enum` members; reuses the `EnumAccessor` shape.

Plus the `native_enum` pack-entity contribution itself (an `entityTypes` entry + a lowering factory) — new code, but the *mechanism* (pack entity + variadic block) is entirely reused.

**Reused (the rest):**
- the variadic PSL block mechanism (`variadicParameters`; the SQL `enum` block is the template) — §2.2, **not new**.
- pack-contributed-entity authoring (entityTypes + block descriptors + lowering factory) — RLS template.
- top-level `DiffableNode` + generic differ + `control` grading — RLS template (deferred managed phase).
- parameterized-codec plumbing (ADR 208), `AstCodecResolver` (ADR 212).
- parameterized-codec typing (`renderOutputType` emit + `CodecChannelType` no-emit — the `vector(N)` path), the `EnumAccessor` mechanics, declaration-order arrays.
- **No custom seams.** No bespoke storage-entity registration; the old native-enum validator residue (`postgres-enum-type-schema.ts`) is **deleted, not reclaimed** — `native_enum` rides the generic entity mechanism. (The `ISSUE_KIND_ORDER` `type_*`/`enum_values_changed` keys are live generic infra, kept.)

## 8. End-to-end lowering pipeline

```
PSL  native_enum block ──parser(block descriptor, §2.2)──▶ parsed extension block
     pg.enum(Ref) field ──field lowering (§3.3)───────────▶ column {codecId, typeParams.values, nativeType}
        │
        ▼ interpreter (entity factory §2.3)
   native_enum IR node (typeName, ordered members, control)   [storage.entries.native_enum]
        │
        ├─▶ typing:      pg.enum codec renderOutputType({values}) → union   [emit + no-emit]  (§5)
        ├─▶ db.native_enums: native_enum members → EnumAccessor (new Postgres-only facade root; db.enums unchanged)
        ├─▶ cast:        column nativeType → $N::type  (§4)
        └─▶ enforcement: external = pre-existing type · managed = CREATE TYPE from members  (§5)
```

TS path (`helpers.nativeEnum` + `field.column(pg.enum(handle))`) lowers to the byte-identical
contract.

## 9. Phasing

- **MVP (external Supabase, no DDL).** §2 (`native_enum` entity, `external`), §3 (`pg.enum`
  codec), §4 (the cast wiring), §5 (typing / `db.native_enums`; enforcement = the pre-existing
  type). Ships **no migration machinery** — external enums are never diffed. See
  [`../plan.md`](../plan.md).
- **Deferred (managed, separate project).** The `PostgresNativeEnum` `DiffableNode` +
  `PostgresSchemaIR` projection + order-aware generic-differ integration + three ops
  (`CREATE TYPE`, `DROP TYPE`, `ALTER TYPE … ADD VALUE`); rename/remove/reorder refused with a
  diagnostic. Plus adoption (contract-infer emits a **`managed`** `native_enum`). Parallel-safe
  with TML-2952/2953. Full design: [`migration-design.md`](migration-design.md).

## 10. Open questions

None — all shaping questions are settled: adopted enums are `managed` (all inference is
managed); the variadic block mechanism is reused, not new (§2.2); members are always
`key = value`, no shorthand (§2.1).
