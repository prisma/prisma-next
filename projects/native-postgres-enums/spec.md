# Native Postgres enums — project spec

**Status:** shaping settled (this supersedes the earlier draft). **Linear:** project
"Enums as a domain concept" (team Terminal); native-enum tickets TBD.

**Authoring design (exhaustive) →** [`specs/authoring-design.md`](specs/authoring-design.md):
the full detail of the `native_enum` pack entity, the `pg.enum` codec, the dynamic
`nativeType` cast, and the end-to-end lowering. This spec is the overview; that doc is the
design of record for authoring.

## Decision

A native Postgres enum is a **distinct database type** (`CREATE TYPE … AS ENUM`) — a
**persistence-plane entity, not a domain enum.** Prisma Next represents it in the contract
and surfaces it to the application as a typed value union. The relationship to a domain enum
runs in **opposite directions** in the two cases, and the primary case is the *inverse* of a
domain-authored enum:

- **Externally-managed (Supabase) / adopted — the primary driver.** The native type already
  exists in the database — Supabase ships a large set of built-in native enums (owned
  externally, never created or altered by PN); a **ported** project has user-authored ones.
  **The type is the source.** PN represents it and *derives* what the app needs from it: the
  **value-set** that drives typing, and a **`db.native_enums`** accessor (a new Postgres-only
  sibling of `db.enums`; members where name = value). There is no authored domain enum; the
  type is surfaced directly, and a ported project's native enums must be *representable*, not
  rejected.
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

**Scope consequence:** Prisma Next will support **add** and **rename**, and **never**
auto-migrate **remove** or **reorder** — those stay user-managed (drop the type, create the
replacement, `ALTER` the column by hand). This is what keeps the project clear of
dependency-aware planner ordering and transaction-grouping.

## Two-phase roadmap

