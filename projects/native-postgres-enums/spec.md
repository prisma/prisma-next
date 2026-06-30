# Native Postgres enums — project spec

**Status:** shaping settled (this supersedes the earlier draft). **Linear:** project
"Enums as a domain concept" (team Terminal); native-enum tickets TBD.

## Decision

A domain enum can be **realized in storage as a native Postgres enum type**
(`CREATE TYPE … AS ENUM`) — a **second persistence strategy for the same domain enum**. The
domain plane is unchanged; only the storage projection differs. The domain enum stays the
single source of truth for the application concept (members, values, `db.enums`, typed
reads).

This exists primarily to **represent native enums Postgres databases already have** — above
all **Supabase**, whose schemas ship a large set of built-in native enums. Those are owned
by an external system, never created or altered by Prisma Next, and must still be
**surfaced to the application** as typed value unions. **Porting** an existing
Postgres/Supabase project is the same case: user-authored native enums must be
*representable* in the contract, not rejected.

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

**Phase 2 — Prisma Next creates and deletes native enums, plus the cheap ops.** An author
opts a domain enum into the native strategy; Prisma Next `CREATE TYPE` / `DROP TYPE`s it and
migrates it in place for **add value** and **rename value** only. Remove and reorder are
diagnosed and refused with a pointer to the manual procedure — never planned. This adds the
SchemaIR node, the projection, the diff integration, and the four migration ops, all in
cheap-ops-only form.

## The model (settled)

The spine (from the parent project): a domain enum is application-domain; **how it persists
is a storage strategy.** Native is one such strategy — and, crucially, **everything
downstream of the permitted values reuses the same machinery as the check strategy.** The
native-only pieces are exactly two: the managed type, and the cast.

- **Domain enum** (domain plane) — unchanged. Members (name→value) + codec. Powers
  `db.enums`; the origin of the permitted values.
