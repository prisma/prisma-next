# Native Postgres enums — project spec

## Decision

A domain enum can be **realized in storage as a native Postgres enum type**
(`CREATE TYPE … AS ENUM`) instead of a text column + value-set + `CHECK` constraint.
Native realization is a second **persistence strategy** for the *same* domain enum — the
domain plane is unchanged. The domain enum stays the single source of truth for the
application concept (members, values, `db.enums`, typed reads); only the storage
projection differs.

This exists primarily to **represent native enums that Postgres databases already have**
— above all Supabase, whose schemas ship a large set of built-in native enums. Those are
owned by an external system, never created or altered by Prisma Next, and must still be
**surfaced to the application** as typed value unions. A user porting an existing Supabase
(or any Postgres) project has user-authored native enums in the same position: they must
be representable in the contract rather than rejected.

Native realization is deliberately **Postgres-only**. SQLite and MongoDB have no native
enum; they keep the check/validator realization the domain enum already lowers to. This
is a SQL/Postgres-target storage feature, not a framework concept — consistent with the
domain enum being target-agnostic and its realization being per-target.

## Why native enums are awkward — and why this is staged

Native enums are painful to *change*, and that pain is the reason the project is phased
and the reason we never auto-migrate the expensive cases. The two operations Postgres
special-cased are cheap and in-place; everything else forces a full-table rewrite:

| Operation | Cost | In-place? |
| --- | --- | --- |
| Add a value (`ALTER TYPE … ADD VALUE`) | 1 txn, no rewrite, no data change | yes (but the new value is unusable until the adding txn commits) |
| Rename a value (`ALTER TYPE … RENAME VALUE`) | 1 txn, no rewrite, no data change | yes |
| Remove a value | rebuild type + repoint column + drop old | **no** — full-table rewrite + data migration |
| Reorder values | rebuild type + repoint column + drop old | **no** — full-table rewrite |

A column stores a reference bound to a specific type, so repointing it to a rebuilt type
re-encodes every row into a new table file under a lock that blocks all reads and writes.
`ADD VALUE` also can't be used in the same transaction that adds it — which breaks the
atomic-migration guarantee Prisma Next relies on. The user-facing rationale lives in
[`docs/`-bound `why-native-postgres-enums.md`](specs/why-native-postgres-enums.md) (the
shareable explainer; migrate to `docs/` at close-out).

The consequence for scope: Prisma Next will support **add** and **rename**, and **never**
auto-migrate **remove** or **reorder** — those stay user-managed (drop the type, create
the replacement, `ALTER` the column by hand). This is what keeps the project clear of
dependency-aware planner ordering and transaction-grouping.

## Two-phase roadmap

**Phase 1 — externally-managed native enums, surfaced to the app.**
Represent a native enum type in the contract and type columns that use it as the value
union. Native enums here are graded `external` (the Supabase extension's default
`control` posture), so Prisma Next emits **no DDL** for them — no create, no alter, no
drop. This cuts the entire migration half: no SchemaIR diff, no Contract→SchemaIR
projection, no migration ops. Phase 1 is representation + typing only.

**Phase 2 — Prisma Next creates and deletes native enums, plus the cheap ops.**
A user can author a domain enum with the native strategy and Prisma Next will
`CREATE TYPE` / `DROP TYPE` it, and migrate it in place for **add value** and
**rename value** only. Remove and reorder are diagnosed and refused with a pointer to the
manual procedure — never planned. This adds the SchemaIR node, the projection, the diff
integration, and the four migration ops, all in cheap-ops-only form.

## At a glance

Phase 1 — a Supabase-defined native enum, represented and surfaced:

```jsonc
// storage plane — a native enum type as a top-level storage entity (external-graded)
"storage": { "namespaces": { "public": { "entries": {
  "type": {
    "user_role": {
      "kind": "postgres-enum",
      "values": ["admin", "member", "guest"],
      "control": "external"
    }
  },
  "table": {
    "profiles": {
      "columns": {
        "role": {
          "nativeType": "user_role",
          "codecId": "pg/text@1",
          "nullable": false,
          "type": { "plane": "storage", "entityKind": "type",
                    "namespaceId": "public", "entityName": "user_role" }
        }
      }
    }
  }
} } } }
```

```ts
const p = await db.profiles.findOne({ where: { id } })
p.role                        // 'admin' | 'member' | 'guest'   (not string)
db.enums.public.UserRole.values   // readonly ['admin','member','guest']
```

The domain plane carries the enum exactly as today (`domain…enum[UserRole]`, members +
codec). The storage plane gains a native `type` entity and the column references it — in
place of the value-set + check a domain-authored enum lowers to.

## Components

