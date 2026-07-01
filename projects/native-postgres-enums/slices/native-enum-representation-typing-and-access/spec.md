# Slice 1 — `native-enum-representation-typing-and-access`

**Project:** [`../../spec.md`](../../spec.md) · **Plan:** [`../../plan.md`](../../plan.md)
**Designs (of record):** [`../../specs/authoring-design.md`](../../specs/authoring-design.md),
[`../../specs/querying-design.md`](../../specs/querying-design.md).

## At a glance

A native Postgres enum becomes representable, typed, and readable at runtime. A `native_enum`
block (PSL + its TS mirror) lowers to a storage `native_enum` entity; a column bound to it via
the `pg.enum(Ref)` **parameterized codec** reads/writes as the **value union**
(`'aal1' | 'aal2' | 'aal3'`, not `string`) across the query builder, ORM, emitted
`contract.d.ts`, and the no-emit (`typeof contract`) path — and generated SQL carries the
`$N::<type>` cast; and `db.native_enums.<ns>.<Name>` exposes the members at runtime. The enum
is graded `external`; **no migration machinery** ships (external enums are never diffed). This
is the whole read surface — slice 2 (Supabase) consumes it.

## Chosen design

`pg.enum` is a **parameterized codec, exactly like `vector(N)`** — that is the spine.

- **`pg/enum@1` codec** (authoring-design §3) — the `PgVectorDescriptor` template: a
  `CodecDescriptorImpl` with a `paramsSchema`, a `factory`, and `renderOutputType(params)`
  returning the **value union** from its params. Params carry the enum's values (+ the Postgres
  type name). Text passthrough encode/decode — the native type enforces membership, so there is
  no runtime value check. Registered into the Postgres pack's `codecDescriptors`.
