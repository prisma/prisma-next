# Native Postgres enums — plan

**Spec:** [`spec.md`](spec.md) · **Designs:** [`specs/authoring-design.md`](specs/authoring-design.md), [`specs/querying-design.md`](specs/querying-design.md), [`specs/migration-design.md`](specs/migration-design.md)
**Linear project:** _(to create on approval — see § Tracker)_

## At a glance

The MVP is one thing: **externally-managed Supabase native enums, represented and surfaced to
the app as typed value unions, with zero migration machinery.** A native enum is a distinct
Postgres type the database already owns; Prisma Next represents it, types the columns that use
it, exposes its members at runtime, and emits **no DDL**. This is the primary deliverable and
what unblocks Supabase.

Almost everything is **reuse**. The PSL block reuses the existing variadic `enum`-block
mechanism; typing reuses `StorageColumnTypes`; runtime access reuses `EnumAccessor`; the cast
reuses the adapter's `nativeType` mechanism. The genuinely-new code is small: a `native_enum`
pack entity (via the generic entity mechanism, RLS template), a `pg.enum` codec, one
per-column `nativeType` threaded to the cast, and a `db.native_enums` facade root.

**PN-managed native enums** (PN creates/drops the type, migrates `ADD VALUE`) are a **separate,
later effort** — sketched in § Future, and may never be built. The MVP deliberately ships no
SchemaIR node, no diff, and no ops: external enums are simply never diffed, so `db verify`
emits nothing for them for free.

Each slice is a vertical: authoring → typed read / runtime access, with an end-to-end test.

## Slices (MVP — external Supabase enums, no DDL)

### Slice 1 — `native-enum-representation-and-typed-column`
- **Outcome:** A `native_enum` block authored in PSL (and its TS mirror) lowers to a storage
  `native_enum` entity, and a column bound to it via the `pg.enum(Ref)` codec reads/writes as
  the **value union** (`'aal1' | 'aal2' | 'aal3'`, not `string`) across query builder, ORM,
  emitted contract, and the no-emit (`typeof contract`) path — with generated SQL carrying the
  `$N::<type>` cast. Members are authored `key = value` (bare members rejected). The enum is
  graded `external` (no DDL — and in the MVP there is no diff to emit from).
- **New code (all via existing mechanisms):**
  - **`native_enum` pack entity** — a `postgresAuthoringEntityTypes` entry + a variadic block
    descriptor (`{ parameters: {}, variadicParameters: true }`, the shipping SQL `enum`-block
    shape) + a lowering factory that **requires `key = value` members** (rejects bare),
    stamps `typeName` from `@@map`, preserves member order, sets the control grade, and derives
    the value-set.
  - **the `pg/enum@1` codec** — a parameterized text codec whose param is a `native_enum` ref;
    resolves the ref for its per-instance `nativeType` and its value list. (Text passthrough;
    the type enforces membership — no runtime value check.)
  - **the cast wiring** — stamp `columnDef.nativeType` onto the `CodecRef` in
    `codecRefForStorageColumn` (dropped there today) and have `renderTypedParam` prefer a
    ref-carried `nativeType` over the static `metaFor(codecId)` meta. The adapter already casts
    by `nativeType`; this just stops discarding the per-column value.
- **Reused as-is:** typing via `StorageColumnTypes` (value-set → union) + no-emit
  `StorageColumnChannelTypes`; the variadic PSL block mechanism (`variadicParameters`); the
  parameterized-codec + `AstCodecResolver` plumbing; `pg.enum`'s ref rides `typeParams`.
- **Builds on:** nothing (foundation).
- **Hands to:** the `native_enum` storage entity + `pg.enum` column shape that slices 2 and 3
  consume.
- **Proven by:** an authored fixture (PSL + TS, byte-identical) with a `native_enum` + a column
  using it → type-tests asserting the union (QB, ORM, `StorageColumnTypes`, no-emit), negative
  tests for out-of-set input and for a bare member, and an execution test asserting the
  `$N::<type>` cast in generated SQL. `fixtures:check`.

### Slice 2 — `db-native-enums-accessor`
- **Outcome:** `db.native_enums.<ns>.<Name>` exposes each native enum's members at runtime
  (`values`/`names`/`members`/`has`/`hasName`/`nameOf`/`ordinalOf`), typed in **both** the
  emitted-`contract.d.ts` and no-emit (`typeof contract`) paths. `db.enums` is unchanged.