The six pieces, mapped to phases. The persistence-strategy abstraction (#5) is the spine;
the rest hang off it.

### #5 — Alternative persistence strategy (the spine; both phases)

A domain enum is application-domain; **how it persists is a storage strategy**:

- **check** (today): storage `valueSet` entity + column `valueSet` ref + table `checks`
  `CheckConstraint`. Family-agnostic; SQLite/Mongo use it.
- **native** (new, Postgres-only): storage `type` (`postgres-enum`) entity carrying the
  ordered values + the column referencing that type via `nativeType` + a `type` ref; **no**
  value-set, **no** check.

The strategy is **structural**, per the parent project's principle (enums spec §10 — the
shape declares the strategy, no marker field). A column realized natively *has* a
`type`-entity reference and *no* value-set/check; a check-realized column has the reverse.
A consumer asks "what's the permitted value set for this column?" and resolves it from
whichever is present.

How the strategy is *chosen* differs by phase:
- Phase 1 (external): the source dictates it — the Supabase extension contributes a native
  `type` entity, or adoption introspects one. The enum is native because the database made
  it native.
- Phase 2 (PN-managed): the author opts in (PSL/TS authoring attribute selecting native
  realization on a domain enum). Default stays check.

### #1 — ContractIR representation (both phases)

- A storage `type` entity, kind `postgres-enum`, carrying ordered `values` and an optional
  `control` grade. A Postgres-target top-level entity kind — the RLS template (policy /
  role) exactly.
- The column→type join: a storage column expresses "my type is native enum X." The clean
  shape is a coordinate reference parallel to `valueSet` (`{ plane: 'storage', entityKind:
  'type', namespaceId, entityName }`), with `nativeType` set to the enum type's name.
  *(Open: reuse the legacy `StorageColumn.typeRef` bare-string seam, or replace it with the
  coordinate ref — see Open decisions.)*
- Validator + serializer for the `type` slot, composed into the Postgres pack's
  `composeSqlEntityKinds([… , typeEntityKind])` alongside `policy`/`role`.

### #6 — Query / typing (both phases)

A column whose strategy is native reads and writes as the **value union**, via the
TML-2886 `StorageColumnTypes` baked-lookup path — the same mechanism the check strategy
uses, sourcing the union from the `type` entity's `values` instead of a value-set's. No
type-level ref-following; the emitter bakes the literal. `db.enums.<ns>.<Name>` is
unchanged (it reads the domain enum). The no-emit (`typeof contract`) path resolves the
union the same structural way.

### #2 — SchemaIR representation (phase 2)

A `PostgresEnumType` `DiffableNode` — `identity()` keyed on the type name (entityKind
`'type'`), `isEqualTo()` over the ordered values. Introspection enriched from the current
names-only `pg_type typtype='e'` query to capture **ordered values** (`pg_enum.enumsortorder`).
Follows `PostgresRole` precisely.

### #3 — Migration diff + Contract→SchemaIR projection (phase 2)

Project the contract's native `type` entities into `PostgresSchemaIR` (a new
`enumTypes` typed field, mirroring `rlsPolicies`/`roles`), and let the generic differ
align expected vs. introspected enum types and report missing / extra / mismatch. The
`external`/`observed` grade suppresses drift the same way it does for RLS — so even in
phase 2 the externally-managed enums from phase 1 stay untouched.

### #4 — Migration ops / factories / call objects (phase 2, cheap-ops-only)

`OpFactoryCall` classes for **create** (`CREATE TYPE … AS ENUM`), **delete**
(`DROP TYPE`), **add value** (`ALTER TYPE … ADD VALUE`), and **rename value**
(`ALTER TYPE … RENAME VALUE`). A value-removal or reorder diff is **refused with a
diagnostic** pointing to the manual procedure — never lowered to an op. Ordering need is
only "type before the column that uses it," which the planner's existing `'type'` →
dependency bucket already models coarsely; add/rename touch no columns. `ADD VALUE`'s
non-transactional caveat is surfaced to the runner, not worked around.

## Requirements

- **R1 — Represent.** A native Postgres enum type is a first-class storage entity
  (`storage…entries.type[Name]`, kind `postgres-enum`, ordered values, optional `control`),
  round-tripping through serializer + validator.
- **R2 — Reference.** A storage column expresses native realization by referencing the
  `type` entity; the domain field/enum is unchanged. The strategy is structural (native ⇒
  type-ref, no value-set/check).
- **R3 — Surface (typed read).** A native-enum column reads as the value union (not
  `string`) in the query builder and the ORM, through the emitted contract and the no-emit
  path. Typed input rejects out-of-set literals.
- **R4 — `db.enums` parity.** `db.enums.<ns>.<Name>` works identically regardless of
  realization (it reads the domain enum).
- **R5 — External grade.** Native enums graded `external`/`observed` produce no DDL and no
  drift reports; the Supabase extension's `external` default applies to its contributed
  enums.