- **`native_enum` entity** (storage plane, `entries.native_enum[name]`, kind
  `postgres-enum`, ordered `values`, optional `control` grade) — does **two** jobs:
  1. it is the **authoring source** of the permitted values;
  2. it is the **managed database object** whose lifecycle owns `CREATE TYPE` / `DROP TYPE`
     / `ALTER TYPE` — a target-owned top-level `DiffableNode`, the RLS policy/role template
     exactly (Components #2).
- **value-set** (storage plane, `entries.valueSet[name]`) — **derived from the
  `native_enum` entity's values.** This is the *same* canonical permitted-values structure a
  check-realized enum has — the one TML-2952/2953 establish as the single typing +
  enforcement source. Native does not invent a parallel structure; it derives this one.
- **column** — `nativeType` = the enum type name (`user_role`); `codecId` = the
  **`native_enum` codec**, a parameterized Postgres codec whose instance carries the enum's
  identity, so its `nativeType` is the type name and the adapter renders the `$1::user_role`
  cast (ADR 205, the inferrable-types allow-list); and a **`valueSet` reference** for typing
  (the shared machinery). **No `CHECK` on the table.**

**Downstream of the value-set it is all the regular-enum machinery:**

- **Typing** — value-set + codec → value union, via TML-2952's `renderValueType`. *Identical*
  to a check enum; there is no native-specific typing path. `db.enums` comes from the domain
  enum.
- **Enforcement** — a per-strategy *render* from the same value-set. **Native: the type
  itself enforces membership** (the `CREATE TYPE`'s value list is taken from the value-set);
  **no `CHECK`.** (Check → `CHECK (col IN (...))` from the value-set; Mongo → `$jsonSchema`
  `enum` from the value-set.) Same source, strategy-specific render.

## Authoring composition

The native enum composes into a model field through the **same surface as a domain enum** —
`field.namedType(handle)` (the DSL already overloads `namedType` for an `EnumTypeHandle`).
No new field-authoring API.

- The **handle carries the realization** (the strategy is structural and lives on the enum,
  not per-field): a native-realized enum handle is authored via the native marker on a domain
  enum (phase 2), or authored-and-contributed by the Supabase extension (phase 1).
- The **lowering branches** on the handle's realization:
  - *check* → domain enum + value-set + column `valueSet` ref + table `CHECK` (today).
  - *native* → domain enum + the `native_enum` entity (managed type + values) + the **derived
    value-set** + the column bound to the **`native_enum` codec** (for the cast) with a
    `valueSet` ref (for typing). **No `CHECK`.**
- The bound column is an ADR-208 **parameterized-codec `ColumnTypeDescriptor`**
  (`native_enum` codec, parameterized by the enum identity), so this reuses the same
  column-descriptor mechanism `field.column(vector(1536))` already uses — just produced from
  the enum handle.
- **Supabase (external):** the extension supplies the handle (the `native_enum` entity it
  owns, graded `external`); a user's field composes it with the same `field.namedType` call,
  or the existing cross-extension reference.

## At a glance

Phase 1 — a Supabase-defined native enum, represented and surfaced:

```jsonc
"storage": { "namespaces": { "public": { "entries": {

  // managed type + authoring source of the permitted values (external-graded)
  "native_enum": {
    "user_role": { "kind": "postgres-enum", "values": ["admin", "member", "guest"], "control": "external" }
  },

  // canonical permitted-values structure, DERIVED from native_enum — the TML-2952/2953 entity
  "valueSet": {
    "user_role": { "kind": "valueSet", "values": ["admin", "member", "guest"] }
  },

  "table": { "profiles": { "columns": {
    "role": {
      "nativeType": "user_role",
      "codecId": "pg/native-enum@1",          // gives the `$1::user_role` cast
      "typeParams": { "typeName": "user_role" },
      "nullable": false,
      "valueSet": { "plane": "storage", "entityKind": "valueSet",
                    "namespaceId": "public", "entityName": "user_role" }  // typing (shared machinery)
    }
  } } }
} } } }
```

```ts
const p = await db.profiles.findOne({ where: { id } })
p.role                            // 'admin' | 'member' | 'guest'   (not string)
db.enums.public.UserRole.values   // readonly ['admin','member','guest']
```

The values appearing in the `native_enum` entity, the derived `valueSet`, and (for Mongo,
elsewhere) the validator is the cross-level redundancy the emitter guarantees and ADR 172
sanctions — each part stays self-contained.

## Components

The persistence-strategy abstraction (#5) is the spine; the rest hang off it.

### #5 — Alternative persistence strategy (the spine; both phases)

A domain enum is application-domain; how it persists is a storage strategy. **check** (text
column + value-set + `CHECK`; family-agnostic) and **native** (`native_enum` type +
value-set; Postgres-only) are the two. The strategy is **structural** — the shape declares
it (enums spec §10), no marker field. **Both strategies derive the same value-set**, and
everything downstream (typing, enforcement-source) is shared. The choice is made by the
source: Phase 1 the database/extension dictates native; Phase 2 the author opts in.

### #1 — ContractIR representation (both phases)

- The `native_enum` entity (kind `postgres-enum`, ordered values, optional `control`) — a
  Postgres-target top-level entity kind, composed into the pack's `composeSqlEntityKinds([…,
  nativeEnumEntityKind])` alongside `policy`/`role`, with validator + serializer.
- The **derived value-set** (`entries.valueSet`) — the existing structure, reused.
- The **column→value-set join** is the coordinate `valueSet` reference (`{ plane: 'storage',
  entityKind: 'valueSet', namespaceId, entityName }`), exactly as a check enum; plus
  `nativeType` + the `native_enum` codec for the cast. **Settled: the legacy
  `StorageColumn.typeRef` + `storage.types` map is *not* used** — that slot is the
  codec-alias mechanism (`vector`/`geometry`/`uuid`), a different concept from a managed enum
  type (see Alternatives).

### #2 — SchemaIR representation (phase 2)

A `PostgresEnumType` `DiffableNode` — `identity()` on the type name, `isEqualTo()` over the
ordered values. Introspection enriched from the names-only `pg_type typtype='e'` query to
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

A native-enum column reads/writes as the **value union** via the value-set + codec machinery
(TML-2952's `StorageColumnTypes` / `renderValueType`) — *the same path a check enum uses*,
sourcing the union from the derived value-set. `db.enums` is unchanged (domain enum). The
no-emit (`typeof contract`) path propagates the authored handle values, as for any enum. The
native-only addition is the codec-emitted `::type` **cast** in generated SQL.

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

- **R1 — Represent.** A `native_enum` entity (kind `postgres-enum`, ordered values, optional
  `control`) round-trips through serializer + validator and is a first-class storage entity.
- **R2 — Derive + reference.** The `native_enum` entity derives a `valueSet`; the column
  references the `valueSet` (typing) and carries the `native_enum` codec + `nativeType` (cast).
  No `CHECK`. The domain enum is unchanged.
- **R3 — Surface (typed read).** A native-enum column reads as the value union (not `string`)
  in the query builder and ORM, emitted-contract and no-emit; typed input rejects out-of-set
  literals; generated SQL carries the `::type` cast where required.
- **R4 — `db.enums` parity.** `db.enums.<ns>.<Name>` works identically regardless of
  realization (it reads the domain enum).
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
- **Cruft to retire, not reuse.** The uncomposed `postgres-enum` arktype validator; and note
  `StorageColumn.typeRef` + `storage.types` is the **codec-alias** seam (vector/geometry) —
  a different concept, *not* the native-enum join. The names-only `nativeEnumTypeNames`
  introspection is superseded by #2's ordered-value introspection.

## Open decisions (genuinely remaining)

1. **Adopted-enum grade (R6).** Do enums from contract-infer come in `external` (observe-only,
   matches phase 1, nearly free) or `managed` (PN owns diff/migrate)? Leaning `external` for
   the first cut, with a manual promote-to-managed path later.
2. **Phase-1 source.** Supabase enums enter the contract via the extension's authoring
   (it declares them) and/or via introspection/adoption (porting). Both produce the same
   `native_enum` entity; the slice settles which path phase 1 ships first.

*(Settled during shaping: slot name `native_enum`; column→value-set join is the coordinate
`valueSet` ref, not the legacy `typeRef`/`storage.types`; native derives a value-set and
reuses the shared typing/enforcement machinery; the type enforces with no `CHECK`; authoring
via `field.namedType`; parallel-safe with TML-2952/2953.)*

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