- **New code:** a `db.native_enums` facade root — a `buildNamespacedNativeEnums(contract.storage)`
  analog of `buildNamespacedEnums` over the storage `native_enum` entities, attached to the
  Postgres client **only**, reusing `createEnumAccessor`/`EnumAccessor`; and a
  `NativeEnums<TContract>` type derived over the storage `native_enum` block (emitted) and the
  authored handles (no-emit).
- **Reused as-is:** the `EnumAccessor` / `ContractEnumAccessor` shape and mechanics.
- **Builds on:** slice 1 (the `native_enum` entity).
- **Hands to:** runtime member access used by the Supabase example (slice 3).
- **Proven by:** runtime tests (`db.native_enums.auth.AalLevel.members.aal1 === 'aal1'`,
  `.has(...)`, `.values`) + type-tests for both emitted and no-emit; Postgres-only (assert the
  field is absent on Mongo/SQLite clients).

### Slice 3 — `supabase-native-enums`
- **Outcome:** The Supabase extension declares its built-in native enums in
  `packages/3-extensions/supabase/src/contract/contract.prisma`; the supabase example uses one
  on a column and reads it as a typed union with `db.native_enums` access; `db verify` /
  migration emits nothing for the type (external, and un-diffed in the MVP).
- **New code:** the `native_enum` declarations in the Supabase extension's contract + example
  usage; ordered members transcribed from the real Supabase types.
- **Reused as-is:** slices 1–2; the extension authoring path.
- **Builds on:** slices 1 and 2.
- **Hands to:** the shipped external-enum capability (the project's purpose).
- **Proven by:** the supabase example end-to-end — a Supabase-defined native enum represented,
  typed read + `db.native_enums`, and `db verify` reporting nothing for it.

## Sequencing
- **Slice 1 first** — the foundation; 2 and 3 consume its entity + column shape.
- **Slices 2 and 3 parallelize** after slice 1 (runtime accessor vs Supabase integration are
  independent). Slice 3's example wires in slice 2's accessor when 2 lands; if that split is
  awkward, sequence 3 after 2. Default: parallel.
- No phase boundary inside the MVP — all three slices are external-only and independently
  shippable increments toward the same capability.

## Future (separate project — may never be built): PN-managed native enums
Deferred, and only if a real need appears beyond Supabase. Sketch — full design in
[`specs/migration-design.md`](specs/migration-design.md):
- SchemaIR `PostgresNativeEnum` `DiffableNode` + Contract→SchemaIR projection (the RLS
  `PostgresRole` template).
- Generic-differ integration: **order-aware**; accept only a pure suffix-append → `ADD VALUE`;
  **reject rename, remove, and reorder** with a diagnostic. external-grade suppression (needed
  once the projection exists).
- Ops: `CREATE TYPE` / `DROP TYPE` / `ALTER TYPE … ADD VALUE` (no `RENAME VALUE`).
- Adoption: contract-infer emits a **`managed`** `native_enum` (all inference is managed;
  ordered values from `pg_enum.enumsortorder`) instead of throwing.

This is roughly three slices and its own project. Do not start it without a fresh triage and
operator go-ahead.

## Dependencies (external)
- **Pack-entity + variadic-block mechanisms** — `postgresAuthoringEntityTypes`,
  `variadicParameters` block descriptors, `composeSqlEntityKinds`. Landed (RLS and the SQL
  `enum` block ship on them).
- **`StorageColumnTypes`** (TML-2886) — landed; slice 1's typing rides it.
- **enum-typing-via-codec refactor (TML-2952/2953)** — parallel-safe, **not** a dependency:
  native typing already lands via `StorageColumnTypes`, and enum codecs are text/identity so
  the codec-driven union is identical. Rebase-coordinate only.

## Tracker
Not yet created. On approval of this plan: create the Linear project "Native Postgres enums"
and one issue per MVP slice (no sub-issues — project + relations + labels per repo convention).
Hold until the operator approves the spec + this plan.

## Residue (already handled)
The dead TML-2853 validator (`postgres-enum-type-schema.ts`) is **already deleted** (commit
`5194b18b4`). The `ISSUE_KIND_ORDER` keys (`type_missing`/`type_values_mismatch`/
`enum_values_changed`) were checked and are **live generic infrastructure, kept** — not
residue. No custom seams: `native_enum` rides the generic pack-entity mechanism.