**Phase 1 — externally-managed native enums, surfaced to the app.** Represent a native enum
in the contract and type columns that use it as the value union. Native enums here are
graded `external` (the Supabase extension's default `control` posture), so Prisma Next
emits **no DDL** for them. This cuts the entire migration half: no SchemaIR diff, no
Contract→SchemaIR projection, no migration ops. Phase 1 is representation + typing only.

**Phase 2 — Prisma Next creates and deletes native enums, plus the cheap ops.** A user
declares a **managed** `native_enum`; Prisma Next `CREATE TYPE` / `DROP TYPE`s it and
migrates it in place for **add value** and **rename value** only. Remove and reorder are
diagnosed and refused with a pointer to the manual procedure — never planned. This adds the
SchemaIR node, the projection, the diff integration, and the four migration ops, all in
cheap-ops-only form.

## The model (settled)

The spine: a native enum is a storage **type**, authored as **one construct** — the
`native_enum` pack entity (its members give `db.native_enums`; its values derive the
value-set) — used on fields via the `pg.enum(<ref>)` codec. External vs managed is only the control grade
(and whether PN creates the type). Crucially, **everything downstream of the permitted values
reuses the same machinery as the check strategy** — the native-only pieces are exactly two:
the managed type, and the cast. Full detail in [`specs/authoring-design.md`](specs/authoring-design.md).

- **No separate domain enum.** The `native_enum` entity is both the app-facing enum (its
  `members` drive a new Postgres-only `db.native_enums` accessor) and the storage type — in
  *either* case (external or authored). There is no `enumType`/domain-enum alongside it, and
  `db.enums` is unaffected.
- **`native_enum` entity** (storage plane, `entries.native_enum[Name]`, kind
  `postgres-enum`, `typeName`, ordered `members[{name,value}]`, optional `control` grade) —
  does **two** jobs:
  1. it is the **authoring source** of the members/permitted values;
  2. it is the **managed database object** whose lifecycle owns `CREATE TYPE` / `DROP TYPE`
     / `ALTER TYPE` — a target-owned top-level `DiffableNode`, the RLS policy/role template
     exactly (Components #2).
- **value-set** (storage plane, `entries.valueSet[Name]`) — **derived from the
  `native_enum` entity's `members[].value`.** This is the *same* canonical permitted-values
  structure a check-realized enum has — the one TML-2952/2953 establish as the single typing +
  enforcement source. Native does not invent a parallel structure; it derives this one.
- **column** — bound to the **`pg.enum` codec** (`codecId: pg/enum@1`) whose `typeParams` is a
  **reference to the `native_enum` entity**; `nativeType` = the resolved type name. The codec
  resolves the ref for its **dynamic `nativeType`** → the `$N::<type>` cast (ADR 205's
  deferred per-instance cast); and the column carries a **`valueSet` reference** for typing
  (the shared machinery). **No `CHECK` on the table.**

**Downstream of the value-set it is all the regular-enum machinery:**

- **Typing** — the column's `valueSet` ref types it as the value union, landing **today** via
  `StorageColumnTypes` (TML-2886, which reads the storage value-set); the enum-typing-via-codec
  refactor (TML-2952/2953) later routes the same union through the codec (`renderValueType`) —
  identical union (enum codecs are text/identity), so refinement not dependency. No native-
  specific typing path, and the domain `FieldOutputTypes` path is not involved (native enums
  have no domain enum).
- **Runtime member access (`db.native_enums`)** — a **new Postgres-only facade root**, a
  sibling of `db.enums` with the same accessor shape, built from the `native_enum` members and
  composed into the Postgres client only. `db.enums` (domain enums) is unchanged; native enums
  never appear in it.
- **Enforcement** — a per-strategy *render* from the same value-set. **Native: the type
  itself enforces membership** (the `CREATE TYPE`'s value list is taken from the value-set);
  **no `CHECK`.** (Check → `CHECK (col IN (...))` from the value-set; Mongo → `$jsonSchema`
  `enum` from the value-set.) Same source, strategy-specific render.

## Authoring composition

Two pieces (full detail — PSL + TS, block descriptor, codec, lowering — in
[`specs/authoring-design.md`](specs/authoring-design.md)):

1. **Declare the `native_enum`** — a pack-contributed entity, the RLS `policy`/`role` pattern.
   PSL: a `native_enum <Name> { member = "value" … @@map("pg_type") }` block (a generic
   extension block with a **variadic member list**). TS mirror: `helpers.nativeEnum(…)`. It
   lowers to the `native_enum` IR entity (`typeName`, ordered members, control grade) and a
   derived value-set.
2. **Reference it on a field via the `pg.enum` codec** — PSL: `aal pg.enum(AalLevel)`; TS:
   `field.column(pg.enum(AalLevel))`. `pg.enum` is a parameterized codec whose param is a
   **reference to the `native_enum` entity**; the column gets `codecId: pg/enum@1`,
   `typeParams.ref`, and `nativeType` = the resolved type name.

The `pg.enum` codec resolves its `native_enum` ref for (a) its **dynamic `nativeType`** → the
`::<type>` cast, and (b) the values → the value-set → typing. `db.native_enums` (the new
Postgres-only accessor) comes from the `native_enum` members; `db.enums` is unchanged.
**External:** the Supabase extension writes the `native_enum` block in
its `contract.prisma` (graded `external`); a user's field references it by name (the existing
cross-namespace/space reference). **Authored (phase 2):** a user writes the same, graded
`managed`.

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
    role pg.enum(UserRole)        // field bound to the pg.enum codec, parameterized by the ref
    @@map("profiles")
  }
}
```

**Emitted contract** (`storage`, `public`):

```jsonc
"storage": { "namespaces": { "public": { "entries": {

  "native_enum": {                                // managed type + members (external-graded)
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
      "nativeType": "user_role",
      "codecId": "pg/enum@1",
      "typeParams": { "ref": { "plane": "storage", "entityKind": "native_enum",
                               "namespaceId": "public", "entityName": "UserRole" } },
      "nullable": false,
      "valueSet": { "plane": "storage", "entityKind": "valueSet",
                    "namespaceId": "public", "entityName": "UserRole" }  // typing (shared machinery)
    }
  } } }
} } } }
```

```ts
const p = await db.profiles.findOne({ where: { id } })
p.role                                  // 'admin' | 'member' | 'guest'   (not string)
db.native_enums.public.UserRole.values  // readonly ['admin','member','guest']  (Postgres-only facade root)
```

The values appearing in the `native_enum` entity, the derived `valueSet`, and (for Mongo,
elsewhere) the validator is the cross-level redundancy the emitter guarantees and ADR 172
sanctions — each part stays self-contained.

## Components

The persistence-strategy abstraction (#5) is the spine; the rest hang off it.

### #5 — Alternative persistence strategy (the spine; both phases)

Two enum kinds share the same downstream machinery via a **value-set**:
- **check-realized** — the framework domain enum (authored via `enumType`): domain enum →
  value-set + column `valueSet` ref + table `CHECK`. Family-agnostic (SQL/Mongo).
- **native** — a Postgres `native_enum` (authored via the `native_enum` block): the
  `native_enum` entity → derived value-set + the `pg.enum` codec + the native type.
  Postgres-only. No `CHECK`; no separate domain enum.

**Both derive the same value-set**, so typing and the enforcement-source are shared. What
differs is the *construct*, the *enforcement render*, and the *runtime accessor*: a
check-realized domain enum surfaces on `db.enums`; a native enum surfaces on the new
Postgres-only `db.native_enums`. For a native enum, external vs managed is only the control
grade + whether PN creates the type: Phase 1 external (the DB owns it), Phase 2 managed (PN
creates it).

### #1 — ContractIR representation (both phases)

- The `native_enum` entity (kind `postgres-enum`, `typeName`, ordered `members[{name,value}]`,
  optional `control`) — a Postgres-target top-level entity kind, composed into the pack's
  `composeSqlEntityKinds([…, nativeEnumEntityKind])` alongside `policy`/`role`, with validator
  + serializer.
- The **derived value-set** (`entries.valueSet`, from `members[].value`) — the existing
  structure, reused.
- The **column** carries: a coordinate `valueSet` reference (typing — `{ plane: 'storage',
  entityKind: 'valueSet', namespaceId, entityName }`, exactly as a check enum); `codecId:
  pg/enum@1` with `typeParams.ref` = the `native_enum` coordinate; and `nativeType` = the
  resolved type name (the cast). **Settled: the legacy `StorageColumn.typeRef` +
  `storage.types` map is *not* used** — that slot is the codec-alias mechanism
  (`vector`/`geometry`/`uuid`), a different concept from a managed enum type (see Alternatives).

### #2 — SchemaIR representation (phase 2)

A `PostgresNativeEnum` `DiffableNode` — `identity()` on the type name, `isEqualTo()` over the
ordered members. Introspection enriched from the names-only `pg_type typtype='e'` query to
capture **ordered values** (`pg_enum.enumsortorder`). Follows `PostgresRole` precisely.

### #3 — Migration diff + Contract→SchemaIR projection (phase 2)

Project the `native_enum` entities into `PostgresSchemaIR` (a new `enumTypes` field,
mirroring `rlsPolicies`/`roles`); the generic differ reports missing / extra / mismatch. The
`external`/`observed` grade suppresses drift the same way it does for RLS, so phase-1
externally-managed enums stay untouched even after phase 2.

### #4 — Migration ops / factories (phase 2, cheap-ops-only)

`OpFactoryCall`s for **create** (`CREATE TYPE … AS ENUM`), **delete** (`DROP TYPE`), **add
value** (`ALTER TYPE … ADD VALUE`), **rename value** (`ALTER TYPE … RENAME VALUE`). A
value-removal or reorder diff is **refused with a diagnostic**, never lowered to an op.
Ordering need is only "type before the column that uses it," which the planner's existing
`'type'` → dependency bucket already models coarsely. `ADD VALUE`'s non-transactional caveat
is surfaced to the runner.

### #6 — Query / typing (both phases)

A native-enum column reads/writes as the **value union** from its `valueSet` ref — landing
today via `StorageColumnTypes` (TML-2886), codec-refined later by the enum-typing-via-codec
refactor (TML-2952/2953). *The same value-set path a check-realized column uses;* no native-
specific typing code. Runtime member access is the new Postgres-only **`db.native_enums`**
accessor (not `db.enums`, which stays domain-only). The no-emit (`typeof contract`) path
propagates the authored handle values, as for any enum. The two native-only additions in the
query path are the **`db.native_enums` facade root** and the codec-emitted `::type` **cast**
in generated SQL. Full detail: [`specs/querying-design.md`](specs/querying-design.md).

## Relationship to the enum-typing refactor (TML-2952/2953) — parallel-safe

Native enums **reuse** the value-set entity + codec-typing machinery those tickets
establish. But the value-set entity and typing-from-it **already exist today** (check enums
have them); TML-2952/2953 only change *how* the value-set is read for typing (direct literal
render → `codec.renderValueType`) and bring Mongo onto it. Enum codecs are **text/identity**
(the encoded value *is* the output literal), so direct-render and codec-render produce the
**same** union.

Therefore native enums **do not hard-depend on the 2952 refactor** and can be designed and
built **in parallel** with it. The only coupling is **file-level overlap** (both touch the
SQL emitter + codec) — *rebase coordination*, not a sequencing dependency. Native should be
built to the codec-driven typing so it doesn't reintroduce a direct-render path, but since
enum codecs are identity that's cleanup-on-rebase, not a blocker.

## Why the value-set lives in storage (the invariant behind the structure)

The migration planner must derive the expected schema from the **storage segment alone**,
with no reference into `domain`:

- **ADR 004** — `storageHash = sha256(canonicalize({ schemaVersion, targetFamily, target,
  storage }))`, storage-only, *"used for applicability of migrations and plan verification."*
- **ADR 199** — a migration's identity reflects *"what they do to storage, not the shape of
  the contract's domain layer."*
- **ADR 221 §115** — *"a domain entity may reference a storage entity, but not the reverse —
  the storage plane must remain independently consumable by the migration planner/runner."*

So the *physical* permitted values must live in storage (the value-set, and the
`native_enum` type), captured by `storageHash` and read by the planner without touching
`domain`; member **names** (domain-only, no physical effect) stay in `domain.enum`.

## Requirements

- **R1 — Represent.** A `native_enum` entity (kind `postgres-enum`, `typeName`, ordered
  `members[{name,value}]`, optional `control`) round-trips through serializer + validator and
  is a first-class storage entity.
- **R2 — Derive + reference.** The `native_enum` entity derives a `valueSet`; a field uses it
  via the `pg.enum(ref)` codec, so its column references the `valueSet` (typing) and carries
  `codecId: pg/enum@1` + `typeParams.ref` + `nativeType` (cast). No `CHECK`. There is no
  separate domain enum; the `native_enum`'s members serve `db.native_enums`.
- **R3 — Surface (typed read).** A native-enum column reads as the value union (not `string`)
  in the query builder and ORM, emitted-contract and no-emit; typed input rejects out-of-set
  literals; generated SQL carries the `::type` cast where required.
- **R4 — `db.native_enums` access.** `db.native_enums.<ns>.<Name>` (a new Postgres-only facade
  root, sibling of `db.enums`) exposes each native enum's members (name→value), for both the
  external and authored cases. `db.enums` (real-PN/domain enums) is unchanged and never
  contains native enums.
- **R5 — External grade.** `external`/`observed` native enums produce no DDL and no drift
  reports; the Supabase extension's `external` default applies to its contributed enums.
- **R6 — Adopt (porting).** Contract-infer emits the `native_enum` representation for an
  introspected native enum instead of throwing. *(Grade of adopted enums: Open decision.)*
- **R7 — Create / delete (phase 2).** An author-selected native enum is created and dropped,
  ordered relative to the columns that use it, proven against a live database.
- **R8 — Cheap ops (phase 2).** Add value and rename value migrate in place, no table
  rewrite, verified against a database.
- **R9 — Refuse the expensive ops (phase 2).** A remove/reorder diff is refused with a
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
- **The value-set + codec typing machinery (TML-2886, TML-2952/2953).** Reused as-is for
  typing; parallel-safe (above).
- **Residue to delete (not reclaim) — no custom seams; that is the point.** Delete the dead
  fragments of the removed TML-2853 native enum instead of building on them:
  `packages/3-targets/3-targets/postgres/src/core/postgres-enum-type-schema.ts` (the
  unregistered `PostgresEnumTypeSchema` validator — its docstring claims registration, but no
  registration call exists) and any dead `ISSUE_KIND_ORDER` keys
  (`type_missing`/`type_values_mismatch`/`enum_values_changed`) left from the old enum planner.
  Leave live behavior alone — the contract-infer native-enum *rejection* test + message are
  current correct behavior until phase 1 replaces them. Separately note `StorageColumn.typeRef`
  + `storage.types` is the **codec-alias** seam (vector/geometry) — a different concept, *not*
  the native-enum join.

## Open decisions (genuinely remaining)

1. **Adopted-enum grade (R6).** Do enums from contract-infer come in `external` (observe-only,
   matches phase 1, nearly free) or `managed` (PN owns diff/migrate)? Leaning `external` for
   the first cut, with a manual promote-to-managed path later.
2. **Phase-1 source.** Supabase enums enter the contract via the extension's authoring
   (it declares them) and/or via introspection/adoption (porting). Both produce the same
   `native_enum` entity; the slice settles which path phase 1 ships first.

*(Settled during shaping: slot name `native_enum`; authoring is a `native_enum` pack block +
the `pg.enum(ref)` codec (not `field.namedType`/`enumType`); the column carries a coordinate
`valueSet` ref for typing (not the legacy `typeRef`/`storage.types`); native derives a
value-set and reuses the shared typing/enforcement machinery; the type enforces with no
`CHECK`; the cast uses the codec's dynamic `nativeType`; parallel-safe with TML-2952/2953.)*

## Alternatives considered

- **Native realization has *no* value-set; the `native_enum` entity is the only value
  carrier.** Rejected: it would fork the typing/enforcement machinery. Native derives the
  *same* value-set a check enum has, so everything downstream is shared (the whole point).
- **The value-set lives only as the codec's `typeParams` (no standalone entity).** Rejected:
  the value-set is the standalone canonical structure TML-2952/2953 establish; the codec is
  parameterized *by* it (for the cast), it doesn't replace it.
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
