# Native Postgres enums — plan

**Spec:** [`spec.md`](spec.md) · **Designs:** [`specs/authoring-design.md`](specs/authoring-design.md), [`specs/querying-design.md`](specs/querying-design.md), [`specs/migration-design.md`](specs/migration-design.md)

## At a glance

The MVP is one thing: **externally-managed Supabase native enums, represented and surfaced to
the app as typed value unions, with zero migration machinery.** A native enum is a distinct
Postgres type the database already owns; Prisma Next represents it, types the columns that use
it, exposes its members at runtime, and emits **no DDL**. This is the primary deliverable and
what unblocks Supabase.

The mechanism is a **parameterized codec, exactly like `vector(N)`.** `pg.enum(AalLevel)` binds
a column to the `pg/enum@1` codec, parameterized by the enum's values (+ its Postgres type
name), resolved from the `native_enum` block at authoring time. **Typing is parameterized-codec
typing** — the codec's output type *is* the value union, for both the emitted contract and
`typeof contract`. There is **no value-set** on the native path (that is the check-enum path)
and no dependency on the enum-typing refactor (TML-2952/2953). Runtime member access is a new
Postgres-only `db.native_enums` root; `db.enums` is untouched.

The genuinely-new code is small: the `pg/enum@1` parameterized codec, the per-column type name
reaching the SQL cast, the `native_enum` pack entity (via the generic pack-entity mechanism —
the RLS template, no custom seams), and the `db.native_enums` root.

**PN-managed native enums** (PN creates/drops the type, migrates `ADD VALUE`) are a **separate,
later effort** — sketched in § Future, and may never be built. The MVP deliberately ships no
SchemaIR node, no diff, no ops: external enums are never diffed, so `db verify` emits nothing
for them for free.

## Slices (MVP — external Supabase enums, no DDL)

### Slice 1 — `native-enum-representation-typing-and-access`
- **Outcome:** A `native_enum` block (PSL + its TS mirror) lowers to a storage `native_enum`
  entity, and a column bound to it via `pg.enum(Ref)` reads/writes as the **value union**
  (`'aal1' | 'aal2' | 'aal3'`, not `string`) across query builder, ORM, emitted contract, and
  the no-emit (`typeof contract`) path — with generated SQL carrying the `$N::<type>` cast; and
  `db.native_enums.<ns>.<Name>` exposes the members at runtime. Members are authored
  `key = "value"` (bare members rejected). Graded `external` (no DDL — and no diff in the MVP).
- **New code (all via existing mechanisms):**
  - **the `pg/enum@1` parameterized codec** — the `vector(N)` descriptor template
    (`CodecDescriptorImpl` + `paramsSchema` + `factory` + `renderOutputType`). Params carry the
    enum's values (+ type name); `renderOutputType(params)` returns the value union; text
    passthrough encode/decode (the type enforces membership — no runtime value check).
    Registered into the Postgres pack's `codecDescriptors`.
  - **the `native_enum` pack entity** — a `postgresAuthoringEntityTypes` entry + a variadic
    block descriptor (`{ parameters: {}, variadicParameters: true }`, the shipping SQL
    `enum`-block shape) + a lowering factory that **requires `key = "value"` members** (rejects
    bare), stamps `typeName` from `@@map`, preserves member order, sets the control grade, and
    lands the entity at `storage.entries.native_enum[Name]` (IR node + arktype validator +
    serializer, the `PostgresRole` template).
  - **`pg.enum(Ref)` resolution** — postgres-specific field lowering resolves the `AalLevel`
    reference against the `native_enum` block in the same document and bakes its values + type
    name into the column (`codecId: 'pg/enum@1'`, `typeParams: { values }`, `nativeType`). Not
    the generic scalar-only type-constructor template.
  - **the cast wiring** — thread the per-column `nativeType` to the SQL cast: stamp
    `columnDef.nativeType` onto the `CodecRef` in `codecRefForStorageColumn` (dropped there
    today), and have `renderTypedParam` prefer a ref-carried `nativeType` over the static
    `metaFor(codecId)` meta. The adapter already casts by `nativeType`; this stops discarding
    the per-column value.
  - **`db.native_enums`** — a `buildNamespacedNativeEnums(contract.storage)` analog of
    `buildNamespacedEnums` over the `native_enum` entities, attached to the Postgres client
    **only**, reusing `createEnumAccessor`/`EnumAccessor`; typed for **both** emitted and
    no-emit. `db.enums` is untouched.
