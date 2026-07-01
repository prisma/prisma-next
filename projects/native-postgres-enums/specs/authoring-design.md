# Native Postgres enums — authoring design (exhaustive)

**Status:** settled. This is the design of record for how a native Postgres enum is
authored, represented, typed, cast, and enforced. It is deliberately exhaustive so the
design does not have to be re-derived. Parent: [`../spec.md`](../spec.md).

Grounded in the current machinery (all verified on `main`):
- pack-contributed entities: `postgresAuthoringEntityTypes` + `postgresAuthoringPslBlockDescriptors` + a lowering factory ([postgres/src/core/authoring.ts](../../../packages/3-targets/3-targets/postgres/src/core/authoring.ts)) — the RLS `policy`/`role` pattern.
- the PSL generic extension block `kw [name] { key = value }` ([psl-parser syntax-kind.ts](../../../packages/1-framework/2-authoring/psl-parser/src/syntax/syntax-kind.ts)).
- parameterized codecs (ADR 208) referenced via `field.column(vector(1536))` / a PSL function-call field type.
- the SQL cast policy `renderTypedParam` reading **static** `meta.db.sql.postgres.nativeType` per codec-id ([adapter-postgres sql-renderer.ts](../../../packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts), ADR 205).
- the value-set + codec typing machinery (TML-2886 / TML-2952/2953).

## 0. One construct, not two

