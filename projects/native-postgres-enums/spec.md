# Native Postgres enums — project spec

**Status:** shaping settled (this supersedes the earlier draft).

**Authoring design (exhaustive) →** [`specs/authoring-design.md`](specs/authoring-design.md):
the full detail of the `native_enum` pack entity, the `pg.enum` codec, the value-set-driven
typing, and the end-to-end lowering. This spec is the overview; that doc is the design of record
for authoring.

## Decision

A native Postgres enum is a **distinct database type** (`CREATE TYPE … AS ENUM`) — a
**persistence-plane entity, not a domain enum.** Prisma Next represents it in the contract
and surfaces it to the application as a typed value union. The relationship to a domain enum
runs in **opposite directions** in the two cases, and the primary case is the *inverse* of a
domain-authored enum:

- **Externally-managed (Supabase) / adopted — the primary driver.** The native type already
  exists in the database — Supabase ships a large set of built-in native enums (owned
  externally, never created or altered by PN); a **ported** project has user-authored ones.
  **The type is the source.** PN represents it and *derives* what the app needs from it: a
  **value-set** (which drives the typed value union, via the same machinery a check enum uses)
  and a **`db.native_enums`** accessor (a new Postgres-only sibling of `db.enums`; members where
  name = value). There is no authored domain enum; the type is surfaced directly, and a ported
  project's native enums must be *representable*, not rejected.
- **Authored (phase 2) — secondary.** A user **declares a managed `native_enum` directly**
  (the *same* authoring surface as the external case — see the authoring design). It is graded
  `managed`, so PN creates the type and migrates the cheap ops. The `native_enum`'s members
  give `db.native_enums` (the new Postgres-only accessor); there is **no separate domain
  enum**, and `db.enums` (domain enums) is untouched. (There is no "realize a domain enum
  as native" path; converting an existing *check*-realized domain enum to native is a
  non-goal — a realization swap.)

Native realization is deliberately **Postgres-only**. SQLite and MongoDB have no native
enum; they keep the check/validator realization. This is a SQL/Postgres-target storage
feature, not a framework concept — consistent with the domain enum being target-agnostic
and its realization being per-target.

## Why native enums are awkward — and why this is staged

Native enums are painful to *change*, and that pain is why the project is phased and why we
never auto-migrate the expensive cases. Postgres special-cased two operations as cheap and
in-place; everything else forces a full-table rewrite:

| Operation | Cost | In-place? |
| --- | --- | --- |
| Add a value (`ALTER TYPE … ADD VALUE`) | 1 txn, no rewrite, no data change | yes (but the new value is unusable until the adding txn commits) |
| Rename a value (`ALTER TYPE … RENAME VALUE`) | 1 txn, no rewrite, no data change | yes |
| Remove a value | rebuild type + repoint column + drop old | **no** — full-table rewrite + data migration |
| Reorder values | rebuild type + repoint column + drop old | **no** — full-table rewrite |

A column stores a reference bound to a specific type, so repointing it to a rebuilt type
re-encodes every row into a new table file under a lock that blocks all reads and writes.
`ADD VALUE` also can't be used in the same transaction that adds it — which breaks the
atomic-migration guarantee Prisma Next relies on. The user-facing rationale is the
shareable explainer [`why-native-postgres-enums.md`](specs/why-native-postgres-enums.md)
(migrate to `docs/` at close-out).

**Scope consequence:** Prisma Next auto-migrates **only add value** (a pure suffix-append),
and **never** rename, remove, or reorder. Rename is cheap in Postgres but skipped anyway —
detecting it means disambiguating rename from add+remove, which an order-aware diff cannot do
cleanly; remove and reorder force a full-table rewrite. All three stay user-managed. This keeps
the project clear of dependency-aware planner ordering and transaction-grouping — and the MVP
(external Supabase enums) ships no migration ops at all.

## Two-phase roadmap