- **R6 — Adopt (porting).** Contract-infer emits the native `type` representation for an
  introspected native enum instead of throwing. *(Grade of adopted enums: Open decision.)*
- **R7 — Create / delete (phase 2).** An author-selected native enum is created
  (`CREATE TYPE … AS ENUM`, declared order) and dropped (`DROP TYPE`), ordered after/before
  the columns that depend on it, proven against a live database.
- **R8 — Cheap in-place ops (phase 2).** Adding a value and renaming a value migrate in
  place (`ADD VALUE` / `RENAME VALUE`) with no table rewrite, verified against a database.
- **R9 — Refuse the expensive ops (phase 2).** A diff that would remove or reorder values
  is refused with a diagnostic naming the manual procedure — never planned. (Verified by a
  negative test.)
- **R10 — Verify (phase 2).** For managed native enums, the generic differ reports
  missing / extra / value-set mismatch against the live database.

## Non-goals

- **Auto-migrating value removal or reorder.** Permanently out — they force a full-table
  rewrite; users manage them by hand. The project refuses, it does not plan them.
- **Native enums on SQLite / MySQL / MongoDB.** No native enum exists there; the check /
  validator realization stays.
- **Dependency-aware planner ordering + transaction-grouping (RLS follow-on B).** Excluded
  by the cheap-ops-only scope. If a future feature wants the expensive ops, it pulls this
  in then.
- **Making native the default realization.** The default stays check (cross-target,
  cheap-to-change). Native is opt-in (phase 2) or external-sourced (phase 1).
- **Migrating existing check-realized enums to native (or back).** A realization swap is a
  separate future want, not this project.

## What this builds on (and the cruft to evaluate, not trust)

- **RLS machinery (the template).** `PostgresRlsPolicy` / `PostgresRole` are target-owned
  top-level `DiffableNode`s composed via `composeSqlEntityKinds`, diffed by the generic
  differ, graded by `control` policy. `PostgresEnumType` follows this exactly. Requires the
  RLS differ + extension-contribution seam landed (slice 1.5 / PR #868 and the
  contribution-seam work) — **not** the full RLS feature set.
- **TML-2886 `StorageColumnTypes`.** The baked storage-column-type lookup that types a
  column as its value union; native-enum columns ride it.
- **Leftover pre-migration plumbing — evaluate, do not assume well-designed.** A
  `postgres-enum` arktype validator exists but is uncomposed/unwired; `StorageColumn.typeRef`
  + a `storage.types` map are still resolved by the Postgres/SQLite planners
  (`planner-type-resolution.ts`). These are the old hacky-enum seams. Parts may be reusable;
  the design target is the clean shape above, and any reuse must be justified against it,
  not adopted by default.

## Open decisions (surface before/at slice shaping)

1. **Column→type join shape.** Reuse the legacy `StorageColumn.typeRef` bare-string +
   `storage.types` map, or introduce a coordinate `type` ref parallel to `valueSet`?
   Leaning coordinate ref (consistent with every other reference site; the bare string
   drops the namespace coordinate). Cost: it diverges from the planner code that currently
   reads `typeRef`.
2. **Entity-kind slot name.** `type` (generic — could later host domains/composites) vs.
   `enum`-native-specific. The domain plane already owns `enum`; the storage slot needs a
   distinct name. Leaning `type` with `kind: 'postgres-enum'` (slot generic, kind specific).
3. **Adopted-enum grade (R6).** Do enums from contract-infer come in `external`
   (observe-only, matches phase 1, nearly free) or `managed` (PN owns the diff/migrate,
   pulls in the phase-2 verify path)? Leaning `external` for the first cut, with a manual
   promote-to-managed path later.
4. **Phase-1 source: extension-declared vs. introspected.** Does Supabase contribute the
   native `type` entities through authoring, or are they introspected/adopted? Affects
   whether phase 1 needs any introspection at all.

## Alternatives considered

- **A `codec | nativeEnum` union on the column type.** Rejected for the same reason the
  parent project rejected it for the domain field: every column has a codec, always; native
  realization is an additive structural fact (a `type` reference), not a replacement of the
  codec slot.
- **Native as the default Postgres realization.** Rejected: native can't cheaply remove or
  reorder values and forces table rewrites; check is the safe default. Native is opt-in.
- **Reusing the legacy `typeRef` + `storage.types` map as-is.** Held open (decision 1) but
  not assumed: it predates the domain/storage split and drops the namespace coordinate.
- **Supporting remove/reorder via an automatic temporary-superset rebuild.** Rejected: two
  full-table rewrites and a throwaway type, on an operation users can do by hand with full
  control over the data migration. We refuse and document instead.
- **A framework-level "native enum" concept.** Rejected: native enums are a Postgres
  storage realization; the framework holds only the target-agnostic domain enum. Keeping
  native in the Postgres target preserves the layering the parent project established.