- **Typing = parameterized-codec typing** (querying-design §2) — the codec's output type *is*
  the value union, in **both** the emitted contract (`renderOutputType`) and no-emit
  (`typeof contract`, the codec's parameterized TS type). There is **no value-set** on the
  native path (that is the check-enum path), and **no dependency on TML-2952/2953**. The domain
  `EnumTypeHandle` / `db.enums` path is not involved.
- **`native_enum` pack entity** (authoring-design §2) — contributed through the **generic**
  pack-entity mechanism (the RLS `role`/`policy` template), no custom seams:
  - a block descriptor reusing the **existing** variadic-block mechanism
    (`{ parameters: {}, variadicParameters: true }`);
  - a lowering factory that **requires `key = "value"` members** (rejects bare), stamps
    `typeName` from `@@map` (default `snake_case(name)`), preserves member order, sets the
    `control` grade (`external`);
  - an IR node (`PostgresNativeEnum`) + arktype validator + serializer, at
    `storage.namespaces[ns].entries.native_enum[Name]`.
  - The entity is the authoring source, the `db.native_enums` source, and the future migration
    source. It carries the members; there is **no derived value-set**.
- **`pg.enum(Ref)` resolution** (authoring-design §3.3) — postgres-specific field lowering
  resolves the `AalLevel` reference against the `native_enum` block in the same document and
  **bakes** its values + type name into the column: `codecId: 'pg/enum@1'`,
  `typeParams: { values }`, `nativeType` = the type name. This is not the generic scalar-only
  type-constructor template (`vector(N)`'s declarative path) — it is a lookup against the
  document's native_enum blocks, the way bare enum-typed fields resolve today.
- **The `::type` cast** (querying-design §4–§5) — the adapter's existing `nativeType` cast, one
  small wiring change: `codecRefForStorageColumn` stamps `columnDef.nativeType` onto the
  `CodecRef` (dropped there today), and `renderTypedParam` prefers a ref-carried `nativeType`
  over the static `metaFor(codecId)` meta. Additive; every other codec is unaffected.
- **`db.native_enums`** (querying-design §3) — a `buildNamespacedNativeEnums(contract.storage)`
  analog of `buildNamespacedEnums`, over the `native_enum` entities, attached to the Postgres
  client **only**, reusing `createEnumAccessor`/`EnumAccessor`, typed for both emitted and
  no-emit. `db.enums` is untouched.

## Coherence rationale (slice-INVEST · _Small_)

One reviewer holds a single claim: **"a `native_enum` exists, columns using it read/write as a
typed value union with the correct Postgres cast, and its members are reachable at runtime."**
The pieces are interdependent — the column needs the codec; the cast needs the per-column type
name the codec carries; `db.native_enums` reads the same entity — so splitting them yields
incomplete verticals that can't be end-to-end tested. It is the complete read surface, one
coherent rollback unit. The Supabase integration is the only deliberately separate slice.

## Scope

**In:**
- the `pg/enum@1` parameterized codec + its registration in the Postgres pack.
- the `native_enum` block descriptor + entityType + lowering factory + IR node + validator +
  serializer.
- `pg.enum(Ref)` field-type resolution (PSL) + `field.column(pg.enum(Ref))` (TS), baking values
  + type name into the column.
- the cast wiring (`codecRefForStorageColumn` + `renderTypedParam`).
- `db.native_enums` (`buildNamespacedNativeEnums` + Postgres-client wiring + accessor type,
  emitted + no-emit).
- tests: authored fixture (PSL + TS, byte-identical) → emitted-contract shape; type-tests (QB,
  ORM, and `typeof contract` no-emit); negative tests (out-of-set input; bare member); a
  generated-SQL test asserting `$N::<type>`; a runtime test for `db.native_enums.…members`.

**Deliberately out:**
- Supabase extension declarations + example → **slice 2**.
- **all** migration machinery — SchemaIR node, Contract→SchemaIR projection, diff, `CREATE
  TYPE`/`DROP TYPE`/`ADD VALUE` ops, adoption/contract-infer → the deferred managed project.
- rename / remove / reorder handling (managed project).
- any change to `db.enums`, the domain-enum path, or the value-set/check-enum path.

## Pre-investigated edge cases

- **Schema-qualified cast.** Non-`public` enum types must cast as `$N::auth.aal_level` — the
  baked `nativeType` must be schema-qualified.
- **`renderTypedParam` has multiple callers** (`renderParamRef`, prepared + plain, all inside
  `sql-renderer.ts`). The ref-carried `nativeType` must be additive — absent it, fall back to
  the static `metaFor(codecId)` path, so `vector`/`jsonb`/text are unaffected.
- **`pg/enum@1` reuses the id of the deleted old codec.** The old value-blind `pg/enum@1` was
  deleted in TML-2853; this reintroduces a correct one — confirm no stale references.
- **Bare members must be rejected.** The variadic parser accepts a value-less key as `{kind:
  'bare'}`; the lowering factory must diagnose it (the "always `key = "value"`" rule).
- **Keep the resolution handle out of the domain-enum slot.** Resolving `pg.enum(Ref)` must not
  register a domain `EnumTypeHandle` / `enum` entry — native enums must never appear in
  `db.enums`.

## Slice-specific done conditions

- An authored fixture (PSL **and** TS, lowering to byte-identical contract) with a `native_enum`
  + a `pg.enum` column: emits the expected `storage.entries.native_enum` + column shape
  (`codecId: 'pg/enum@1'`, `typeParams.values`, `nativeType`, **no valueSet**); types as the
  value union across QB / ORM / no-emit `typeof contract`; rejects out-of-set input and a bare
  member; generates `$N::<type>` in compiled SQL; and `db.native_enums.<ns>.<Name>.members`
  resolves at runtime (Postgres client only).
- `pnpm fixtures:check` clean.

(CI-green, reviewer-accept, and the project-DoD floor are inherited — not restated here.)

## Open questions

None — the design is settled (parameterized-codec typing; no value-set on the native path;
`db.native_enums` root; `db.enums` untouched).

## Dispatch plan

_(Held for [`plan-slice`] — grounded now; added next.)_
