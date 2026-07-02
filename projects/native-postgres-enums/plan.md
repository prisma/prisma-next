# Native Postgres enums — plan

**Spec:** [`spec.md`](spec.md) · **Designs:** [`specs/authoring-design.md`](specs/authoring-design.md), [`specs/querying-design.md`](specs/querying-design.md), [`specs/migration-design.md`](specs/migration-design.md)

## At a glance

The MVP is one thing: **externally-managed Supabase native enums, represented and surfaced to
the app as typed value unions, with zero migration machinery.** A native enum is a distinct
Postgres type the database already owns; Prisma Next represents it, types the columns that use
it, exposes its members at runtime, and emits **no DDL**.

The mechanism **reuses what check enums already use**: the `native_enum` block **derives a
value-set**, the column carries a `valueSet` ref, and typing is the **value-set → codec** path —
the existing post-TML-2952 machinery, **unchanged and enum-agnostic** (`computeColumnType` →
`renderValueSetType` → `renderValueLiteral`). So native typing needs **zero new code**. (TML-2952
is merged and in this branch; it made value-set typing enum-agnostic — *"the domain enum is no
longer a typing input."*) Runtime access is a new Postgres-only `db.native_enums` root; `db.enums`
is untouched.

The genuinely-new code is small: the `native_enum` pack entity (→ entity + a derived
`StorageValueSet`), the `pg.enum` codec (text decode + `renderValueLiteral` + the per-column
`nativeType` for the cast), the per-column `::type` cast wiring, and `db.native_enums`.

**PN-managed native enums** (PN creates/drops the type, migrates `ADD VALUE`) are a **separate,
later effort** — sketched in § Future, and may never be built. The MVP ships no SchemaIR node,
no diff, no ops: external enums are never diffed, so `db verify` emits nothing for them for free.

## Slices (MVP — external Supabase enums, no DDL)

### Slice 1 — `native-enum-representation-typing-and-access`
- **Outcome:** A `native_enum` block (PSL + its TS mirror) lowers to a storage `native_enum`
  entity **and a derived `StorageValueSet`**, and a column bound via `pg.enum(Ref)` — carrying
  `{ codecId, valueSet ref, nativeType }` — reads/writes as the **value union**
  (`'aal1' | 'aal2' | 'aal3'`, not `string`) in the query builder, ORM, and emitted contract,
  via the existing value-set → codec machinery; generated SQL carries the `$N::<type>` cast; and
  `db.native_enums.<ns>.<Name>` exposes the members at runtime. Members are `key = "value"`
  (bare rejected). Graded `external` (no DDL — and no diff in the MVP).
- **New code (all via existing mechanisms):**
  - **the `native_enum` pack entity** — a `postgresAuthoringEntityTypes` entry + a variadic
    block descriptor (`{ parameters: {}, variadicParameters: true }`, the shipping SQL
    `enum`-block shape) + a lowering factory (requires `key = "value"`, stamps `typeName` from
    `@@map`, preserves order, sets the control grade) + a `PostgresNativeEnum` IR node + arktype
    validator + serializer wiring; **and the derived `StorageValueSet`**.
  - **the `pg/enum@1` codec** — a text codec (encode/decode passthrough) implementing
    `renderValueLiteral` (so the value-set values render as literals) and carrying a per-column
    `nativeType`. *Slice-time decision:* a distinct `pg/enum@1` vs. reuse `pg/text@1` + per-column
    `nativeType` + no CHECK (lean: distinct, for identifiability + the managed phase).
  - **`pg.enum(Ref)` resolution** — postgres-specific field lowering resolves the `Ref` against
    the `native_enum` block → column `{ codecId, valueSet ref → the derived value-set,
    nativeType }`. (Not the generic scalar-only type-constructor template.)
  - **the cast wiring** — stamp `columnDef.nativeType` onto the `CodecRef` in
    `codecRefForStorageColumn` (dropped there today); `renderTypedParam` prefers a ref-carried
    `nativeType` over the static `metaFor(codecId)` meta.
  - **`db.native_enums`** — `buildNamespacedNativeEnums(contract.storage)` over the `native_enum`
    entities, attached to the Postgres client **only**, reusing `EnumAccessor`; typed for both
    emitted and no-emit (mirroring the existing `enumAccessors`). `db.enums` untouched.
- **Reused as-is:** the **value-set → codec typing** (post-TML-2952, *unchanged* — a native
  column carries a `valueSet` ref exactly like a check-enum column); the `StorageValueSet`
  structure; the variadic PSL block mechanism; the pack-entity authoring + `composeSqlEntityKinds`
  + serializer (RLS template); the `EnumAccessor` mechanics; the codec plumbing
  (`AstCodecResolver`) for decode.
- **Builds on:** nothing (foundation).
- **Hands to:** the `native_enum` entity + derived value-set + `pg.enum` column shape +
  `db.native_enums` that the Supabase slice consumes.
- **Proven by:** an authored fixture (PSL + TS, byte-identical) with a `native_enum` + a column
  using it → type-tests asserting the value union (QB, ORM, emitted contract), negative tests for
  out-of-set input and a bare member, an execution test asserting `$N::<type>` in generated SQL,
  and a runtime test for `db.native_enums.…members`. `fixtures:check`. (No-emit column typing is
  out of scope — TML-2960.)

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
- **The value-set → codec typing machinery (TML-2952)** — **merged, and in this branch** (this
  branch is rebased onto `main`). Native typing rides it unchanged; a native column carries a
  `valueSet` ref like a check-enum column.
- **Pack-entity + variadic-block mechanisms** — `postgresAuthoringEntityTypes`,
  `variadicParameters` block descriptors, `composeSqlEntityKinds`. Landed (RLS + the SQL
  `enum` block ship on them).
- **[TML-2960]** (no-emit per-instance column typing) — **not a blocker** for the MVP: emit
  typing works today; no-emit column typing is explicitly out of slice 1's scope until 2960
  lands (assigned to the operator).

## Tracker
Linear intentionally skipped for the slices (operator call); tracked here in-repo. Cross-cutting
follow-up filed: **TML-2960** (no-emit typing).

## Residue (already handled)
The dead TML-2853 validator (`postgres-enum-type-schema.ts`) is **already deleted**. The
`ISSUE_KIND_ORDER` keys are **live generic infrastructure, kept** — not residue. No custom
seams: `native_enum` rides the generic pack-entity mechanism; typing rides the generic
value-set → codec path.
