# Design notes: enums-as-domain-concept

> Synthesized design document for `enums-as-domain-concept`. Read this to understand
> **what the design is**, **what principles it serves**, and **what alternatives were
> considered and rejected**. It captures the settled design, standing independently of
> the discussion that produced it. The spec (`./spec.md`) is the authoritative,
> requirement-mapped statement; this document is the rationale behind it.

## Principles this design serves

- **A codec is a type; an enum is a restriction on it.** A column's type is its codec
  (the set of assignable values). An enum does not replace the codec — it narrows the
  permitted values to a named subset. Every field/column keeps its codec, always.
- **Domain concept vs storage projection (ADR 172).** The application's enum (named,
  ordered members) is a domain concept; the permitted physical values are a storage
  concept. Each lives in its own plane, referenced within that plane.
- **Single source, emitted projections.** The domain enum is the one authored source.
  Storage and runtime copies are emitted from it, so they cannot drift — the same
  redundancy ADR 172 already accepts for nullability and native types.
- **Structure carries strategy (no markers).** As with polymorphism and ownership, the
  persistence strategy is implied by the shape (text column + value-set + check), not a
  separate flag. Changing the strategy is a visible structural diff.
- **One reference rule everywhere (ADR 221 / PR #745).** References use the full
  space-aware entity coordinate, never bare names — uniform with relations and FKs.
- **Delete native enums; keep the seam.** Native `CREATE TYPE … AS ENUM` carries
  operational pain (no value removal without rebuild, transaction caveats, text-only).
  It is removed now and, because the strategy is structural, can return later as a
  different storage shape under the same unchanged domain enum.

## The model

An enum is an ordered map from a member **name** (a code identifier) to a member
**value** (the runtime value the column stores). The two are independent; the **value**
is the runtime identity used in the ORM, the query builder, raw SQL, and the wire.

### Domain plane — the concept

`domain.namespaces[ns].enum[Name]` carries an explicit `codecId` and ordered
`members: [{ name, value }, …]`. The codec is required (declared, never inferred) and
its input type constrains the member value type. A field that uses the enum keeps its
always-present `codecId` and adds a `valueSet` restriction referencing the enum.

### Storage plane — the physical projection

`storage.namespaces[ns].valueSet[Name]` carries ordered `values: […]` — a bare, named
set of permitted physical values (no member names, no application semantics; a
storage-legitimate concept). A column keeps its `codecId` + `nativeType` and adds a
`valueSet` restriction referencing the storage value-set. The value-set is referenced,
not inlined, so the values live once per plane.

### Restriction and enforcement are separate jobs

- The column's **`valueSet` property** is the *notional* restriction — read the column
  in isolation and you know its value space. This types the client (ORM from the domain
  field, query builder from the storage column), present whether or not the database
  enforces anything.
- The **check constraint** (`StorageTable.checks[]`, referencing the same value-set) is
  the *server-side* enforcement. A column may carry the restriction with or without the
  check.

### References

`valueSet` (and the `enumMember` default) carry a discriminated, space-aware coordinate:
`kind` (the source entity-kind) + `namespaceId` (admitting the `__unbound__` sentinel) +
`name`, plus an optional `spaceId` whose presence is the cross-space discriminator — the
TML-2500 / PR #745 carrier convention. Domain → domain and storage → storage references
are intra-plane; the `enumMember` default is storage → domain, permitted by ADR 221's
directional invariant.

### Typing and surface

Read/write types are the codec's `Output`/`Input` narrowed to the value-set's values
(`string` → `'user' | 'admin'`). `db.enums.<Name>` exposes the ordered, literal-typed
value tuple and member accessors. `ORDER BY` follows declaration order, rendered per
target from the ordered values.

## Alternatives considered

- **Enum as a storage-plane entity (the original approach).** Attractive: it was already
  half-built (`PostgresEnumType`). **Rejected because:** it puts the source of truth in
  the wrong plane, forcing every application-facing feature to reach down into storage
  for the values — the breakage this project removes.
- **Native `CREATE TYPE … AS ENUM` as the storage realization.** Attractive: a real,
  shared, introspectable type. **Rejected because:** Postgres-only, no value removal
  without rebuild, transaction caveats, text-only. Value-set + check works on every SQL
  target with ordinary `ALTER TABLE`s; native can return later as a different structure.
- **Field/column type as a `codec | enum` union.** Attractive: explicit. **Rejected
  because:** it breaks the "every field/column has a codec, always" invariant — a
  foundational change that ripples everywhere. A codec *is* the type; the enum is
  additive.
- **A named enum entity in the storage plane.** Attractive: symmetry with the domain
  enum. **Rejected because:** with native types gone there is no physical object to name;
  a storage "enum" would be a domain concept in a plane meant for concrete artifacts. The
  bare value-set is the storage-legitimate version.
- **Inlining permitted values on each column/check.** Attractive: storage fully
  self-contained for DDL. **Rejected because:** it duplicates the list per site. The
  named value-set, referenced intra-plane, keeps values once and storage still resolves
  without leaving its plane.
- **A literal default instead of an `enumMember` variant.** Attractive: no new
  `ColumnDefault` shape. **Rejected because:** a column now openly carries an enum
  restriction, so a member-referenced default is the natural corollary and records
  intent; the fixture cost is small.
- **An explicit persistence-strategy marker.** **Rejected because:** the structure
  declares the strategy (as in polymorphism/ownership); a marker would be a second source
  of truth.
- **Bare-name references.** **Rejected because:** names collide and need lexical context;
  the full space-aware coordinate is the uniform rule.
- **Authoring as a `Map` / bare object / array of pairs.** **Rejected because:** a `Map`
  erases literals; an object reorders integer-like keys and collides the accessor with
  type properties; pairs are unergonomic. The `member()` variadic preserves order and
  literals.
- **A per-enum runtime validator (e.g. arktype).** **Rejected because:** the compile-time
  union and the database check already enforce membership; a third check is redundant
  defense.
- **An ecosystem enum library** (Zod / Effect / enumify / …). **Rejected because:** each
  either collapses name into value or uses runtime classes (against no-runtime-codegen);
  none gives ordered + independent name/value + literal inference. The ~30-line
  `enumType` is hand-rolled.

## Open questions

- **Realization layer** — implement value-set + check at the SQL-family layer
  (MySQL/SQLite inherit) or Postgres-only now? **Working position:** family-layer; the
  structured check is dialect-agnostic.
- **PSL surface** for declaring an enum's codec and per-member values. **Working
  position:** an explicit codec annotation on the `enum` block + per-member `@map` for
  the value; exact syntax settled at slice-plan time.
- **`db.enums` scope** — local to this project or the first instance of a broader
  domain-client surface for IR-modelled entities? **Working position:** ship it here,
  shaped so a later generalization is non-breaking.
- **Reference-carrier coupling** — the `valueSet`/default refs track TML-2500 / PR #745;
  if that convention shifts before this lands, these refs shift with it. **Working
  position:** conform to the merged M1 carrier; local refs need no `spaceId`.

## References

- Project spec: [`./spec.md`](./spec.md)
- Project plan: [`./plan.md`](./plan.md)
- [ADR 172 — Contract domain-storage separation](../../docs/architecture%20docs/adrs/ADR%20172%20-%20Contract%20domain-storage%20separation.md)
- [ADR 221 — Contract IR two planes, uniform entity coordinate, pack-contributed kinds](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)
- TML-2500 / PR #745 — cross-contract-space FK reference carrier (the reference coordinate convention)