A native Postgres enum is authored with **one construct**: a pack-contributed
`native_enum` **entity** plus a `pg.enum(<ref>)` **codec** on the fields that use it. There
is **no "domain enum realized as native"** path — a native enum is a Postgres *type*, not a
domain enum (see `../spec.md` "Decision"). The `native_enum` entity provides everything the
app needs: its members drive a new **`db.native_enums`** facade root (a Postgres-only sibling
of `db.enums`, §5), its values derive the value-set that drives typing and (in phase 2) the
`CREATE TYPE`.

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
    aal pg.enum(AalLevel)       // field bound to the pg.enum codec, parameterized by the ref
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

  "valueSet": {                                   // DERIVED from native_enum.members[].value
    "AalLevel": { "kind": "valueSet", "values": ["aal1", "aal2", "aal3"] }
  },

  "table": { "sessions": { "columns": {
    "aal": {
      "nativeType": "aal_level",
      "codecId": "pg/enum@1",
      "typeParams": { "ref": { "plane": "storage", "entityKind": "native_enum",
                               "namespaceId": "auth", "entityName": "AalLevel" } },
      "nullable": false,
      "valueSet": { "plane": "storage", "entityKind": "valueSet",
                    "namespaceId": "auth", "entityName": "AalLevel" }
    }
  } } }
} } } }
```

**Generated read query** (the cast comes from the codec's *dynamic* `nativeType`):

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
- The body is a **variadic** `memberName = "value"` list — the enum's members. `memberName`
  is the code identifier surfaced on `db.native_enums.…members`; `"value"` is the string stored in
  the Postgres type and on the wire. For most native enums (and all of Supabase's)
  `memberName === value`; the two-token form is kept so an authored enum may diverge them.
- `@@map` gives the Postgres type name (snake_case), mirroring how models `@@map` to table
  names. Required for adoption/external where the DB type name is fixed; defaults to
  `snake_case(HandleName)` when omitted.
- **Grade** is *not* a per-block attribute. It comes from the pack's `defaultControlPolicy`
  (the Supabase extension already sets `external`); an authored user contract defaults to
  `managed`. (A per-entity override could ride the generic `control` mechanism later; not
  part of this design.)

### 2.2 The PSL block descriptor (parser)

A new entry in `postgresAuthoringPslBlockDescriptors` (sibling of `policy_select`):

```ts
native_enum: {
  kind: 'pslBlock',
  keyword: 'native_enum',
  discriminator: 'postgres-enum',
  name: { required: true },
  members: { kind: 'variadic-members', value: { kind: 'value', codecId: 'pg/text@1' } },
  // @@map handled by the existing map-attribute path
}
```

**New capability required:** today block descriptors declare a *fixed* set of `parameters`
(`policy_select` has `target`/`roles`/`using`). `native_enum`'s body is an **open** member
list, so the block-descriptor mechanism needs a **variadic-members mode** — arbitrary keys,
each a `pg/text@1`-encoded value. This is the first of the three genuinely-new pieces (§7).

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

### 2.5 The derived value-set

At contract-build/emit, the `native_enum` entity's `members[].value` list derives a
**value-set** (`storage.namespaces[ns].entries.valueSet[HandleName]`, kind `valueSet`,
`values` in declaration order) — the *same* canonical structure a check enum has (TML-2952/2953).
The value-set is what typing and enforcement-source read. The value-on-both-sides redundancy
(native_enum members + value-set values) is the intentional, emitter-guaranteed cross-level
redundancy (ADR 172).

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
the TML-2853 cutover; this re-introduces a correct one). It is a text codec (enum values are
text on the wire) whose **parameter is a reference to a `native_enum` entity**:

```
field:  aal pg.enum(AalLevel)
column: { codecId: 'pg/enum@1', typeParams: { ref: <native_enum coordinate> }, nativeType: 'aal_level' }
```

- **encode/decode:** text passthrough (`encode('aal1') → 'aal1'`, `decode('aal1') → 'aal1'`).
  No runtime value-validation (the type + compile-time union enforce; the parent project
  ruled out a third runtime check).
- **the param is an entity ref**, not a literal — the second genuinely-new piece (§7). ADR-208
  params are literals (`{length:1536}`); `pg.enum`'s `typeParams.ref` is a
  `{plane, entityKind:'native_enum', namespaceId, entityName}` coordinate the codec resolves.

### 3.2 What the codec resolves the ref for

Resolving `typeParams.ref` → the `native_enum` entity yields:
1. the **type name** (`typeName`, e.g. `aal_level`) → the codec instance's **dynamic
   `nativeType`** (§4) → the `::aal_level` cast.
2. the **values** (`members[].value`) → the value-set → the value-union typing (§5).

### 3.3 Field-type resolution

- **PSL:** `pg.enum(AalLevel)` is a function-call field type. The field-type resolver
  recognizes the `pg.enum(<ref>)` form, resolves `<ref>` to the `native_enum` entity's
  coordinate, and produces the column `{ codecId:'pg/enum@1', typeParams:{ref}, nativeType }`
  (nativeType stamped from the resolved `typeName`).
- **TS:** `field.column(pg.enum(AalLevel))` — `pg.enum(handle)` returns a `ColumnTypeDescriptor`
  carrying `codecId`, `typeParams.ref`, and `nativeType`, exactly as `vector(1536)` returns one
  carrying `{length}`.

## 4. The dynamic `nativeType` and the cast — the one hard new piece

### 4.1 Why static meta can't hold it

The cast policy (`renderTypedParam(index, codecId, codecLookup)`, ADR 205) emits `$N::<T>`
when a codec's `meta.db.sql.postgres.nativeType` is outside the inferrable allow-list. That
`nativeType` is **static per codec-id**. `pg.enum@1` is **one codec-id** used for **many**
Postgres types (`aal_level`, `factor_type`, …), so a single static `nativeType` cannot serve
it. ADR 205 anticipated exactly this and **deferred** it: *"`pg/enum@1` has no static
`nativeType` — the type name is per-column… a future `LowererContext`-borne variant."*

### 4.2 The mechanism

`nativeType` becomes a **per-instance** property on the `pg.enum` codec, resolved from
`typeParams.ref` (the `native_enum`'s `typeName`). The cast chokepoint reads the **resolved
codec instance's** `nativeType`, not the static descriptor meta:

- every AST node already carries `codec: CodecRef` and resolves an instance via
  `AstCodecResolver` (ADR 212), content-keyed on `codecId` + `typeParams`.
- `renderTypedParam` (or its effective-nativeType lookup) prefers the **instance** `nativeType`
  when present, falling back to static descriptor meta for all other codecs.
- `aal_level` is not in `POSTGRES_INFERRABLE_NATIVE_TYPES`, so the renderer emits `$N::aal_level`.

This is additive — `vector`/`jsonb`/text keep using static meta. It is the "move `nativeType`
to the instance" capability discussed during shaping, and the crux of this project. Cast
target may need schema-qualification for non-`public` types (`$N::auth.aal_level`); the
resolved `native_enum` carries its `namespaceId`, so the renderer has what it needs.

## 5. Typing, `db.native_enums`, enforcement — all downstream, all reused/derived

- **Typing (value union) — no new typing code.** The column carries a `valueSet` reference,
  and the SQL query-builder/ORM read the union from it. This lands **today**: the landed
  `StorageColumnTypes` (TML-2886, [2-sql/3-tooling/emitter/src/index.ts](../../../packages/2-sql/3-tooling/emitter/src/index.ts))
  computes a column's type from the storage value-set (`computeColumnType` →
  `renderValueSetUnionBase`), so a `pg.enum` column is `'aal1' | 'aal2' | 'aal3'` with no
  domain enum and no native-specific path. The enum-typing-via-codec refactor (TML-2952/2953)
  later re-routes that same union through the codec (`renderValueType`); because enum codecs
  are text/identity the union is unchanged, so this is refinement, not a dependency. **The
  domain-plane `FieldOutputTypes` path (`resolveFieldType`/`domainEnumLookup`) is *not*
  involved** — that reads the domain enum, which a native enum does not have. The no-emit
  (`typeof contract`) path resolves the union from the authored handle values, as for any enum.
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
  exists. Phase 2: `CREATE TYPE … AS ENUM (<values in declaration order>)`, values taken from
  the value-set/members. **No `CHECK` is written to the table** (contrast the check strategy).

## 6. Ordering

Postgres enum sort order is the *declaration* order of the values. `native_enum`'s member
order is preserved (ordered arrays) through: block → IR `members` → value-set `values` →
`CREATE TYPE … AS ENUM (…)`. Declaration-order `ORDER BY` on a native-enum column uses the
native type's own ordering (no `array_position` rewrite needed — unlike the text+check
strategy, the native type *is* ordered), so `ORDER BY aal` sorts `aal1 < aal2 < aal3` by the
type.

## 7. What is genuinely new vs reused

**New (four pieces):**
1. **Variadic-members block descriptor** (§2.2) — open `name = "value"` body, vs RLS's fixed params.
2. **Codec param = an entity ref** (§3.1) — `pg.enum`'s `typeParams.ref` resolves a `native_enum`, vs ADR-208 literal params.
3. **Dynamic (per-instance) `nativeType` in the cast policy** (§4) — the ADR-205-deferred capability; the piece that needs new machinery.
4. **The `db.native_enums` facade root** (§5) — a Postgres-only sibling of `db.enums`, built from the `native_enum` members. New code, but confined to the Postgres facade; reuses the `EnumAccessor` shape.

**Reused (everything else):**
- pack-contributed-entity authoring (entityTypes + block descriptors + lowering factory) — RLS template.
- top-level `DiffableNode` + generic differ + `control` grading — RLS template (phase 2).
- parameterized-codec plumbing (ADR 208), `AstCodecResolver` (ADR 212).
- value-set typing (`StorageColumnTypes`, TML-2886, landed; codec-refined by TML-2952/2953), the `EnumAccessor` mechanics, declaration-order arrays.
- **No custom seams.** No bespoke storage-entity registration; the old native-enum residue (`postgres-enum-type-schema.ts`, dead `ISSUE_KIND_ORDER` keys) is **deleted, not reclaimed** — `native_enum` rides the generic entity mechanism.

## 8. End-to-end lowering pipeline

```
PSL  native_enum block ──parser(block descriptor, §2.2)──▶ parsed extension block
     pg.enum(Ref) field ──field-type resolver(§3.3)──────▶ column {codecId, typeParams.ref, nativeType}
        │
        ▼ interpreter (entity factory §2.3)
   native_enum IR node (typeName, ordered members, control)   [storage.entries.native_enum]
        │
        ▼ contract build/emit (§2.5)
   derived value-set (ordered values)                          [storage.entries.valueSet]
        │
        ├─▶ typing:      value-set → union (StorageColumnTypes today; codec renderValueType later)  [contract.d.ts / no-emit]
        ├─▶ db.native_enums: native_enum members → EnumAccessor (new Postgres-only facade root; db.enums unchanged)
        ├─▶ cast:        pg.enum instance nativeType (from ref) → $N::type  (§4)
        └─▶ enforcement: phase 1 none (external) · phase 2 CREATE TYPE from values  (§5)