**Phase 1 — externally-managed native enums, surfaced to the app.** Represent a native enum
in the contract and type columns that use it as the value union. Native enums here are
graded `external` (the Supabase extension's default `control` posture), so Prisma Next
emits **no DDL** for them. This cuts the entire migration half: no SchemaIR diff, no
Contract→SchemaIR projection, no migration ops. Phase 1 is representation + typing only.

**Phase 2 (deferred, separate project — may never be built) — Prisma Next creates and deletes
native enums, plus add value.** A user declares a **managed** `native_enum`; Prisma Next
`CREATE TYPE` / `DROP TYPE`s it and migrates it in place for **add value only**. Rename, remove,
and reorder are diagnosed and refused with a pointer to the manual procedure — never planned.
This adds the SchemaIR node, the projection, the order-aware diff integration, and the three
migration ops (create, delete, add value). The MVP (phase 1) does not include this.

## The model (settled)

The spine: a native enum is a storage **type**, authored as **one construct** — the
`native_enum` pack entity, which **derives a value-set** — and used on fields via the
`pg.enum(<ref>)` codec. External vs managed is only the control grade (and whether PN creates
the type). Typing reuses the **existing post-TML-2952 value-set → codec machinery** (the same a
check enum uses); the native-only pieces are small: the codec, the per-column cast,
`db.native_enums`, and (managed phase) the type's lifecycle. Full detail in
[`specs/authoring-design.md`](specs/authoring-design.md).

- **No separate domain enum.** The `native_enum` entity is both the app-facing enum (its
  `members` drive the Postgres-only `db.native_enums` accessor) and the storage type. There is
  no `enumType`/domain-enum alongside it (`db.enums` is unaffected).
- **`native_enum` entity** (storage plane, `entries.native_enum[Name]`, kind `postgres-enum`,
  `typeName`, ordered `members[{name,value}]`, optional `control` grade) — does **two** jobs:
  1. the **authoring source** of the members (and the `db.native_enums` source);
  2. the **managed database object** whose lifecycle owns `CREATE TYPE` / `DROP TYPE` /
     `ALTER TYPE` (managed phase) — a target-owned top-level `DiffableNode`, the RLS
     policy/role template (Components #2).
- **derived value-set** (storage plane, `entries.valueSet[Name]`) — the entity's `members`
  derive a `StorageValueSet` (ordered values), exactly as a check enum derives one. This is
  what drives typing.
- **column** — bound to the **`pg.enum` codec** (`codecId: pg/enum@1`, a text codec) and
  carrying a **`valueSet` reference** → the derived value-set (typing) plus `nativeType` = the
  resolved type name (the cast). **No `CHECK`** on the table.

**Typing, access, enforcement:**

- **Typing — value-set → codec, the existing post-TML-2952 machinery, unchanged and
  enum-agnostic.** `computeColumnType` gates on `if (column.valueSet)` → `renderValueSetType` →
  the codec's `renderValueLiteral` → the literal union. The **same path a check enum uses**; no
  native-specific typing code, no domain-enum path. (No-emit `typeof contract` column typing is
  the one gap — [TML-2960]: that path is codec-id-keyed and doesn't read the value-set yet;
  emit typing works today.)
- **Runtime member access (`db.native_enums`)** — a **new Postgres-only facade root**, a sibling
  of `db.enums` with the same accessor shape, built from the `native_enum` entity's members and
  composed into the Postgres client only. `db.enums` is unchanged; native enums never appear in
  it.
- **Enforcement** — the native **type** enforces membership: external, it already exists;
  managed, `CREATE TYPE … AS ENUM` is rendered from the entity's members. **No `CHECK`.**

## Authoring composition

Two pieces (full detail — PSL + TS, block descriptor, codec, lowering — in
[`specs/authoring-design.md`](specs/authoring-design.md)):

1. **Declare the `native_enum`** — a pack-contributed entity, the RLS `policy`/`role` pattern.
   PSL: a `native_enum <Name> { member = "value" … @@map("pg_type") }` block (a generic
   extension block with a **variadic member list**). TS mirror: `helpers.nativeEnum(…)`. It
   lowers to the `native_enum` IR entity (`typeName`, ordered members, control grade) **and a
   derived value-set**.
2. **Reference it on a field via the `pg.enum` codec** — PSL: `aal pg.enum(AalLevel)`; TS:
   `field.column(pg.enum(AalLevel))`. Postgres-specific field lowering resolves the `AalLevel`
   reference against the `native_enum` block and produces the column: `codecId: pg/enum@1`, a
   **`valueSet` ref** → the derived value-set, and `nativeType` = the type name.

The **value-set drives typing** (via the codec's `renderValueLiteral`, the post-2952 machinery)
and the column's `nativeType` drives the **`::<type>` cast**. `db.native_enums` (the new
Postgres-only accessor) comes from the `native_enum` members; `db.enums` is unchanged.
**External:** the Supabase extension writes the `native_enum` block in its `contract.prisma`
(graded `external`); a user's field references it by name. **Authored (managed phase):** a user
writes the same, graded `managed`.

## At a glance

A native enum. **PSL** (external → in the extension's `contract.prisma`; authored → in a
user's schema, graded `managed`):

```prisma
namespace public {
  native_enum UserRole {          // pack-contributed entity (variadic members)
    admin  = "admin"
    member = "member"
    guest  = "guest"
    @@map("user_role")            // the Postgres type name
  }
  model Profile {
    id   Uuid @id
    role pg.enum(UserRole)        // field bound to the pg.enum codec; typed via the derived value-set
    @@map("profiles")
  }
}
```

**Emitted contract** (`storage`, `public`):

```jsonc
"storage": { "namespaces": { "public": { "entries": {

  "native_enum": {                                // members + type name (external-graded)
    "UserRole": {
      "kind": "postgres-enum", "typeName": "user_role", "control": "external",
      "members": [ {"name":"admin","value":"admin"}, {"name":"member","value":"member"}, {"name":"guest","value":"guest"} ]
    }
  },

  "valueSet": {                                   // DERIVED from native_enum.members[].value
    "UserRole": { "kind": "valueSet", "values": ["admin", "member", "guest"] }
  },

  "table": { "profiles": { "columns": {
    "role": {
      "nativeType": "user_role",                  // → the $N::user_role cast
      "codecId": "pg/enum@1",
      "valueSet": { "plane": "storage", "entityKind": "valueSet",
                    "namespaceId": "public", "entityName": "UserRole" },  // → typing (value union)
      "nullable": false
    }
  } } }
} } } }
```

```ts
const p = await db.profiles.findOne({ where: { id } })
p.role                                  // 'admin' | 'member' | 'guest'   (not string)
db.native_enums.public.UserRole.values  // readonly ['admin','member','guest']  (Postgres-only facade root)
```

The values appear in the `native_enum` entity (the source) and in the derived `valueSet` — the
cross-level redundancy the emitter guarantees and ADR 172 sanctions; each part stays
self-contained.

## Components

The realization split (#5) is the spine; the rest hang off it.

### #5 — Two enum realizations, one typing path (both phases)

Prisma Next has two enum realizations that **share the same value-set typing machinery** and
differ in construct, enforcement, and runtime accessor:
- **check-realized** — the framework domain enum (authored via `enumType`): domain enum →
  value-set + column `valueSet` ref + table `CHECK`. Family-agnostic (SQL/Mongo). Surfaces on
  `db.enums`.
- **native** — a Postgres `native_enum` (authored via the `native_enum` block): the
  `native_enum` entity → **derived value-set** + column `valueSet` ref + the `pg.enum` codec +
  the native type (no `CHECK`). Postgres-only. No domain enum. Surfaces on `db.native_enums`.

Both type via the value-set → codec path (post-TML-2952). What differs: the *construct*
(`enumType` vs `native_enum`), the *enforcement* (`CHECK` vs the native type), and the
*accessor* (`db.enums` vs `db.native_enums`). For a native enum, external vs managed is only the
control grade + whether PN creates the type: external (the DB owns it) is the MVP; managed (PN
creates it) is the deferred phase.

### #1 — ContractIR representation (both phases)

- The `native_enum` entity (kind `postgres-enum`, `typeName`, ordered `members[{name,value}]`,
  optional `control`) — a Postgres-target top-level entity kind, composed into the pack's
  `composeSqlEntityKinds([…, nativeEnumEntityKind])` alongside `policy`/`role`, with validator
  + serializer.
- The **derived value-set** (`entries.valueSet[Name]`, from `members[].value`) — the existing
  `StorageValueSet` structure, reused; it drives typing.
- The **column** carries: `codecId: pg/enum@1`; a **`valueSet` ref** → the derived value-set
  (typing — `{ plane: 'storage', entityKind: 'valueSet', namespaceId, entityName }`, exactly as
  a check enum); and `nativeType` = the resolved type name (the cast). **No `CHECK`.**
- **Not used:** the legacy `StorageColumn.typeRef` + `storage.types` map (the codec-alias
  mechanism for `vector`/`geometry`/`uuid`) — a different concept (see Alternatives).

### #2 — SchemaIR representation (phase 2)

A `PostgresNativeEnum` `DiffableNode` — `identity()` on the type name, `isEqualTo()` over the
ordered members. Introspection enriched from the names-only `pg_type typtype='e'` query to
capture **ordered values** (`pg_enum.enumsortorder`). Follows `PostgresRole` precisely.

### #3 — Migration diff + Contract→SchemaIR projection (phase 2)

Project the `native_enum` entities into `PostgresSchemaIR` (a new `enumTypes` field,
mirroring `rlsPolicies`/`roles`); the generic differ reports missing / extra / mismatch. The
`external`/`observed` grade suppresses drift the same way it does for RLS, so phase-1
externally-managed enums stay untouched even after phase 2.

### #4 — Migration ops / factories (phase 2, add-value-only)

`OpFactoryCall`s for **create** (`CREATE TYPE … AS ENUM`), **delete** (`DROP TYPE`), and **add
value** (`ALTER TYPE … ADD VALUE`) — three ops. Diffing is **order-aware**: the only accepted
value change is a **pure suffix-append** → `ADD VALUE`; a rename, removal, or reorder diff is
**refused with a diagnostic**, never lowered to an op. Ordering need is only "type before the
column that uses it," which the planner's existing `'type'` → dependency bucket already models
coarsely. `ADD VALUE`'s non-transactional caveat is surfaced to the runner.

### #6 — Query / typing (both phases)

A native-enum column reads/writes as the **value union** via the **value-set → codec** path —
the existing post-TML-2952 machinery (`computeColumnType`'s `column.valueSet` branch →
`renderValueSetType` → `renderValueLiteral`), the **same path a check enum uses**; no
native-specific typing code. (No-emit `typeof contract` column typing is deferred — [TML-2960].)
Runtime member access is the new Postgres-only **`db.native_enums`** accessor (not `db.enums`,
which stays domain-only). The native-only additions in the query path are the **`db.native_enums`
facade root** and the per-column **`::type` cast**. Full detail:
[`specs/querying-design.md`](specs/querying-design.md).

## Relationship to the enum-typing refactor (TML-2952/2953)

Native enums **reuse** the value-set → codec typing machinery **TML-2952 established** (SQL;
merged, and in this branch): post-2952, column typing is purely value-set-driven and
enum-agnostic (`computeColumnType` gates on `column.valueSet`; the enum-specific typing override
was deleted — *"the domain enum is no longer a typing input"*). A native column carries a
`valueSet` ref and gets the literal union through that path unchanged. TML-2953 does the same
for Mongo (not relevant here). The one remaining gap is **no-emit** column typing ([TML-2960]) —
orthogonal, tracked.

## Why the `native_enum` entity lives in storage (the invariant behind the structure)

The migration planner must derive the expected schema from the **storage segment alone**,
with no reference into `domain`:

- **ADR 004** — `storageHash = sha256(canonicalize({ schemaVersion, targetFamily, target,
  storage }))`, storage-only, *"used for applicability of migrations and plan verification."*
- **ADR 199** — a migration's identity reflects *"what they do to storage, not the shape of
  the contract's domain layer."*
- **ADR 221 §115** — *"a domain entity may reference a storage entity, but not the reverse —
  the storage plane must remain independently consumable by the migration planner/runner."*

So the `native_enum` **entity** (`typeName` + ordered `members`) **and its derived value-set**
live in storage (`entries.native_enum`, `entries.valueSet`), captured by `storageHash` and read
by the planner without touching `domain`. Both are physical storage-plane objects with no
domain-plane counterpart.

## Requirements

- **R1 — Represent.** A `native_enum` entity (kind `postgres-enum`, `typeName`, ordered
  `members[{name,value}]`, optional `control`) round-trips through serializer + validator and
  is a first-class storage entity, deriving a value-set.
- **R2 — Reference.** A field uses a `native_enum` via the `pg.enum(ref)` codec; the entity
  **derives a value-set**, and the column carries `codecId: pg/enum@1` + a **`valueSet` ref**
  (typing) + `nativeType` (cast). No `CHECK`. There is no separate domain enum; the
  `native_enum`'s members serve `db.native_enums`.
- **R3 — Surface (typed read).** A native-enum column reads as the value union (not `string`)
  in the query builder and ORM (emitted contract); typed input rejects out-of-set literals;
  generated SQL carries the `::type` cast where required. (No-emit column typing → [TML-2960].)
- **R4 — `db.native_enums` access.** `db.native_enums.<ns>.<Name>` (a new Postgres-only facade
  root, sibling of `db.enums`) exposes each native enum's members (name→value), for both the
  external and authored cases. `db.enums` (real-PN/domain enums) is unchanged and never
  contains native enums.
- **R5 — External grade.** `external`/`observed` native enums produce no DDL and no drift
  reports; the Supabase extension's `external` default applies to its contributed enums.
- **R6 — Adopt (porting).** Contract-infer emits the `native_enum` representation for an
  introspected native enum instead of throwing, graded **`managed`** (all inference is managed).
- **R7 — Create / delete (phase 2).** An author-selected native enum is created and dropped,
  ordered relative to the columns that use it, proven against a live database.
- **R8 — Add value (phase 2).** A pure suffix-append migrates in place (`ALTER TYPE … ADD
  VALUE`), no table rewrite, verified against a database.
- **R9 — Refuse the other ops (phase 2).** A rename, remove, or reorder diff is refused with a
  diagnostic, never planned (negative test).
- **R10 — Verify (phase 2).** For managed native enums, the generic differ reports
  missing / extra / value mismatch against the live database.

## Non-goals

- **Auto-migrating value removal or reorder** — permanently out; user-managed.
- **Native enums on SQLite / MySQL / MongoDB** — no native enum exists there.
- **Dependency-aware planner ordering + transaction-grouping** — excluded by cheap-ops-only.
- **Making native the default realization** — default stays check; native is opt-in (phase 2)
  or external-sourced (phase 1).
- **Migrating existing check-realized enums to native (or back)** — a separate future want.

## What this builds on (and the cruft to retire)

- **RLS machinery (the template).** `PostgresRlsPolicy` / `PostgresRole` are target-owned
  top-level `DiffableNode`s composed via `composeSqlEntityKinds`, diffed by the generic
  differ, graded by `control`. `native_enum` follows this exactly. Needs the RLS differ +
  extension-contribution seam landed — not the full RLS feature set.
- **The value-set → codec typing machinery (TML-2952, merged).** `computeColumnType` →
  `renderValueSetType` → `renderValueLiteral`. Reused as-is; a native column carries a `valueSet`
  ref exactly like a check-enum column. Plus the codec plumbing (`CodecDescriptorImpl`,
  `AstCodecResolver`) for decode + the cast.
- **Residue to delete (not reclaim) — no custom seams; that is the point.** Delete the one
  dead fragment of the removed TML-2853 native enum instead of building on it:
  `packages/3-targets/3-targets/postgres/src/core/postgres-enum-type-schema.ts` (the
  unregistered `PostgresEnumTypeSchema` validator — its docstring claims registration, but no
  registration call exists). The `ISSUE_KIND_ORDER` keys
  (`type_missing`/`type_values_mismatch`/`enum_values_changed`) were checked and are **live
  generic infrastructure, not residue** — kept and reused. Leave live behavior alone — the
  contract-infer native-enum *rejection* test + message are current correct behavior until
  phase 1 replaces them. Separately note `StorageColumn.typeRef` + `storage.types` is the
  **codec-alias** seam (vector/geometry) — a different concept, *not* the native-enum join.

## Open decisions

None remaining — shaping is complete.

*(Settled during shaping: slot name `native_enum`; authoring is a `native_enum` pack block
reusing the existing variadic-block mechanism + the `pg.enum(ref)` codec (not
`field.namedType`/`enumType`); members are always `key = value` (no shorthand); the `native_enum`
**derives a value-set**, and the column carries a `valueSet` ref; typing is the **value-set →
codec** path — the same as check enums, post-TML-2952 — with no native-specific typing code; the
`pg.enum` codec is a text codec (decode + `renderValueLiteral`) carrying a per-column
`nativeType`; runtime member access is a new Postgres-only `db.native_enums` facade root
(`db.enums` unchanged); the type enforces with no `CHECK`; the cast is the adapter's existing
`nativeType` mechanism (the per-column `nativeType` threaded onto the `CodecRef`); all inference
is `managed`; Supabase enters via the extension declaring the enums; only add value — a pure
suffix-append — is auto-migrated, rename/remove/reorder refused. No-emit column typing is the one
open gap, tracked as TML-2960.)*

## Alternatives considered

- **Type native columns via a parameterized codec (`renderOutputType`, values baked into
  `typeParams`), with no value-set.** Rejected: post-TML-2952 the value-set → codec path is the
  general, enum-agnostic column-typing mechanism, so a native column just carries a `valueSet`
  ref (like a check enum) and reuses it with **zero new typing code** — and no-emit behaves like
  any value-set column (pending TML-2960). A bespoke parameterized-codec typing path would
  duplicate that, and only seemed right pre-2952 when value-set typing was still enum-tangled.
- **Reuse `StorageColumn.typeRef` + `storage.types` for the column→type join.** Rejected:
  that slot is the codec-alias mechanism (`vector`/`geometry`/`uuid`) — values rendered inline
  into a column type, never a managed `CREATE TYPE` object. A native enum is a managed
  schema object (RLS template), a different concept.
- **A `codec | nativeEnum` union on the column type.** Rejected: every column has a codec
  always; native realization is an additive structural fact, not a replacement of the codec.
- **Native as the default Postgres realization.** Rejected: native can't cheaply
  remove/reorder and forces table rewrites; check is the safe default.
- **Supporting remove/reorder via an automatic temporary-superset rebuild.** Rejected: two
  full-table rewrites + a throwaway type on an operation users can do by hand. We refuse and
  document.
- **A framework-level "native enum" concept.** Rejected: native enums are a Postgres storage
  realization; the framework holds only the target-agnostic domain enum.