- **Reused as-is:** the parameterized-codec descriptor + `AstCodecResolver` plumbing (the
  `vector(N)` path — typing, encode/decode, resolution); the variadic PSL block mechanism
  (`variadicParameters`); the pack-entity authoring + `composeSqlEntityKinds` + serializer
  (RLS template); the `EnumAccessor` mechanics.
- **Builds on:** nothing (foundation).
- **Hands to:** the `native_enum` entity + `pg.enum` column shape + `db.native_enums` that the
  Supabase slice consumes.
- **Proven by:** an authored fixture (PSL + TS, byte-identical) with a `native_enum` + a column
  using it → type-tests asserting the union (QB, ORM, and `typeof contract` no-emit), negative
  tests for out-of-set input and for a bare member, an execution test asserting `$N::<type>` in
  generated SQL, and a runtime test for `db.native_enums.…members`. `fixtures:check`.

### Slice 2 — `supabase-native-enums`
- **Outcome:** The Supabase extension declares its built-in native enums in
  `packages/3-extensions/supabase/src/contract/contract.prisma`; the supabase example uses one
  on a column, reads it as a typed union, and reaches its members via `db.native_enums`;
  `db verify` / migration emits nothing for the type (external, and un-diffed in the MVP).
- **New code:** the `native_enum` declarations in the Supabase extension's contract + example
  usage; ordered members transcribed from the real Supabase types.
- **Reused as-is:** slice 1; the extension authoring path.
- **Builds on:** slice 1.
- **Hands to:** the shipped external-enum capability (the project's purpose).
- **Proven by:** the supabase example end-to-end — a Supabase-defined native enum represented,
  typed read + `db.native_enums`, and `db verify` reporting nothing for it.

## Sequencing
- **Slice 1 first** — the foundation; slice 2 consumes its entity + column + accessor.
- **Slice 2 after.** Two slices, one stack thread; no parallelism worth modelling.

## Future (separate project — may never be built): PN-managed native enums
Deferred, and only if a real need appears beyond Supabase. Sketch — full design in
[`specs/migration-design.md`](specs/migration-design.md):
- SchemaIR `PostgresNativeEnum` `DiffableNode` + Contract→SchemaIR projection (the RLS
  `PostgresRole` template).
- Order-aware generic-differ integration: accept only a pure suffix-append → `ADD VALUE`;
  **reject rename, remove, and reorder** with a diagnostic. external-grade suppression (needed
  once the projection exists).
- Ops: `CREATE TYPE` / `DROP TYPE` / `ALTER TYPE … ADD VALUE` (no `RENAME VALUE`).
- Adoption: contract-infer emits a **`managed`** `native_enum` (all inference is managed;
  ordered values from `pg_enum.enumsortorder`) instead of throwing.

Roughly three slices and its own project. Do not start without a fresh triage and operator
go-ahead.

## Dependencies (external)
- **Parameterized-codec plumbing** — `CodecDescriptorImpl`, `renderOutputType`,
  `AstCodecResolver`, the codec registry (`vector(N)` ships on it). Landed.
- **Pack-entity + variadic-block mechanisms** — `postgresAuthoringEntityTypes`,
  `variadicParameters` block descriptors, `composeSqlEntityKinds`. Landed (RLS + the SQL
  `enum` block ship on them).
- **enum-typing refactor (TML-2952/2953)** — **not** a dependency and not on the native path:
  native columns are typed by the `pg.enum` codec, not the value-set. No coupling.

## Tracker
Linear intentionally skipped (operator call). Slices tracked here in-repo only.

## Residue (already handled)
The dead TML-2853 validator (`postgres-enum-type-schema.ts`) is **already deleted** (commit
`5194b18b4`). The `ISSUE_KIND_ORDER` keys are **live generic infrastructure, kept** — not
residue. No custom seams: `native_enum` rides the generic pack-entity mechanism; `pg.enum`
rides the parameterized-codec mechanism.