```

TS path (`helpers.nativeEnum` + `field.column(pg.enum(handle))`) lowers to the byte-identical
contract.

## 9. Phasing

- **Phase 1 (external, no DDL).** §2 (native_enum entity representation, `external`), §3
  (`pg.enum` codec), §4 (dynamic-nativeType cast), §5 (typing / `db.native_enums`; enforcement =
  the pre-existing type). Cuts all migration machinery. Plus adoption (contract-infer emits a
  `native_enum` block instead of throwing).
- **Phase 2 (managed).** The `PostgresNativeEnum` `DiffableNode` + `PostgresSchemaIR`
  projection + generic-differ integration + the four ops (`CREATE TYPE`, `DROP TYPE`,
  `ALTER TYPE … ADD VALUE`, `ALTER TYPE … RENAME VALUE`); remove/reorder refused with a
  diagnostic. Parallel-safe with TML-2952/2953 (`../spec.md`).

## 10. Open questions (genuine)

1. **Adopted-enum grade.** contract-infer emits `native_enum` on adoption — `external`
   (observe-only, cheap) or `managed`? Leaning `external` first, manual promote later.
2. **Variadic-members descriptor shape.** The exact `pslBlock` descriptor extension for an
   open member list (§2.2) — settled at slice-1 planning; the requirement is fixed, the
   descriptor encoding is not.
3. **`memberName === value` enforcement.** Whether the two-token member form may diverge
   name from value for native enums, or is constrained to `name === value` (all real cases).
   Leaning: allow divergence (name is db.native_enums-only; value is the type label), no constraint.
