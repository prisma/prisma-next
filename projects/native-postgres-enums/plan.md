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

### Slice 1 — `native-enum-representation-typing-and-access` (PSL vertical)
- **Outcome:** A `native_enum` **PSL block** lowers to a storage `native_enum`
  entity **and a derived `StorageValueSet`**, and a column bound via `pg.enum(Ref)` — carrying
  `{ codecId, valueSet ref, nativeType }` — reads/writes as the **value union**
  (`'aal1' | 'aal2' | 'aal3'`, not `string`) in the query builder, ORM, and emitted contract,
  via the existing value-set → codec machinery; generated SQL carries the `$N::<type>` cast; and
  `db.native_enums.<ns>.<Name>` exposes the members at runtime. Members are `key = "value"`
  (bare rejected). Graded `external` (no DDL — and no diff in the MVP).
- **TS authoring is deferred** to [TML-2965] (see Slice 3): the TS mirror needs generic
  `ContractDefinition` pack-entity attachment — shared with RLS role/policy, and unused by the
  MVP's PSL/Supabase path. Slice 1 ships the complete **PSL** vertical.
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
    entities, attached to the Postgres client **only**, reusing `EnumAccessor`. Typed per
    namespace as an open `Record<string, EnumAccessor>` — runtime-correct in both emitted and
    no-emit. Per-name literal accessor typing is deferred: the storage plane isn't type-emitted
    per-entity, so it composes with the value-set typing boundary (TML-2960). `db.enums` untouched.
- **Reused as-is:** the **value-set → codec typing** (post-TML-2952, *unchanged* — a native
  column carries a `valueSet` ref exactly like a check-enum column); the `StorageValueSet`
  structure; the variadic PSL block mechanism; the pack-entity authoring + `composeSqlEntityKinds`
  + serializer (RLS template); the `EnumAccessor` mechanics; the codec plumbing
  (`AstCodecResolver`) for decode.
- **Builds on:** nothing (foundation).
- **Hands to:** the `native_enum` entity + derived value-set + `pg.enum` column shape +
  `db.native_enums` that the Supabase slice consumes.
- **Proven by:** an authored **PSL** fixture with a `native_enum` + a column using it →
  type-tests asserting the value union (QB, ORM, emitted contract), negative tests for
  out-of-set input and a bare member, an execution test asserting `$N::<type>` in generated SQL,
  and a runtime test for `db.native_enums.…members`. `fixtures:check`. (No-emit column typing is
  out of scope — TML-2960; TS authoring is out of scope — TML-2965.)

### Slice 2 — `supabase-native-enums` (also the slice-1 e2e proof) — DELIVERED
- **Delivered:** the schema-qualification fix (`b8c4a69a7`) + the Supabase demonstration
  (`1a3306cf4`). Running the feature for real exposed that slice 1 was incomplete for non-`public`
  schemas — the `$N::type` cast and `db verify` both used the bare `@@map` type name, so an `auth`
  enum needs `auth.aal_level`. Fixed by qualifying the column's `nativeType` by its namespace; the
  same fix corrects both the cast and verify. Also wired `db.native_enums` onto the Supabase
  client's `.supabase` root (D4 had it on the plain postgres client only). The executed example
  test proves typed read + `db.native_enums` + the `$N::auth.aal_level` cast against real Postgres.
- **Outcome:** The Supabase extension declares its built-in native enums in
  `packages/3-extensions/supabase/src/contract/contract.prisma`; the supabase example uses one
  on a column, reads it as a typed union, and reaches its members via `db.native_enums`;
  `db verify` / migration emits nothing for the type (external, and un-diffed in the MVP). This
  real example-app demonstration **subsumes the synthetic D5 fixture** — an executed example is a
  stronger emit-then-consume proof than a test-only fixture.
- **First enum:** `auth.aal_level` (`aal1`/`aal2`/`aal3`, the one member set already grounded in
  the repo) on a new `AuthSession` model (`@@map("sessions")`), `aal pg.enum(AalLevel)?`.
- **New code:** the `native_enum` + `AuthSession` declarations in the Supabase extension's
  contract; example usage; and — since the enum is **external** — a `CREATE TYPE auth.aal_level`
  + `sessions` table in the example's `bootstrapSupabaseShim` seed (PN emits no DDL, so the dev
  DB must already own the type).
- **Reused as-is:** slice 1; the extension authoring path; the example's executed integration
  harness (`@prisma/dev` disposable Postgres, `.supabase` service-role root).
- **Builds on:** slice 1.
- **Hands to:** the shipped external-enum capability (the project's purpose).
- **Proven by:** the supabase example end-to-end — a Supabase-defined native enum represented,
  typed read + `db.native_enums` at runtime, and `db verify` reporting nothing for it. The
  bound-param `$N::auth.aal_level` cast is exercised and its schema-qualification behaviour
  verified (a non-`public` enum type needs a schema-qualified cast).

### Slice 3 — `native-enum-ts-authoring-mirror` (deferred → [TML-2965])
- **Outcome:** A `native_enum` is authorable in the TS DSL (`helpers.nativeEnum(...)` +
  `field.column(pg.enum(handle))`), producing a contract byte-identical to the PSL version.
- **New code:** generic `ContractDefinition` pack-entity attachment — route author-declared,
  namespace-scoped pack entities into `entries.<kind>` at `createNamespace` time (**shared with
  RLS role/policy**, which face the identical gap); a `pg.enum(handle)` TS descriptor function;
  `helpers.nativeEnum` ergonomics. The column/codec plumbing (`ColumnTypeDescriptor.valueSet` /
  `valueSetEnforcement`) already exists — no new machinery there.
- **Deferred:** not MVP-blocking (Supabase enums are PSL-authored). Best sequenced with the RLS
  TS-authoring-surface work, which needs the identical attachment mechanism. Do not start before
  Supabase ships. Tracked as [TML-2965].
- **Proven by:** a PSL + TS byte-identical parity test (mirror
  `contract-psl/test/ts-psl-parity.test.ts`).

## Sequencing
- **Slice 1 first** — the foundation; slice 2 consumes its entity + column + accessor.
- **Slice 2 after** — one stack thread; no parallelism worth modelling.
- **Slice 3 deferred** ([TML-2965]) — the TS authoring mirror; picked up with the RLS
  TS-authoring surface, not before Supabase ships.

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
Linear intentionally skipped for the MVP slices 1–2 (operator call); tracked here in-repo.
Cross-cutting follow-ups filed: **TML-2960** (no-emit per-instance column typing) and **TML-2965**
(TS authoring mirror + generic `ContractDefinition` pack-entity attachment, shared with RLS).

## Residue (already handled)
The dead TML-2853 validator (`postgres-enum-type-schema.ts`) is **already deleted**. The
`ISSUE_KIND_ORDER` keys are **live generic infrastructure, kept** — not residue. No custom
seams: `native_enum` rides the generic pack-entity mechanism; typing rides the generic
value-set → codec path.
